#include "main_node/hal/fleet_store.h"

#include "shared/preferences_store.h"

namespace hydra {

namespace {
constexpr char kNamespace[] = "hydra-fleet";
constexpr char kKey[] = "roster";
}  // namespace

void FleetStore::load(FleetRoster& roster) {
  PreferencesStore store(kNamespace, /*readOnly=*/true);
  uint8_t buffer[FleetRoster::kBlobSize];
  size_t size = store.getBlob(kKey, buffer, sizeof(buffer));
  if (size > 0) roster.deserialize(buffer, static_cast<int>(size));
}

void FleetStore::save(const FleetRoster& roster) {
  uint8_t buffer[FleetRoster::kBlobSize];
  int size = roster.serialize(buffer, sizeof(buffer));
  if (size <= 0) return;
  PreferencesStore store(kNamespace, /*readOnly=*/false);
  store.putBlob(kKey, buffer, static_cast<size_t>(size));
}

}  // namespace hydra
