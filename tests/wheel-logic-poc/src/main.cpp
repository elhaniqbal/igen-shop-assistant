#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>

// ========== USER CONFIG (pins & motor type) ====================
// Choose motor type (default: step/dir stepper driver)
#define MOTOR_STEPPER 1
#define MOTOR_DC      2
#ifndef MOTOR_TYPE
  #define MOTOR_TYPE MOTOR_STEPPER
#endif

#if MOTOR_TYPE == MOTOR_STEPPER
  // Step/Dir driver (A4988/DRV8825/TMC..)
  const int PIN_DIR  = 18;
  const int PIN_STEP = 19;
  const int PIN_EN   = 5;   // -1 if unused
  // Motion config (change to your setup)
  volatile int   g_stepsPerRev = 3200;   // 200 * microsteps (e.g. 16) => 3200
  volatile float g_degPerSec   = 90.0;   // move speed used by stepper moves
#elif MOTOR_TYPE == MOTOR_DC
  // Simple H-bridge: IN1/IN2 direction, PWM speed
  const int PIN_IN1 = 26;
  const int PIN_IN2 = 27;
  const int PIN_PWM = 25;   // LEDC PWM
  const int PWM_CH  = 4;    // LEDC channel
  const int PWMFREQ = 20000;// 20kHz
  const int PWMBITS = 10;   // duty: 0..1023
  volatile float g_degPerSec   = 90.0;   // target closed-loop speed
#endif

// Encoder (AS5600) over I2C
const uint8_t AS5600_ADDR = 0x36;
const uint8_t REG_RAW_ANGLE = 0x0C; // 0x0C (high), 0x0D (low)
const uint8_t REG_STATUS    = 0x0B; // MD, ML, MH bits

// Wheel/Index config
Preferences prefs;
volatile uint16_t g_offsetRaw = 0;   // 0..4095 calibration offset
volatile int      g_spokes    = 5;   // N
volatile bool     g_invertDir = false; // flip direction if your mechanical CW/CCW is reversed
const int TICKS_PER_REV = 4096;      // AS5600 12-bit
// Handy macros
#define NOW_MS (millis())

// ---------- Debug helpers ----------
void logln(const String& s){ Serial.printf("[%lu] %s\n", (unsigned long)NOW_MS, s.c_str()); }
void logf(const char* fmt, ...){
  char buf[160];
  va_list ap; va_start(ap, fmt); vsnprintf(buf, sizeof(buf), fmt, ap); va_end(ap);
  Serial.printf("[%lu] %s\n", (unsigned long)NOW_MS, buf);
}

// ---------- AS5600 helpers ----------
uint16_t as5600Read16(uint8_t regHigh){
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(regHigh);
  Wire.endTransmission(false);
  Wire.requestFrom((int)AS5600_ADDR, 2);
  if (Wire.available() < 2) return 0;
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  return ((uint16_t)hi << 8 | lo) & 0x0FFF; // 12-bit
}
uint16_t as5600Raw() { return as5600Read16(REG_RAW_ANGLE); }

bool as5600MagPresent(bool *tooWeak=nullptr, bool *tooStrong=nullptr){
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(REG_STATUS);
  Wire.endTransmission(false);
  Wire.requestFrom((int)AS5600_ADDR, 1);
  if (!Wire.available()) return false;
  uint8_t s = Wire.read();
  bool md = s & 0x20; // magnet detected
  bool ml = s & 0x10; // too low
  bool mh = s & 0x08; // too high
  if (tooWeak)  *tooWeak  = ml;
  if (tooStrong)*tooStrong= mh;
  return md;
}

float wrap360(float a){ while(a < 0) a += 360.0f; while(a >= 360.0f) a -= 360.0f; return a; }
float wrap180(float a){
  a = fmodf(a + 180.0f, 360.0f);
  if (a < 0) a += 360.0f;
  return a - 180.0f;
}

// return angle (deg) with offset applied; 0° = your calibrated zero (X)
float angleDeg(){
  int32_t raw = (int32_t)as5600Raw() - (int32_t)g_offsetRaw;
  if (raw < 0) raw += TICKS_PER_REV;
  return (raw * 360.0f) / (float)TICKS_PER_REV;
}

// ---------- Preferences ----------
void savePrefs(){
  prefs.begin("drum", false);
  prefs.putUShort("offRaw", g_offsetRaw);
  prefs.putInt("spokes", g_spokes);
  prefs.putBool("invDir", g_invertDir);
  prefs.putInt("stepsRev", g_stepsPerRev);
  prefs.putFloat("dps", g_degPerSec);
  prefs.end();
  logln("Saved preferences.");
}
void loadPrefs(){
  prefs.begin("drum", true);
  g_offsetRaw = prefs.getUShort("offRaw", g_offsetRaw);
  g_spokes    = prefs.getInt("spokes", g_spokes);
  g_invertDir = prefs.getBool("invDir", g_invertDir);
  #if MOTOR_TYPE == MOTOR_STEPPER
    g_stepsPerRev = prefs.getInt("stepsRev", g_stepsPerRev);
  #endif
  g_degPerSec = prefs.getFloat("dps", g_degPerSec);
  prefs.end();
}

