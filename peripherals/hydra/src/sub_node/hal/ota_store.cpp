#include "sub_node/hal/ota_store.h"

#include "shared/preferences_store.h"

namespace hydra {

namespace {
constexpr char kNamespace[] = "hydra-ota-sub";
constexpr char kVerKey[] = "ver";
constexpr char kSeqKey[] = "seq";
}  // namespace

uint32_t OtaStore::loadVersion() {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  return store.getU32(kVerKey, 0);
}

void OtaStore::saveVersion(uint32_t version) {
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putU32(kVerKey, version);
}

uint32_t OtaSeqStore::loadSeq() {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  return store.getU32(kSeqKey, 0);
}

void OtaSeqStore::saveSeq(uint32_t seq) {
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putU32(kSeqKey, seq);
}

}  // namespace hydra
