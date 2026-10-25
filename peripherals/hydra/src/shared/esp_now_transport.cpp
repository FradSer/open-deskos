#include "shared/esp_now_transport.h"

#include <Arduino.h>
#include <WiFi.h>

#include <cstring>
#include <atomic>
#ifdef HYDRA_DESKTOP_TELEMETRY
#include "shared/host_tx_gate.h"
#endif
#include <esp_now.h>
#include <esp_wifi.h>

namespace hydra {

namespace {

constexpr uint8_t kBroadcastAddr[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// Single-producer (WiFi task) / single-consumer (main loop) ring of received
// frames. head is written only by the producer, tail only by the consumer; a
// power-of-two length makes the wrap a cheap mask and lets the two run without a
// lock. When full, the newest frame is dropped (status arrives again in ~2 s).
constexpr uint32_t kQueueLen = 16;
volatile uint32_t g_head = 0;
volatile uint32_t g_tail = 0;
FleetMessage g_queue[kQueueLen];
bool g_initialized = false;
uint8_t g_channel = 1;
#ifdef HYDRA_DESKTOP_TELEMETRY
HostTxGate g_hostGate;
uint8_t g_hostMac[6] = {};
bool g_hostConfigured = false;
uint8_t g_localMac[6]{};
std::atomic<uint32_t> g_controlHead{0}, g_controlTail{0};
uint8_t g_controlQueue[4][128]{};
#endif

// Arduino-ESP32 3.x / IDF 5.x recv signature (esp_now_recv_info_t*, not the old
// const uint8_t* mac).
void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  if (!info || !info->src_addr || !info->des_addr || !data) return;
  if (memcmp(info->des_addr, kBroadcastAddr, 6) != 0) {
    if (!g_hostConfigured || len != 128 || memcmp(data, "HDC1", 4) ||
        memcmp(info->src_addr, g_hostMac, 6) || memcmp(info->des_addr, g_localMac, 6)) return;
    uint32_t head = g_controlHead.load(std::memory_order_relaxed);
    uint32_t next = (head + 1) & 3;
    if (next == g_controlTail.load(std::memory_order_acquire)) return;
    memcpy(g_controlQueue[head], data, 128);
    g_controlHead.store(next, std::memory_order_release);
    return;
  }
#endif
  (void)info;
  // Forward-compatible gate: read the version byte first (it lives at offset 0,
  // frozen across all schemas), then ask shouldAcceptFrame whether to keep the
  // frame. A newer-schema frame is accepted with only the first sizeof(FleetMessage)
  // bytes copied; trailing new fields are ignored.
  uint8_t version = len >= 1 ? data[0] : 0;
  if (!shouldAcceptFrame(version, len)) return;
  FleetMessage m{};
  memcpy(&m, data, sizeof(m));  // safe: shouldAcceptFrame guarantees len >= sizeof(m)
#ifdef HYDRA_DESKTOP_TELEMETRY
  if (m.type == static_cast<uint8_t>(FleetMsgType::PlanInstallReceipt))
    memcpy(m.mac, info->src_addr, 6);  // source evidence, not caller-supplied body
#endif
  uint32_t next = (g_head + 1) & (kQueueLen - 1);
  if (next == g_tail) return;  // full: drop newest
  g_queue[g_head] = m;
  g_head = next;
}

// 3.x send signature (esp_now_send_info_t*). Broadcast has no per-peer ack worth
// acting on, so the result is ignored.
void onSent(const esp_now_send_info_t* info, esp_now_send_status_t status) {
  (void)info;
  (void)status;
#ifdef HYDRA_DESKTOP_TELEMETRY
  if (!info || !info->des_addr) return;
  if (memcmp(info->des_addr, kBroadcastAddr, 6) == 0)
    g_hostGate.fleetComplete();
  else if (g_hostConfigured && memcmp(info->des_addr, g_hostMac, 6) == 0)
    g_hostGate.hostComplete();
#endif
}

}  // namespace

bool EspNowTransport::begin(uint8_t channel) {
  if (g_initialized) {
    setChannel(channel);
    return true;
  }
  WiFi.mode(WIFI_STA);
#ifdef HYDRA_DESKTOP_TELEMETRY
  WiFi.setAutoReconnect(false);
  WiFi.disconnect(false, false);  // Do not erase the operator's stored credentials.
  wifi_config_t empty{};
  if (esp_wifi_set_storage(WIFI_STORAGE_RAM) != ESP_OK ||
      esp_wifi_set_config(WIFI_IF_STA, &empty) != ESP_OK)
    return false;
#endif
  WiFi.setSleep(false);  // power-save sleep drops incoming ESP-NOW frames

  // Pin the channel once the STA interface is up and before esp_now_init. With no
  // AP connection the channel is ours to set.
  uint32_t start = millis();
  while (!WiFi.STA.started() && millis() - start < 1000) delay(10);
#ifdef HYDRA_DESKTOP_TELEMETRY
  if (esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE) != ESP_OK) return false;
#else
  esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE);
