#include <Arduino.h>
#include <M5Unified.h>

// Watering Unit bring-up -- CONFIRMED pin mapping from the scan:
//   soil analog output = G33   (steady ~2000 in air)
//   PUMP_EN            = G32   (idle low)
// (i.e. the opposite of the naive white->G32 / yellow->G33 guess.)
//
// Plug the Watering Unit directly into the Grove port; keep USB power.
//   - soil (G33) is read continuously -- watch it change air vs wet.
//   - hold BtnA: pump ON (drives G32 HIGH). Release: off. PUMP_EN assumed
//     active-high; the pump is 5W (~1A) and may need EXTERNAL 5V if the Stick's
//     Grove rail can't source it -- if holding BtnA does nothing with water
//     present, that's a power limit, not a wiring one.

namespace {
constexpr int kSoilPin = 33;  // white  - analog soil moisture
constexpr int kPumpPin = 32;  // yellow - PUMP_EN (active-high assumed)
}  // namespace

void setup() {
  auto cfg = M5.config();
  M5.begin(cfg);
  Serial.begin(115200);
  pinMode(kSoilPin, INPUT);
  pinMode(kPumpPin, OUTPUT);
  digitalWrite(kPumpPin, LOW);  // off
  M5.Display.setRotation(3);
  M5.Display.setTextSize(2);
  Serial.println("\n[watering] soil=G33  hold BtnA = pump ON (G32)");
}

void loop() {
  M5.update();

  bool run = M5.BtnA.isPressed();  // pump runs only while held
  digitalWrite(kPumpPin, run ? HIGH : LOW);

  int soil = analogRead(kSoilPin);
  Serial.printf("[watering] soil(G33)=%d  pump(G32)=%d\n", soil, run);

  auto& d = M5.Display;
  d.fillScreen(TFT_BLACK);
  d.setCursor(0, 0);
  d.setTextColor(TFT_CYAN, TFT_BLACK);
  d.println("Watering test");
  d.setTextColor(TFT_WHITE, TFT_BLACK);
  d.printf("soil G33:%d\n", soil);
  d.setTextColor(run ? TFT_GREEN : TFT_WHITE, TFT_BLACK);
  d.printf("pump:%s\n", run ? "ON" : "OFF");
  d.setTextColor(TFT_YELLOW, TFT_BLACK);
  d.print("hold BtnA=pump");

  delay(200);
}
