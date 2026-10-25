#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace hydra {

struct OtaHttpUrl {
  char host[40];
  uint16_t port;
  char path[128];
};

inline bool isOtaHostnameChar(char value) {
  return (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') ||
         (value >= '0' && value <= '9') || value == '.' || value == '-';
}

inline bool parseOtaPort(const char* begin, const char* end, uint16_t& out) {
  if (begin == end) return false;
  uint32_t value = 0;
  for (const char* p = begin; p < end; ++p) {
    if (*p < '0' || *p > '9') return false;
    uint32_t digit = static_cast<uint32_t>(*p - '0');
    if (value > (65535U - digit) / 10U) return false;
    value = value * 10U + digit;
  }
  if (value == 0) return false;
  out = static_cast<uint16_t>(value);
  return true;
}

inline bool parseOtaHttpUrl(const char* value, OtaHttpUrl& out) {
  if (value == nullptr || strncmp(value, "http://", 7) != 0) return false;
  const char* authority = value + 7;
  const char* slash = strchr(authority, '/');
  const char* end = slash ? slash : authority + strlen(authority);
  const char* colon = nullptr;
  for (const char* p = authority; p < end; ++p) {
    if (*p == ':') {
      if (colon != nullptr) return false;
      colon = p;
    }
  }

  const char* hostEnd = colon ? colon : end;
  size_t hostLength = static_cast<size_t>(hostEnd - authority);
  if (hostLength == 0 || hostLength >= sizeof(out.host)) return false;
  for (const char* p = authority; p < hostEnd; ++p) {
    if (!isOtaHostnameChar(*p)) return false;
  }
  memcpy(out.host, authority, hostLength);
  out.host[hostLength] = '\0';

  out.port = 80;
  if (colon != nullptr && !parseOtaPort(colon + 1, end, out.port)) return false;

  const char* path = slash ? slash : "/";
  size_t pathLength = strlen(path);
  if (pathLength >= sizeof(out.path)) return false;
  memcpy(out.path, path, pathLength + 1);
  return true;
}

struct OtaTransferPlan {
  bool valid;
  size_t bound;
};

// A nonzero announced size is required even when HTTP supplies Content-Length:
// the MQTT/ESP-NOW metadata is the release's expected byte count.
inline OtaTransferPlan makeOtaTransferPlan(uint32_t announcedSize, int contentLength) {
  if (announcedSize == 0) return {false, 0};
  if (contentLength > 0 && announcedSize != 0 &&
      static_cast<uint32_t>(contentLength) != announcedSize) {
    return {false, 0};
  }
  size_t bound = contentLength > 0 ? static_cast<size_t>(contentLength)
                                   : static_cast<size_t>(announcedSize);
  return {bound != 0, bound};
}

inline bool canAcceptOtaChunk(const OtaTransferPlan& plan, size_t written, size_t chunkSize) {
  return plan.valid && written <= plan.bound && chunkSize <= plan.bound - written;
}

inline bool otaTransferStalled(uint32_t lastProgressAt, uint32_t now, uint32_t stallMs) {
  return now - lastProgressAt >= stallMs;
}

class OtaWriter;

// Streams a bounded HTTP LAN response through the shared writer. HTTP only:
// this uses WiFiClient and deliberately does not negotiate TLS.
bool transferOtaHttp(const char* url, uint32_t announcedSize, const uint8_t expectedSha[32],
                     OtaWriter& writer);

}  // namespace hydra
