// /*
//   MotorSmokeTest.cpp
//   ------------------
//   ESP32 + Step/Dir (+ optional Enable) motor smoke test.

//   What it does:
//     - Lets you verify the motor + driver + wiring without any sensors.
//     - Simple Serial commands to move by RPM/seconds, degrees, or raw steps.
//     - A canned "test" sequence you can run and watch.

//   Wiring (typical A4988 / DRV8825 / TMC step/dir drivers):
//     - DIR  -> driver DIR
//     - STEP -> driver STEP
//     - EN   -> driver EN (active low on many drivers). If you don't wire EN, set EN_PIN = -1.

//   Open Serial Monitor @ 115200 and type 'help'.

//   NOTE on stepsPerRev:
//     stepsPerRev = (motor full steps per rev) * (microstepping)
//     e.g. 200-step NEMA17 @ 1/16 microstep -> 200 * 16 = 3200
// */

#include <Arduino.h>

// /* ------------------ USER EDITABLE PINS & MOTOR PARAMS ------------------ */
// const int DIR_PIN  = 18;
// const int STEP_PIN = 19;
// const int EN_PIN   = -1;     // set to -1 if not used

// // 200 full steps/rev * 16 microstep  = 3200 steps/rev (edit for your setup)
// int   stepsPerRev = 3200;

// // For convenience moves
// float defaultDegPerSec = 90.0f;  // used by 'deg' if no speed given
// float defaultRPM       = 30.0f;  // used by 'rpm' if seconds missing

// // Pulse timing safety (microseconds)
// const uint32_t MIN_HALF_US = 120;   // >=120us is very safe for most drivers

// /* ----------------------------- UTILITIES -------------------------------- */
// void say(const char* fmt, ...) {
//   char b[256];
//   va_list ap; va_start(ap,fmt); vsnprintf(b,sizeof(b),fmt,ap); va_end(ap);
//   Serial.printf("[%lu] %s\n", (unsigned long)millis(), b);
// }

// String readLine() {
//   static String buf;
//   while (Serial.available()) {
//     char c = Serial.read();
//     if (c == '\r') continue;
//     if (c == '\n') { String out = buf; buf = ""; out.trim(); return out; }
//     buf += c;
//   }
//   return "";
// }

// /* --------------------------- MOTOR PRIMITIVES --------------------------- */
// void motorEnable(bool en) {
//   if (EN_PIN < 0) return;
//   // Most drivers: EN LOW = enabled, HIGH = disabled
//   digitalWrite(EN_PIN, en ? LOW : HIGH);
//   say("Motor %s", en ? "ENABLED" : "DISABLED");
// }

// void motorInit() {
//   pinMode(DIR_PIN, OUTPUT);
//   pinMode(STEP_PIN, OUTPUT);
//   digitalWrite(DIR_PIN, LOW);
//   digitalWrite(STEP_PIN, LOW);
//   if (EN_PIN >= 0) {
//     pinMode(EN_PIN, OUTPUT);
//     motorEnable(true);
//   }
//   say("Pins: DIR=%d STEP=%d EN=%d | stepsPerRev=%d", DIR_PIN, STEP_PIN, EN_PIN, stepsPerRev);
// }

// // Blocking step train at constant steps/sec.
// // cw=true rotates CW (DIR=HIGH), cw=false CCW (DIR=LOW) — change if your wiring is inverted.
// void stepBlocking(long steps, bool cw, float stepsPerSec) {
//   if (steps <= 0 || stepsPerSec <= 0) return;
//   digitalWrite(DIR_PIN, cw ? HIGH : LOW);

//   // Half-period in microseconds; clamp to safe minimum
//   float half_us_f = 1e6f / (2.0f * stepsPerSec);
//   uint32_t half_us = (uint32_t) max<float>(half_us_f, MIN_HALF_US);

//   say("stepBlocking: %ld steps | dir=%s | sps=%.1f | halfPeriod=%lu us",
//       steps, cw ? "CW" : "CCW", stepsPerSec, (unsigned long)half_us);

