#include <Wire.h>
#include <Preferences.h>

#define I2C_SDA 21
#define I2C_SCL 22

static const uint8_t TCA_ADDR = 0x70;
static const uint8_t AS5600_ADDR = 0x36;
static const uint8_t MAX_CAKES = 8;

Preferences prefs;

struct EncoderConfig {
  uint16_t zeroRaw;   // 0..4095
  int8_t dir;         // +1 = CW, -1 = CCW
};

EncoderConfig cfg[MAX_CAKES + 1]; // 1-based indexing

// -----------------------------
// Utility
// -----------------------------
bool validCake(int cake) {
  return cake >= 1 && cake <= MAX_CAKES;
}

void selectMuxChannel(uint8_t channel) {
  if (channel > 7) return;
  Wire.beginTransmission(TCA_ADDR);
  Wire.write(1 << channel);
  Wire.endTransmission();
}

void disableMuxAll() {
  Wire.beginTransmission(TCA_ADDR);
  Wire.write(0x00);
  Wire.endTransmission();
}

bool readAS5600Reg8(uint8_t reg, uint8_t &value) {
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom((int)AS5600_ADDR, 1) != 1) return false;
  value = Wire.read();
  return true;
}

bool readAS5600Reg16(uint8_t reg, uint16_t &value) {
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;

  if (Wire.requestFrom((int)AS5600_ADDR, 2) != 2) return false;
  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  value = ((uint16_t)hi << 8) | lo;
  return true;
}

bool encoderPresent(int cake) {
  if (!validCake(cake)) return false;
  selectMuxChannel(cake - 1);

  uint8_t status = 0;
  bool ok = readAS5600Reg8(0x0B, status);  // STATUS register
  disableMuxAll();
  return ok;
}

bool readStatusReg(int cake, uint8_t &status) {
  if (!validCake(cake)) return false;
  selectMuxChannel(cake - 1);
  bool ok = readAS5600Reg8(0x0B, status);
  disableMuxAll();
  return ok;
}

bool readRawAngle(int cake, uint16_t &raw) {
  if (!validCake(cake)) return false;
  selectMuxChannel(cake - 1);

  // RAW ANGLE register = 0x0C / 0x0D
  uint16_t val = 0;
  bool ok = readAS5600Reg16(0x0C, val);
  disableMuxAll();

  if (!ok) return false;
  raw = val & 0x0FFF;
  return true;
}

bool readScaledAngleDeg(int cake, float &deg, uint16_t &rawOut) {
  uint16_t raw = 0;
  if (!readRawAngle(cake, raw)) return false;

  uint16_t zero = cfg[cake].zeroRaw & 0x0FFF;
  int32_t delta = (int32_t)raw - (int32_t)zero;

  while (delta < 0) delta += 4096;
  delta %= 4096;

  if (cfg[cake].dir < 0) {
    delta = (4096 - delta) % 4096;
  }

  deg = (360.0f * delta) / 4096.0f;
  rawOut = raw;
  return true;
}

const char* dirToString(int8_t dir) {
  return (dir >= 0) ? "CW" : "CCW";
}

bool parseDir(const char* s, int8_t &dir) {
  if (!s) return false;
  String t = String(s);
  t.toUpperCase();

  if (t == "CW" || t == "1" || t == "+1") {
    dir = 1;
    return true;
  }
  if (t == "CCW" || t == "-1") {
    dir = -1;
    return true;
  }
  return false;
}

// -----------------------------
// Persistence
// -----------------------------
void loadConfig() {
  prefs.begin("encoders", true);
  for (int i = 1; i <= MAX_CAKES; i++) {
    String zKey = "z" + String(i);
    String dKey = "d" + String(i);

    cfg[i].zeroRaw = prefs.getUShort(zKey.c_str(), 0);
    cfg[i].dir = prefs.getChar(dKey.c_str(), 1);
    if (cfg[i].dir != 1 && cfg[i].dir != -1) cfg[i].dir = 1;
  }
  prefs.end();
}

void saveConfig() {
  prefs.begin("encoders", false);
  for (int i = 1; i <= MAX_CAKES; i++) {
    String zKey = "z" + String(i);
    String dKey = "d" + String(i);

    prefs.putUShort(zKey.c_str(), cfg[i].zeroRaw & 0x0FFF);
    prefs.putChar(dKey.c_str(), cfg[i].dir);
  }
  prefs.end();
}

void resetConfigOne(int cake) {
  if (!validCake(cake)) return;
  cfg[cake].zeroRaw = 0;
  cfg[cake].dir = 1;
}

void resetConfigAll() {
  for (int i = 1; i <= MAX_CAKES; i++) {
    resetConfigOne(i);
  }
}

