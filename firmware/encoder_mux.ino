#include <Arduino.h>
#include <Wire.h>
#include <EEPROM.h>
#include <math.h>

// ============================================================
// CONFIG
// ============================================================
static constexpr uint8_t TCA9548_ADDR = 0x70;
static constexpr uint8_t AS5600_ADDR = 0x36;
static constexpr uint8_t NUM_CAKES = 6;
static constexpr uint32_t SERIAL_BAUD = 115200;
static constexpr uint16_t EEPROM_SIZE_BYTES = 256;
static constexpr uint32_t EEPROM_MAGIC = 0x43414B45; // 'CAKE'
static constexpr uint16_t EEPROM_VERSION = 1;

// Cake -> TCA9548 channel mapping.
// Current mapping means:
// cake=1 -> ch0
// cake=2 -> ch1
// cake=3 -> ch2
// cake=4 -> ch3
// cake=5 -> ch4
// cake=6 -> ch5
static const uint8_t CAKE_CHANNEL_MAP[NUM_CAKES] = {
  0, 1, 2, 3, 4, 5
};

// AS5600 angle registers
static constexpr uint8_t REG_RAW_ANGLE_HI = 0x0C;
static constexpr uint8_t REG_RAW_ANGLE_LO = 0x0D;

struct PersistedState {
  uint32_t magic;
  uint16_t version;
  uint16_t reserved;
  float zero_deg[NUM_CAKES];
};

PersistedState g_state;
String g_line;

// ============================================================
// UTILS
// ============================================================
float normalize360(float deg) {
  while (deg < 0.0f) deg += 360.0f;
  while (deg >= 360.0f) deg -= 360.0f;
  return deg;
}

float rawToDeg(uint16_t raw) {
  return (static_cast<float>(raw & 0x0FFF) * 360.0f) / 4096.0f;
}

bool i2cDevicePresent(uint8_t addr) {
  Wire.beginTransmission(addr);
  return Wire.endTransmission() == 0;
}

bool selectMuxChannel(uint8_t ch) {
  if (ch > 7) return false;
  Wire.beginTransmission(TCA9548_ADDR);
  Wire.write(1 << ch);
  return Wire.endTransmission() == 0;
}

bool selectCakeChannel(uint8_t cakeIdx) {
  if (cakeIdx >= NUM_CAKES) return false;
  return selectMuxChannel(CAKE_CHANNEL_MAP[cakeIdx]);
}

void disableAllMuxChannels() {
  Wire.beginTransmission(TCA9548_ADDR);
  Wire.write(0x00);
  Wire.endTransmission();
}

bool readAs5600RawFromSelectedChannel(uint16_t &rawOut) {
  Wire.beginTransmission(AS5600_ADDR);
  Wire.write(REG_RAW_ANGLE_HI);
  if (Wire.endTransmission(false) != 0) {
    return false;
  }

  const uint8_t want = 2;
  uint8_t got = Wire.requestFrom(static_cast<int>(AS5600_ADDR), static_cast<int>(want));
  if (got != want) {
    return false;
  }

  uint8_t hi = Wire.read();
  uint8_t lo = Wire.read();
  rawOut = ((static_cast<uint16_t>(hi) << 8) | lo) & 0x0FFF;
  return true;
}

bool readAs5600Raw(uint8_t cakeIdx, uint16_t &rawOut) {
  if (!selectCakeChannel(cakeIdx)) {
    return false;
  }

  bool ok = readAs5600RawFromSelectedChannel(rawOut);
  disableAllMuxChannels();
  return ok;
}

void cmdReadEeprom(const String &line) {
  uint8_t cakeIdx;
  if (!parseCake1Based(line, cakeIdx)) {
    replyErr("BAD_ARG", "READEEPROM requires cake=<1..NUM_CAKES>");
    return;
  }

  Serial.print("OK READEEPROM cake=");
  Serial.print(cakeIdx + 1);
  Serial.print(" zero_deg=");
  Serial.print(g_state.zero_deg[cakeIdx], 3);
  Serial.print(" magic=0x");
  Serial.print(g_state.magic, HEX);
  Serial.print(" version=");
  Serial.println(g_state.version);
}

bool readAs5600RawByChannel(uint8_t ch, uint16_t &rawOut) {
  if (!selectMuxChannel(ch)) {
    return false;
  }

  bool ok = readAs5600RawFromSelectedChannel(rawOut);
  disableAllMuxChannels();
  return ok;
}

void saveState() {
  EEPROM.put(0, g_state);
  EEPROM.commit();
}

void initStateDefaults() {
  g_state.magic = EEPROM_MAGIC;
  g_state.version = EEPROM_VERSION;
  g_state.reserved = 0;
  for (uint8_t i = 0; i < NUM_CAKES; ++i) {
    g_state.zero_deg[i] = 0.0f;
  }
}

