// controller-mcu/main.cpp
//
// ESP32 Controller MCU
// - Bridges upstream (MQTT preferred, UART fallback) <-> CAN(TWAI) slaves
// - Forwards commands and replies, periodically polls status
//
#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "driver/twai.h"
#include "protocol.h"

// -------- Build-time config (can be overridden in platformio.ini) --------
#ifndef WIFI_SSID
#define WIFI_SSID "ssid"
#endif
#ifndef WIFI_PASS
#define WIFI_PASS "pass"
#endif
#ifndef MQTT_HOST
#define MQTT_HOST "192.168.1.50"
#endif
#ifndef MQTT_PORT
#define MQTT_PORT 1883
#endif
#ifndef MQTT_CLIENT_ID
#define MQTT_CLIENT_ID "igen-controller"
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
#ifndef UART_TX_PIN
#define UART_TX_PIN 17
#endif
#ifndef UART_RX_PIN
#define UART_RX_PIN 16
#endif

// Known node IDs to poll (edit as you add modules)
static uint8_t KNOWN_IDS[] = { 4 /*wheel*/, 7 /*gantry*/ };
static const size_t KNOWN_N = sizeof(KNOWN_IDS) / sizeof(KNOWN_IDS[0]);

// -------- Globals --------
WiFiClient net;
PubSubClient mqtt(net);
HardwareSerial UPLINK(1);   // UART1 to Raspberry Pi (or other host)

enum class UpMode { UART_ONLY, MQTT_PREFERRED };
UpMode upMode = UpMode::UART_ONLY;

unsigned long lastMqttCheck = 0;
unsigned long lastPoll = 0;

// -------- CAN(TWAI) helpers --------
static void canStart() {
  twai_general_config_t g =
      TWAI_GENERAL_CONFIG_DEFAULT((gpio_num_t)CAN_TX_PIN, (gpio_num_t)CAN_RX_PIN, TWAI_MODE_NORMAL);

  twai_timing_config_t t;
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
# error Unsupported CAN_BPS. Use 1M/800k/500k/250k/125k.
#endif

  twai_filter_config_t f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  ESP_ERROR_CHECK(twai_driver_install(&g, &t, &f));
  ESP_ERROR_CHECK(twai_start());
}

static bool canSend(uint16_t id, const uint8_t* data, uint8_t len) {
  twai_message_t tx = {};
  tx.identifier = id;
  tx.extd = 0;
  tx.rtr = 0;
  uint8_t dlc = (len > 8) ? 8 : len;
  tx.data_length_code = dlc;
  if (dlc > 0 && data) memcpy(tx.data, data, dlc);
  return twai_transmit(&tx, pdMS_TO_TICKS(50)) == ESP_OK;
}

static bool canWaitReply(uint16_t replyId, twai_message_t& out, uint32_t timeout_ms = 400) {
  uint32_t until = millis() + timeout_ms;
  while (millis() < until) {
    twai_message_t rx;
    if (twai_receive(&rx, pdMS_TO_TICKS(20)) == ESP_OK) {
      if (!rx.extd && rx.identifier == replyId) { out = rx; return true; }

      // Forward unsolicited status upstream
      if (!rx.extd && rx.identifier >= 100 && rx.identifier < 128) {
        uint8_t dev = rx.identifier - 100;
        if (rx.data_length_code > 0 && rx.data[0] == R_STATUS) {
          JsonDocument dj;
          dj["src"]  = "status";
          dj["id"]   = dev;
          dj["code"] = rx.data[0];
          if (rx.data_length_code > 1) dj["b1"] = rx.data[1];
          if (rx.data_length_code > 2) dj["b2"] = rx.data[2];
          if (rx.data_length_code > 3) dj["b3"] = rx.data[3];

          char buf[160];
          size_t n = serializeJson(dj, buf, sizeof(buf));
          if (upMode == UpMode::MQTT_PREFERRED && mqtt.connected()) {
            char topic[64]; snprintf(topic, sizeof(topic), "igen/slave/%u/status", dev);
            mqtt.publish(topic, buf, n);
          } else {
            UPLINK.write((const uint8_t*)buf, n);
            UPLINK.write('\n');
          }
        }
      }
    }
  }
  return false;
}

// -------- Upstream helpers --------
static void sendUp(const JsonDocument& d, const char* topicLeaf = nullptr) {
  if (upMode == UpMode::MQTT_PREFERRED && mqtt.connected()) {
    String topic = String("igen/controller/") + (topicLeaf ? topicLeaf : "event");
    String payload; serializeJson(d, payload);
    mqtt.publish(topic.c_str(), payload.c_str());
  } else {
    String line; serializeJson(d, line);
    UPLINK.println(line);
  }
}