// -----------------------------
// JSON reply helpers
// -----------------------------
void replyOk(const String &body) {
  Serial.print("{\"ok\":true");
  if (body.length() > 0) {
    Serial.print(",");
    Serial.print(body);
  }
  Serial.println("}");
}

void replyErr(const String &msg) {
  Serial.print("{\"ok\":false,\"error\":\"");
  Serial.print(msg);
  Serial.println("\"}");
}

// -----------------------------
// Commands
// -----------------------------
void cmdPing() {
  replyOk("\"cmd\":\"PING\",\"msg\":\"pong\"");
}

void cmdScan() {
  Serial.print("{\"ok\":true,\"cmd\":\"SCAN\",\"cakes\":[");
  for (int i = 1; i <= MAX_CAKES; i++) {
    bool present = encoderPresent(i);
    Serial.print("{\"cake\":");
    Serial.print(i);
    Serial.print(",\"present\":");
    Serial.print(present ? "true" : "false");
    Serial.print("}");
    if (i < MAX_CAKES) Serial.print(",");
  }
  Serial.println("]}");
}

void cmdReadAngle(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  float deg = 0.0f;
  uint16_t raw = 0;
  if (!readScaledAngleDeg(cake, deg, raw)) {
    replyErr("read failed");
    return;
  }

  String body = "\"cmd\":\"READ_ANGLE\","
                "\"cake\":" + String(cake) + ","
                "\"raw\":" + String(raw) + ","
                "\"zero_raw\":" + String(cfg[cake].zeroRaw) + ","
                "\"dir\":\"" + String(dirToString(cfg[cake].dir)) + "\","
                "\"angle_deg\":" + String(deg, 3);
  replyOk(body);
}

void cmdReadRaw(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  uint16_t raw = 0;
  if (!readRawAngle(cake, raw)) {
    replyErr("read failed");
    return;
  }

  String body = "\"cmd\":\"READ_RAW\","
                "\"cake\":" + String(cake) + ","
                "\"raw\":" + String(raw);
  replyOk(body);
}

void cmdReadStatus(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  uint8_t status = 0;
  if (!readStatusReg(cake, status)) {
    replyErr("status read failed");
    return;
  }

  bool magnetDetected = status & (1 << 5); // MD
  bool magnetTooWeak  = status & (1 << 4); // ML
  bool magnetTooStrong= status & (1 << 3); // MH

  String body = "\"cmd\":\"READ_STATUS\","
                "\"cake\":" + String(cake) + ","
                "\"status\":" + String(status) + ","
                "\"magnet_detected\":" + String(magnetDetected ? "true" : "false") + ","
                "\"magnet_too_weak\":" + String(magnetTooWeak ? "true" : "false") + ","
                "\"magnet_too_strong\":" + String(magnetTooStrong ? "true" : "false");
  replyOk(body);
}

void cmdSetZero(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  uint16_t raw = 0;
  if (!readRawAngle(cake, raw)) {
    replyErr("read failed");
    return;
  }

  cfg[cake].zeroRaw = raw & 0x0FFF;

  String body = "\"cmd\":\"SET_ZERO\","
                "\"cake\":" + String(cake) + ","
                "\"zero_raw\":" + String(cfg[cake].zeroRaw);
  replyOk(body);
}

void cmdSetZeroRaw(int cake, int raw) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }
  if (raw < 0 || raw > 4095) {
    replyErr("raw must be 0..4095");
    return;
  }

  cfg[cake].zeroRaw = (uint16_t)raw;

  String body = "\"cmd\":\"SET_ZERO_RAW\","
                "\"cake\":" + String(cake) + ","
                "\"zero_raw\":" + String(cfg[cake].zeroRaw);
  replyOk(body);
}

void cmdGetZero(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  String body = "\"cmd\":\"GET_ZERO\","
                "\"cake\":" + String(cake) + ","
                "\"zero_raw\":" + String(cfg[cake].zeroRaw);
  replyOk(body);
}

void cmdSetDir(int cake, const char* dirStr) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  int8_t dir = 1;
  if (!parseDir(dirStr, dir)) {
    replyErr("dir must be CW/CCW or 1/-1");
    return;
  }

  cfg[cake].dir = dir;

  String body = "\"cmd\":\"SET_DIR\","
                "\"cake\":" + String(cake) + ","
                "\"dir\":\"" + String(dirToString(cfg[cake].dir)) + "\"";
  replyOk(body);
}

void cmdGetDir(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  String body = "\"cmd\":\"GET_DIR\","
                "\"cake\":" + String(cake) + ","
                "\"dir\":\"" + String(dirToString(cfg[cake].dir)) + "\"";
  replyOk(body);
}

void cmdGetConfig(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  String body = "\"cmd\":\"GET_CONFIG\","
                "\"cake\":" + String(cake) + ","
                "\"zero_raw\":" + String(cfg[cake].zeroRaw) + ","
                "\"dir\":\"" + String(dirToString(cfg[cake].dir)) + "\"";
  replyOk(body);
}

