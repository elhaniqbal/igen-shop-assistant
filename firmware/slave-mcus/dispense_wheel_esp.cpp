// slave-mcus/dispense_wheel_esp.cpp
#include <Arduino.h>
#include <Wire.h>
#include <EEPROM.h>
#include "driver/twai.h"
#include "protocol.h"

// -------- Pins / Config (override via build_flags) --------
#ifndef DEVICE_ID
#define DEVICE_ID 4
#endif
#ifndef CAN_TX_PIN
#define CAN_TX_PIN 27
#endif
#ifndef CAN_RX_PIN
#define CAN_RX_PIN 26
#endif
#ifndef CAN_BPS
#define CAN_BPS 500000
#endif
#ifndef I2C_SDA
#define I2C_SDA 21
#endif
#ifndef I2C_SCL
#define I2C_SCL 22
#endif
#ifndef PIN_DIR
#define PIN_DIR 2
#endif
#ifndef PIN_STEP
#define PIN_STEP 5
#endif
#ifndef PIN_EN
#define PIN_EN -1
#endif
#ifndef PIN_DOCK_OK
#define PIN_DOCK_OK -1  // -1 disables the interlock
#endif
#ifndef PIN_DOCK_ACTIVE_HIGH
#define PIN_DOCK_ACTIVE_HIGH 1
#endif

// AS5600
static const uint8_t AS5600_ADDR      = 0x36;
static const uint8_t REG_STATUS       = 0x0B;
static const uint8_t REG_RAW_ANGLE_H  = 0x0C;
static const uint8_t REG_ANGLE_H      = 0x0E;
#define USE_FILTERED_ANGLE 0
static const int     TICKS_PER_REV    = 4096;

// Geometry
struct Drum {
  uint8_t N; float pitchDeg; uint8_t openIndex;
} drum = {5, 72.0f, 0};

// Persist
struct __attribute__((packed)) Persist {
  uint8_t  magic;
  uint8_t  version;
  uint8_t  deviceId;
  uint8_t  dirCwHigh;
  uint16_t stepsPerRev;
  float    degPerSec;
  uint16_t encZeroRaw;
  uint8_t  spokesN;
  uint8_t  slotsFilled[8];
  uint8_t  reserved[8];
};
Persist ps;
const uint8_t PS_MAGIC = 0xA5;
const uint8_t PS_VER   = 1;
static const int EEPROM_SIZE = 256;
static const int EEPROM_ADDR = 0;

// State
uint16_t encZeroRaw = 0;
uint8_t  slots[8]   = {0}; // 0=empty, 1=filled
int      stepsPerRev = 1600;
float    degPerSec   = 90.0f;
bool     dirCwHigh   = true;
uint8_t  windowIndex = 0;

// Logging
static inline void say(const char* s){
  Serial.printf("[%lu] %s\n", (unsigned long)millis(), s);
}

static inline void sayf(const char* fmt, ...) {
  char buf[256];
  va_list ap; 
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  Serial.printf("[%lu] %s\n", (unsigned long)millis(), buf);
}
// I2C helpers
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
  uint8_t regH = USE_FILTERED_ANGLE ? REG_ANGLE_H : REG_RAW_ANGLE_H;
  return i2cRead16(AS5600_ADDR, regH) & 0x0FFF;
}
static float encoderAngleDeg() {
  uint16_t raw = as5600AngleRaw();
  int32_t diff = (int32_t)raw - (int32_t)encZeroRaw;
  if (diff < 0) diff += TICKS_PER_REV;
  float deg = (diff * 360.0f) / (float)TICKS_PER_REV;
  if (deg > 359.8f) deg = 0.0f;
  return deg;
}
static void setZeroHerePersist() {
  encZeroRaw = as5600AngleRaw();
  ps.encZeroRaw = encZeroRaw;
  EEPROM.put(EEPROM_ADDR, ps); EEPROM.commit();
  sayf("Zero set raw=%u", encZeroRaw);
}

