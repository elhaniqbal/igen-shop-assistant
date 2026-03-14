#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include "driver/twai.h"   // ESP32 CAN (TWAI) driver

// =======================================================
// IGEN Shop Assistant — Cake Spinner Node (Refactor)
// - Keeps CAN RX (TWAI) + Serial command parsing
// - Drops inventory/slot state + encoder verification for now
// - Implements deterministic cake movement:
//      CAKE <id> DISPENSE  -> rotate +60° (CW)
//      CAKE <id> RETURN    -> rotate -60° (CCW)
// - Supports 6 cakes (id 1..6); this node responds only to its CAKE_ID
// =======================================================

// ---------------- Pins ----------------
#define STEP_PIN 18
#define DIR_PIN  19
#define EN_PIN   32
#define MS1_PIN  33
#define MS2_PIN  25

// ---------------- CAN pins / node ----------------
#define CAN_TX 13
#define CAN_RX 14

// This firmware instance controls one cake.
// Set per-board / per-node (e.g., DIP switch later).
#define CAKE_ID 1

// ---------------- Motion constants ----------------
static const int   BASE_STEPS_PER_REV = 200;   // 1.8° motor
int   microstep   = 16;                        // MUST match real driver microstep
int   stepsPerRev = BASE_STEPS_PER_REV * 16;   // 3200 if microstep=16

// Gearbox + belt: motor revs per cake rev
// Gearbox 10:1 (10 motor rev = 1 gearbox out rev)
// Belt: small (10T) on gearbox driving big (40T) on cake => gearbox out rev / cake rev = 40/10 = 4
static const float GEARBOX_RATIO = 10.0f;
static const float PULLEY_DRIVER_TEETH = 10.0f;   // small on gearbox output
static const float PULLEY_DRIVEN_TEETH = 40.0f;   // large on cake
static const float BELT_RATIO = PULLEY_DRIVEN_TEETH / PULLEY_DRIVER_TEETH; // 4
static const float TOTAL_RATIO = GEARBOX_RATIO * BELT_RATIO;               // 40

// Cake has 6 spokes => 60° per spoke move
static const uint8_t SPOKES = 6;
static const float   SPOKE_DEG = 360.0f / (float)SPOKES; // 60 deg

// Speed (cake deg/s). 90 deg/s is pretty quick; tune as needed.
float degPerSecCake = 90.0f;

// Pulse timing floor (smaller = faster). 80us is a good ESP32 starting point.
static const uint32_t MIN_US_HALF = 80;

// Direction polarity
static const bool dirCwHigh = true;   // DIR=HIGH = CW (flip if wrong)

// ---------------- CAN / TWAI ----------------
static bool canOK = false;

// ---------- Microstepping ----------
static void applyMicrostepPins() {
  pinMode(MS1_PIN, OUTPUT);
  pinMode(MS2_PIN, OUTPUT);

  bool ms1 = LOW;
  bool ms2 = LOW;

  // NOTE: mapping depends on driver/module; keep your known-good mapping.
  switch (microstep) {
    case 1:   ms1 = LOW;  ms2 = LOW;  break;
    case 2:   ms1 = HIGH; ms2 = LOW;  break;
    case 4:   ms1 = LOW;  ms2 = HIGH; break;
    case 8:   ms1 = HIGH; ms2 = HIGH; break;
    case 16:  ms1 = HIGH; ms2 = HIGH; break;
    default:  ms1 = LOW;  ms2 = LOW;  break;
  }

  digitalWrite(MS1_PIN, ms1);
  digitalWrite(MS2_PIN, ms2);
}

static bool setMicrostep(int m) {
  if (m != 1 && m != 2 && m != 4 && m != 8 && m != 16) {
    Serial.println(F("[cfg] invalid microstep (use 1,2,4,8,16)"));
    return false;
  }
  microstep   = m;
  stepsPerRev = BASE_STEPS_PER_REV * microstep;
  applyMicrostepPins();
  Serial.print(F("[cfg] microstep="));
  Serial.print(microstep);
  Serial.print(F(" stepsPerRev="));
  Serial.println(stepsPerRev);
  return true;
}

// ---------- Stepper low-level ----------
static inline void stepPulse(uint32_t usHalf) {
  digitalWrite(STEP_PIN, HIGH);
  delayMicroseconds(usHalf);
  digitalWrite(STEP_PIN, LOW);
  delayMicroseconds(usHalf);
}

static void moveSteps(long steps, bool cw, uint32_t usHalf) {
  if (steps <= 0) return;

  digitalWrite(DIR_PIN, (cw == dirCwHigh) ? HIGH : LOW);

  // enable (active-low)
  digitalWrite(EN_PIN, LOW);
  delayMicroseconds(5);

  for (long i = 0; i < steps; i++) {
    stepPulse(usHalf);
  }

  // disable
  digitalWrite(EN_PIN, HIGH);
}

