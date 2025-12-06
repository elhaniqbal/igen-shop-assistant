// slave-mcus/gantry_uno.cpp
#include <Arduino.h>
#include <SPI.h>
#include <mcp_can.h>
#include "protocol.h"

#ifndef DEVICE_ID
#define DEVICE_ID 7
#endif
#ifndef MCP2515_CS
#define MCP2515_CS 10
#endif
#ifndef MCP2515_INT
#define MCP2515_INT 2
#endif
#ifndef MCP2515_CLK
#define MCP2515_CLK 16
#endif

#ifndef PIN_IR_DOCK
#define PIN_IR_DOCK -1
#endif
#ifndef PIN_WEIGHT_OK
#define PIN_WEIGHT_OK -1
#endif
#ifndef ACTIVE_HIGH
#define ACTIVE_HIGH 1
#endif

MCP_CAN CAN(MCP2515_CS);

static bool sensorTrue(int pin){ if (pin<0) return true; pinMode(pin, INPUT); int v=digitalRead(pin); return ACTIVE_HIGH ? (v==HIGH):(v==LOW); }

static bool canInit(){
  byte r;
  #if MCP2515_CLK==16
    r = CAN.begin(MCP_ANY, CAN_500KBPS, MCP_16MHZ);
  #else
    r = CAN.begin(MCP_ANY, CAN_500KBPS, MCP_8MHZ);
  #endif
  if (r!=CAN_OK) return false;
  CAN.setMode(MCP_NORMAL);
  pinMode(MCP2515_INT, INPUT);
  return true;
}
static void reply(uint8_t code, const uint8_t* d=nullptr, uint8_t len=0){
  byte buf[8]={0}; buf[0]=code; for (uint8_t i=0;i<len && i<7;i++) buf[1+i]=d?d[i]:0;
  CAN.sendMsgBuf(100+DEVICE_ID, 0, min<uint8_t>(8,(uint8_t)(len+1)), buf);
}

void setup(){
  Serial.begin(115200);
  if (!canInit()) Serial.println("CAN init fail");
  Serial.println("Gantry UNO placeholder ready.");
}

static void handle(unsigned long id, byte len, byte* d){
  if (id!=DEVICE_ID || len<1) return;
  uint8_t op=d[0];
  switch (op){
    case OP_GANTRY_HOME: { uint8_t p[1]={1}; reply(R_GANTRY_ACK,p,1);} break;
    case OP_GANTRY_CLAMP: {
      bool want=(len>=2)?(d[1]!=0):true;
      bool ok = want ? (sensorTrue(PIN_IR_DOCK) && sensorTrue(PIN_WEIGHT_OK)) : true;
      uint8_t p[1]={(uint8_t)(ok?1:0)}; reply(R_GANTRY_ACK,p,1);
    } break;
    case OP_GANTRY_MOVE_TO: {
      bool ok = sensorTrue(PIN_IR_DOCK) && sensorTrue(PIN_WEIGHT_OK);
      uint8_t p[1]={(uint8_t)(ok?1:0)}; reply(R_GANTRY_ACK,p,1);
    } break;
    case OP_GET_STATUS: {
      uint8_t s=0; if (sensorTrue(PIN_IR_DOCK)) s|=0x01; if (sensorTrue(PIN_WEIGHT_OK)) s|=0x02;
      uint8_t p[1]={s}; reply(R_STATUS,p,1);
    } break;
    default: reply(R_ERROR,nullptr,0); break;
  }
}

void loop(){
  if (CAN_MSGAVAIL == CAN.checkReceive()){
    unsigned long id; byte len; byte buf[8];
    CAN.readMsgBuf(&id,&len,buf); handle(id,len,buf);
  }
}