// Motor
static void motorInit() {
  pinMode(PIN_DIR, OUTPUT);
  pinMode(PIN_STEP, OUTPUT);
  if (PIN_EN >= 0) { pinMode(PIN_EN, OUTPUT); digitalWrite(PIN_EN, LOW); }
}
static void stepBlocking(long steps, bool cw) {
  digitalWrite(PIN_DIR, (cw == dirCwHigh) ? HIGH : LOW);
  float sps = max(100.0f, (degPerSec * stepsPerRev) / 360.0f);
  uint32_t usHalf = (uint32_t)max(100.0f, 1e6f / (2.0f * sps));
  for (long i = 0; i < steps; i++) {
    digitalWrite(PIN_STEP, HIGH); delayMicroseconds(usHalf);
    digitalWrite(PIN_STEP, LOW);  delayMicroseconds(usHalf);
  }
}
static void moveByDegrees(float deltaDeg) {
  if (!isfinite(deltaDeg) || fabsf(deltaDeg) < 0.1f) return;
  long estSteps = lroundf((deltaDeg * stepsPerRev) / 360.0f);
  bool cw = (deltaDeg >= 0);
  stepBlocking(labs(estSteps), cw);
}

// Dock interlock
static bool dockReady(){
  if (PIN_DOCK_OK < 0) return true;
  pinMode(PIN_DOCK_OK, INPUT);
  int v = digitalRead(PIN_DOCK_OK);
  return PIN_DOCK_ACTIVE_HIGH ? (v==HIGH) : (v==LOW);
}

// Geometry helpers
inline uint8_t modN(int v, uint8_t N){ int m = v % (int)N; return (m<0)?(m+N):m; }
static uint8_t nextFilledCW(uint8_t from) {
  for (int st=1; st<drum.N; ++st) {
    uint8_t idx = modN((int)from - st, drum.N);
    if (idx==drum.openIndex) continue;
    if (slots[idx]) return idx;
  }
  return from;
}
static bool anyEmptyNonOpen() {
  for (uint8_t i=0;i<drum.N;i++) if (i!=drum.openIndex && !slots[i]) return true;
  return false;
}
struct Leg { int steps; bool cw; uint8_t target; };
static Leg shortestTo(uint8_t target){
  int cw = (int)modN((int)windowIndex - (int)target, drum.N);
  int ccw = (int)modN((int)target - (int)windowIndex, drum.N);
  if (cw <= ccw) return {cw, true, target};
  else           return {ccw, false, target};
}
static void rotateSteps(const Leg& l){
  if (l.steps<=0) return;
  moveByDegrees((l.cw? +1.0f : -1.0f) * l.steps * drum.pitchDeg);
  windowIndex = l.cw ? modN((int)windowIndex - l.steps, drum.N)
                     : modN((int)windowIndex + l.steps, drum.N);
}

// Inventory ops with dock gate
static bool performDispenseNearest() {
  if (!dockReady()) return false;
  uint8_t tgt = nextFilledCW(windowIndex);
  if (tgt == windowIndex) return false;
  Leg l = shortestTo(tgt);
  rotateSteps(l);
  slots[windowIndex] = 0;
  return true;
}
static bool performDispenseToSlot(uint8_t slotIdx){
  if (!dockReady()) return false;
  if (slotIdx==drum.openIndex || slotIdx>=drum.N || !slots[slotIdx]) return false;
  Leg l = shortestTo(slotIdx);
  rotateSteps(l);
  slots[windowIndex] = 0;
  return true;
}
static bool performReturnNearest() {
  if (!dockReady()) return false;
  int bestSteps = 999, bestIdx = -1; bool bestCW = true;
  for (uint8_t i=0;i<drum.N;i++){
    if (i==drum.openIndex || slots[i]) continue;
    int cw  = (int)modN((int)windowIndex - (int)i, drum.N);
    int ccw = (int)modN((int)i - (int)windowIndex, drum.N);
    int steps; bool cwdir;
    if (cw < ccw)      { steps=cw;  cwdir=true;  }
    else if (ccw < cw) { steps=ccw; cwdir=false; }
    else               { steps=ccw; cwdir=false; }
    if (steps>0 && steps < bestSteps){ bestSteps=steps; bestIdx=i; bestCW=cwdir; }
  }
  if (bestIdx<0) return false;
  rotateSteps({bestSteps,bestCW,(uint8_t)bestIdx});
  slots[windowIndex] = 1;
  return true;
}