// ---------- Motor low-level ----------
#if MOTOR_TYPE == MOTOR_STEPPER
void stepperInit(){
  pinMode(PIN_DIR, OUTPUT);
  pinMode(PIN_STEP, OUTPUT);
  if (PIN_EN >= 0) { pinMode(PIN_EN, OUTPUT); digitalWrite(PIN_EN, LOW); } // LOW enable (flip if needed)
  digitalWrite(PIN_DIR, LOW);
  digitalWrite(PIN_STEP, LOW);
}
inline void motorSetDir(bool cw){
  bool level = cw ^ g_invertDir;
  digitalWrite(PIN_DIR, level ? HIGH : LOW);
}
void motorStepBlocking(long steps){
  // compute pulse timing from deg/sec → steps/sec
  float stepsPerSec = (g_degPerSec * (float)g_stepsPerRev) / 360.0f;
  stepsPerSec = max(stepsPerSec, 50.0f);
  uint32_t us = (uint32_t)max(120.0f, 1e6f / stepsPerSec / 2.0f); // HIGH+LOW = 2*us
  for (long i=0;i<steps;i++){
    digitalWrite(PIN_STEP, HIGH); delayMicroseconds(us);
    digitalWrite(PIN_STEP, LOW);  delayMicroseconds(us);
  }
}
#elif MOTOR_TYPE == MOTOR_DC
void dcInit(){
  pinMode(PIN_IN1, OUTPUT);
  pinMode(PIN_IN2, OUTPUT);
  ledcSetup(PWM_CH, PWMFREQ, PWMBITS);
  ledcAttachPin(PIN_PWM, PWM_CH);
  ledcWrite(PWM_CH, 0);
}
inline void dcDrive(bool cw, int duty){
  bool dir = cw ^ g_invertDir;
  digitalWrite(PIN_IN1, dir ? HIGH : LOW);
  digitalWrite(PIN_IN2, dir ? LOW  : HIGH);
  duty = constrain(duty, 0, (1<<PWMBITS)-1);
  ledcWrite(PWM_CH, duty);
}
inline void dcStop(){ ledcWrite(PWM_CH, 0); digitalWrite(PIN_IN1, LOW); digitalWrite(PIN_IN2, LOW); }
#endif

// ---------- Move helpers ----------
float pitchDeg(){ return 360.0f / (float)g_spokes; }
int   angleToIndex(float a){ return (int)floor(wrap360(a) / pitchDeg() + 0.5f) % g_spokes; }

#if MOTOR_TYPE == MOTOR_STEPPER
// open-loop: compute steps from delta degrees
void moveByDegrees(float delta){
  bool cw = (delta >= 0);
  long steps = llroundf(fabs(delta) * (float)g_stepsPerRev / 360.0f);
  motorSetDir(cw);
  motorStepBlocking(steps);
}
#else
// very simple closed-loop for DC motor (bang-bang with taper)
void moveByDegrees(float delta){
  const float deadband = 0.6f; // deg
  const int   maxDuty  = (1<<PWMBITS) - 1;
  const int   minDuty  = max(120, maxDuty/14);
  bool cw = (delta >= 0);
  unsigned long t0 = NOW_MS;
  while (fabs(delta) > deadband && (NOW_MS - t0) < 8000){
    int duty = map( (int)min(fabs(delta)*10, 1000.0f), 0, 1000, minDuty, maxDuty );
    dcDrive(cw, duty);
    delay(6);
    float cur = angleDeg();
    float target = wrap360(cur + delta);
    // recompute remaining delta against current angle → target
    float rem = wrap180(target - angleDeg());
    delta = rem;
  }
  dcStop();
}
#endif

void gotoAngle(float targetDeg){
  float cur = angleDeg();
  float delta = wrap180(targetDeg - cur);
  logf("Goto %.2f°, cur=%.2f°, delta=%.2f°", targetDeg, cur, delta);
  moveByDegrees(delta);
  float fin = angleDeg();
  logf("Arrived: %.2f° (err=%.2f°)", fin, wrap180(targetDeg - fin));
}
void gotoIndex(int idx){
  float tgt = wrap360(idx * pitchDeg());
  gotoAngle(tgt);
}

// ---------- Motor test ----------
void motorTest(){
  logln("Motor test: +360°, pause, -360°, pause");
  moveByDegrees(+360.0f); delay(400);
  moveByDegrees(-360.0f); delay(400);
  logln("Motor test: small jogs +/−72°");
  moveByDegrees(+72.0f); delay(200);
  moveByDegrees(-72.0f); delay(200);
  logln("Motor test done.");
}