#endif

  if (esp_now_init() != ESP_OK) return false;
  esp_now_register_recv_cb(onRecv);
  esp_now_register_send_cb(onSent);

  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, kBroadcastAddr, 6);
  peer.channel = 0;  // 0 = use the interface's current channel
  peer.ifidx = WIFI_IF_STA;
  peer.encrypt = false;
  if (esp_now_add_peer(&peer) != ESP_OK) {
    esp_now_deinit();
    return false;
  }
  g_initialized = true;
  g_channel = channel;
#ifdef HYDRA_DESKTOP_TELEMETRY
  esp_wifi_get_mac(WIFI_IF_STA, g_localMac);
#endif
  return true;
}

void EspNowTransport::end() {
  if (!g_initialized) return;
  esp_now_deinit();
  g_head = 0;
  g_tail = 0;
  g_initialized = false;
#ifdef HYDRA_DESKTOP_TELEMETRY
  g_hostConfigured = false;
  g_controlHead.store(0); g_controlTail.store(0);
  g_hostGate.reset();
#endif
}

bool EspNowTransport::initialized() const { return g_initialized; }

void EspNowTransport::setChannel(uint8_t channel) {
  if (esp_wifi_set_channel(channel, WIFI_SECOND_CHAN_NONE) == ESP_OK) g_channel = channel;
}

bool EspNowTransport::broadcast(const FleetMessage& msg) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  // Fleet commands remain immediate. They never wait in a new application queue.
  g_hostGate.fleetStart();
  bool accepted =
      esp_now_send(kBroadcastAddr, reinterpret_cast<const uint8_t*>(&msg), sizeof(msg)) == ESP_OK;
  if (!accepted) g_hostGate.fleetComplete();
  return accepted;
#else
  return esp_now_send(kBroadcastAddr, reinterpret_cast<const uint8_t*>(&msg), sizeof(msg)) ==
         ESP_OK;
#endif
}

bool EspNowTransport::poll(FleetMessage& out) {
  if (g_tail == g_head) return false;
  out = g_queue[g_tail];
  g_tail = (g_tail + 1) & (kQueueLen - 1);
  return true;
}

bool EspNowTransport::pollControl(uint8_t out[128]) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  uint32_t tail = g_controlTail.load(std::memory_order_relaxed);
  if (tail == g_controlHead.load(std::memory_order_acquire)) return false;
  memcpy(out, g_controlQueue[tail], 128);
  g_controlTail.store((tail + 1) & 3, std::memory_order_release);
  return true;
#else
  (void)out; return false;
#endif
}

uint8_t EspNowTransport::channel() const { return g_channel; }
bool EspNowTransport::configureHost(const uint8_t gateway[6], const uint8_t pmk[16],
                                    const uint8_t lmk[16]) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  if (!g_initialized || g_hostConfigured || (gateway[0] & 1)) return false;
  esp_now_peer_info_t peer{};
  memcpy(peer.peer_addr, gateway, 6);
  memcpy(peer.lmk, lmk, 16);
  peer.ifidx = WIFI_IF_STA;
  peer.channel = g_channel;
  peer.encrypt = true;
  bool ok = esp_now_set_pmk(pmk) == ESP_OK && esp_now_add_peer(&peer) == ESP_OK;
  memset(peer.lmk, 0, 16);
  if (ok) {
    memcpy(g_hostMac, gateway, 6);
    g_hostConfigured = true;
  }
  return ok;
#else
  return false;
#endif
}
bool EspNowTransport::sendHost(const uint8_t* data, size_t size) {
#ifdef HYDRA_DESKTOP_TELEMETRY
  if (!g_initialized || !g_hostConfigured || !data || !size || size > 250 ||
      !g_hostGate.hostStart(millis()))
    return false;
  if (esp_now_send(g_hostMac, data, size) == ESP_OK) return true;
  g_hostGate.hostRejected();
  return false;
#else
  return false;
#endif
}

void EspNowTransport::macAddress(uint8_t out[6]) const { esp_wifi_get_mac(WIFI_IF_STA, out); }

}  // namespace hydra