// EEPROM
static void saveAll() {
  ps.magic = PS_MAGIC; ps.version=PS_VER; ps.deviceId=DEVICE_ID;
  ps.dirCwHigh = dirCwHigh?1:0;
  ps.stepsPerRev = (uint16_t)stepsPerRev;
  ps.degPerSec = degPerSec;
  ps.encZeroRaw = encZeroRaw;
  ps.spokesN = drum.N;
  for (uint8_t i=0;i<8;i++) ps.slotsFilled[i] = (i<drum.N)? slots[i] : 0;
  EEPROM.put(EEPROM_ADDR, ps); EEPROM.commit();
}
static void loadOrInit() {
  EEPROM.get(EEPROM_ADDR, ps);
  if (ps.magic!=PS_MAGIC || ps.version!=PS_VER){
    memset(&ps, 0, sizeof(ps));
    ps.magic=PS_MAGIC; ps.version=PS_VER; ps.deviceId=DEVICE_ID;
    ps.dirCwHigh=1; ps.stepsPerRev=1600; ps.degPerSec=90.0f;
    ps.encZeroRaw=as5600AngleRaw();
    ps.spokesN=5;
    for (int i=0;i<8;i++) ps.slotsFilled[i]=(i==0)?0:(i<5?1:0);
    EEPROM.put(EEPROM_ADDR, ps); EEPROM.commit();
  }
  dirCwHigh = ps.dirCwHigh!=0;
  stepsPerRev=ps.stepsPerRev; degPerSec=ps.degPerSec; encZeroRaw=ps.encZeroRaw;
  drum.N = ps.spokesN?ps.spokesN:5; drum.pitchDeg=360.0f/drum.N; drum.openIndex=0;
  for (uint8_t i=0;i<drum.N && i<8;i++) slots[i]=ps.slotsFilled[i];
  slots[0]=0;
}

// CAN/TWAI
static void canStart(){
  twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)CAN_TX_PIN,
                                                        (gpio_num_t)CAN_RX_PIN,
                                                        TWAI_MODE_NORMAL);

  twai_timing_config_t t;  // choose without ternary
  #if   (CAN_BPS == 1000000)
    t = TWAI_TIMING_CONFIG_1MBITS();
  #elif (CAN_BPS == 800000)
    t = TWAI_TIMING_CONFIG_800KBITS();
  #elif (CAN_BPS == 500000)
    t = TWAI_TIMING_CONFIG_500KBITS();
  #elif (CAN_BPS == 250000)
    t = TWAI_TIMING_CONFIG_250KBITS();
  #elif (CAN_BPS == 125000)
    t = TWAI_TIMING_CONFIG_125KBITS();
  #else
    #error Unsupported CAN_BPS. Use 1M/800k/500k/250k/125k.
  #endif

  twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  twai_driver_install(&g, &t, &f);
  twai_start();
}
static void canReply(uint8_t code, const uint8_t* data=nullptr, uint8_t len=0){
  twai_message_t tx={};
  tx.identifier = 100 + DEVICE_ID; tx.extd=0; tx.rtr=0;
  tx.data_length_code = min<uint8_t>(8, (uint8_t)(len+1));
  tx.data[0]=code;
  for (uint8_t i=0;i<len && i<7;i++) tx.data[1+i]=data[i];
  twai_transmit(&tx, pdMS_TO_TICKS(50));
}
static void reportStatus(){
  uint8_t bmp=0; for (uint8_t i=0;i<drum.N;i++) if (slots[i]) bmp|=(1u<<i);
  uint8_t p[7];
  p[0]=windowIndex; p[1]=bmp; p[2]=drum.N;
  p[3]=(uint8_t)(stepsPerRev>>8); p[4]=(uint8_t)(stepsPerRev&0xFF);
  p[5]=dirCwHigh?1:0; p[6]=DEVICE_ID;
  canReply(R_STATUS, p, 7);
}

