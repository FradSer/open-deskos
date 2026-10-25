#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
#include "esp_wifi.h"
struct esp_now_recv_info_t { const uint8_t* src_addr; const uint8_t* des_addr; };
struct esp_now_send_info_t { const uint8_t* des_addr; };
using esp_now_send_status_t = int;
struct esp_now_peer_info_t { uint8_t peer_addr[6] = {}, lmk[16] = {}; int channel = 0, ifidx = 0; bool encrypt = false; };
inline void (*sdkReceive)(const esp_now_recv_info_t*, const uint8_t*, int) = nullptr;
inline void (*sdkSent)(const esp_now_send_info_t*, esp_now_send_status_t) = nullptr;
inline bool sdkAutoCallback = false, sdkReject = false;
inline int sdkSends = 0, sdkInit = 0, sdkReceiveRegisters = 0, sdkSendRegisters = 0;
inline uint8_t sdkLastDestination[6] = {};
inline int esp_now_init() { ++sdkInit; return ESP_OK; }
inline void esp_now_deinit() {}
inline void esp_now_register_recv_cb(decltype(sdkReceive) callback) { ++sdkReceiveRegisters; sdkReceive = callback; }
inline void esp_now_register_send_cb(decltype(sdkSent) callback) { ++sdkSendRegisters; sdkSent = callback; }
inline int esp_now_add_peer(const esp_now_peer_info_t*) { return ESP_OK; }
inline int esp_now_set_pmk(const uint8_t*) { return ESP_OK; }
inline int esp_now_send(const uint8_t* destination, const uint8_t*, size_t) {
  ++sdkSends; memcpy(sdkLastDestination, destination, 6);
  if (sdkReject) return -1;
  if (sdkAutoCallback) { esp_now_send_info_t info{destination}; sdkSent(&info, 0); }
  return ESP_OK;
}
