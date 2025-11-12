// slave-mcus/dispense_wheel_uno.cpp
#include <Arduino.h>
#include <Wire.h>
#include <EEPROM.h>
#include <SPI.h>
#include <mcp_can.h>
#include "protocol.h"


// -------- Pins / Config (set via build_flags) --------
#ifndef DEVICE_ID
#define DEVICE_ID 4
#endif
#ifndef MCP2515_CS
#define MCP2515_CS 10
#endif
#ifndef MCP2515_INT
#define MCP2515_INT 2
#endif
#ifndef MCP2515_CLK
#define MCP2515_CLK 16   // 16 for 16 MHz module, 8 for 8 MHz
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
#define PIN_DOCK_OK 8
#endif
#ifndef PIN_DOCK_ACTIVE_HIGH
#define PIN_DOCK_ACTIVE_HIGH 1
#endif

// AS5600 constants
static const uint8_t AS5600_ADDR      = 0x36;
static const uint8_t REG_RAW_ANGLE_H  = 0x0C;
static const int     TICKS_PER_REV    = 4096;

// CAN
MCP_CAN CAN(MCP2515_CS);

// Geometry / state same as ESP32
struct __attribute__((packed)) Persist {
  uint8_t  magic, version, deviceId, dirCwHigh;
  uint16_t stepsPerRev;
  float    degPerSec;
  uint16_t encZeroRaw;
  uint8_t  spokesN;
  uint8_t  slotsFilled[8];
  uint8_t  reserved[8];
};
Persist ps;
const uint8_t PS_MAGIC=0xA5, PS_VER=1;
uint16_t encZeroRaw=0;
uint8_t  slots[8]={0};
int      stepsPerRev=1600;
float    degPerSec=90.0f;
bool     dirCwHigh=true;
uint8_t  windowIndex=0;
struct Drum { uint8_t N; float pitchDeg; uint8_t openIndex; } drum={5,72.0f,0};

static void logln(const String& s){ Serial.println(s); }

// I2C helpers
static uint16_t i2cRead16(uint8_t dev, uint8_t regHigh){
  Wire.beginTransmission(dev); Wire.write(regHigh);
  if (Wire.endTransmission(false)!=0) return 0;
  if (Wire.requestFrom((int)dev, 2)!=2) return 0;
  uint8_t hi=Wire.read(), lo=Wire.read();
  return ((uint16_t)hi<<8)|lo;
}
static uint16_t as5600AngleRaw(){ return i2cRead16(AS5600_ADDR, REG_RAW_ANGLE_H) & 0x0FFF; }
static float encoderAngleDeg(){
  uint16_t raw=as5600AngleRaw();
  int32_t diff=(int32_t)raw - (int32_t)encZeroRaw; if (diff<0) diff+=TICKS_PER_REV;
  float deg=(diff*360.0f)/(float)TICKS_PER_REV; if (deg>359.8f) deg=0.0f; return deg;
}
static void setZeroHerePersist(){
  encZeroRaw=as5600AngleRaw(); ps.encZeroRaw=encZeroRaw; EEPROM.put(0, ps);
  logln("Zero set.");
}

// Motor
static void motorInit(){
  pinMode(PIN_DIR, OUTPUT); pinMode(PIN_STEP, OUTPUT);
  if (PIN_EN>=0){ pinMode(PIN_EN, OUTPUT); digitalWrite(PIN_EN, LOW); }
}
static void stepBlocking(long steps, bool cw){
  digitalWrite(PIN_DIR, (cw==dirCwHigh)?HIGH:LOW);
  float sps = max(100.0f, (degPerSec*stepsPerRev)/360.0f);
  uint32_t usHalf = (uint32_t)max(100.0f, 1000000.0f/(2.0f*sps));
  for (long i=0;i<steps;i++){ digitalWrite(PIN_STEP,HIGH); delayMicroseconds(usHalf);
                              digitalWrite(PIN_STEP,LOW);  delayMicroseconds(usHalf); }
}
static void moveByDegrees(float d){
  if (!isfinite(d)||fabs(d)<0.1f) return;
  long estSteps = lround((d*stepsPerRev)/360.0f);
  stepBlocking(labs(estSteps), d>=0);
}

// Dock interlock
static bool dockReady(){
  if (PIN_DOCK_OK<0) return true;
  pinMode(PIN_DOCK_OK, INPUT);
  int v=digitalRead(PIN_DOCK_OK);
  return PIN_DOCK_ACTIVE_HIGH ? (v==HIGH):(v==LOW);
}