void cmdSave() {
  saveConfig();
  replyOk("\"cmd\":\"SAVE\",\"msg\":\"config saved\"");
}

void cmdLoad() {
  loadConfig();
  replyOk("\"cmd\":\"LOAD\",\"msg\":\"config loaded\"");
}

void cmdResetConfig(int cake) {
  if (!validCake(cake)) {
    replyErr("invalid cake");
    return;
  }

  resetConfigOne(cake);

  String body = "\"cmd\":\"RESET_CONFIG\","
                "\"cake\":" + String(cake) + ","
                "\"zero_raw\":0,"
                "\"dir\":\"CW\"";
  replyOk(body);
}

void cmdResetAll() {
  resetConfigAll();
  replyOk("\"cmd\":\"RESET_ALL\",\"msg\":\"all configs reset\"");
}

void cmdHelp() {
  Serial.println(
    "{\"ok\":true,\"cmd\":\"HELP\",\"commands\":["
    "\"PING\","
    "\"SCAN\","
    "\"READ_ANGLE <cake>\","
    "\"READ_RAW <cake>\","
    "\"READ_STATUS <cake>\","
    "\"SET_ZERO <cake>\","
    "\"SET_ZERO_RAW <cake> <0..4095>\","
    "\"GET_ZERO <cake>\","
    "\"SET_DIR <cake> <CW|CCW|1|-1>\","
    "\"GET_DIR <cake>\","
    "\"GET_CONFIG <cake>\","
    "\"SAVE\","
    "\"LOAD\","
    "\"RESET_CONFIG <cake>\","
    "\"RESET_ALL\""
    "]}"
  );
}

// -----------------------------
// Parsing
// -----------------------------
void handleCommand(char* line) {
  char* cmd = strtok(line, " \t\r\n");
  if (!cmd) return;

  String scmd = String(cmd);
  scmd.toUpperCase();

  if (scmd == "PING") {
    cmdPing();
    return;
  }

  if (scmd == "HELP") {
    cmdHelp();
    return;
  }

  if (scmd == "SCAN") {
    cmdScan();
    return;
  }

  if (scmd == "SAVE") {
    cmdSave();
    return;
  }

  if (scmd == "LOAD") {
    cmdLoad();
    return;
  }

  if (scmd == "RESET_ALL") {
    cmdResetAll();
    return;
  }

  char* cakeStr = strtok(NULL, " \t\r\n");
  int cake = cakeStr ? atoi(cakeStr) : -1;

  if (scmd == "READ_ANGLE") {
    cmdReadAngle(cake);
    return;
  }

  if (scmd == "READ_RAW") {
    cmdReadRaw(cake);
    return;
  }

  if (scmd == "READ_STATUS") {
    cmdReadStatus(cake);
    return;
  }

  if (scmd == "SET_ZERO") {
    cmdSetZero(cake);
    return;
  }

  if (scmd == "GET_ZERO") {
    cmdGetZero(cake);
    return;
  }

  if (scmd == "SET_ZERO_RAW") {
    char* rawStr = strtok(NULL, " \t\r\n");
    if (!rawStr) {
      replyErr("missing raw value");
      return;
    }
    cmdSetZeroRaw(cake, atoi(rawStr));
    return;
  }

  if (scmd == "SET_DIR") {
    char* dirStr = strtok(NULL, " \t\r\n");
    if (!dirStr) {
      replyErr("missing dir");
      return;
    }
    cmdSetDir(cake, dirStr);
    return;
  }

  if (scmd == "GET_DIR") {
    cmdGetDir(cake);
    return;
  }

  if (scmd == "GET_CONFIG") {
    cmdGetConfig(cake);
    return;
  }

  if (scmd == "RESET_CONFIG") {
    cmdResetConfig(cake);
    return;
  }

  replyErr("unknown command");
}

// -----------------------------
// Arduino
// -----------------------------
void setup() {
  Serial.begin(115200);
  delay(300);

  Wire.begin(I2C_SDA, I2C_SCL, 400000);
  disableMuxAll();

  for (int i = 1; i <= MAX_CAKES; i++) {
    cfg[i].zeroRaw = 0;
    cfg[i].dir = 1;
  }

  loadConfig();

  Serial.println("{\"ok\":true,\"boot\":true,\"msg\":\"encoder mux node ready\"}");
}

void loop() {
  static char buffer[128];
  static size_t idx = 0;

  while (Serial.available() > 0) {
    char c = Serial.read();

    if (c == '\n') {
      buffer[idx] = '\0';
      if (idx > 0) {
        handleCommand(buffer);
      }
      idx = 0;
    } else if (c != '\r') {
      if (idx < sizeof(buffer) - 1) {
        buffer[idx++] = c;
      }
    }
  }
}