//   for (long i = 0; i < steps; i++) {
//     digitalWrite(STEP_PIN, HIGH); delayMicroseconds(half_us);
//     digitalWrite(STEP_PIN, LOW);  delayMicroseconds(half_us);
//   }
// }

// // Convenience: move by degrees at a rough deg/sec speed.
// void moveDegrees(float deg, float degPerSec = -1.0f) {
//   if (degPerSec <= 0) degPerSec = defaultDegPerSec;
//   long steps = lroundf((deg * stepsPerRev) / 360.0f);
//   float sps  = (degPerSec * stepsPerRev) / 360.0f;
//   say("moveDegrees: %.2f° -> %ld steps @ %.1f deg/s", deg, steps, degPerSec);
//   stepBlocking(labs(steps), (steps >= 0), sps);
// }

// // Spin at an RPM for some seconds (continuous motion).
// void spinRPM(float rpm, float seconds, bool cw = true) {
//   if (rpm <= 0 || seconds <= 0) return;
//   float sps = (rpm * stepsPerRev) / 60.0f;
//   long totalSteps = lroundf(sps * seconds);
//   say("spinRPM: %.1f RPM for %.2f s -> %ld steps (%s)", rpm, seconds, totalSteps, cw ? "CW" : "CCW");
//   stepBlocking(totalSteps, cw, sps);
// }

// // Raw jog in steps (positive = CW, negative = CCW). Optional steps/sec.
// void jogSteps(long steps, float stepsPerSec = -1.0f) {
//   if (steps == 0) return;
//   if (stepsPerSec <= 0) {
//     // pick a conservative default from defaultRPM
//     stepsPerSec = max(50.0f, (defaultRPM * stepsPerRev) / 60.0f);
//   }
//   say("jogSteps: %ld steps @ %.1f sps", steps, stepsPerSec);
//   stepBlocking(labs(steps), (steps >= 0), stepsPerSec);
// }

// // A canned sequence to visually verify: one rev CW, pause, one rev CCW, pause, 2 revs CW faster.
// void testMotor() {
//   say("=== TEST SEQUENCE START ===");
//   motorEnable(true);

//   // 1 rev CW @ defaultRPM for ~2s (computed automatically by sps)
//   spinRPM(defaultRPM, 2.0f, true);
//   delay(500);

//   // 1 rev CCW @ defaultRPM
//   spinRPM(defaultRPM, 2.0f, false);
//   delay(500);

//   // 2 rev CW @ 60 RPM
//   spinRPM(60.0f, 2.0f, true);
//   delay(250);

//   // Jog by 360° using degrees
//   moveDegrees(360.0f, 180.0f);
//   delay(250);

//   // Jog 1000 steps CCW
//   jogSteps(-1000);

//   say("=== TEST SEQUENCE END ===");
// }

// /* ------------------------------- CONSOLE -------------------------------- */
// void printHelp() {
//   Serial.println(
//     "Commands:\n"
//     "  help                 - this help text\n"
//     "  on / off             - enable/disable driver (EN pin)\n"
//     "  spr <int>            - set stepsPerRev (e.g., 3200 for 200*16)\n"
//     "  rpm <rpm> <sec> [cw|ccw]  - spin at RPM for seconds\n"
//     "  deg <deg> [degps]    - move by degrees (optional deg/s)\n"
//     "  steps <n> [sps]      - jog raw steps (positive=CW, negative=CCW)\n"
//     "  test                 - run canned sequence\n"
//   );
// }

// void handleCmd(const String& line) {
//   if (!line.length()) return;
//   String cmd = line, arg = "";
//   int sp = line.indexOf(' ');
//   if (sp >= 0) { cmd = line.substring(0, sp); arg = line.substring(sp + 1); }
//   cmd.toLowerCase(); arg.trim();

//   if (cmd == "help") { printHelp(); return; }

//   if (cmd == "on") { motorEnable(true); return; }
//   if (cmd == "off") { motorEnable(false); return; }

//   if (cmd == "spr") {
//     int v = arg.toInt();
//     if (v > 0) { stepsPerRev = v; say("stepsPerRev = %d", stepsPerRev); }
//     else       { say("spr: provide a positive integer"); }
//     return;
//   }

