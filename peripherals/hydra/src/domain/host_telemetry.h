#pragma once
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <limits>

#include "domain/env_metrics.h"
#include "domain/node_status.h"
namespace hydra {
// This allowlisted application protocol never serializes FleetMessage or credentials.
class HostTelemetrySession {
 public:
  HostTelemetrySession(const char* boot, const char* firmware, uint32_t sequence = 0)
      : sequence_(sequence) {
    valid_ =
        boot && strlen(boot) == 16 && firmware && strlen(firmware) > 0 && strlen(firmware) <= 24;
    if (!valid_) return;
    for (const char* p = boot; *p; ++p)
      if (!((*p >= '0' && *p <= '9') || (*p >= 'a' && *p <= 'f'))) valid_ = false;
    for (const char* p = firmware; *p; ++p)
      if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || (*p >= '0' && *p <= '9') ||
            *p == '.' || *p == '_' || *p == '-'))
        valid_ = false;
    memcpy(boot_, boot, 17);
    memcpy(firmware_, firmware, strlen(firmware) + 1);
  }
  bool hello(char* out, size_t cap, uint32_t uptime, bool clock) {
    uint32_t seq;
    if (!next(seq)) return false;
    return bounded(snprintf(out, cap,
                            "{\"p\":\"hydra\",\"v\":1,\"k\":\"hello\",\"boot\":\"%s\",\"seq\":%lu,"
                            "\"firmware\":\"%s\",\"uptime\":%lu,\"clock\":%s}",
                            boot_, static_cast<unsigned long>(seq), firmware_,
                            static_cast<unsigned long>(uptime), clock ? "true" : "false"),
                   cap);
  }
  bool environment(char* out, size_t cap, const EnvMetrics& env, uint32_t age) {
    uint32_t seq;
    if (!next(seq)) return false;
    const bool valid = env.valid && std::isfinite(env.tempC) && std::isfinite(env.humidity) &&
                       std::isfinite(env.pressurePa) && env.tempC >= -50 && env.tempC <= 100 &&
                       env.humidity >= 0 && env.humidity <= 100 && env.pressurePa >= 10000 &&
                       env.pressurePa <= 130000;
    if (!valid)
      return bounded(
          snprintf(out, cap,
                   "{\"p\":\"hydra\",\"v\":1,\"k\":\"env\",\"boot\":\"%s\",\"seq\":%lu,\"age\":%lu,"
                   "\"valid\":false}",
                   boot_, static_cast<unsigned long>(seq), static_cast<unsigned long>(age)),
          cap);
    char lux[24] = "null", vpd[24] = "null";
    if (env.luxValid && std::isfinite(env.lux) && env.lux >= 0 && env.lux <= 200000)
      snprintf(lux, sizeof(lux), "%.1f", static_cast<double>(env.lux));
    if (std::isfinite(env.vpdKpa) && env.vpdKpa >= 0 && env.vpdKpa <= 100)
      snprintf(vpd, sizeof(vpd), "%.3f", static_cast<double>(env.vpdKpa));
    return bounded(
        snprintf(out, cap,
                 "{\"p\":\"hydra\",\"v\":1,\"k\":\"env\",\"boot\":\"%s\",\"seq\":%lu,\"age\":%lu,"
                 "\"valid\":true,\"tc\":%.2f,\"rh\":%.2f,\"hp\":%.2f,\"lx\":%s,\"vp\":%s}",
                 boot_, static_cast<unsigned long>(seq), static_cast<unsigned long>(age),
                 static_cast<double>(env.tempC), static_cast<double>(env.humidity),
                 static_cast<double>(env.pressurePa / 100.0f), lux, vpd),
        cap);
  }
  bool node(char* out, size_t cap, const NodeStatus& node, uint32_t now) {
    if (node.nodeId < 1 || node.nodeId > 6 ||
        static_cast<uint8_t>(node.status) > static_cast<uint8_t>(PumpStatus::Fault))
      return false;
    uint32_t seq;
    if (!next(seq)) return false;
    char soil[24] = "null";
    if (node.soil.valid && std::isfinite(node.soil.percent) && node.soil.percent >= 0 &&
        node.soil.percent <= 100)
      snprintf(soil, sizeof(soil), "%.2f", static_cast<double>(node.soil.percent));
    const uint32_t age = now - node.lastSeenMs;
    return bounded(
        snprintf(out, cap,
                 "{\"p\":\"hydra\",\"v\":1,\"k\":\"node\",\"boot\":\"%s\",\"seq\":%lu,\"id\":%u,"
                 "\"age\":%lu,\"online\":%s,\"soil\":%s,\"status\":\"%s\"}",
                 boot_, static_cast<unsigned long>(seq), node.nodeId,
                 static_cast<unsigned long>(age), node.online && age <= 8000 ? "true" : "false",
                 soil, pumpStatusLabel(node.status)),
        cap);
  }

 private:
  bool next(uint32_t& out) {
    if (!valid_ || sequence_ == std::numeric_limits<uint32_t>::max()) return false;
    out = ++sequence_;
    return true;
  }
  static bool bounded(int count, size_t cap) {
    return count > 0 && count <= 250 && static_cast<size_t>(count) < cap;
  }
  char boot_[17] = {};
  char firmware_[25] = {};
  uint32_t sequence_ = 0;
  bool valid_ = false;
};
}  // namespace hydra
