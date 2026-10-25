#include "main_node/hal/ota_store.h"

#include "shared/preferences_store.h"

namespace hydra {

namespace {
constexpr char kNamespace[] = "hydra-ota";
constexpr char kVerKey[] = "ver";
constexpr char kSubSeqKey[] = "subseq";
}  // namespace

uint32_t OtaStore::loadVersion() {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  return store.getU32(kVerKey, 0);
}

void OtaStore::saveVersion(uint32_t version) {
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putU32(kVerKey, version);
}

uint32_t OtaStore::loadNextSubOtaSeq() {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  return store.getU32(kSubSeqKey, 1);
}

void OtaStore::saveNextSubOtaSeq(uint32_t seq) {
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putU32(kSubSeqKey, seq);
}

}  // namespace hydra
