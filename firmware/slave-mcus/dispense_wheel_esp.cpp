#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <Preferences.h>
#include "driver/twai.h"   // ESP32 CAN (TWAI) driver

// ---------------- Pins ----------------
#define STEP_PIN 18
#define DIR_PIN  19
#define EN_PIN   32
#define MS1_PIN  33
#define MS2_PIN  25

// AS5600 I2C
#define I2C_SDA 21
#define I2C_SCL 22

// CAN pins / node
#define CAN_TX 13
#define CAN_RX 14
#define NODE_ID 3

// ---------------- AS5600 constants ----------------
static const uint8_t AS5600_ADDR      = 0x36;
static const uint8_t REG_RAW_ANGLE_H  = 0x0C;
static const int     TICKS_PER_REV    = 4096;

// Zero ref for single-turn angle (debug)
static uint16_t encZeroRaw = 0;

// ---------------- Motor / gearbox config ----------------
static const int   BASE_STEPS_PER_REV = 200;   // 1.8° motor
int   microstep   = 16;                        // MUST match real driver microstep
int   stepsPerRev = BASE_STEPS_PER_REV * 16;   // 3200 if microstep=16

// GEARBOX: motor revs per 1 wheel rev
static const float GEAR_RATIO = 10.0f;

// high-level speed: WHEEL degrees per second
float degPerSecWheel = 90.0f;

static const uint32_t MIN_US_HALF = 200;
static const bool dirCwHigh       = true;   // DIR=HIGH = CW (flip if wrong)

// ---------------- Drum geometry & inventory ----------------
static const uint8_t DRUM_N    = 5;
static const float   PITCH_DEG = 360.0f / (float)DRUM_N;   // wheel deg per slot

// Default logical state after burn / first boot
//  - slot 0 = open slice at the window
//  - slots array = {0,1,1,1,1}
static const uint8_t DEFAULT_WINDOW_INDEX = 0;

uint8_t slots[DRUM_N] = {0, 1, 1, 1, 1};
uint8_t windowIndex   = DEFAULT_WINDOW_INDEX;   // overridden by NVS

bool modeCwOnly = false;

// ---------------- Encoder multi-turn tracking ----------------
long     multiCounts         = 0;      // total motor counts since startup
uint16_t prevRaw             = 0;
bool     encoderInitialized  = false;

// Tolerances
static const long JAM_TOL_COUNTS          = 300;   // step verification (~26° motor)
static const long MANUAL_MOVE_WARN_COUNTS = 2000;  // manual move detection threshold

// For manual-rotation detection
long baseCountsForIndex   = 0;   // encoder count when windowIndex was last “trusted”
bool baseCountsValid      = false;
unsigned long lastEncPollMs = 0;

// ---------------- Persistence ----------------
Preferences prefs;
static const uint32_t STATE_MAGIC = 0x1A3F5B0C;   // arbitrary constant

// ---------------- CAN / TWAI config ----------------
static bool canOK = false;

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

// Receive a single CAN command frame and forward to handleCommand
static void pollCAN() {
  if (!canOK) return;

  twai_message_t msg;
  // Non-blocking receive
  if (twai_receive(&msg, 0) == ESP_OK) {
    Serial.print(F("[can-rx] id=0x"));
    Serial.print(msg.identifier, HEX);
    Serial.print(F(" dlc="));
    Serial.print(msg.data_length_code);
    Serial.print(F(" ext="));
    Serial.print(msg.extd);
    Serial.print(F(" rtr="));
    Serial.print(msg.rtr);
    Serial.print(F(" data=["));
    for (int i = 0; i < msg.data_length_code; ++i) {
      char c = (char)msg.data[i];
      Serial.print((c >= 32 && c <= 126) ? c : '.');
    }
    Serial.println(F("]"));

    // Ignore RTR & extended frames for now
    if (msg.rtr || msg.extd) {
      Serial.println(F("[can-rx] ignoring RTR/ext frame"));
      return;
    }

    if (msg.data_length_code == 0) {
      Serial.println(F("[can-rx] empty frame, ignoring"));
      return;
    }

    String cmd;
    cmd.reserve(msg.data_length_code);
    for (int i = 0; i < msg.data_length_code; ++i) {
      char c = (char)msg.data[i];
      if ((c >= 32 && c <= 126) || c == ' ') {
        cmd += c;
      }
    }
    cmd.trim();

    if (cmd.length() > 0) {
      Serial.print(F("[can] cmd="));
      Serial.println(cmd);
      handleCommand(cmd);   // EXACT same parser as Serial
    } else {
      Serial.println(F("[can-rx] no valid ASCII in frame"));
    }
  }
}