// ---------- Serial command parsing ----------
String readLine(){
  static String buf;
  while (Serial.available()){
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n'){ String out = buf; buf = ""; out.trim(); return out; }
    buf += c;
  }
  return "";
}
void printHelp(){
  Serial.println(F(
    "Commands:\n"
    " help\n stat\n mag\n zero\n setoff <raw>\n setoffdeg <deg>\n"
    " N <int>\n dir <0|1>\n speed <deg_per_s>\n stepsrev <int>\n"
    " goto <idx>\n deg <signed_deg>\n motortest\n save\n load\n"
  ));
}
void printStat(){
  bool weak=false, strong=false;
  bool md = as5600MagPresent(&weak,&strong);
  float ang = angleDeg();
  uint16_t raw = as5600Raw();
  int idx = angleToIndex(ang);
  logf("AS5600 raw=%u, angle=%.2f deg, index=%d/%d, pitch=%.2f deg", raw, ang, idx, g_spokes-1, pitchDeg());
  logf("offsetRaw=%u, invDir=%d, speed=%.1f deg/s", g_offsetRaw, g_invertDir?1:0, g_degPerSec);
  #if MOTOR_TYPE == MOTOR_STEPPER
    logf("steps/rev=%d (%.3f steps/deg)", g_stepsPerRev, (float)g_stepsPerRev/360.0f);
  #endif
  logf("mag: %s (weak=%d strong=%d)", md?"OK":"NO_MAGNET", weak?1:0, strong?1:0);
}

void handleCommand(const String& line){
  if (line.length()==0) return;
  // split
  String cmd = line; int sp = line.indexOf(' ');
  String arg = (sp>=0) ? line.substring(sp+1) : "";
  cmd = (sp>=0) ? line.substring(0, sp) : cmd;
  cmd.toLowerCase(); arg.trim();

  if (cmd=="help") printHelp();
  else if (cmd=="stat") printStat();
  else if (cmd=="mag") { bool w=false,s=false; bool ok=as5600MagPresent(&w,&s); logf("mag: %s (weak=%d strong=%d)",ok?"OK":"NO",w,s); }
  else if (cmd=="zero"){
    g_offsetRaw = as5600Raw();
    savePrefs();
    logf("Zero set. offsetRaw=%u", g_offsetRaw);
  }
  else if (cmd=="setoff"){
    uint16_t v = (uint16_t) arg.toInt();
    g_offsetRaw = v % TICKS_PER_REV;
    savePrefs();
    logf("offsetRaw=%u saved", g_offsetRaw);
  }
  else if (cmd=="setoffdeg"){
    float d = arg.toFloat();
    d = wrap360(d);
    g_offsetRaw = (uint16_t) roundf((d/360.0f) * TICKS_PER_REV) % TICKS_PER_REV;
    savePrefs();
    logf("offsetRaw from deg -> %u", g_offsetRaw);
  }
  else if (cmd=="n" || cmd=="N"){
    int n = max(3, min(36, arg.toInt()));
    g_spokes = n; savePrefs();
    logf("spokes=%d, pitch=%.2f deg", g_spokes, pitchDeg());
  }
  else if (cmd=="dir"){
    g_invertDir = (arg.toInt()!=0); savePrefs();
    logf("invertDir=%d", g_invertDir?1:0);
  }
  else if (cmd=="speed"){
    g_degPerSec = max(10.0f, min(720.0f, arg.toFloat())); savePrefs();
    logf("deg/sec=%.1f", g_degPerSec);
  }
  else if (cmd=="stepsrev"){
    #if MOTOR_TYPE == MOTOR_STEPPER
      g_stepsPerRev = max(100, min(200000, arg.toInt())); savePrefs();
      logf("steps/rev=%d (%.3f steps/deg)", g_stepsPerRev, (float)g_stepsPerRev/360.0f);
    #else
      logln("Not a stepper build.");
    #endif
  }
  else if (cmd=="deg"){
    float d = arg.toFloat();
    logf("Move by %.2f deg", d);
    moveByDegrees(d);
    printStat();
  }
  else if (cmd=="goto"){
    int idx = arg.toInt();
    idx = (idx % g_spokes + g_spokes) % g_spokes;
    gotoIndex(idx);
    printStat();
  }
  else if (cmd=="motortest"){ motorTest(); }
  else if (cmd=="save"){ savePrefs(); }
  else if (cmd=="load"){ loadPrefs(); logln("Loaded prefs."); printStat(); }
  else {
    logf("Unknown cmd: '%s'", line.c_str()); printHelp();
  }
}

// ================== Arduino lifecycle ==================
void setup(){
  Serial.begin(115200);
  while(!Serial && millis()<1500){} // wait a bit for USB
  logln("=== Drum Wheel + AS5600 (ESP32) ===");
  Wire.begin(); // SDA/SCL default
  loadPrefs();
  #if MOTOR_TYPE == MOTOR_STEPPER
    stepperInit();
    logln("Motor: Step/Dir");
  #else
    dcInit();
    logln("Motor: DC H-bridge");
  #endif
  bool weak=false,strong=false;
  bool ok = as5600MagPresent(&weak,&strong);
  logf("AS5600 magnet: %s (weak=%d strong=%d)", ok?"OK":"NO", weak, strong);
  printHelp();
  printStat();
}

void loop(){
  String line = readLine();
  if (line.length()) handleCommand(line);
}