void loadState() {
  EEPROM.begin(EEPROM_SIZE_BYTES);
  EEPROM.get(0, g_state);

  if (g_state.magic != EEPROM_MAGIC || g_state.version != EEPROM_VERSION) {
    initStateDefaults();
    saveState();
  }
}

bool parseKeyValue(const String &line, const String &key, String &valueOut) {
  String keyUpper = key;
  keyUpper.toUpperCase();

  int start = line.indexOf(keyUpper + "=");
  if (start < 0) return false;

  start += keyUpper.length() + 1;
  int end = line.indexOf(' ', start);
  if (end < 0) end = line.length();

  valueOut = line.substring(start, end);
  valueOut.trim();
  return valueOut.length() > 0;
}

bool parseCake1Based(const String &line, uint8_t &cakeIdx) {
  String v;
  if (!parseKeyValue(line, "cake", v)) return false;
  int cake1 = v.toInt();
  if (cake1 < 1 || cake1 > NUM_CAKES) return false;
  cakeIdx = static_cast<uint8_t>(cake1 - 1);
  return true;
}

bool parseChannel(const String &line, uint8_t &ch) {
  String v;
  if (!parseKeyValue(line, "ch", v)) return false;
  int parsed = v.toInt();
  if (parsed < 0 || parsed > 7) return false;
  ch = static_cast<uint8_t>(parsed);
  return true;
}

void replyOk(const String &msg) {
  Serial.print("OK ");
  Serial.println(msg);
}

void replyErr(const String &code, const String &msg) {
  Serial.print("ERR code=");
  Serial.print(code);
  Serial.print(" msg=\"");
  Serial.print(msg);
  Serial.println("\"");
}

void cmdPing() {
  replyOk("PONG");
}

void cmdStatus() {
  Serial.print("OK STATUS cakes=");
  Serial.print(NUM_CAKES);
  Serial.print(" uptime_ms=");
  Serial.print(millis());
  Serial.print(" eeprom_magic=");
  Serial.print(g_state.magic, HEX);
  Serial.print(" version=");
  Serial.println(g_state.version);
}

void cmdMap() {
  Serial.print("OK MAP");
  for (uint8_t i = 0; i < NUM_CAKES; ++i) {
    Serial.print(" cake");
    Serial.print(i + 1);
    Serial.print("=");
    Serial.print(CAKE_CHANNEL_MAP[i]);
  }
  Serial.println();
}

void cmdI2CScan() {
  Serial.print("OK I2CSCAN");
  bool any = false;
  for (uint8_t addr = 1; addr < 127; ++addr) {
    Wire.beginTransmission(addr);
    if (Wire.endTransmission() == 0) {
      Serial.print(" 0x");
      if (addr < 16) Serial.print("0");
      Serial.print(addr, HEX);
      any = true;
    }
  }
  if (!any) Serial.print(" none");
  Serial.println();
}

void cmdMuxScan() {
  if (!i2cDevicePresent(TCA9548_ADDR)) {
    replyErr("MUX_MISSING", "TCA9548 not detected at 0x70");
    return;
  }

  Serial.print("OK MUXSCAN mux=0x70");
  for (uint8_t ch = 0; ch < 8; ++ch) {
    bool muxOk = selectMuxChannel(ch);
    bool asOk = false;
    if (muxOk) {
      asOk = i2cDevicePresent(AS5600_ADDR);
    }
    disableAllMuxChannels();

    Serial.print(" ch");
    Serial.print(ch);
    Serial.print("=");
    Serial.print(asOk ? "AS5600" : "-");
  }
  Serial.println();
}

void cmdRead(const String &line) {
  uint8_t cakeIdx;
  if (!parseCake1Based(line, cakeIdx)) {
    replyErr("BAD_ARG", "READ requires cake=<1..NUM_CAKES>");
    return;
  }

  uint16_t raw = 0;
  if (!readAs5600Raw(cakeIdx, raw)) {
    replyErr("READ_FAIL", "AS5600 read failed");
    return;
  }

  float deg = rawToDeg(raw);
  float zeroDeg = g_state.zero_deg[cakeIdx];
  float adjDeg = normalize360(deg - zeroDeg);

  Serial.print("OK READ cake=");
  Serial.print(cakeIdx + 1);
  Serial.print(" ch=");
  Serial.print(CAKE_CHANNEL_MAP[cakeIdx]);
  Serial.print(" raw=");
  Serial.print(raw);
  Serial.print(" deg=");
  Serial.print(deg, 3);
  Serial.print(" zero_deg=");
  Serial.print(zeroDeg, 3);
  Serial.print(" adj_deg=");
  Serial.println(adjDeg, 3);
}

