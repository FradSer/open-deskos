#include "main_node/hal/provisioning_store.h"

#include "shared/preferences_store.h"

namespace hydra {

namespace {
constexpr char kNamespace[] = "hydra-net";
constexpr char kHostKey[] = "mqtt_host";
}  // namespace

bool ProvisioningStore::loadHost(char* out, size_t cap) {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  return store.getString(kHostKey, out, cap) > 0;
}

void ProvisioningStore::saveHost(const char* host) {
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putString(kHostKey, host);
}

}  // namespace hydra