// ---------------- Small helpers ----------------
static inline uint8_t modN(int v) {
  int m = v % (int)DRUM_N;
  return (m < 0) ? (m + DRUM_N) : m;
}

// ---------------- AS5600 helpers ----------------
static uint16_t i2cRead16(uint8_t dev, uint8_t regHigh) {
  Wire.beginTransmission(dev);
  Wire.write(regHigh);
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom((int)dev, 2) != 2) return 0;
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  return ((uint16_t)hi << 8) | lo;
}

static uint16_t as5600AngleRaw() {
  uint16_t raw = i2cRead16(AS5600_ADDR, REG_RAW_ANGLE_H);
  return raw & 0x0FFF;
}

// Single-turn MOTOR angle for debug [0..360)
static float encoderMotorAngleDegSingleTurn() {
  uint16_t raw = as5600AngleRaw();
  int32_t diff = (int32_t)raw - (int32_t)encZeroRaw;
  if (diff < 0) diff += TICKS_PER_REV;
  if (diff >= TICKS_PER_REV) diff -= TICKS_PER_REV;
  float deg = (diff * 360.0f) / (float)TICKS_PER_REV;
  if (deg >= 360.0f) deg -= 360.0f;
  return deg;
}

// Multi-turn update (call routinely + while motor is moving)
static long updateEncoderMulti() {
  uint16_t raw = as5600AngleRaw();

  if (!encoderInitialized) {
    prevRaw = raw;
    encoderInitialized = true;
    return 0;
  }

  int32_t delta = (int32_t)raw - (int32_t)prevRaw;

  // Wrap correction: half-turn = 2048 counts
  if (delta >  2048) delta -= 4096;
  if (delta < -2048) delta += 4096;

  multiCounts += delta;
  prevRaw = raw;
  return delta;
}

