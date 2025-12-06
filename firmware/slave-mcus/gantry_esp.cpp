// slave-mcus/gantry_esp.cpp
#include <Arduino.h>
#include "driver/twai.h"
#include "protocol.h"

#ifndef DEVICE_ID
#define DEVICE_ID 7
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

// Optional interlocks (set pins via build flags if you wire them)
#ifndef PIN_IR_DOCK
#define PIN_IR_DOCK -1
#endif
#ifndef PIN_WEIGHT_OK
#define PIN_WEIGHT_OK -1
#endif
#ifndef ACTIVE_HIGH
#define ACTIVE_HIGH 1
#endif

static bool sensorTrue(int pin){
  if (pin<0) return true;
  pinMode(pin, INPUT);
  int v = digitalRead(pin);
  return ACTIVE_HIGH ? (v==HIGH) : (v==LOW);
}

static void canStart(){
  twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)CAN_TX_PIN,(gpio_num_t)CAN_RX_PIN,TWAI_MODE_NORMAL);
  twai_timing_config_t  t = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t  f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  twai_driver_install(&g,&t,&f); twai_start();
}
static void reply(uint8_t code, const uint8_t* d=nullptr, uint8_t len=0){
  twai_message_t tx={}; tx.identifier=100+DEVICE_ID; tx.extd=0; tx.rtr=0;
  tx.data_length_code=min<uint8_t>(8,(uint8_t)(len+1)); tx.data[0]=code;
  for (uint8_t i=0;i<len && i<7;i++) tx.data[1+i]=d?d[i]:0;
  twai_transmit(&tx, pdMS_TO_TICKS(50));
}

void setup(){
  Serial.begin(115200);
  canStart();
  Serial.println("Gantry ESP32 placeholder ready.");
}

static void handle(const twai_message_t& rx){
  if (rx.identifier!=DEVICE_ID || rx.data_length_code<1) return;
  uint8_t op=rx.data[0];
  switch (op){
    case OP_GANTRY_HOME: {
      // TODO: home axes; for now just ack
      uint8_t p[1]={1}; reply(R_GANTRY_ACK,p,1);
    } break;
    case OP_GANTRY_CLAMP: {
      bool want = (rx.data_length_code>=2) ? (rx.data[1]!=0) : true;
      // TODO: actuate clamp; for now just check “interlock satisfied” if want==1
      bool ok = want ? (sensorTrue(PIN_IR_DOCK) && sensorTrue(PIN_WEIGHT_OK)) : true;
      uint8_t p[1]={(uint8_t)(ok?1:0)}; reply(R_GANTRY_ACK,p,1);
    } break;
    case OP_GANTRY_MOVE_TO: {
      // Require clamp/interlock before motion
      bool ok = sensorTrue(PIN_IR_DOCK) && sensorTrue(PIN_WEIGHT_OK);
      uint8_t p[1]={(uint8_t)(ok?1:0)}; reply(R_GANTRY_ACK,p,1);
    } break;
    case OP_GET_STATUS: {
      uint8_t s=0;
      if (sensorTrue(PIN_IR_DOCK))   s|=0x01;
      if (sensorTrue(PIN_WEIGHT_OK)) s|=0x02;
      uint8_t p[1]={s}; reply(R_STATUS,p,1);
    } break;
    default: reply(R_ERROR,nullptr,0); break;
  }
}

void loop(){
  twai_message_t rx;
  if (twai_receive(&rx, pdMS_TO_TICKS(20)) == ESP_OK) handle(rx);
}