// Geometry/inventory
inline uint8_t modN(int v, uint8_t N){ int m=v%(int)N; return (m<0)?(m+N):m; }
static uint8_t nextFilledCW(uint8_t from){
  for (int st=1; st<drum.N; ++st){ uint8_t idx=modN((int)from - st, drum.N);
    if (idx==drum.openIndex) continue; if (slots[idx]) return idx; }
  return from;
}
static bool anyEmptyNonOpen(){
  for (uint8_t i=0;i<drum.N;i++) if (i!=drum.openIndex && !slots[i]) return true;
  return false;
}
struct Leg{ int steps; bool cw; uint8_t target; };
static Leg shortestTo(uint8_t target){
  int cw=(int)modN((int)windowIndex - (int)target, drum.N);
  int ccw=(int)modN((int)target - (int)windowIndex, drum.N);
  if (cw<=ccw) return {cw,true,target}; else return {ccw,false,target};
}
static void rotateSteps(const Leg& l){
  if (l.steps<=0) return;
  moveByDegrees((l.cw?+1.0f:-1.0f)*l.steps*drum.pitchDeg);
  windowIndex = l.cw ? modN((int)windowIndex - l.steps, drum.N)
                     : modN((int)windowIndex + l.steps, drum.N);
}
static bool performDispenseNearest(){
  if (!dockReady()) return false;
  uint8_t tgt=nextFilledCW(windowIndex); if (tgt==windowIndex) return false;
  Leg l=shortestTo(tgt); rotateSteps(l); slots[windowIndex]=0; return true;
}
static bool performDispenseToSlot(uint8_t s){
  if (!dockReady()) return false;
  if (s==drum.openIndex || s>=drum.N || !slots[s]) return false;
  Leg l=shortestTo(s); rotateSteps(l); slots[windowIndex]=0; return true;
}
static bool performReturnNearest(){
  if (!dockReady()) return false;
  int bestSteps=999; int bestIdx=-1; bool bestCW=true;
  for (uint8_t i=0;i<drum.N;i++){
    if (i==drum.openIndex || slots[i]) continue;
    int cw =(int)modN((int)windowIndex - (int)i, drum.N);
    int ccw=(int)modN((int)i - (int)windowIndex, drum.N);
    int steps; bool cwdir; if (cw<ccw){steps=cw;cwdir=true;} else if (ccw<cw){steps=ccw;cwdir=false;} else {steps=ccw;cwdir=false;}
    if (steps>0 && steps<bestSteps){ bestSteps=steps; bestIdx=i; bestCW=cwdir; }
  }
  if (bestIdx<0) return false;
  rotateSteps({bestSteps,bestCW,(uint8_t)bestIdx}); slots[windowIndex]=1; return true;
}

// EEPROM
static void saveAll(){
  ps.magic=PS_MAGIC; ps.version=PS_VER; ps.deviceId=DEVICE_ID;
  ps.dirCwHigh=dirCwHigh?1:0; ps.stepsPerRev=(uint16_t)stepsPerRev;
  ps.degPerSec=degPerSec; ps.encZeroRaw=encZeroRaw; ps.spokesN=drum.N;
  for (uint8_t i=0;i<8;i++) ps.slotsFilled[i]=(i<drum.N)?slots[i]:0;
  EEPROM.put(0, ps);
}
static void loadOrInit(){
  EEPROM.get(0, ps);
  if (ps.magic!=PS_MAGIC || ps.version!=PS_VER){
    memset(&ps,0,sizeof(ps));
    ps.magic=PS_MAGIC; ps.version=PS_VER; ps.deviceId=DEVICE_ID;
    ps.dirCwHigh=1; ps.stepsPerRev=1600; ps.degPerSec=90.0f; ps.encZeroRaw=as5600AngleRaw();
    ps.spokesN=5; for (int i=0;i<8;i++) ps.slotsFilled[i]=(i==0)?0:(i<5?1:0);
    EEPROM.put(0, ps);
  }
  dirCwHigh=ps.dirCwHigh!=0; stepsPerRev=ps.stepsPerRev; degPerSec=ps.degPerSec; encZeroRaw=ps.encZeroRaw;
  drum.N=ps.spokesN?ps.spokesN:5; drum.pitchDeg=360.0f/drum.N; drum.openIndex=0;
  for (uint8_t i=0;i<drum.N && i<8;i++) slots[i]=ps.slotsFilled[i];
  slots[0]=0;
}

// CAN helpers (UNO)
static bool canInit(){
  byte ret;
  #if MCP2515_CLK==16
    ret = CAN.begin(MCP_ANY, CAN_500KBPS, MCP_16MHZ);
  #else
    ret = CAN.begin(MCP_ANY, CAN_500KBPS, MCP_8MHZ);
  #endif
  if (ret != CAN_OK) return false;
  CAN.setMode(MCP_NORMAL);
  pinMode(MCP2515_INT, INPUT);
  return true;
}
static void canReply(uint8_t code, const uint8_t* data=nullptr, uint8_t len=0){
  byte buf[8] = {0};
  buf[0] = code;
  for (uint8_t i = 0; i < 7 && i < len; i++) buf[1 + i] = data ? data[i] : 0;

  // DLC = min(8, len+1) without std::min or the Arduino macro
  uint8_t dlc = (len >= 7) ? 8 : (uint8_t)(len + 1);

  CAN.sendMsgBuf(100 + DEVICE_ID, 0, dlc, buf);
}


