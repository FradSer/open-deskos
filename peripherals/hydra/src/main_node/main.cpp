#include <Arduino.h>
#include <M5Unified.h>
#include <Wire.h>
#include <esp_ota_ops.h>
#include <esp_system.h>

#include "main_node/app/host_telemetry.h"
#include "main_node/app/main_display.h"
#include "main_node/app/main_runtime.h"
#include "main_node/app/mqtt_bridge.h"
#include "main_node/config.h"
#include "main_node/hal/bh1750_sensor.h"
#include "main_node/hal/composite_env_sensor.h"
#include "main_node/hal/env_iii_sensor.h"
#include "main_node/hal/fleet_store.h"
#include "main_node/hal/host_link.h"
#include "main_node/hal/desktop_control_crypto.h"
#include "main_node/hal/main_clock.h"
#include "main_node/hal/mqtt_link.h"
#include "main_node/hal/ota_store.h"
#include "main_node/hal/ota_updater.h"
#include "main_node/hal/pahub.h"
#include "main_node/hal/provisioning_store.h"
#include "main_node/hal/wifi_portal.h"
#include "shared/esp_now_transport.h"

using namespace hydra;

static PaHub g_pahub;
static EnvIIISensor g_envIII(g_pahub, config::kEnvChannel);
static BH1750Sensor g_bh1750(g_pahub, config::kLightChannel);
static CompositeEnvSensor g_env(g_envIII, g_bh1750);
static MainDisplay g_display;
static EspNowTransport g_transport;
static FleetStore g_fleetStore;
static MqttLink g_mqtt;
static MainClock g_clock;
static MqttFleetBridge g_mqttBridge(config::kRemoteForceRefreshMs, config::kMqttForceMaxMs);
static ProvisioningStore g_provisioningStore;
static WifiPortal g_wifiPortal;
static OtaUpdater g_otaUpdater;
static OtaStore g_otaStore;
static char g_bootIdentity[32] = {};
static char g_resetReason[24] = "unknown";

static const char* resetReasonLabel(esp_reset_reason_t reason) {
  switch (reason) {
    case ESP_RST_POWERON:
      return "power-on";
    case ESP_RST_EXT:
      return "external";
    case ESP_RST_SW:
      return "software";
    case ESP_RST_PANIC:
      return "panic";
    case ESP_RST_INT_WDT:
      return "interrupt-watchdog";
    case ESP_RST_TASK_WDT:
      return "task-watchdog";
    case ESP_RST_WDT:
      return "watchdog";
    case ESP_RST_DEEPSLEEP:
      return "deep-sleep";
    case ESP_RST_BROWNOUT:
      return "brownout";
    default:
      return "unknown";
  }
}

static MainDiagnosticIdentity g_diagnosticIdentity{
    config::kFirmwareVersion,
    config::kBuildIdentity,
    g_bootIdentity,
    g_resetReason,
};
static MainRuntime g_runtime(g_env, g_display, g_transport, g_fleetStore, g_mqtt, g_clock,
                             g_mqttBridge, g_provisioningStore, g_wifiPortal, g_otaUpdater,
                             g_otaStore, g_diagnosticIdentity);

static MainButtonEvents sampleButtons() {
  return {
      .frontHeld = M5.BtnA.wasHold(),
      .frontClicked = M5.BtnA.wasClicked(),
      .sideClicked = M5.BtnB.wasClicked(),
      .sideHeld = M5.BtnB.wasHold(),
      .sideHolding = M5.BtnB.isHolding(),
      .sideReleased = M5.BtnB.wasReleased(),
  };
}

void setup() {
  Serial.begin(115200);
  auto cfg = M5.config();
  M5.begin(cfg);
  delay(1000);
  uint64_t mac = ESP.getEfuseMac();
  snprintf(g_bootIdentity, sizeof(g_bootIdentity), "%012llx-%08lx",
           static_cast<unsigned long long>(mac), static_cast<unsigned long>(esp_random()));
  snprintf(g_resetReason, sizeof(g_resetReason), "%s", resetReasonLabel(esp_reset_reason()));
  Serial.println("\n[main-node] Hydra main node -- sensor hub + fleet dashboard");

  g_display.begin();
  M5.update();
  bool bootSidePressed = M5.BtnB.isPressed();

  Wire.begin(config::kI2cSda, config::kI2cScl, config::kI2cFreq);
  Serial.printf("[main-node] I2C: SDA=%d SCL=%d freq=%lu\n", config::kI2cSda, config::kI2cScl,
                config::kI2cFreq);
  bool environmentBusReady = g_pahub.begin(config::kPaHubAddr);
  if (!environmentBusReady) {
    Serial.printf("[main-node] ERROR: PaHub not found at 0x%02X\n", config::kPaHubAddr);
  } else {
    Serial.printf("[main-node] PaHub OK at 0x%02X\n", config::kPaHubAddr);
  }

  MainRuntimeOutcome outcome = g_runtime.provision(bootSidePressed);
  if (outcome.restart) ESP.restart();

  HostLinkConfig hostConfig = loadHostLinkConfig();
  const uint8_t channel = hostConfig.valid ? hostConfig.channel : config::kDefaultEspNowChannel;
  if (!g_transport.begin(channel)) {
    Serial.println("[main-node] ERROR: ESP-NOW init failed");
  } else {
    uint8_t mac[6];
    g_transport.macAddress(mac);
    Serial.printf(
        "[main-node] ESP-NOW fixed channel %d, "
        "MAC %02X:%02X:%02X:%02X:%02X:%02X\n",
        channel, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
  }

  if (hostConfig.valid &&
      g_transport.configureHost(hostConfig.gateway, hostConfig.pmk, hostConfig.lmk)) {
    char boot[17];
    snprintf(boot, sizeof(boot), "%08lx%08lx", static_cast<unsigned long>(esp_random()),
             static_cast<unsigned long>(esp_random()));
    static HostTelemetryPublisher telemetry(boot, "odk-hydra-main-1");
    g_runtime.attachHostTelemetry(&telemetry);
    static DesktopControl control;
    uint8_t mainMac[6] = {}; g_transport.macAddress(mainMac);
    uint64_t controlBoot = 0; esp_fill_random(&controlBoot, sizeof(controlBoot));
    if (control.begin(mainMac, hostConfig.gateway, controlBoot, loadDesktopControlCrypto()))
      g_runtime.attachDesktopControl(&control);
    Serial.println("[desktop] encrypted telemetry configured");
  } else
    Serial.println("[desktop] telemetry unavailable; local fleet remains active");
  memset(hostConfig.pmk, 0, sizeof(hostConfig.pmk));
  memset(hostConfig.lmk, 0, sizeof(hostConfig.lmk));
  outcome = g_runtime.begin(environmentBusReady, millis());
  if (outcome.restart) ESP.restart();
}

void loop() {
  M5.update();
  uint32_t now = millis();

  static bool otaMarked = false;
  if (shouldMarkOtaValid(otaMarked, now, config::kOtaHealthMs)) {
    esp_ota_mark_app_valid_cancel_rollback();
    otaMarked = true;
  }

  MainButtonEvents buttons = sampleButtons();
  MainRuntimeOutcome outcome = g_runtime.tick(now, buttons);
  if (outcome.restart) {
    delay(100);
    ESP.restart();
  }

  delay(10);
}
