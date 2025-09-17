#include "CanFrame.h"
uint16_t makeId(uint8_t prio, uint8_t type, uint8_t node){
  return ((prio & 0x3) << 9) | ((type & 0xF) << 5) | (node & 0x1F);
}