// ---------- Kinematics: cake degrees -> steps ----------
static void moveCakeByDegrees(float cakeDeg) {
  if (!isfinite(cakeDeg) || fabsf(cakeDeg) < 0.01f) return;

  bool cw = (cakeDeg > 0.0f);
  float absCakeDeg = fabsf(cakeDeg);

  // cake degrees -> motor degrees (multiply by total ratio)
  float motorDeg = absCakeDeg * TOTAL_RATIO;

  // motor degrees -> step pulses
  long steps = lroundf((motorDeg * (float)stepsPerRev) / 360.0f);
  if (steps <= 0) return;

  // speed: cake deg/s -> motor steps/s
  float motorDegPerSec = degPerSecCake * TOTAL_RATIO;
  float sps = (motorDegPerSec * stepsPerRev) / 360.0f;
  if (sps < 50.0f) sps = 50.0f;

  float period_us = 1e6f / sps;
  uint32_t usHalf = max((uint32_t)(period_us / 2.0f), MIN_US_HALF);

  Serial.print(F("[move] cakeDeg="));
  Serial.print(cakeDeg, 2);
  Serial.print(F(" motorDeg="));
  Serial.print(cw ? motorDeg : -motorDeg, 2);
  Serial.print(F(" steps="));
  Serial.print(steps);
  Serial.print(F(" usHalf="));
  Serial.println(usHalf);

  moveSteps(steps, cw, usHalf);
}

// ---------- Actions ----------
static bool performDispense() {
  // For this refactor: DISPENSE = +1 spoke (60° CW)
  Serial.println(F("[act] DISPENSE -> +60deg CW"));
  moveCakeByDegrees(+SPOKE_DEG);
  return true;
}

static bool performReturn() {
  // For this refactor: RETURN = -1 spoke (60° CCW)
  Serial.println(F("[act] RETURN -> -60deg CCW"));
  moveCakeByDegrees(-SPOKE_DEG);
  return true;
}

// ---------- CAN helpers ----------
static void initCAN() {
  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
    (gpio_num_t)CAN_TX,
    (gpio_num_t)CAN_RX,
    TWAI_MODE_NORMAL
  );
  twai_timing_config_t t_config  = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t f_config  = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) == ESP_OK) {
    if (twai_start() == ESP_OK) {
      Serial.println(F("[can] TWAI started @500kbps"));
      canOK = true;
    } else {
      Serial.println(F("[can] ERROR: twai_start failed"));
    }
  } else {
    Serial.println(F("[can] ERROR: twai_driver_install failed"));
  }
}

static void sendCanAck(const String &msg) {
  if (!canOK) return;

  twai_message_t tx = {};
  // Use identifier as CAKE_ID for now; adjust to your bus schema later.
  tx.identifier = (uint32_t)CAKE_ID;
  tx.extd = 0;
  tx.rtr  = 0;
  tx.data_length_code = (msg.length() > 8) ? 8 : msg.length();

  for (int i = 0; i < tx.data_length_code; i++) {
    tx.data[i] = (uint8_t)msg[i];
  }

  if (twai_transmit(&tx, pdMS_TO_TICKS(20)) == ESP_OK) {
    Serial.print(F("[ack] sent: "));
    Serial.println(msg);
  } else {
    Serial.println(F("[ack] FAILED to send"));
  }
}

// Parse: "CAKE <id> DISPENSE" or "CAKE <id> RETURN"
static bool parseCakeCommand(const String &cmd, int &cakeIdOut, String &verbOut) {
  String s = cmd;
  s.trim();
  if (s.length() == 0) return false;

  // Normalize whitespace
  s.replace('\t', ' ');
  while (s.indexOf("  ") >= 0) s.replace("  ", " ");

  // Tokenize
  int sp1 = s.indexOf(' ');
  if (sp1 < 0) return false;
  String t0 = s.substring(0, sp1);
  t0.toUpperCase();

  int sp2 = s.indexOf(' ', sp1 + 1);
  if (sp2 < 0) return false;

  String t1 = s.substring(sp1 + 1, sp2);  // id
  String t2 = s.substring(sp2 + 1);       // verb
  t2.trim();
  t2.toUpperCase();

  if (t0 != "CAKE") return false;

  int id = t1.toInt();
  if (id <= 0) return false;

  if (!(t2 == "DISPENSE" || t2 == "RETURN")) return false;

  cakeIdOut = id;
  verbOut = t2;
  return true;
}

