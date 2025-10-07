#include "driver/twai.h"
#include <Arduino.h>

#define NODE_ID 4        // change to 2, 3, or 4 for each node
#define LED_PIN 2
#define TX_PIN GPIO_NUM_27
#define RX_PIN GPIO_NUM_26

bool ledState = false;   // track LED ON/OFF state

void sendAck(bool state);

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, ledState ? HIGH : LOW);

  twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT(TX_PIN, RX_PIN, TWAI_MODE_NORMAL);
  twai_timing_config_t  t = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t  f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  twai_driver_install(&g, &t, &f);
  twai_start();

  Serial.printf("Node %d ready (toggle mode)\n", NODE_ID);
}

void loop() {
  twai_message_t rx;
  if (twai_receive(&rx, pdMS_TO_TICKS(10)) == ESP_OK) {
    // Check if this message is meant for this node
    if (rx.identifier == NODE_ID) {
      // Toggle LED state
      ledState = !ledState;
      digitalWrite(LED_PIN, ledState ? HIGH : LOW);
      Serial.printf("Node %d toggled -> %s\n", NODE_ID, ledState ? "ON" : "OFF");

      // Send acknowledgment back to master
      sendAck(ledState);
    }
  }
}

void sendAck(bool state) {
  twai_message_t tx = {};
  tx.identifier = 100 + NODE_ID;   // Response IDs: 102–104
  tx.extd = 0;
  tx.rtr = 0;
  tx.data_length_code = 2;
  tx.data[0] = NODE_ID;
  tx.data[1] = state ? 1 : 0;

  esp_err_t result = twai_transmit(&tx, pdMS_TO_TICKS(100));
  if (result == ESP_OK) {
    Serial.printf("ACK sent: Node %d is now %s\n", NODE_ID, state ? "ON" : "OFF");
  } else {
    Serial.printf("ACK send failed (%d)\n", result);
  }
}
