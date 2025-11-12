/*
  ESP32 + TMC2208 + AS5600  (Persistent zero & config via NVS)
  ------------------------------------------------------------
  Pins (change if needed):
    DIR  = GPIO 2
    STEP = GPIO 5
    EN   = -1  (set to a GPIO if you wired EN; LOW enables TMC2208)
    SDA  = GPIO 21  (AS5600)
    SCL  = GPIO 22  (AS5600)

  Serial (115200) commands:
    help
    scan
    stat
    zero
    setslot <0..4>
    setspr <stepsPerRev>     (e.g., 1600)
    setdps <degPerSec>       (e.g., 120)
    setdir <0|1>             (1 = DIR=HIGH is CW)
    test <deg>
    motor_test
*/

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <math.h>

/* ----------------------------- Pins ----------------------------- */
const int PIN_DIR  = 2;
const int PIN_STEP = 5;
const int PIN_EN   = -1;   // -1 if not connected (LOW enables TMC2208)

/* --------------------------- NVS (Preferences) ------------------ */
Preferences prefs;
struct Config {
  uint16_t encZeroRaw;       // AS5600 raw zero (0..4095)
  int8_t   currentSlotIndex; // 0..4 for 5-spoke wheel
  uint16_t stepsPerRev;      // 200 * microstep (e.g., 1600)
  uint16_t ticksPerRev;      // AS5600 = 4096
  uint8_t  dirCwHigh;        // 1 if DIR=HIGH is CW
  float    degPerSec;        // default angular speed
};
Config conf;

void loadDefaults() {
  conf.encZeroRaw       = 0;
  conf.currentSlotIndex = 0;
  conf.stepsPerRev      = 1600;
  conf.ticksPerRev      = 4096;
  conf.dirCwHigh        = 1;
  conf.degPerSec        = 90.0f;
}

void nvsSave() {
  prefs.begin("disp", false);
  prefs.putUShort("zero", conf.encZeroRaw);
  prefs.putChar("slot", conf.currentSlotIndex);
  prefs.putUShort("spr", conf.stepsPerRev);
  prefs.putUShort("tpr", conf.ticksPerRev);
  prefs.putUChar("cw",  conf.dirCwHigh);
  prefs.putFloat("dps", conf.degPerSec);
  prefs.end();
}

bool nvsLoad() {
  prefs.begin("disp", true);
  bool have = prefs.isKey("spr"); // presence check (first-boot if false)
  if (have) {
    conf.encZeroRaw       = prefs.getUShort("zero", 0);
    conf.currentSlotIndex = prefs.getChar("slot", 0);
    conf.stepsPerRev      = prefs.getUShort("spr", 1600);
    conf.ticksPerRev      = prefs.getUShort("tpr", 4096);
    conf.dirCwHigh        = prefs.getUChar("cw", 1);
    conf.degPerSec        = prefs.getFloat("dps", 90.0f);
  }
  prefs.end();
  return have;
}

/* --------------------------- Encoder ---------------------------- */
static const uint8_t AS5600_ADDR      = 0x36;
static const uint8_t REG_STATUS       = 0x0B;
static const uint8_t REG_RAW_ANGLE_H  = 0x0C;
static const uint8_t REG_ANGLE_H      = 0x0E;
#define USE_FILTERED_ANGLE 0

/* --------------------------- Logging ---------------------------- */
void say(const String &msg) {
  Serial.print("["); Serial.print(millis()); Serial.print("] ");
  Serial.println(msg);
}

/* --------------------------- I2C helpers ------------------------ */
uint16_t i2cRead16(uint8_t dev, uint8_t regHigh) {
  Wire.beginTransmission(dev);
  Wire.write(regHigh);
  if (Wire.endTransmission(false) != 0) return 0;
  if (Wire.requestFrom((int)dev, 2) != 2) return 0;
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  return ((uint16_t)hi << 8) | lo;
}

uint8_t as5600Status() {
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(REG_STATUS);
  if (Wire.endTransmission(false) != 0) { say("I2C STATUS error"); return 0; }
  if (Wire.requestFrom((int)AS5600_ADDR, 1) != 1) { say("I2C STATUS read fail"); return 0; }
  uint8_t st = Wire.read();
  bool md = st & (1 << 5);
  bool ml = st & (1 << 4);
  bool mh = st & (1 << 3);
  Serial.print("STATUS=0x"); Serial.print(st, HEX);
  Serial.print(" [MD="); Serial.print(md);
  Serial.print(" ML="); Serial.print(ml);
  Serial.print(" MH="); Serial.print(mh);
  Serial.println("]");
  return st;
}

