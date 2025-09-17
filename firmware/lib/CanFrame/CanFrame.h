#pragma once
#include <Arduino.h>
struct CanMsg { uint16_t id; uint8_t len; uint8_t data[8]; };
uint16_t makeId(uint8_t prio, uint8_t type, uint8_t node);