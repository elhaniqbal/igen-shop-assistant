#include "driver/twai.h"
#include <Arduino.h>

#define NODE_ID 1
#define LED_PIN 2
#define TX_PIN GPIO_NUM_27
#define RX_PIN GPIO_NUM_26

void sendCommand(int target, bool on);

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  twai_general_config_t g = TWAI_GENERAL_CONFIG_DEFAULT(TX_PIN, RX_PIN, TWAI_MODE_NORMAL);
  twai_timing_config_t  t = TWAI_TIMING_CONFIG_500KBITS();
  twai_filter_config_t  f = TWAI_FILTER_CONFIG_ACCEPT_ALL();
  twai_driver_install(&g, &t, &f);
  twai_start();

  Serial.println("Master ready. Type 2,24,0 etc. and press Enter.");
}

void loop() {
  // === Serial command input ===
  if (Serial.available()) {
    String s = Serial.readStringUntil('\n');
    s.trim();

    if (s == "0") {   // turn all off
      for (int i = 2; i <= 4; i++) sendCommand(i, false);
      Serial.println("All OFF commands sent");
    } else {
      for (char c : s) {
        if (c >= '2' && c <= '4') {
          int target = c - '0';
          sendCommand(target, true);
          Serial.printf("Command sent to %d\n", target);
        }
      }
    }
  }

  // === Listen for responses ===
  twai_message_t rx;
  if (twai_receive(&rx, pdMS_TO_TICKS(5)) == ESP_OK) {
    if (rx.identifier >= 102 && rx.identifier <= 104 && rx.data_length_code >= 2) {
      int sender = rx.data[0];
      int state  = rx.data[1];
      Serial.printf("ACK from Node %d: LED %s\n", sender, state ? "ON" : "OFF");
    }
  }
}

void sendCommand(int target, bool on) {
  twai_message_t tx = {};
  tx.identifier = target;       // command target ID
  tx.extd = 0; tx.rtr = 0;
  tx.data_length_code = 1;
  tx.data[0] = on ? 1 : 0;
  twai_transmit(&tx, pdMS_TO_TICKS(100));
}