uint16_t as5600AngleRaw() {
  uint8_t regH = USE_FILTERED_ANGLE ? REG_ANGLE_H : REG_RAW_ANGLE_H;
  return i2cRead16(AS5600_ADDR, regH) & 0x0FFF;
}

float encoderAngleDeg() {
  uint16_t raw = as5600AngleRaw();
  int32_t diff = (int32_t)raw - (int32_t)conf.encZeroRaw;
  if (diff < 0) diff += conf.ticksPerRev;
  float deg = (diff * 360.0f) / (float)conf.ticksPerRev;
  if (deg > 359.8f) deg = 0.0f;
  return deg;
}

void encoderZeroHere() {
  conf.encZeroRaw = as5600AngleRaw();
  nvsSave(); // persist immediately
  Serial.print("Zero saved. raw="); Serial.print(conf.encZeroRaw);
  Serial.print(" (0x"); Serial.print(conf.encZeroRaw, HEX); Serial.println(")");
}

/* --------------------------- I2C Scanner ------------------------ */
void scanI2C() {
  say("Scanning I2C bus...");
  int found = 0;
  for (uint8_t addr = 1; addr < 127; addr++) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print("  Found device at 0x");
      if (addr < 16) Serial.print("0");
      Serial.println(addr, HEX);
      found++;
    }
  }
  if (!found) say("No I2C devices found!");
  else say("Scan complete.");
}

/* --------------------------- Motor helpers ---------------------- */
void motorInit() {
  pinMode(PIN_DIR, OUTPUT);
  pinMode(PIN_STEP, OUTPUT);
  if (PIN_EN >= 0) {
    pinMode(PIN_EN, OUTPUT);
    digitalWrite(PIN_EN, LOW); // TMC2208 enable = LOW
  }
}

// Simple blocking step generator (fine for bring-up)
void stepBlocking(long steps, bool cw) {
  // Map requested CW/CCW to DIR level per config
  int dirLevel = conf.dirCwHigh ? (cw ? HIGH : LOW) : (cw ? LOW : HIGH);
  digitalWrite(PIN_DIR, dirLevel);

  float sps = max(100.0f, (conf.degPerSec * conf.stepsPerRev) / 360.0f);
  uint32_t usHalf = (uint32_t)max(100.0f, 1e6f / (2.0f * sps));

  for (long i = 0; i < steps; i++) {
    digitalWrite(PIN_STEP, HIGH);
    delayMicroseconds(usHalf);
    digitalWrite(PIN_STEP, LOW);
    delayMicroseconds(usHalf);
  }
}

/* --------------------------- Open-loop move ---------------------- */
void moveByDegrees(float targetDelta) {
  if (!isfinite(targetDelta) || fabs(targetDelta) < 0.1f) {
    say("Ignored tiny/invalid move");
    return;
  }
  float start = encoderAngleDeg();
  float goal  = fmodf(start + targetDelta + 360.0f, 360.0f);

  Serial.print("Start="); Serial.print(start, 2);
  Serial.print("°, Goal="); Serial.print(goal, 2);
  Serial.print("°, Delta="); Serial.println(targetDelta, 2);

  long estSteps = lroundf((targetDelta * conf.stepsPerRev) / 360.0f);
  bool cw = (targetDelta >= 0);
  stepBlocking(labs(estSteps), cw);
}

/* --------------------------- Motor test ------------------------- */
void motorTest() {
  say("Motor test: 1 rev CW, 1 rev CCW");
  stepBlocking(conf.stepsPerRev, true);
  delay(500);
  stepBlocking(conf.stepsPerRev, false);
  say("Motor test done.");
}

/* ----------------------------- Commands ------------------------- */
String readLine() {
  static String buf;
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') { String out = buf; buf = ""; out.trim(); return out; }
    buf += c;
  }
  return "";
}