static void applyCommand(const JsonDocument& jd) {
  const char* cmd = jd["cmd"] | "";
  uint8_t id = jd["id"] | 0;

  // Broadcast poll
  if (id == 0 && strcmp(cmd, "get_status") == 0) {
    for (size_t i = 0; i < KNOWN_N; i++) {
      uint8_t tid = KNOWN_IDS[i];
      uint8_t b[1] = { OP_GET_STATUS };
      canSend(tid, b, 1);
    }
    return;
  }
  if (id == 0) return; // need a target id otherwise

  uint8_t b[8] = {0};
  uint8_t len = 0;

  if      (!strcmp(cmd, "dispense_nearest")) { b[0] = OP_DISPENSE_NEAREST; len = 1; }
  else if (!strcmp(cmd, "return_nearest"))   { b[0] = OP_RETURN_NEAREST;   len = 1; }
  else if (!strcmp(cmd, "set_zero"))         { b[0] = OP_SET_ZERO_HERE;    len = 1; }
  else if (!strcmp(cmd, "dispense_to_slot")) { b[0] = OP_DISPENSE_TO_SLOT; b[1] = (uint8_t)(jd["slot"] | 0); len = 2; }
  else if (!strcmp(cmd, "get_status"))       { b[0] = OP_GET_STATUS;       len = 1; }
  else if (!strcmp(cmd, "set_slot"))         { b[0] = OP_SET_SLOT; b[1] = (uint8_t)(jd["slot"] | 0); b[2] = (uint8_t)((jd["filled"] | 0) ? 1 : 0); len = 3; }
  else if (!strcmp(cmd, "set_param")) {
    b[0] = OP_SET_PARAM;
    b[1] = (uint8_t)(jd["sub"] | 0);
    len  = 2;
    if (jd["u16"].is<unsigned>()) {
      uint16_t v = (uint16_t)jd["u16"].as<unsigned>();
      pack_u16_be(&b[2], v); len = 4;
    } else if (jd["u8"].is<unsigned>()) {
      b[2] = (uint8_t)jd["u8"].as<unsigned>(); len = 3;
    } else if (jd["f"].is<float>()) {
      float f = jd["f"].as<float>(); pack_float(&b[2], f); len = 6;
    }
  } else {
    return; // unknown command
  }

  JsonDocument out;
  out["type"] = "reply";
  out["to"]   = id;
  out["sent"] = b[0];

  bool ok = canSend(id, b, len);
  if (!ok) { out["err"] = "CAN_TX"; sendUp(out, "error"); return; }

  twai_message_t rx;
  if (canWaitReply(100 + id, rx, 600)) {
    out["code"] = rx.data[0];
    JsonArray arr = out["data"].to<JsonArray>();
    for (int i = 1; i < rx.data_length_code; i++) arr.add(rx.data[i]);
    sendUp(out, "rx");
  } else {
    out["err"] = "TIMEOUT";
    sendUp(out, "timeout");
  }
}

static void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  JsonDocument jd;
  DeserializationError e = deserializeJson(jd, payload, length);
  if (!e) applyCommand(jd);
}

static void mqttEnsure() {
  if (mqtt.connected()) return;
  if (WiFi.status() != WL_CONNECTED) return;

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(onMqttMessage);

  if (mqtt.connect(MQTT_CLIENT_ID)) {
    mqtt.subscribe("igen/controller/cmd");
    upMode = UpMode::MQTT_PREFERRED;
    JsonDocument dj; dj["type"] = "online";
    sendUp(dj, "lifecycle");
  }
}

static void wifiMaybeConnect() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long until = millis() + 7000;
  while (WiFi.status() != WL_CONNECTED && millis() < until) delay(100);
  if (WiFi.status() != WL_CONNECTED) upMode = UpMode::UART_ONLY;
}

// -------- Arduino lifecycle --------
void setup() {
  Serial.begin(115200);
  delay(200);

  UPLINK.begin(115200, SERIAL_8N1, UART_RX_PIN, UART_TX_PIN);
  canStart();

  wifiMaybeConnect();
  mqttEnsure();

  JsonDocument hello;
  hello["type"] = "boot";
  hello["mode"] = (upMode == UpMode::MQTT_PREFERRED) ? "mqtt" : "uart";
  sendUp(hello, "boot");
}

void loop() {
  // Maintain/upshift to MQTT when possible
  if (millis() - lastMqttCheck > 2000) {
    lastMqttCheck = millis();
    if (upMode == UpMode::MQTT_PREFERRED) {
      if (WiFi.status() != WL_CONNECTED) upMode = UpMode::UART_ONLY;
      else if (!mqtt.connected()) mqttEnsure();
    } else {
      wifiMaybeConnect();
      mqttEnsure();
    }
  }
  if (upMode == UpMode::MQTT_PREFERRED) mqtt.loop();

  // Periodic status polls
  if (millis() - lastPoll > 2000) {
    lastPoll = millis();
    for (size_t i = 0; i < KNOWN_N; i++) {
      uint8_t id = KNOWN_IDS[i];
      uint8_t b[1] = { OP_GET_STATUS };
      canSend(id, b, 1);
    }
  }

  // UART command input (JSON lines)
  if (UPLINK.available()) {
    String line = UPLINK.readStringUntil('\n'); line.trim();
    if (line.length()) {
      JsonDocument jd;
      DeserializationError e = deserializeJson(jd, line);
      if (!e) applyCommand(jd);
      else {
        JsonDocument dj; dj["type"] = "parse_error"; dj["msg"] = line;
        sendUp(dj, "error");
      }
    }
  }

  // Drain CAN for unsolicited events and forward upstream
  twai_message_t rx;
  while (twai_receive(&rx, pdMS_TO_TICKS(1)) == ESP_OK) {
    if (!rx.extd && rx.identifier >= 100 && rx.identifier < 128) {
      uint8_t dev = rx.identifier - 100;
      JsonDocument dj;
      dj["type"] = "event";
      dj["id"]   = dev;
      dj["code"] = rx.data[0];
      JsonArray arr = dj["data"].to<JsonArray>();
      for (int i = 1; i < rx.data_length_code; i++) arr.add(rx.data[i]);
      sendUp(dj, "event");
    }
  }
}
