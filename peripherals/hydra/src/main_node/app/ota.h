#pragma once
#include <cstdint>
#include <cstring>

namespace hydra {

// Pure-logic OTA command parsing for the main node's self-update path. The NAS
// triggers an update by publishing a small text record to hydra/main/ota/cmd;
// this header turns that record into a struct and decides whether to apply it
// (only a strictly higher version is applied, so a replay of an old announce
// never re-flashes). Header-only and Arduino-free so it is host-tested
// (test_ota_command), mirroring the app/mqtt_bridge.h split: the HAL moves the
// bytes, this maps payload -> intent.
//
// Payload grammar (order fixed, ';' separated, no spaces):
//   v=<u32>;size=<u32>;sha=<64 hex chars>;url=<string>
// `url` is the rest of the record after "url=" (no quoting; ';' inside a URL is
// not supported -- NAS-side URLs don't use it).

struct OtaCommand {
  uint32_t version;     // monotonic; higher than current required to apply
  uint32_t binSize;     // expected firmware size in bytes
  uint8_t sha256[32];   // expected SHA-256 of the downloaded bin
  char url[128];        // http://<host>/<path> on the NAS
  bool valid;           // false if any field is missing or malformed
};

inline bool parseOtaU32(const char* begin, const char* end, uint32_t& out) {
  if (begin == end) return false;
  uint32_t value = 0;
  for (const char* p = begin; p < end; ++p) {
    if (*p < '0' || *p > '9') return false;
    uint32_t digit = static_cast<uint32_t>(*p - '0');
    if (value > (UINT32_MAX - digit) / 10) return false;
    value = value * 10 + digit;
  }
  out = value;
  return true;
}

// Parse a payload record into an OtaCommand. Sets valid=false (and zeroes the
// fields) on any malformation: missing field, out-of-range/non-numeric
// version/size, a sha that isn't exactly 64 hex chars, or an empty url.
inline OtaCommand parseOtaCommand(const char* payload) {
  OtaCommand c{};
  c.valid = false;
  if (!payload) return c;

  // Walk "key=value;" pairs. We accept the four known keys in any order but
  // each must appear exactly once; an unknown key makes the record invalid.
  bool haveV = false, haveSize = false, haveSha = false, haveUrl = false;
  const char* p = payload;
  while (*p) {
    // Find the next '='.
    const char* eq = p;
    while (*eq && *eq != '=') ++eq;
    if (*eq != '=') return c;  // no '=' -> malformed
    const char* val = eq + 1;

    // End of value is the next ';' or end-of-string (url is last and may run to EOL).
    const char* end = val;
    while (*end && *end != ';') ++end;
    size_t vlen = static_cast<size_t>(end - val);

    // Compare the key (length-prefixed to avoid matching "url" inside "myurl").
    size_t klen = static_cast<size_t>(eq - p);
    auto keyIs = [&](const char* k) {
      return strlen(k) == klen && strncmp(p, k, klen) == 0;
    };

    if (keyIs("v")) {
      if (haveV || vlen == 0) return c;
      haveV = true;
      if (!parseOtaU32(val, end, c.version)) return c;
    } else if (keyIs("size")) {
      if (haveSize || vlen == 0) return c;
      haveSize = true;
      if (!parseOtaU32(val, end, c.binSize)) return c;
    } else if (keyIs("sha")) {
      if (haveSha || vlen != 64) return c;
      haveSha = true;
      for (size_t i = 0; i < 32; ++i) {
        char hi = val[2 * i], lo = val[2 * i + 1];
        auto nibble = [](char ch, bool& ok) -> uint8_t {
          if (ch >= '0' && ch <= '9') return static_cast<uint8_t>(ch - '0');
          if (ch >= 'a' && ch <= 'f') return static_cast<uint8_t>(ch - 'a' + 10);
          if (ch >= 'A' && ch <= 'F') return static_cast<uint8_t>(ch - 'A' + 10);
          ok = false;
          return 0;
        };
        bool ok = true;
        uint8_t h = nibble(hi, ok), l = nibble(lo, ok);
        if (!ok) return c;
        c.sha256[i] = static_cast<uint8_t>((h << 4) | l);
      }
    } else if (keyIs("url")) {
      if (haveUrl || vlen == 0 || vlen >= sizeof(c.url)) return c;
      haveUrl = true;
      memcpy(c.url, val, vlen);
      c.url[vlen] = '\0';
    } else {
      return c;  // unknown key
    }

    p = (*end == ';') ? end + 1 : end;
  }

  if (!(haveV && haveSize && haveSha && haveUrl)) return c;
  c.valid = true;
  return c;
}

// True only when cmd is valid and strictly newer than currentVersion. A replay
// of the running version (or older) is a no-op so a stale announce never
// re-flashes the same (or older) image.
inline bool shouldApplyOta(const OtaCommand& cmd, uint32_t currentVersion) {
  return cmd.valid && cmd.version > currentVersion;
}

}  // namespace hydra