void help() {
  Serial.println(
    "Commands:\n"
    "  help              - show this text\n"
    "  scan              - scan I2C bus\n"
    "  stat              - encoder status/angle + persisted config\n"
    "  zero              - set current pose as zero (SAVES)\n"
    "  setslot <i>       - set current slot index 0..4 (SAVES)\n"
    "  setspr <n>        - set stepsPerRev (SAVES)\n"
    "  setdps <f>        - set degPerSec (SAVES)\n"
    "  setdir <0|1>      - set DIR=HIGH is CW (SAVES)\n"
    "  test <deg>        - move motor by <deg>\n"
    "  motor_test        - 1 rev CW + 1 rev CCW test\n"
  );
}

void stat() {
  as5600Status();
  uint16_t raw = as5600AngleRaw();
  float deg = encoderAngleDeg();
  Serial.print("raw="); Serial.print(raw);
  Serial.print(" deg="); Serial.print(deg, 2);
  Serial.print(" | zeroRaw="); Serial.print(conf.encZeroRaw);
  Serial.print(" slot="); Serial.print(conf.currentSlotIndex);
  Serial.print(" stepsPerRev="); Serial.print(conf.stepsPerRev);
  Serial.print(" ticksPerRev="); Serial.print(conf.ticksPerRev);
  Serial.print(" dirCwHigh="); Serial.print(conf.dirCwHigh);
  Serial.print(" degPerSec="); Serial.println(conf.degPerSec, 1);
}

void handleCmd(String line) {
  if (!line.length()) return;
  line.trim();
  String cmd = line, arg = "";
  int sp = line.indexOf(' ');
  if (sp >= 0) { cmd = line.substring(0, sp); arg = line.substring(sp + 1); }
  cmd.toLowerCase(); arg.trim();

  if      (cmd == "help") help();
  else if (cmd == "scan") scanI2C();
  else if (cmd == "stat") stat();
  else if (cmd == "zero") encoderZeroHere();
  else if (cmd == "setslot") {
    int v = arg.toInt();
    if (v >= 0 && v <= 4) { conf.currentSlotIndex = (int8_t)v; nvsSave(); say("Slot index saved."); }
    else say("Bad slot index (0..4)");
  }
  else if (cmd == "setspr") {
    long v = arg.toInt();
    if (v >= 200 && v <= 25600) { conf.stepsPerRev = (uint16_t)v; nvsSave(); say("stepsPerRev saved."); }
    else say("Bad stepsPerRev (200..25600)");
  }
  else if (cmd == "setdps") {
    float v = arg.toFloat();
    if (v > 0 && v <= 720.0f) { conf.degPerSec = v; nvsSave(); say("degPerSec saved."); }
    else say("Bad degPerSec (0..720]");
  }
  else if (cmd == "setdir") {
    int v = arg.toInt();
    if (v == 0 || v == 1) { conf.dirCwHigh = (uint8_t)v; nvsSave(); say("dirCwHigh saved."); }
    else say("Use 0 or 1");
  }
  else if (cmd == "test") { float d = arg.toFloat(); moveByDegrees(d); }
  else if (cmd == "motor_test") motorTest();
  else say("Unknown command: " + cmd);
}

/* ------------------------------ Setup --------------------------- */
void setup() {
  Serial.begin(115200);
  delay(300);

  // I2C on ESP32 (3.3 V)
  Wire.begin(21, 22);

  // Load persisted config or defaults
  if (!nvsLoad()) {
    say("NVS empty -> loading defaults");
    loadDefaults();
    nvsSave();
  } else {
    say("NVS config restored");
  }

  motorInit();

  Serial.print("ZeroRaw="); Serial.print(conf.encZeroRaw);
  Serial.print(" Slot="); Serial.print(conf.currentSlotIndex);
  Serial.print(" Steps/Rev="); Serial.print(conf.stepsPerRev);
  Serial.print(" Ticks/Rev="); Serial.print(conf.ticksPerRev);
  Serial.print(" DirCW="); Serial.print(conf.dirCwHigh);
  Serial.print(" dps="); Serial.println(conf.degPerSec, 1);

  say("ESP32 + TMC2208 + AS5600 ready (NVS persistent)");
  help();
}

/* ------------------------------ Loop ---------------------------- */
void loop() {
  String l = readLine();
  if (l.length()) handleCmd(l);
}
