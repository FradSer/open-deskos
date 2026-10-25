#include "main_node/hal/host_link.h"

#include <Preferences.h>
#ifdef HYDRA_ENABLE_PRIVATE_PROVISION
#include "../../../.local/hydra_host_config.h"
#endif
namespace hydra {
HostLinkConfig loadHostLinkConfig() {
  Preferences store;
#ifdef HYDRA_ENABLE_PRIVATE_PROVISION
  HostLinkConfig desired;
  memcpy(desired.gateway, hydra_private_host::gateway, 6);
  memcpy(desired.pmk, hydra_private_host::pmk, 16);
  memcpy(desired.lmk, hydra_private_host::lmk, 16);
  desired.channel = hydra_private_host::channel;
  if (hydra_private_host::schema != 1 || !validHostLinkConfig(desired) ||
      !store.begin("hydra-host", false))
    return {};
  bool provisioned = provisionHostLinkConfig(store, desired);
  memset(desired.pmk, 0, 16);
  memset(desired.lmk, 0, 16);
  if (!provisioned) {
    store.end();
    return {};
  }
#else
  // Ordinary builds never consume a leftover private header or write NVS.
  if (!store.begin("hydra-host", true)) return {};
#endif
  HostLinkConfig result = readHostLinkConfig(store);
  store.end();
  return result;
}
}  // namespace hydra
