#pragma once
#include <cstdint>
#include <cstring>

#include "domain/fleet_message.h"
#include "domain/plan.h"
#include "domain/timetable.h"

// Builders for the ESP-NOW wire frames. Both composition roots used to hand-fill the
// FleetMessage header (version + type + nodeId + memcpy(mac)) for every message kind;
// these factor that boilerplate into one place so the version stamp and type tag are
// set exactly once. Pure and header-only, so they are host-tested (test_fleet_codec).

namespace hydra {

// Common header: zero-initialise the frame, then stamp version + type + nodeId.
// Every builder starts here; payload setters follow.
inline FleetMessage makeFleetMessage(FleetMsgType type, uint8_t nodeId) {
  FleetMessage m{};
  m.version = kFleetProtocolVersion;
  m.type = static_cast<uint8_t>(type);
  m.nodeId = nodeId;
  return m;
}

// main -> all: latest environment reading. VPD is derived once on the hub and carried
// on the wire so sub-nodes read it as-is.
// main -> all: latest environment reading + the main node's local time. VPD is derived
// once on the hub and carried on the wire so sub-nodes read it as-is. The time slice
// (hour/minute/month) lets RTC-less sub-nodes gate watering by time-of-day and season;
// pass 0xFF for each field when the main node's RTC has no valid time (pre-SNTP).
inline FleetMessage makeEnvBroadcast(float tempC, float humidity, float pressurePa,
                                     float lux, float vpdKpa, uint8_t hour, uint8_t minute,
                                     uint8_t month) {
  FleetMessage m = makeFleetMessage(FleetMsgType::EnvBroadcast, 0);
  m.tempC = tempC;
  m.humidity = humidity;
  m.pressurePa = pressurePa;
  m.lux = lux;
  m.vpdKpa = vpdKpa;
  m.hour = hour;
  m.minute = minute;
  m.month = month;
  return m;
}

// sub -> main: soil + pump state. `status` is a PumpStatus the sub derived once.
// The diagnostic slice (pulseCount/effDryPercent/season/version) lets the main
// node forward runtime context to MQTT so a misbehaving cycle is explainable
// from the persisted log. pulseCount is the cycle's pulse index; effDryPercent
// is the env-fused dry threshold in force (0-100); season is the active Season
// preset; version is the sub-node's firmware version (OtaStore::loadVersion).
// The outcome slice (v6) is the executor's verdict on the last Timetable entry it
// consumed: the Window, the entry's index, the EntryRefusal code (0 = ran), and the
// Window's ran/refused counters. The builder takes them as one block so a caller
// cannot set half of a verdict.
struct TimetableOutcome {
  uint32_t windowSeq = 0;  // 0 = no verdict yet (nothing to publish)
  uint8_t index = 0;
  uint8_t code = 0;  // EntryRefusal code, 0 = RAN
  uint8_t ran = 0;
  uint8_t refused = 0;
};

inline FleetMessage makeStatusReport(uint8_t nodeId, const uint8_t mac[6], int32_t soilRaw,
                                     float soilPercent, bool soilValid, uint8_t status,
                                     uint8_t pulseCount, uint8_t effDryPercent,
                                     uint8_t season, uint32_t fwVersion,
                                     const TimetableOutcome& outcome = {}) {
  FleetMessage m = makeFleetMessage(FleetMsgType::StatusReport, nodeId);
  memcpy(m.mac, mac, 6);
  m.soilRaw = soilRaw;
  m.soilPercent = soilPercent;
  m.soilValid = soilValid ? 1 : 0;
  m.status = status;
  m.pulseCount = pulseCount;
  m.effDryPercent = effDryPercent;
  m.season = season;
  m.fwVersion = fwVersion;
  m.ttOutcomeWindowSeq = outcome.windowSeq;
  m.ttOutcomeIndex = outcome.index;
  m.ttOutcomeCode = outcome.code;
  m.ttRanCount = outcome.ran;
  m.ttRefusedCount = outcome.refused;
  return m;
}

// sub -> main: "assign me an id" (pairing). nodeId is the requester's current id (0
// when unprovisioned); mac identifies the subject.
inline FleetMessage makePairRequest(uint8_t nodeId, const uint8_t mac[6]) {
  FleetMessage m = makeFleetMessage(FleetMsgType::PairRequest, nodeId);
  memcpy(m.mac, mac, 6);
  return m;
}

// main -> sub: "you are node N" (pairing), carrying the main node's current channel
// so the sub locks onto and persists it.
inline FleetMessage makePairAssign(uint8_t nodeId, const uint8_t mac[6], uint8_t channel) {
  FleetMessage m = makeFleetMessage(FleetMsgType::PairAssign, nodeId);
  memcpy(m.mac, mac, 6);
  m.channel = channel;
  return m;
}

// main -> sub: force the pump on/off (target is nodeId).
inline FleetMessage makePumpCommand(uint8_t targetId, bool on) {
  FleetMessage m = makeFleetMessage(FleetMsgType::PumpCommand, targetId);
  m.pumpOn = on ? 1 : 0;
  return m;
}

// The wire's entry capacity and the domain value's are the same number by construction,
// not by convention. If either moves, this is where it fails.
static_assert(kFleetTimetableEntries == kMaxTimetableEntries,
              "the wire's timetable capacity and the domain value's must not drift");

// main -> sub: one Window's Timetable (target is nodeId), the ADR-0006 replacement for
// the per-tick Directive. The frame carries an intent per entry and nothing about the
// dose, so the device keeps the single home for watering physics (ADR-0002).
//
// A malformed Timetable is refused rather than sent: a frame is only ever built from a
// value that passed the same structural rules the receiver will apply, so an invalid
// Window cannot reach the air and the two ends cannot disagree about "well formed".
inline FleetMessage makeTimetableCommand(uint8_t targetId, const Timetable& table) {
  if (validateTimetable(table) != TimetableFault::Ok) return FleetMessage{};  // nothing sent

  FleetMessage m = makeFleetMessage(FleetMsgType::Timetable, targetId);
  m.ttWindowSeq = table.windowSeq;
  m.ttSeason = static_cast<uint8_t>(table.season);
  m.ttCount = table.count;
  for (uint8_t i = 0; i < table.count && i < kFleetTimetableEntries; i++) {
    m.ttEntries[i].offsetMinutes = table.entries[i].offsetMinutes;
    m.ttEntries[i].intent = static_cast<uint8_t>(table.entries[i].intent);
    m.ttEntries[i].night = table.entries[i].night ? 1 : 0;
  }
  return m;
}

// Decodes a Timetable addressed to `selfId`. False on another message kind, another
// node's id, an unprovisioned node, or a Timetable that fails the structural rules --
// including a season or an intent code this firmware cannot name, because a byte it
// cannot name is not a Window it can execute.
//
// `out` is untouched on failure. A partially populated Window would be an edit to a
// judgment nobody made, so a malformed frame decodes to nothing at all.
inline bool decodeTimetable(const FleetMessage& frame, uint8_t selfId, Timetable& out) {
  if (frame.type != static_cast<uint8_t>(FleetMsgType::Timetable)) return false;
  if (selfId == 0 || frame.nodeId != selfId) return false;
  if (frame.ttSeason >= kSeasonCount) return false;

  Timetable decoded{};
  decoded.windowSeq = frame.ttWindowSeq;
  decoded.season = static_cast<Season>(frame.ttSeason);
  // Copied unclamped so validation still sees an over-capacity count and rejects it.
  decoded.count = frame.ttCount;
  for (uint8_t i = 0; i < frame.ttCount && i < kFleetTimetableEntries; i++) {
    const uint8_t code = frame.ttEntries[i].intent;
    // Checked here as well as in `validateTimetable`, deliberately: this guard is what
    // keeps an unnameable byte from ever materialising as a `Plan` value, and the
    // validator is what rejects one a fixture built by casting. Same rule, two layers,
    // because constructing an invalid enum is not the same concern as judging a value.
    if (!isKnownPlan(code) || !planWaters(static_cast<Plan>(code))) return false;
    decoded.entries[i].offsetMinutes = frame.ttEntries[i].offsetMinutes;
    decoded.entries[i].intent = static_cast<Plan>(code);
    decoded.entries[i].night = frame.ttEntries[i].night != 0;
  }
  if (validateTimetable(decoded) != TimetableFault::Ok) return false;
  out = decoded;
  return true;
}

inline FleetMessage makePlanInstallReceipt(uint8_t node, const uint8_t mac[6],
                                           const Timetable& table, bool installed) {
  FleetMessage frame = makeTimetableCommand(node, table);
  frame.type = static_cast<uint8_t>(FleetMsgType::PlanInstallReceipt);
  memcpy(frame.mac, mac, 6); frame.pumpOn = installed ? 1 : 0;
  return frame;
}
inline bool decodePlanInstallReceipt(const FleetMessage& frame, uint8_t node,
                                     Timetable& table) {
  if (frame.type != static_cast<uint8_t>(FleetMsgType::PlanInstallReceipt) || frame.pumpOn > 1)
    return false;
  FleetMessage copy = frame; copy.type = static_cast<uint8_t>(FleetMsgType::Timetable);
  return decodeTimetable(copy, node, table);
}

// main -> sub: light the blue LED while being viewed (target is nodeId).
inline FleetMessage makeViewSpotlight(uint8_t targetId, bool on) {
  FleetMessage m = makeFleetMessage(FleetMsgType::ViewSpotlight, targetId);
  m.viewOn = on ? 1 : 0;
  return m;
}

// main -> all: announce a new firmware version. Carries metadata only (no bin,
// no Wi-Fi credentials); a sub-node that wants to update fetches the bin over
// HTTP from ip:port. seq is monotonic per announce so receivers can drop replays.
inline FleetMessage makeOtaAnnounce(uint32_t version, uint32_t binSize,
                                    const uint8_t sha256[32], const uint8_t ip[4],
                                    uint16_t port, uint32_t seq) {
  FleetMessage m = makeFleetMessage(FleetMsgType::OtaAnnounce, 0);
  m.otaVersion = version;
  m.otaBinSize = binSize;
  memcpy(m.otaSha256, sha256, 32);
  memcpy(m.otaIp, ip, 4);
  m.otaPort = port;
  m.otaSeq = seq;
  return m;
}

// main -> sub (at pairing): home Wi-Fi SSID + PSK so the sub can join the home
// network later and HTTP-GET the OTA bin from the NAS. Delivered once,
// persisted in the sub's NVS. `mac` is the sub's MAC (the sub only accepts a
// PskDelivery addressed to it). Strings are copied + NUL-terminated.
inline FleetMessage makePskDelivery(const uint8_t mac[6],
                                    const char* ssid, const char* psk) {
  FleetMessage m = makeFleetMessage(FleetMsgType::PskDelivery, 0);
  memcpy(m.mac, mac, 6);
  strncpy(m.ssid, ssid ? ssid : "", sizeof(m.ssid) - 1);
  m.ssid[sizeof(m.ssid) - 1] = '\0';
  strncpy(m.psk, psk ? psk : "", sizeof(m.psk) - 1);
  m.psk[sizeof(m.psk) - 1] = '\0';
  return m;
}

}  // namespace hydra