// ---------------- Microstepping ----------------
static void applyMicrostepPins() {
  pinMode(MS1_PIN, OUTPUT);
  pinMode(MS2_PIN, OUTPUT);

  bool ms1 = LOW;
  bool ms2 = LOW;

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

// ---------------- Persistence (windowIndex only) ----------------
static void saveState() {
  prefs.putUInt("magic", STATE_MAGIC);
  prefs.putUChar("slot", windowIndex);
  Serial.print(F("[state] saved windowIndex="));
  Serial.println(windowIndex);
}

static void loadState() {
  prefs.begin("wheel", false);
  uint32_t magic = prefs.getUInt("magic", 0);

  if (magic == STATE_MAGIC) {
    windowIndex = prefs.getUChar("slot", DEFAULT_WINDOW_INDEX);
    Serial.print(F("[state] loaded windowIndex="));
    Serial.println(windowIndex);
  } else {
    Serial.println(F("[state] no valid state, seeding defaults"));
    windowIndex = DEFAULT_WINDOW_INDEX;
    prefs.putUInt("magic", STATE_MAGIC);
    prefs.putUChar("slot", windowIndex);
    Serial.print(F("[state] default windowIndex="));
    Serial.println(windowIndex);
  }

  // After load, treat current encoder position as base for that index
  baseCountsForIndex = multiCounts;
  baseCountsValid    = true;
}

// Wipe stored state and reset to default idx=0 (open slice)
static void burnState() {
  prefs.begin("wheel", false);
  Serial.println(F("[state] WARNING: clearing stored state and resetting to defaults..."));

  prefs.clear();

  windowIndex = DEFAULT_WINDOW_INDEX;
  prefs.putUInt("magic", STATE_MAGIC);
  prefs.putUChar("slot", windowIndex);

  baseCountsForIndex = multiCounts;   // whatever angle we’re at now = “slot 0 open”
  baseCountsValid    = true;

  Serial.print(F("[state] EEPROM reset to default windowIndex="));
  Serial.println(windowIndex);
}

// ---------------- Stepper motion (MOTOR space) ----------------

static void moveSteps(long steps, bool cw) {
  if (steps <= 0) return;

  // set direction once
  digitalWrite(DIR_PIN, cw == dirCwHigh ? HIGH : LOW);

  // convert wheel deg/s to motor steps/s
  float motorDegPerSec = degPerSecWheel * GEAR_RATIO;
  float sps = (motorDegPerSec * stepsPerRev) / 360.0f;
  if (sps < 100.0f) sps = 100.0f;
  float period_us = 1e6f / sps;
  uint32_t usHalf = (uint32_t)max((float)MIN_US_HALF, period_us / 2.0f);

  for (long i = 0; i < steps; ++i) {
    digitalWrite(STEP_PIN, HIGH);
    delayMicroseconds(usHalf);
    digitalWrite(STEP_PIN, LOW);
    delayMicroseconds(usHalf);

    // Update encoder multi-turn tracking per step
    updateEncoderMulti();
  }
}

// Low-level motor movement in MOTOR degrees, with encoder verification
static bool moveMotorByDegreesVerified(float deltaMotorDeg) {
  // Make sure encoder tracking is fresh
  updateEncoderMulti();

  // ---- Detect manual rotation since last trusted index ----
  if (baseCountsValid && digitalRead(EN_PIN) == HIGH) {
    long diffCounts = multiCounts - baseCountsForIndex;
    if (labs(diffCounts) > MANUAL_MOVE_WARN_COUNTS) {
      float motorIdleDeg = diffCounts * 360.0f / (float)TICKS_PER_REV;
      float wheelIdleDeg = motorIdleDeg / GEAR_RATIO;
      float slotsIdle    = wheelIdleDeg / PITCH_DEG;

      Serial.print(F("[WARN] detected manual rotation since last index align: ~"));
      Serial.print(wheelIdleDeg, 1);
      Serial.print(F(" wheel deg (~"));
      Serial.print(slotsIdle, 2);
      Serial.println(F(" slots). Logical index may be wrong."));
      // We do NOT touch windowIndex here.
    }
  }

  // ---- Normal commanded move verification ----
  if (!isfinite(deltaMotorDeg) || fabsf(deltaMotorDeg) < 0.1f) return true;

  bool cw      = (deltaMotorDeg > 0.0f);
  float absDeg = fabsf(deltaMotorDeg);

  long steps = lroundf((absDeg * stepsPerRev) / 360.0f);
  if (steps <= 0) return true;

  // Expected encoder counts for this move
  long expectedCounts = lroundf(deltaMotorDeg * (float)TICKS_PER_REV / 360.0f);

  Serial.print(F("[move] motor "));
  Serial.print(deltaMotorDeg, 2);
  Serial.print(F(" deg -> "));
  Serial.print(steps);
  Serial.print(F(" steps, expectedCounts="));
  Serial.println(expectedCounts);

  long startCounts = multiCounts;

  // Enable driver only while moving
  digitalWrite(EN_PIN, LOW);
  delay(2);

  moveSteps(steps, cw);

  digitalWrite(EN_PIN, HIGH); // disable after move

  long actualCounts = multiCounts - startCounts;
  long errorCounts  = actualCounts - expectedCounts;

  Serial.print(F("[enc] actualCounts="));
  Serial.print(actualCounts);
  Serial.print(F(" error="));
  Serial.println(errorCounts);

  if (labs(errorCounts) > JAM_TOL_COUNTS) {
    Serial.println(F("[FAULT] encoder mismatch: motor did NOT move as commanded"));
    return false;
  }

  Serial.println(F("[OK] encoder verified move"));
  return true;
}

// High-level movement in WHEEL degrees
static bool moveWheelByDegreesVerified(float deltaWheelDeg) {
  float deltaMotorDeg = deltaWheelDeg * GEAR_RATIO;
  return moveMotorByDegreesVerified(deltaMotorDeg);
}

// ---------------- Index / geometry ----------------
static void advanceIndexCW(uint8_t steps) {
  windowIndex = modN((int)windowIndex + (int)steps);
}

static void advanceIndexCCW(uint8_t steps) {
  windowIndex = modN((int)windowIndex - (int)steps);
}

// Compute how many slot steps and direction to go from windowIndex to target
static void computeMove(uint8_t target, uint8_t &stepsOut, bool &cwOut) {
  int cwSteps  = modN((int)target - (int)windowIndex);  // + direction on WHEEL
  int ccwSteps = modN((int)windowIndex - (int)target);  // - direction on WHEEL

  if (modeCwOnly) {
    stepsOut = (uint8_t)cwSteps;
    cwOut    = true;
  } else {
    if (cwSteps <= ccwSteps) {
      stepsOut = (uint8_t)cwSteps;
      cwOut    = true;
    } else {
      stepsOut = (uint8_t)ccwSteps;
      cwOut    = false;
    }
  }
}

static bool rotateToSlot(uint8_t target) {
  uint8_t steps;
  bool cw;
  computeMove(target, steps, cw);
  if (steps == 0) return true;

  float deltaWheelDeg = (float)steps * PITCH_DEG * (cw ? +1.0f : -1.0f);

  bool ok = moveWheelByDegreesVerified(deltaWheelDeg);
  if (!ok) {
    Serial.println(F("[geo] move FAILED, not updating index/state"));
    return false;
  }

  if (cw) advanceIndexCW(steps);
  else    advanceIndexCCW(steps);

  Serial.print(F("[geo] windowIndex -> "));
  Serial.println(windowIndex);

  // After a successful logical index change, re-anchor encoder
  baseCountsForIndex = multiCounts;
  baseCountsValid    = true;

  saveState();
  return true;
}

// ---------------- Inventory ----------------
static void printSlots() {
  Serial.print(F("[slots] idx="));
  Serial.print(windowIndex);
  Serial.print(F(" state=["));
  for (uint8_t i = 0; i < DRUM_N; ++i) {
    Serial.print((int)slots[i]);
    if (i + 1 < DRUM_N) Serial.print(',');
  }
  Serial.println(']');
}

static int8_t findNearestFilled() {
  int bestSteps = 999;
  int bestIdx   = -1;

  for (uint8_t i = 0; i < DRUM_N; ++i) {
    if (i == 0) continue;          // never use slot 0
    if (slots[i] != 1) continue;   // only filled slots

    int cwSteps  = modN((int)i - (int)windowIndex);
    int ccwSteps = modN((int)windowIndex - (int)i);
    int steps = modeCwOnly
      ? cwSteps
      : (cwSteps <= ccwSteps ? cwSteps : ccwSteps);

    if (steps > 0 && steps < bestSteps) {
      bestSteps = steps;
      bestIdx   = i;
    }
  }
  return (int8_t)bestIdx;
}

void sendCanAck(const String &msg) {
  twai_message_t tx = {};
  tx.identifier = NODE_ID;       // 3
  tx.extd = 0;
  tx.rtr  = 0;
  tx.data_length_code = msg.length();

  for (int i = 0; i < msg.length() && i < 8; i++) {
    tx.data[i] = msg[i];
  }

  if (twai_transmit(&tx, pdMS_TO_TICKS(20)) == ESP_OK) {
    Serial.print("[ack] sent: "); Serial.println(msg);
  } else {
    Serial.println("[ack] FAILED to send");
  }
}


// nearest empty CCW (including slot 0)
static int8_t findNearestEmptyCCW() {
  for (int step = 1; step < DRUM_N; ++step) {
    uint8_t idx = modN((int)windowIndex - step);
    if (slots[idx] == 0) {
      return (int8_t)idx;
    }
  }
  return -1;
}

static bool performDispense() {
  int8_t idx = findNearestFilled();
  if (idx < 0) {
    Serial.println(F("[disp] no filled slots available"));
    return false;
  }

  Serial.print(F("[disp] target slot "));
  Serial.println(idx);

  if (!rotateToSlot((uint8_t)idx)) {
    Serial.println(F("[disp] ABORT: rotation failed"));
    return false;
  }

  // Dispensed from windowIndex
  slots[windowIndex] = 0;
  printSlots();
  return true;
}

static bool performReturn() {
  Serial.println(F("[ret] docking hold..."));
  delay(2000);

  if (windowIndex == 0) {
    Serial.println(F("[ret] ERROR: cannot return into slot 0 (non-storage)."));
    return false;
  }

  // Deposit into current slot
  slots[windowIndex] = 1;

  // Find new open slot CCW
  int8_t idx = findNearestEmptyCCW();
  if (idx < 0) {
    Serial.println(F("[ret] no empty slots available after return"));
    printSlots();
    return false;
  }

  Serial.print(F("[ret] new open slot (CCW) = "));
  Serial.println(idx);

  int steps = modN((int)windowIndex - (int)idx);
  if (steps <= 0) {
    printSlots();
    saveState();
    return true;
  }

  float deltaWheelDeg = - (float)steps * PITCH_DEG;
  bool ok = moveWheelByDegreesVerified(deltaWheelDeg);
  if (!ok) {
    Serial.println(F("[ret] ABORT: rotation failed, not updating index"));
    return false;
  }

  advanceIndexCCW((uint8_t)steps);

  // Re-anchor encoder after successful move
  baseCountsForIndex = multiCounts;
  baseCountsValid    = true;

  printSlots();
  saveState();
  return true;
}

// ---------------- Serial & CAN commands ----------------
static void printHelp() {
  Serial.println(F("Commands (via Serial or CAN data bytes):"));
  Serial.println(F("  help          - show this help"));
  Serial.println(F("  angle         - show MOTOR single-turn angle [0..360)"));
  Serial.println(F("  zero          - set current MOTOR position as 0 deg"));
  Serial.println(F("  deg <angle>   - move WHEEL RELATIVE by <angle> deg (+CW, -CCW)"));
  Serial.println(F("  spd <dps>     - set WHEEL speed in deg/s"));
  Serial.println(F("  ms <1|2|4|8|16> - set microstepping"));
  Serial.println(F("  slots         - show slot state & window index"));
  Serial.println(F("  disp          - perform dispense to nearest filled slot"));
  Serial.println(F("  ret           - perform return to nearest empty slot"));
  Serial.println(F("  mode bi       - bidirectional (shortest path)"));
  Serial.println(F("  mode cw       - CW-only rotation"));
  Serial.println(F("  burn          - CLEAR saved state and reset to default (idx=0)"));
}

void handleCommand(String cmd) {
  cmd.trim();
  if (cmd.length() == 0) return;
  String low = cmd;
  low.toLowerCase();

  if (low == "help") { printHelp(); return; }

  if (low == "angle") {
    float a = encoderMotorAngleDegSingleTurn();
    Serial.print(F("[enc] MOTOR angle(single-turn) = "));
    Serial.print(a, 2);
    Serial.println(F(" deg"));
    return;
  }

  if (low == "zero") {
    encZeroRaw = as5600AngleRaw();
    Serial.print(F("[enc] zero set at raw="));
    Serial.println(encZeroRaw);
    return;
  }

  if (low.startsWith("deg ")) {
    float wheelDeg = cmd.substring(4).toFloat();
    moveWheelByDegreesVerified(wheelDeg);
    return;
  }

  if (low.startsWith("spd ")) {
    float s = cmd.substring(4).toFloat();
    if (s > 0.1f) {
      degPerSecWheel = s;
      Serial.print(F("[cfg] wheel speed="));
      Serial.println(degPerSecWheel, 1);
    } else {
      Serial.println(F("[cfg] speed must be >0"));
    }
    return;
  }

  if (low.startsWith("ms ")) {
    int m = cmd.substring(3).toInt();
    setMicrostep(m);
    return;
  }

  if (low == "slots") {
    printSlots();
    return;
  }

  if (low == "disp") {
     bool ok = performDispense();
    if (ok) sendCanAck("ack:disp");
    else    sendCanAck("err:disp");
    return;
  }

  if (low == "ret") {
    bool ok = performReturn();
    if (ok) sendCanAck("ack:return");
    else    sendCanAck("err:return");
    return;
  }

  if (low == "mode bi") {
    modeCwOnly = false;
    Serial.println(F("[mode] bidirectional (shortest path)"));
    return;
  }

  if (low == "mode cw") {
    modeCwOnly = true;
    Serial.println(F("[mode] CW-only"));
    return;
  }

  if (low == "burn") {
    burnState();
    return;
  }

  Serial.print(F("[err] unknown command '"));
  Serial.print(cmd);
  Serial.println(F("'; type 'help'"));
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

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(400000);

  applyMicrostepPins();
  encZeroRaw = as5600AngleRaw();
  prevRaw    = as5600AngleRaw();
  encoderInitialized = true;
  multiCounts = 0;

  // Initial base anchor is “whatever angle we booted at”
  baseCountsForIndex = multiCounts;
  baseCountsValid    = true;

  loadState();
  initCAN();

  Serial.println(F("ESP32 drum test: gearbox + encoder-verified moves + manual-move warning + CAN RX"));
  Serial.print(F("BASE_STEPS_PER_REV="));
  Serial.println(BASE_STEPS_PER_REV);
  Serial.print(F("microstep="));
  Serial.println(microstep);
  Serial.print(F("stepsPerRev="));
  Serial.println(stepsPerRev);
  Serial.print(F("GEAR_RATIO="));
  Serial.println(GEAR_RATIO, 2);
  Serial.print(F("Initial encZeroRaw="));
  Serial.println(encZeroRaw);
  printSlots();
  printHelp();
}

void loop() {
  // Periodic encoder polling to track manual motion smoothly
  unsigned long now = millis();
  if (now - lastEncPollMs >= 20) {   // 50 Hz
    lastEncPollMs = now;
    updateEncoderMulti();
  }

  // Serial commands
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    handleCommand(cmd);
  }

  // CAN commands
  pollCAN();
}
