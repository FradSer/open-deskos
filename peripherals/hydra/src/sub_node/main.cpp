#include <Adafruit_NeoPixel.h>
#include <Arduino.h>
#include <M5NanoC6.h>
#include <esp_ota_ops.h>

#include "sub_node/app/sub_runtime.h"
#include "sub_node/app/sub_runtime_config.h"
#include "sub_node/hal/gpio_watering_zone.h"
#include "shared/ota_writer.h"
#include "sub_node/hal/watering_zone_config.h"
#include "sub_node/hal/wire_clock.h"
#include "shared/esp_now_transport.h"

using namespace hydra;

#define NUM_LEDS 1
static Adafruit_NeoPixel g_strip(NUM_LEDS, M5NANO_C6_RGB_LED_DATA_PIN, NEO_GRB + NEO_KHZ800);
static WireClock g_clock;
static GpioWateringZone g_zone1(
    config::kZone1SoilPin, config::kZone1PumpPin, config::kSoilRawDry, config::kSoilRawWet,
    config::kPumpActiveHigh,
    GpioWateringZone::AdcTuning{config::kSoilSamples, config::kSoilMaxSpread,
                                config::kSoilInvalidThreshold, config::kSoilEmaAlpha,
                                config::kSoilSlewRateLimit});
static IWateringZone* g_zones[] = {&g_zone1};
static EspNowTransport g_transport;
static OtaWriter g_otaWriter;
static SubRuntime g_runtime(g_zones, 1, g_clock, g_transport, g_otaWriter, g_strip);

static SubButtonEvents sampleButtons() {
  return {
      .pressed = NanoC6.BtnA.isPressed(),
      .singleClicked = NanoC6.BtnA.wasSingleClicked(),
      .hold = NanoC6.BtnA.wasHold(),
      .released = NanoC6.BtnA.wasReleased(),
  };
}

void setup() {
  Serial.begin(115200);
  NanoC6.begin();

  pinMode(M5NANO_C6_RGB_LED_PWR_PIN, OUTPUT);
  digitalWrite(M5NANO_C6_RGB_LED_PWR_PIN, HIGH);
  g_strip.begin();
  g_strip.setBrightness(32);
  g_strip.show();

  pinMode(M5NANO_C6_BLUE_LED_PIN, OUTPUT);
  digitalWrite(M5NANO_C6_BLUE_LED_PIN, LOW);
  pinMode(M5NANO_C6_BTN_PIN, INPUT_PULLUP);
  NanoC6.BtnA.setHoldThresh(config::kButtonHoldMs);

  uint8_t bootChannel = g_runtime.bootChannel();
  uint8_t mac[6] = {};
  bool radioReady = g_transport.begin(bootChannel);
  if (radioReady) {
    g_transport.macAddress(mac);
  } else if (config::kSerialDebug) {
    Serial.println("[hydra] ESP-NOW init failed");
  }

  g_runtime.begin(bootChannel, mac, radioReady, millis());
}

void loop() {
  NanoC6.update();
  uint32_t now = millis();

  static bool otaMarked = false;
  if (shouldMarkSubOtaValid(otaMarked, now, config::kOtaHealthMs)) {
    esp_ota_mark_app_valid_cancel_rollback();
    otaMarked = true;
  }

  SubButtonEvents buttons = sampleButtons();
  SubRuntimeOutcome outcome = g_runtime.tick(now, buttons);
  if (outcome.restart) {
    delay(100);
    ESP.restart();
  }

  delay(10);
}
