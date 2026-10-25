#pragma once

#include "main_node/app/fleet_roster.h"

namespace hydra {

// Persists the main node's roster identities (id <-> mac) in NVS so the fleet
// survives a reboot. Only the stable identities are stored, not the volatile
// status -- nodes come back offline until they report again. Thin adapter over
// FleetRoster::serialize/deserialize.
class FleetStore {
 public:
  void load(FleetRoster& roster);
  void save(const FleetRoster& roster);
};

}  // namespace hydra