static void handleCommand(const String &cmd) {
  String s = cmd;
  s.trim();
  if (s.length() == 0) return;

  // Also support quick local commands:
  //  help, onecw, oneccw, spd <x>, ms <x>
  String low = s;
  low.toLowerCase();

  if (low == "help") {
    Serial.println(F("Commands (Serial or CAN ASCII):"));
    Serial.println(F("  CAKE <id> DISPENSE   -> +60deg CW"));
    Serial.println(F("  CAKE <id> RETURN     -> -60deg CCW"));
    Serial.println(F("  onecw / oneccw       -> local test move"));
    Serial.println(F("  spd <deg_per_sec>    -> set cake speed"));
    Serial.println(F("  ms <1|2|4|8|16>       -> set microstep var + pins"));
    return;
  }

  if (low == "onecw") { performDispense(); return; }
  if (low == "oneccw") { performReturn(); return; }

  if (low.startsWith("spd ")) {
    float v = s.substring(4).toFloat();
    if (v > 0.1f) {
      degPerSecCake = v;
      Serial.print(F("[cfg] degPerSecCake="));
      Serial.println(degPerSecCake, 2);
    } else {
      Serial.println(F("[cfg] speed must be >0"));
    }
    return;
  }

  if (low.startsWith("ms ")) {
    int m = s.substring(3).toInt();
    setMicrostep(m);
    return;
  }

  // CAKE protocol
  int cakeId = 0;
  String verb;
  if (parseCakeCommand(s, cakeId, verb)) {
    if (cakeId != CAKE_ID) {
      Serial.print(F("[cake] ignoring cmd for CAKE "));
      Serial.print(cakeId);
      Serial.print(F(" (this node is CAKE "));
      Serial.print(CAKE_ID);
      Serial.println(F(")"));
      return;
    }

    bool ok = false;
    if (verb == "DISPENSE") ok = performDispense();
    else if (verb == "RETURN") ok = performReturn();

    if (ok) sendCanAck("ack");
    else    sendCanAck("err");
    return;
  }

  Serial.print(F("[err] unknown cmd: "));
  Serial.println(s);
}

static void pollCAN() {
  if (!canOK) return;

  twai_message_t msg;
  if (twai_receive(&msg, 0) == ESP_OK) {
    // Ignore RTR & extended frames for now
    if (msg.rtr || msg.extd) return;
    if (msg.data_length_code == 0) return;

    String cmd;
    cmd.reserve(msg.data_length_code);
    for (int i = 0; i < msg.data_length_code; ++i) {
      char c = (char)msg.data[i];
      if ((c >= 32 && c <= 126) || c == ' ') cmd += c;
    }
    cmd.trim();

    if (cmd.length() > 0) {
      Serial.print(F("[can] cmd="));
      Serial.println(cmd);
      handleCommand(cmd);
    }
  }
}

// ---------------- Arduino hooks ----------------
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(EN_PIN, OUTPUT);
  pinMode(STEP_PIN, OUTPUT);
  pinMode(DIR_PIN, OUTPUT);

  digitalWrite(STEP_PIN, LOW);
  digitalWrite(DIR_PIN, LOW);
  digitalWrite(EN_PIN, HIGH); // disabled by default (active-low)

  applyMicrostepPins();
  initCAN();

  Serial.println(F("IGEN Cake node online (no encoder verify, deterministic 60deg moves)."));
  Serial.print(F("CAKE_ID=")); Serial.println(CAKE_ID);

  Serial.print(F("GEARBOX_RATIO=")); Serial.println(GEARBOX_RATIO, 2);
  Serial.print(F("BELT_RATIO=")); Serial.println(BELT_RATIO, 2);
  Serial.print(F("TOTAL_RATIO=")); Serial.println(TOTAL_RATIO, 2);

  Serial.print(F("SPOKES=")); Serial.print(SPOKES);
  Serial.print(F(" SPOKE_DEG=")); Serial.println(SPOKE_DEG, 2);

  Serial.print(F("microstep=")); Serial.print(microstep);
  Serial.print(F(" stepsPerRev=")); Serial.println(stepsPerRev);

  // Expected steps per spoke (useful sanity check)
  float motorDegForSpoke = SPOKE_DEG * TOTAL_RATIO;
  long expectedSteps = lroundf((motorDegForSpoke * (float)stepsPerRev) / 360.0f);
  Serial.print(F("Expected steps per 60deg spoke = "));
  Serial.println(expectedSteps);

  Serial.println(F("Type 'help' for commands."));
}

void loop() {
  // Serial commands
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    handleCommand(cmd);
  }

  // CAN commands
  pollCAN();
}