//   if (cmd == "rpm") {
//     // usage: rpm <rpm> <sec> [cw|ccw]
//     float rpm = 0, sec = 0;
//     bool cw = true;
//     if (arg.length()) {
//       // split arguments
//       int sp1 = arg.indexOf(' ');
//       int sp2 = (sp1 >= 0) ? arg.indexOf(' ', sp1 + 1) : -1;
//       String s1 = (sp1 >= 0) ? arg.substring(0, sp1) : arg;
//       String s2 = (sp1 >= 0 && sp2 >= 0) ? arg.substring(sp1 + 1, sp2) : (sp1 >= 0 ? arg.substring(sp1 + 1) : "");
//       String s3 = (sp2 >= 0) ? arg.substring(sp2 + 1) : "";
//       rpm = s1.toFloat();
//       sec = s2.length() ? s2.toFloat() : 0;
//       if (s3.length()) { String d = s3; d.toLowerCase(); cw = !(d.startsWith("ccw")); }
//     }
//     if (rpm <= 0) rpm = defaultRPM;
//     if (sec <= 0) sec = 2.0f;
//     spinRPM(rpm, sec, cw);
//     return;
//   }

//   if (cmd == "deg") {
//     // usage: deg <deg> [degps]
//     float d = 0, v = -1;
//     if (arg.length()) {
//       int sp1 = arg.indexOf(' ');
//       String s1 = (sp1 >= 0) ? arg.substring(0, sp1) : arg;
//       String s2 = (sp1 >= 0) ? arg.substring(sp1 + 1) : "";
//       d = s1.toFloat();
//       if (s2.length()) v = s2.toFloat();
//     }
//     moveDegrees(d, v);
//     return;
//   }

//   if (cmd == "steps") {
//     // usage: steps <n> [sps]
//     long st = 0; float sps = -1;
//     if (arg.length()) {
//       int sp1 = arg.indexOf(' ');
//       String s1 = (sp1 >= 0) ? arg.substring(0, sp1) : arg;
//       String s2 = (sp1 >= 0) ? arg.substring(sp1 + 1) : "";
//       st = s1.toInt();
//       if (s2.length()) sps = s2.toFloat();
//     }
//     jogSteps(st, sps);
//     return;
//   }

//   if (cmd == "test") { testMotor(); return; }

//   say("Unknown command: %s  (type 'help')", line.c_str());
// }

// /* ------------------------------ ARDUINO --------------------------------- */
// void setup() {
//   Serial.begin(115200);
//   while (!Serial && millis() < 1500) {}
//   say("=== ESP32 Motor Smoke Test ===");
//   motorInit();
//   printHelp();
// }

// void loop() {
//   String ln = readLine();
//   if (ln.length()) handleCmd(ln);
// }

/*   
 *   Basic example code for controlling a stepper without library
 *      
 *   by Dejan, https://howtomechatronics.com
 */

// defines pins
#define stepPin 19
#define dirPin 18 
 
void setup() {
  // Sets the two pins as Outputs
  pinMode(stepPin,OUTPUT); 
  pinMode(dirPin,OUTPUT);
}
void loop() {
  digitalWrite(dirPin,HIGH); // Enables the motor to move in a particular direction
  // Makes 200 pulses for making one full cycle rotation
  for(int x = 0; x < 800; x++) {
    digitalWrite(stepPin,HIGH); 
    delayMicroseconds(700);    // by changing this time delay between the steps we can change the rotation speed
    digitalWrite(stepPin,LOW); 
    delayMicroseconds(700); 
  }
  delay(1000); // One second delay
  
  digitalWrite(dirPin,LOW); //Changes the rotations direction
  // Makes 400 pulses for making two full cycle rotation
  for(int x = 0; x < 1600; x++) {
    digitalWrite(stepPin,HIGH);
    delayMicroseconds(500);
    digitalWrite(stepPin,LOW);
    delayMicroseconds(500);
  }
  delay(1000);
}