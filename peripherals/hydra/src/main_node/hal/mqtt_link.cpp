#include "main_node/hal/mqtt_link.h"

#include <Arduino.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <cstring>

#include "main_node/config.h"

namespace hydra {

namespace {

constexpr const char* kSetFilter = "hydra/+/pump/set";
// One level of wildcard, so this matches hydra/node<N>/timetable and deliberately not
// hydra/node<N>/timetable/ack or hydra/node<N>/timetable/outcome -- the two topics the
// main node publishes itself.
constexpr const char* kTimetableFilter = "hydra/+/timetable";
constexpr const char* kOtaFilter = "hydra/main/ota/cmd";
constexpr const char* kSubOtaFilter = "hydra/main/ota/sub/cmd";

// Incoming command ring (single producer / single consumer: the PubSubClient
// callback runs inside client.loop() on the main task, so this is just simple
// decoupling, not concurrency control).
constexpr uint32_t kQueueLen = 8;
uint32_t g_head = 0;
uint32_t g_tail = 0;
MqttLink::Incoming g_queue[kQueueLen];

WiFiClient g_wifiClient;
PubSubClient g_client(g_wifiClient);

char g_host[40] = {};  // PubSubClient::setServer keeps the pointer, so copy
const char* g_clientId = nullptr;
uint32_t g_reconnectMs = 5000;
uint32_t g_lastAttemptMs = 0;
bool g_wifiWasConnected = false;
bool g_mqttWasConnected = false;
bool g_hasSuccessfulPublish = false;
uint32_t g_lastSuccessfulPublishMs = 0;
uint8_t g_lastWifiChannel = 0;

void onMessage(char* topic, uint8_t* payload, unsigned int len) {
  uint32_t next = (g_head + 1) % kQueueLen;
  if (next == g_tail) return;  // full: drop newest (HomeKit will re-send)
  MqttLink::Incoming& in = g_queue[g_head];
  snprintf(in.topic, sizeof(in.topic), "%s", topic);
  unsigned int n = len < sizeof(in.payload) - 1 ? len : sizeof(in.payload) - 1;
  memcpy(in.payload, payload, n);
  in.payload[n] = '\0';
  g_head = next;
}

}  // namespace

void MqttLink::begin(const char* host, uint16_t port, const char* clientId,
                     uint32_t reconnectMs) {
  snprintf(g_host, sizeof(g_host), "%s", host);
  g_clientId = clientId;
  g_reconnectMs = reconnectMs;
  g_client.setServer(g_host, port);
  g_client.setCallback(onMessage);
  // LWT is wired in the connect() call below: if the main node dies / loses power
  // / hangs mid-loop, the broker flips hydra/main/online to "false" (retained) on
  // its own. The post-connect publish seeds "true"; publishEnv heartbeats it.
  // EspNowTransport::begin already put the radio in STA mode on the fleet
  // channel; the no-arg begin associates with the portal-provisioned network and
  // keeps the channel as long as the router's 2.4 GHz band is pinned to it.
  WiFi.begin();
}

void MqttLink::loop(uint32_t now) {
  bool wifiUp = WiFi.status() == WL_CONNECTED;
  if (wifiUp) g_lastWifiChannel = static_cast<uint8_t>(WiFi.channel());
  if (wifiUp && !g_wifiWasConnected) {
    WiFi.setSleep(false);  // modem-sleep drops ESP-NOW frames
    Serial.printf("[mqtt] WiFi up: %s ch %d, IP %s\n", WiFi.SSID().c_str(), WiFi.channel(),
                  WiFi.localIP().toString().c_str());
  }
  g_wifiWasConnected = wifiUp;
  if (!wifiUp) {
    if (g_client.connected()) g_client.disconnect();
    g_mqttWasConnected = false;
    return;  // no point touching MQTT until Wi-Fi is back
  }

  if (!g_client.connected()) {
    if (g_mqttWasConnected) {
      Serial.println("[mqtt] broker connection lost");
      g_mqttWasConnected = false;
    }
    if (now - g_lastAttemptMs >= g_reconnectMs) {
      g_lastAttemptMs = now;
      // 5-arg connect overload carries the LWT: broker flips kMainOnlineTopic to
      // "false" (retained, QoS 1) on an ungraceful socket drop.
      if (g_client.connect(g_clientId, config::kMainOnlineTopic, 1, true, "false")) {
        // Seed the availability topic immediately so the iOS app sees "online" the
        // moment the broker session is up. The LWT covers the ungraceful-exit case;
        // the heartbeat in publishEnv covers the connected-but-hung case.
        if (g_client.publish(config::kMainOnlineTopic, "true", true)) {
          g_hasSuccessfulPublish = true;
          g_lastSuccessfulPublishMs = now;
        }
        g_client.subscribe(kSetFilter);
        g_client.subscribe(kTimetableFilter);
        g_client.subscribe(kOtaFilter);
        g_client.subscribe(kSubOtaFilter);
        g_mqttWasConnected = true;
        Serial.printf("[mqtt] broker connected, subscribed %s + %s + %s + %s\n",
                      kSetFilter, kTimetableFilter, kOtaFilter, kSubOtaFilter);
      }
    }
    return;
  }
  g_client.loop();
}

bool MqttLink::wifiConnected() const { return WiFi.status() == WL_CONNECTED; }

bool MqttLink::connected() { return g_client.connected(); }

bool MqttLink::hasSuccessfulPublish() const { return g_hasSuccessfulPublish; }

uint32_t MqttLink::lastSuccessfulPublishMs() const { return g_lastSuccessfulPublishMs; }

void MqttLink::nudgeWifi() {
  Serial.println("[mqtt] nudging Wi-Fi reconnect");
  WiFi.reconnect();
}

void MqttLink::restartRadio() {
  Serial.println("[mqtt] restarting Wi-Fi radio");
  g_client.disconnect();
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);
  WiFi.begin();
  g_wifiWasConnected = false;
  g_mqttWasConnected = false;
  g_lastAttemptMs = 0;
}

bool MqttLink::publish(const char* topic, const char* value) {
  if (!g_client.connected()) return false;
  bool published = g_client.publish(topic, value, true);
  if (published) {
    g_hasSuccessfulPublish = true;
    g_lastSuccessfulPublishMs = millis();
  }
  return published;
}

bool MqttLink::poll(Incoming& out) {
  if (g_tail == g_head) return false;
  out = g_queue[g_tail];
  g_tail = (g_tail + 1) % kQueueLen;
  return true;
}

int MqttLink::wifiChannel() const {
  return WiFi.status() == WL_CONNECTED ? WiFi.channel() : 0;
}

uint8_t MqttLink::recoveryChannel() const {
  return g_lastWifiChannel != 0 ? g_lastWifiChannel : config::kDefaultEspNowChannel;
}

}  // namespace hydra
