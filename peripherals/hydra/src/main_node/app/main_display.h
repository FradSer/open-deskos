#pragma once

#include "main_node/app/fleet_roster.h"
#include "domain/env_metrics.h"
#include "domain/fleet_view.h"
#include "domain/node_status.h"

namespace hydra {

// The main node's screen (M5StickC Plus, portrait). Renders one page at a time
// into a single shared off-screen canvas; the view FSM in the composition root
// chooses which to draw.
//   - renderEnv:  the local environment metrics (temp/humidity primary with a
//                 derived VPD band, pressure/light secondary with status tags).
//   - renderNode: one sub-node's soil moisture + pump state + online status.
// (renderConfig for pairing is added in the pairing phase.)
class MainDisplay {
 public:
  void begin();
  void renderEnv(const EnvMetrics& e);
  // `forcing` true while the main node is holding the side button to remotely
  // water this node -- shown as WATER (the forced pump reports phase Idle, so this
  // local flag is what the screen reflects during the hold).
  void renderNode(const NodeStatus& n, int index, int total, bool forcing);
  void renderNoNodes();  // fleet page with no sub-nodes paired/heard yet
  // Settings menu (front-button hold): Network / Pairing entries, side button
  // moves the highlight, short front press confirms.
  void renderMenu(MenuItem selected);
  // Pairing page: instructions + the current roster, highlighting justPaired
  // (0 = none) so a freshly paired node flashes confirmation.
  void renderConfig(const FleetRoster& roster, uint8_t justPaired);
  // Provisioning page shown while the captive portal is up: which AP to join and
  // the portal address.
  void renderSetup(const char* apName, const char* portalUrl);
};

}  // namespace hydra