void setup(){
  Serial.begin(115200); delay(200);
  Wire.begin(); motorInit();
  if (!canInit()){ logln("CAN init failed"); }
  loadOrInit();
  windowIndex=drum.openIndex;

  logln("UNO wheel ready.");
}

static void handleFrame(unsigned long id, byte len, byte* d){
  if (id != DEVICE_ID || len<1) return;
  uint8_t op=d[0];

  switch (op){
    case OP_DISPENSE_NEAREST:{ bool ok=performDispenseNearest(); if (ok) saveAll();
      uint8_t p[2]={(uint8_t)(ok?1:0), windowIndex}; canReply(R_DISP_NEAREST,p,2);
    } break;
    case OP_DISPENSE_TO_SLOT:{
      if (len<2){ canReply(R_ERROR,nullptr,0); break; }
      uint8_t s=d[1]; bool ok=performDispenseToSlot(s); if (ok) saveAll();
      uint8_t p[2]={(uint8_t)(ok?1:0), windowIndex}; canReply(R_DISP_TO_SLOT,p,2);
    } break;
    case OP_RETURN_NEAREST:{
      bool any=anyEmptyNonOpen(); bool ok=any && performReturnNearest(); if (ok) saveAll();
      uint8_t p[2]={(uint8_t)(ok?1:0), windowIndex}; canReply(R_RETURN_NEAREST,p,2);
    } break;
    case OP_SET_ZERO_HERE:{ setZeroHerePersist();
      uint8_t p[2]={(uint8_t)(encZeroRaw>>8),(uint8_t)(encZeroRaw&0xFF)}; canReply(R_SET_ZERO,p,2);
    } break;
    case OP_SET_PARAM:{
      if (len<2){ canReply(R_ERROR,nullptr,0); break; }
      uint8_t sub=d[1]; bool ok=false;
      if (sub==PARAM_STEPSPERREV && len>=4){ uint16_t v=read_u16_be(&d[2]); if (v>=200 && v<=25600){ stepsPerRev=v; ok=true; } }
      else if (sub==PARAM_DEGPERSEC && len>=6){ float f=read_float(&d[2]); if (f>0.1f && f<=720.0f){ degPerSec=f; ok=true; } }
      else if (sub==PARAM_DIRCWHIGH && len>=3){ dirCwHigh = d[2]!=0; ok=true; }
      else if (sub==PARAM_SPOKESN && len>=3){ uint8_t n=d[2]; if (n>=3 && n<=8){
          drum.N=n; drum.pitchDeg=360.0f/n; drum.openIndex=0;
          for (uint8_t i=0;i<8;i++) slots[i]=(i<drum.N)?(i==0?0:1):0; windowIndex=0; ok=true; } }
      if (ok) saveAll(); uint8_t p[2]={sub,(uint8_t)(ok?1:0)}; canReply(R_SET_PARAM,p,2);
    } break;
    case OP_SET_SLOT:{
      if (len<3){ canReply(R_ERROR,nullptr,0); break; }
      uint8_t s=d[1]; uint8_t f=d[2]?1:0; bool ok=false;
      if (s<drum.N){ slots[s]=(s==drum.openIndex)?0:f; ok=true; saveAll(); }
      uint8_t p[2]={s,(uint8_t)(ok?1:0)}; canReply(R_SET_SLOT,p,2);
    } break;
    case OP_GET_STATUS:{
      uint8_t bmp=0; for (uint8_t i=0;i<drum.N;i++) if (slots[i]) bmp|=(1u<<i);
      uint8_t p[7]; p[0]=windowIndex; p[1]=bmp; p[2]=drum.N;
      p[3]=(uint8_t)(stepsPerRev>>8); p[4]=(uint8_t)(stepsPerRev&0xFF); p[5]=dirCwHigh?1:0; p[6]=DEVICE_ID;
      canReply(R_STATUS,p,7);
    } break;
    default: canReply(R_ERROR,nullptr,0); break;
  }
}

void loop(){
  if (CAN_MSGAVAIL == CAN.checkReceive()){
    unsigned long id; byte len; byte buf[8];
    CAN.readMsgBuf(&id, &len, buf); handleFrame(id, len, buf);
  }
  if (Serial.available()){
    String cmd=Serial.readStringUntil('\n'); cmd.trim();
    if (cmd=="stat"){ float ang=encoderAngleDeg(); Serial.print("angle="); Serial.println(ang,2); }
    else if (cmd=="zero"){ setZeroHerePersist(); }
    else if (cmd.startsWith("test ")){ float d=cmd.substring(5).toFloat(); moveByDegrees(d); }
  }
}
