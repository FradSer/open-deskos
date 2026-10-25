#include "sub_node/hal/node_identity.h"

#include "shared/preferences_store.h"

namespace hydra {

namespace {
constexpr char kNamespace[] = "hydra-node";
constexpr char kIdKey[] = "id";
constexpr char kChannelKey[] = "ch";
}  // namespace

uint8_t NodeIdentity::load() {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  return store.getU8(kIdKey, 0);
}

void NodeIdentity::save(uint8_t id) {
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putU8(kIdKey, id);
}

uint8_t NodeIdentity::loadChannel(uint8_t fallback) {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  return store.getU8(kChannelKey, fallback);
}

void NodeIdentity::saveChannel(uint8_t channel) {
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putU8(kChannelKey, channel);
}

}  // namespace hydra