void cmdReadCh(const String &line) {
  uint8_t ch;
  if (!parseChannel(line, ch)) {
    replyErr("BAD_ARG", "READCH requires ch=<0..7>");
    return;
  }

  uint16_t raw = 0;
  if (!readAs5600RawByChannel(ch, raw)) {
    replyErr("READ_FAIL", "AS5600 read failed on channel");
    return;
  }

  float deg = rawToDeg(raw);

  Serial.print("OK READCH ch=");
  Serial.print(ch);
  Serial.print(" raw=");
  Serial.print(raw);
  Serial.print(" deg=");
  Serial.println(deg, 3);
}

void cmdZero(const String &line) {
  uint8_t cakeIdx;
  if (!parseCake1Based(line, cakeIdx)) {
    replyErr("BAD_ARG", "ZERO requires cake=<1..NUM_CAKES>");
    return;
  }

  uint16_t raw = 0;
  if (!readAs5600Raw(cakeIdx, raw)) {
    replyErr("READ_FAIL", "AS5600 read failed during ZERO");
    return;
  }

  float deg = rawToDeg(raw);
  g_state.zero_deg[cakeIdx] = normalize360(deg);
  saveState();

  Serial.print("OK ZERO cake=");
  Serial.print(cakeIdx + 1);
  Serial.print(" stored_zero_deg=");
  Serial.println(g_state.zero_deg[cakeIdx], 3);
}

void cmdSetZero(const String &line) {
  uint8_t cakeIdx;
  if (!parseCake1Based(line, cakeIdx)) {
    replyErr("BAD_ARG", "SETZERO requires cake=<1..NUM_CAKES> deg=<float>");
    return;
  }

  String degStr;
  if (!parseKeyValue(line, "deg", degStr)) {
    replyErr("BAD_ARG", "SETZERO requires deg=<float>");
    return;
  }

  float deg = normalize360(degStr.toFloat());
  g_state.zero_deg[cakeIdx] = deg;
  saveState();

  Serial.print("OK SETZERO cake=");
  Serial.print(cakeIdx + 1);
  Serial.print(" stored_zero_deg=");
  Serial.println(g_state.zero_deg[cakeIdx], 3);
}

void cmdClearZero(const String &line) {
  uint8_t cakeIdx;
  if (!parseCake1Based(line, cakeIdx)) {
    replyErr("BAD_ARG", "CLEARZERO requires cake=<1..NUM_CAKES>");
    return;
  }

  g_state.zero_deg[cakeIdx] = 0.0f;
  saveState();

  Serial.print("OK CLEARZERO cake=");
  Serial.println(cakeIdx + 1);
}

void cmdDumpZero() {
  Serial.print("OK ZEROS");
  for (uint8_t i = 0; i < NUM_CAKES; ++i) {
    Serial.print(" cake");
    Serial.print(i + 1);
    Serial.print("=");
    Serial.print(g_state.zero_deg[i], 3);
  }
  Serial.println();
}

void cmdHelp() {
  Serial.println("OK HELP cmds=PING,STATUS,MAP,I2CSCAN,MUXSCAN,READ cake=N,READCH ch=N,ZERO cake=N,SETZERO cake=N deg=F,CLEARZERO cake=N,DUMPZERO,HELP");
}

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;

  line.toUpperCase();

  if (line == "PING") {
    cmdPing();
  } else if (line == "STATUS") {
    cmdStatus();
  } else if (line == "MAP") {
    cmdMap();
  } else if (line == "I2CSCAN") {
    cmdI2CScan();
  } else if (line == "MUXSCAN") {
    cmdMuxScan();
  } else if (line.startsWith("READCH")) {
    cmdReadCh(line);
  } else if (line.startsWith("READEEPROM")) {
    cmdReadEeprom(line);
  } else if (line.startsWith("READ")) {
    cmdRead(line);
  } else if (line.startsWith("ZERO")) {
    cmdZero(line);
  } else if (line.startsWith("SETZERO")) {
    cmdSetZero(line);
  } else if (line.startsWith("CLEARZERO")) {
    cmdClearZero(line);
  } else if (line == "DUMPZERO") {
    cmdDumpZero();
  } else if (line == "HELP") {
    cmdHelp();
  } else {
    replyErr("BAD_CMD", "unknown command");
  }
}

void setup() {
  Serial.begin(SERIAL_BAUD);
  Wire.begin();
  loadState();
  disableAllMuxChannels();
  delay(50);
  Serial.println("OK BOOT encoder_mux ready");
}

void loop() {
  while (Serial.available() > 0) {
    char c = static_cast<char>(Serial.read());
    if (c == '\n' || c == '\r') {
      if (g_line.length() > 0) {
        handleCommand(g_line);
        g_line = "";
      }
    } else {
      g_line += c;
      if (g_line.length() > 200) {
        g_line = "";
        replyErr("LINE_TOO_LONG", "command exceeded 200 chars");
      }
    }
  }
}