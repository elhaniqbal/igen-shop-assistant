/*
  Arduino UNO + TMC2208 + AS5600  (EEPROM-persistent zero + config)
  -----------------------------------------------------------------
  - UNO pins:
        DIR = 2
        STEP = 5
        EN = optional (set -1 if tied LOW)
        SDA = A4, SCL = A5  (AS5600)
  - Serial (115200) commands:
        help, stat, zero, test <deg>, scan, motor_test, setslot <0..4>
*/

#include <Arduino.h>
#include <Wire.h>
#include <EEPROM.h>
#include <math.h>

/* ----------------------------- Pins ----------------------------- */
const int PIN_DIR  = 2;
const int PIN_STEP = 5;
const int PIN_EN   = -1;   // -1 if not connected

/* --------------------------- EEPROM ----------------------------- */
struct __attribute__((packed)) Persist {
  uint8_t  magic;            // If the first byte is 0xA5 → you assume the rest of the struct is valid (and maybe check CRC too). If the first byte isn’t 0xA5 → it means either the EEPROM is empty, corrupted, or you’ve changed the schema, so you ignore it and reinitialize defaults.
  uint8_t  version;          // schema version
  uint16_t encZeroRaw;       // AS5600 raw zero (0..4095)
  int8_t   currentSlotIndex; // 0..4 (for 5-spoke)
  uint16_t stepsPerRev;      // 200 * microstep
  uint16_t ticksPerRev;      // AS5600 -> 4096 by default
  uint8_t  dirCwHigh;        // 1 if DIR=HIGH yields CW
  float    degPerSec;        // default move speed
  uint32_t crc32;            // integrity (computed with crc32_fast)
};

Persist conf;

/* CRC32 (poly 0xEDB88320) */
static uint32_t crc32_fast(const uint8_t* d, size_t n) {
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) {
    c ^= d[i];
    for (int b = 0; b < 8; b++) c = (c >> 1) ^ (0xEDB88320u & (-(int)(c & 1)));
  }
  return ~c;
}

void loadDefaults() {
  memset(&conf, 0, sizeof(conf));
  conf.magic            = 0xA5;
  conf.version          = 1;
  conf.encZeroRaw       = 0;
  conf.currentSlotIndex = 0;
  conf.stepsPerRev      = 1600;    // 200 * 16x microstep
  conf.ticksPerRev      = 4096;    // AS5600
  conf.dirCwHigh        = 1;       // DIR=HIGH -> CW
  conf.degPerSec        = 90.0f;
}

bool eepromLoad() {
  EEPROM.get(0, conf);
  if (conf.magic != 0xA5 || conf.version != 1) return false;
  uint32_t old = conf.crc32;
  conf.crc32 = 0;
  uint32_t calc = crc32_fast((uint8_t*)&conf, sizeof(conf));
  conf.crc32 = old;
  return (calc == old);
}

void eepromSave() {
  conf.crc32 = 0;
  uint32_t calc = crc32_fast((uint8_t*)&conf, sizeof(conf));
  conf.crc32 = calc;
  EEPROM.put(0, conf);
}

/* ---------------------------- Motor ----------------------------- */
static inline uint16_t& stepsPerRev() { return conf.stepsPerRev; }
static inline float& degPerSec()      { return conf.degPerSec;   }

/* --------------------------- Encoder ---------------------------- */
uint8_t AS5600_ADDR = 0x36;
const uint8_t REG_STATUS      = 0x0B;
const uint8_t REG_RAW_ANGLE_H = 0x0C;
const uint8_t REG_ANGLE_H     = 0x0E;
#define USE_FILTERED_ANGLE 0

/* --------------------------- Logging ---------------------------- */
void say(const String &msg) {
  Serial.print("["); Serial.print(millis()); Serial.print("] ");
  Serial.println(msg);
}

/* --------------------------- I2C helpers -------------------------- */
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
  eepromSave();  // persist immediately
  Serial.print("Zero saved. raw="); Serial.print(conf.encZeroRaw);
  Serial.print(" (0x"); Serial.print(conf.encZeroRaw, HEX); Serial.println(")");
}

/* --------------------------- I2C Scanner -------------------------- */
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

/* --------------------------- Motor helpers ------------------------ */
void motorInit() {
  pinMode(PIN_DIR, OUTPUT);
  pinMode(PIN_STEP, OUTPUT);
  if (PIN_EN >= 0) {
    pinMode(PIN_EN, OUTPUT);
    digitalWrite(PIN_EN, LOW); // LOW = enable for TMC2208
  }
}

void stepBlocking(long steps, bool cw) {
  digitalWrite(PIN_DIR, conf.dirCwHigh ? (cw ? HIGH : LOW) : (cw ? LOW : HIGH));
  float sps = max(100.0f, (degPerSec() * stepsPerRev()) / 360.0f);
  uint32_t usHalf = (uint32_t)max(100.0f, 1e6f / (2.0f * sps));
  for (long i = 0; i < steps; i++) {
    digitalWrite(PIN_STEP, HIGH);
    delayMicroseconds(usHalf);
    digitalWrite(PIN_STEP, LOW);
    delayMicroseconds(usHalf);
  }
}

/* --------------------------- Open-loop move ------------------------ */
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

  long estSteps = lroundf((targetDelta * stepsPerRev()) / 360.0f);
  bool cw = (targetDelta >= 0);
  stepBlocking(labs(estSteps), cw);
}

/* --------------------------- Motor test --------------------------- */
void motorTest() {
  say("Motor test: 1 rev CW, 1 rev CCW");
  stepBlocking(stepsPerRev(), true);
  delay(500);
  stepBlocking(stepsPerRev(), false);
  say("Motor test done.");
}

/* ----------------------------- Commands ---------------------------- */
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
    "  zero              - set current pose as zero (SAVES to EEPROM)\n"
    "  setslot <i>       - set current slot index 0..4 (SAVES)\n"
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
    if (v >= 0 && v <= 4) { conf.currentSlotIndex = (int8_t)v; eepromSave(); say("Slot index saved."); }
    else say("Bad slot index (0..4)");
  }
  else if (cmd == "test") { float d = arg.toFloat(); moveByDegrees(d); }
  else if (cmd == "motor_test") motorTest();
  else say("Unknown command: " + cmd);
}

/* ------------------------------ Setup ------------------------------ */
void setup() {
  Serial.begin(115200);
  delay(300);
  Wire.begin(); // UNO: SDA=A4, SCL=A5

  if (!eepromLoad()) {
    say("EEPROM empty/invalid -> loading defaults");
    loadDefaults();
    eepromSave();
  } else {
    say("EEPROM config restored");
  }

  motorInit();

  Serial.print("ZeroRaw="); Serial.print(conf.encZeroRaw);
  Serial.print(" Slot="); Serial.print(conf.currentSlotIndex);
  Serial.print(" Steps/Rev="); Serial.print(conf.stepsPerRev);
  Serial.print(" Ticks/Rev="); Serial.print(conf.ticksPerRev);
  Serial.print(" DirCW="); Serial.print(conf.dirCwHigh);
  Serial.print(" dps="); Serial.println(conf.degPerSec, 1);

  say("UNO + TMC2208 + AS5600 ready (EEPROM persistent)");
  help();
}

/* ------------------------------ Loop ------------------------------- */
void loop() {
  String l = readLine();
  if (l.length()) handleCmd(l);
}
