#include "driver/twai.h"
#include <Arduino.h>

#define NODE_ID 1
#define LED_PIN 2
#define TX_PIN GPIO_NUM_27
#define RX_PIN GPIO_NUM_26

void sendToNextNode();

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(TX_PIN, RX_PIN, TWAI_MODE_NORMAL);
  twai_timing_config_t  t_config = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t  f_config = TWAI_FILTER_CONFIG_ACCEPT_ALL();

  if (twai_driver_install(&g_config, &t_config, &f_config) != ESP_OK) {
    Serial.println("Driver install failed");
    while (1);
  }
  if (twai_start() != ESP_OK) {
    Serial.println("Driver start failed");
    while (1);
  }

  Serial.printf("Node %d started CAN (TWAI)\n", NODE_ID);
  delay(2000);
  if (NODE_ID == 1) sendToNextNode();
}

void loop() {
  twai_message_t rx_msg;
  if (twai_receive(&rx_msg, pdMS_TO_TICKS(10)) == ESP_OK) {
    if (rx_msg.identifier == NODE_ID) {
      Serial.printf("Node %d activated\n", NODE_ID);
      digitalWrite(LED_PIN, HIGH);
      delay(1000);
      digitalWrite(LED_PIN, LOW);
      sendToNextNode();
    }
  }
}

void sendToNextNode() {
  int next_id = (NODE_ID % 4) + 1;
  twai_message_t tx_msg = {.identifier = (uint32_t)next_id, .data_length_code = 1};
  tx_msg.data[0] = NODE_ID;
  if (twai_transmit(&tx_msg, pdMS_TO_TICKS(100)) == ESP_OK) {
    Serial.printf("Node %d → Node %d\n", NODE_ID, next_id);
  }
  delay(500);
}
