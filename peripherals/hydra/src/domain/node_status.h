#pragma once
#include <cstdint>

#include "pump_status.h"
#include "soil_reading.h"

namespace hydra {

// The main node's model of one sub-node, assembled from its StatusReport frames.
// `mac` is the stable device identity; `nodeId` is the human-facing fixed number
// assigned at pairing. `status` is the single operating state the sub-node derived
// and reported. `online` is derived on the main node (a report landed within the
// offline timeout), not sent by the sub-node.
struct NodeStatus {
  uint8_t nodeId;
  uint8_t mac[6];
  SoilReading soil;
  PumpStatus status;
  bool online;
  uint32_t lastSeenMs;
  // Diagnostic slice mirrored from the sub-node's StatusReport, so the main
  // node can forward them to MQTT. Defaults to 0 (matches an unupgraded v2
  // sub-node that never sets these fields -- harmless "unknown" sentinel).
  uint8_t pulseCount = 0;
  uint8_t effDryPercent = 0;
  uint8_t season = 0;
  uint32_t fwVersion = 0;
  // Timetable outcome telemetry (v6) mirrored from the sub-node's StatusReport. windowSeq 0
  // means no verdict yet, so the outcome topic stays silent for this node.
  uint32_t ttOutcomeWindowSeq = 0;
  uint8_t ttOutcomeIndex = 0;
  uint8_t ttOutcomeCode = 0;  // EntryRefusal code, 0 = RAN
  uint8_t ttRanCount = 0;
  uint8_t ttRefusedCount = 0;
};

}  // namespace hydra