static void handleCAN(const twai_message_t& rx){
  if (rx.identifier != DEVICE_ID || rx.data_length_code < 1) return;
  uint8_t op = rx.data[0];

  switch (op){
    case OP_DISPENSE_NEAREST:{
      bool ok = performDispenseNearest(); if (ok) saveAll();
      uint8_t p[2]={(uint8_t)(ok?1:0), windowIndex}; canReply(R_DISP_NEAREST, p, 2);
    } break;
    case OP_DISPENSE_TO_SLOT:{
      if (rx.data_length_code<2){ canReply(R_ERROR,nullptr,0); break; }
      uint8_t s=rx.data[1]; bool ok=performDispenseToSlot(s); if (ok) saveAll();
      uint8_t p[2]={(uint8_t)(ok?1:0), windowIndex}; canReply(R_DISP_TO_SLOT, p, 2);
    } break;
    case OP_RETURN_NEAREST:{
      bool any = anyEmptyNonOpen(); bool ok = any && performReturnNearest(); if (ok) saveAll();
      uint8_t p[2]={(uint8_t)(ok?1:0), windowIndex}; canReply(R_RETURN_NEAREST, p, 2);
    } break;
    case OP_SET_ZERO_HERE:{
      setZeroHerePersist();
      uint8_t p[2]={(uint8_t)(encZeroRaw>>8),(uint8_t)(encZeroRaw&0xFF)}; canReply(R_SET_ZERO, p, 2);
    } break;
    case OP_SET_PARAM:{
      if (rx.data_length_code<2){ canReply(R_ERROR,nullptr,0); break; }
      uint8_t sub=rx.data[1]; bool ok=false;
      if (sub==PARAM_STEPSPERREV && rx.data_length_code>=4){
        uint16_t v = read_u16_be(&rx.data[2]); if (v>=200 && v<=25600){ stepsPerRev=v; ok=true; }
      } else if (sub==PARAM_DEGPERSEC && rx.data_length_code>=6){
        float v = read_float(&rx.data[2]); if (v>0.1f && v<=720.0f){ degPerSec=v; ok=true; }
      } else if (sub==PARAM_DIRCWHIGH && rx.data_length_code>=3){
        dirCwHigh = rx.data[2]!=0; ok=true;
      } else if (sub==PARAM_SPOKESN && rx.data_length_code>=3){
        uint8_t n=rx.data[2]; if (n>=3 && n<=8){
          drum.N=n; drum.pitchDeg=360.0f/n; drum.openIndex=0;
          for (uint8_t i=0;i<8;i++) slots[i]=(i<drum.N)?(i==0?0:1):0;
          windowIndex=0; ok=true;
        }
      }
      if (ok) saveAll();
      uint8_t p[2]={sub,(uint8_t)(ok?1:0)}; canReply(R_SET_PARAM, p, 2);
    } break;
    case OP_SET_SLOT:{
      if (rx.data_length_code<3){ canReply(R_ERROR,nullptr,0); break; }
      uint8_t s=rx.data[1]; uint8_t f=rx.data[2]?1:0; bool ok=false;
      if (s<drum.N){ slots[s]=(s==drum.openIndex)?0:f; ok=true; saveAll(); }
      uint8_t p[2]={s,(uint8_t)(ok?1:0)}; canReply(R_SET_SLOT,p,2);
    } break;
    case OP_GET_STATUS: reportStatus(); break;
    default: canReply(R_ERROR,nullptr,0); break;
  }
}

void setup(){
  Serial.begin(115200); delay(200);
  Wire.begin(I2C_SDA, I2C_SCL);
  EEPROM.begin(EEPROM_SIZE);
  motorInit(); canStart(); loadOrInit();
  windowIndex=drum.openIndex;

  uint8_t bmp=0; for (uint8_t i=0;i<drum.N;i++) if (slots[i]) bmp|=(1u<<i);
  sayf("Ready id=%u N=%u pitch=%.1f deg/s=%.1f steps/rev=%d dirCW=%d zero=%u dock=%s",
       DEVICE_ID, drum.N, drum.pitchDeg, degPerSec, stepsPerRev, (int)dirCwHigh, encZeroRaw,
       (PIN_DOCK_OK<0?"none":"present"));
  sayf("Slots: 0b" BYTE_TO_BINARY_PATTERN, BYTE_TO_BINARY(bmp));
}

void loop(){
  twai_message_t rx;
  if (twai_receive(&rx, pdMS_TO_TICKS(10)) == ESP_OK) handleCAN(rx);

  if (Serial.available()){
    String cmd = Serial.readStringUntil('\n'); cmd.trim();
    if (cmd=="stat"){ float ang=encoderAngleDeg(); uint8_t bmp=0; for (uint8_t i=0;i<drum.N;i++) if (slots[i]) bmp|=(1u<<i);
      sayf("win=%u angle=%.2f slots=0b" BYTE_TO_BINARY_PATTERN, windowIndex, ang, BYTE_TO_BINARY(bmp)); }
    else if (cmd=="zero"){ setZeroHerePersist(); }
    else if (cmd.startsWith("test ")){ float d=cmd.substring(5).toFloat(); moveByDegrees(d); }
  }
}
