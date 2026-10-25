#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
namespace hydra {
struct HostLinkConfig {
  uint8_t gateway[6] = {}, pmk[16] = {}, lmk[16] = {};
  uint8_t channel = 1;
  bool valid = false;
};
inline bool validHostLinkConfig(const HostLinkConfig& config) {
  bool any = false;
  for (uint8_t byte : config.gateway) any = any || byte != 0;
  return any && !(config.gateway[0] & 1) && config.channel >= 1 && config.channel <= 11;
}
template <class Store>
HostLinkConfig readHostLinkConfig(Store& store) {
  HostLinkConfig out;
  bool lengths = store.getUChar("schema", 0) == 1 && store.getBytesLength("gateway") == 6 &&
                 store.getBytesLength("pmk") == 16 && store.getBytesLength("lmk") == 16;
  if (lengths) {
    bool read = store.getBytes("gateway", out.gateway, 6) == 6 &&
                store.getBytes("pmk", out.pmk, 16) == 16 &&
                store.getBytes("lmk", out.lmk, 16) == 16;
    out.channel = store.getUChar("channel", 0);
    out.valid = read && validHostLinkConfig(out);
  }
  if (!out.valid) out = HostLinkConfig{};
  return out;
}
inline bool sameHostLinkConfig(const HostLinkConfig& a, const HostLinkConfig& b) {
  return a.valid && b.valid && a.channel == b.channel && memcmp(a.gateway, b.gateway, 6) == 0 &&
         memcmp(a.pmk, b.pmk, 16) == 0 && memcmp(a.lmk, b.lmk, 16) == 0;
}
// The Store must already be open on hydra-host. No partition clear or erase is used.
template <class Store>
bool provisionHostLinkConfig(Store& store, HostLinkConfig desired) {
  if (!validHostLinkConfig(desired)) return false;
  desired.valid = true;
  if (sameHostLinkConfig(readHostLinkConfig(store), desired)) return true;
  // The commit marker is invalid until every field has been written and verified.
  if (store.putUChar("schema", 0) != 1 || store.putBytes("gateway", desired.gateway, 6) != 6 ||
      store.putBytes("pmk", desired.pmk, 16) != 16 ||
      store.putBytes("lmk", desired.lmk, 16) != 16 ||
      store.putUChar("channel", desired.channel) != 1)
    return false;
  if (store.putUChar("schema", 1) != 1) return false;
  if (sameHostLinkConfig(readHostLinkConfig(store), desired)) return true;
  store.putUChar("schema", 0);
  return false;
}
}  // namespace hydra
