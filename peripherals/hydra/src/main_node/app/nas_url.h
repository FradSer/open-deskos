#pragma once

#include <cstdint>
#include <cstring>

namespace hydra {

struct NasUrl {
  uint8_t ip[4];
  uint16_t port;
};

inline bool parseNasDecimal(const char* begin, const char* end, unsigned long maximum,
                            unsigned long& out) {
  if (begin == end) return false;
  unsigned long value = 0;
  for (const char* p = begin; p < end; ++p) {
    if (*p < '0' || *p > '9') return false;
    unsigned long digit = static_cast<unsigned long>(*p - '0');
    if (value > (maximum - digit) / 10) return false;
    value = value * 10 + digit;
  }
  out = value;
  return true;
}

inline bool parseNasUrl(const char* value, NasUrl& out) {
  if (value == nullptr || strncmp(value, "http://", 7) != 0) return false;
  const char* host = value + 7;
  const char* slash = strchr(host, '/');
  if (strchr(host, '?') != nullptr) return false;
  const char* end = slash ? slash : host + strlen(host);
  const char* colon = nullptr;
  for (const char* p = host; p < end; ++p) {
    if (*p == ':') {
      if (colon != nullptr) return false;
      colon = p;
    }
  }

  const char* ipEnd = colon ? colon : end;
  int octets[4] = {};
  const char* cursor = host;
  for (int i = 0; i < 4; ++i) {
    const char* segmentEnd = cursor;
    while (segmentEnd < ipEnd && *segmentEnd != '.') ++segmentEnd;
    unsigned long parsed = 0;
    if (!parseNasDecimal(cursor, segmentEnd, 255, parsed)) return false;
    octets[i] = static_cast<int>(parsed);
    if (i < 3) {
      if (segmentEnd == ipEnd || *segmentEnd != '.') return false;
      cursor = segmentEnd + 1;
    } else if (segmentEnd != ipEnd) {
      return false;
    }
  }

  uint16_t port = 80;
  if (colon != nullptr) {
    unsigned long parsed = 0;
    if (!parseNasDecimal(colon + 1, end, 65535, parsed) || parsed == 0) {
      return false;
    }
    port = static_cast<uint16_t>(parsed);
  }

  for (int i = 0; i < 4; ++i) out.ip[i] = static_cast<uint8_t>(octets[i]);
  out.port = port;
  return true;
}

}  // namespace hydra
