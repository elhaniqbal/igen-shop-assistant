// include/protocol.h
#pragma once
#include <Arduino.h>

//
// CAN addressing convention:
//   Command to slave:  ID == DEVICE_ID (standard ID)
//   Slave reply:       ID == 100 + DEVICE_ID
//
// Controller may poll status using OP_GET_STATUS.
// Wheel/gantry slaves implement a subset relevant to them.
//

// Opcodes sent to slaves
enum : uint8_t {
  OP_DISPENSE_NEAREST   = 0x01,
  OP_RETURN_NEAREST     = 0x02,
  OP_SET_ZERO_HERE      = 0x03,
  OP_SET_PARAM          = 0x04, // data[1]=sub, value in following bytes
  OP_SET_SLOT           = 0x05, // data[1]=slot idx, data[2]=0/1
  OP_GET_STATUS         = 0x06,
  OP_DISPENSE_TO_SLOT   = 0x07,

  // Gantry-specific (placeholder)
  OP_GANTRY_HOME        = 0x30,
  OP_GANTRY_MOVE_TO     = 0x31, // data[1..4]=float mm, data[5..8]=float mm/s (optional)
  OP_GANTRY_CLAMP       = 0x32, // data[1]=0/1
};

// Parameters for OP_SET_PARAM
enum : uint8_t {
  PARAM_STEPSPERREV     = 0x00, // u16
  PARAM_DEGPERSEC       = 0x01, // float
  PARAM_DIRCWHIGH       = 0x02, // u8
  PARAM_SPOKESN         = 0x03, // u8 (<=8)
};

// Reply/event codes from slaves
enum : uint8_t {
  R_STATUS              = 0x80, // status packet (see pack in wheel)
  R_DISP_NEAREST        = 0x11, // payload: ok, windowIndex
  R_DISP_TO_SLOT        = 0x12, // payload: ok, windowIndex
  R_RETURN_NEAREST      = 0x13, // payload: ok, windowIndex
  R_SET_ZERO            = 0x21, // payload: rawZero hi, lo
  R_SET_PARAM           = 0x22, // payload: sub, ok
  R_SET_SLOT            = 0x23, // payload: slot, ok
  R_GANTRY_ACK          = 0x90, // payload varies
  R_ERROR               = 0xFE
};

// Small packing helpers
inline void pack_u16_be(uint8_t* p, uint16_t v){ p[0]=uint8_t(v>>8); p[1]=uint8_t(v&0xFF); }
inline uint16_t read_u16_be(const uint8_t* p){ return (uint16_t(p[0])<<8) | p[1]; }
inline void pack_float(uint8_t* p, float f){ memcpy(p, &f, 4); }
inline float read_float(const uint8_t* p){ float f; memcpy(&f, p, 4); return f; }

// Bitmap pretty (for Serial prints)
#define BYTE_TO_BINARY_PATTERN "%c%c%c%c%c%c%c%c"
#define BYTE_TO_BINARY(byte)  \
  ((byte) & 0x80 ? '1' : '0'), \
  ((byte) & 0x40 ? '1' : '0'), \
  ((byte) & 0x20 ? '1' : '0'), \
  ((byte) & 0x10 ? '1' : '0'), \
  ((byte) & 0x08 ? '1' : '0'), \
  ((byte) & 0x04 ? '1' : '0'), \
  ((byte) & 0x02 ? '1' : '0'), \
  ((byte) & 0x01 ? '1' : '0')
