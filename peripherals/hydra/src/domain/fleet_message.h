#pragma once
#include <cstdint>

// ESP-NOW wire contract shared by the main node and every sub-node. One packed
// POD so a raw memcpy across the link is portable: both the ESP32-PICO-D4 (main)
// and the ESP32-C6 (sub) are little-endian. The frame is tiny (~44 bytes), well
// under the 250-byte ESP-NOW v1 limit, so a v2 C6 and a v1 PICO interoperate with
// no extra configuration.
//
// A single fixed layout carries every message kind; `type` says which fields are
// meaningful and the rest are zero. This trades a few wasted bytes for avoiding
// the casting pitfalls of a tagged union. `mac` is declared now (used by pairing
// in a later phase) so the wire format never breaks between phases.

namespace hydra {

// Schema version of the wire layout. Bump on any field addition/retype; the recv
// gate (shared/esp_now_transport.h shouldAcceptFrame) accepts frames whose version
// is >= this firmware's, so a newer-schema main can still reach an older-schema
// sub (the sub parses its prefix, ignores trailing new fields, and can receive an
// OtaAnnounce to self-upgrade). Older->newer is rejected, so a newer main does not
// see an older sub's StatusReport during the upgrade window -- the sub upgrades
// and reconnects.
constexpr uint8_t kFleetProtocolVersion = 6;

// Capacity of the Timetable block's entry list. It is the frame's field width, which is
// also what the model is asked for; the domain value's own capacity is asserted equal to
// this in domain/fleet_codec.h, so the two cannot drift apart.
constexpr uint8_t kFleetTimetableEntries = 4;

enum class FleetMsgType : uint8_t {
  EnvBroadcast = 1,  // main -> all: latest environment reading
  StatusReport = 2,  // sub  -> main: soil + pump state
  PairRequest = 3,    // sub  -> main: "assign me an id" (pairing)
  PairAssign = 4,     // main -> sub: "you are node N" (pairing)
  PumpCommand = 5,    // main -> sub: force the pump on/off (nodeId=target)
  ViewSpotlight = 6,  // main -> sub: light the blue LED while being viewed (nodeId=target)
  OtaAnnounce = 7,    // main -> all: a new firmware is available (sub-node OTA, phase 4)
  // 8 was OtaReady (legacy AP-mode OTA); removed 2026-07-06, no longer produced
  // or consumed by either node. Skip the value rather than reuse it, in case an
  // older sub-node firmware image is still running it in the field.
  PskDelivery = 9,    // main -> sub (pairing): home Wi-Fi SSID+PSK so the sub can OTA-GET the bin
  PlanCommand = 10,   // main -> sub: a Supervised watering Directive (plan code in `pumpOn`)
                      // Anti-replay rides the MQTT payload, not this frame: the
                      // publisher's monotonic sequence is enforced on the main node's
                      // ingress (app/mqtt_bridge.h parseTimetableDirective), so the wire
                      // layout stays frozen and a replay is dropped before it reaches
                      // ESP-NOW at all.
                      // RETIRED by ADR-0006 (see Timetable below). Left unused rather
                      // than reassigned, the way 8 was, in case an older sub-node image
                      // is still running it in the field.
  PlanInstallReceipt = 12, // sub -> main: same timetable fields; pumpOn=installed bool
  Timetable = 11,     // main -> sub: one Window's Timetable (ADR-0006), replacing the
                      // per-tick Directive. Carries an intent per entry and nothing about
                      // the dose, and offsets measured from RECEIPT rather than a clock,
                      // so a sub-node executes a whole Window without a trustworthy time
                      // source. Anti-replay rides the MQTT payload -- the main node keeps
                      // the last Window it accepted per zone -- so the wire stays a pure
                      // value.
};

// PREFIX-FREEZE DISCIPLINE (required for forward compatibility):
// New fields are APPENDED AT THE END only. Never insert, reorder, retype, or
// resize an existing field. The version (byte 0) and type (byte 1) are frozen
// at their current positions -- they drive the parse. An older firmware parses
// the prefix it compiled against and ignores trailing bytes from a newer schema;
// this only holds if the prefix is byte-stable across versions. If you must
// change a field's meaning, bump kFleetProtocolVersion and accept that older
// firmware will reject the frame (older->newer is dropped by shouldAcceptFrame).
struct __attribute__((packed)) FleetMessage {
  uint8_t version;  // kFleetProtocolVersion
  uint8_t type;     // FleetMsgType
  uint8_t nodeId;   // assigned id (0 = main / unprovisioned sub)
  uint8_t mac[6];   // pairing subject MAC (PairRequest / PairAssign)

  // EnvBroadcast payload. The main node owns the sensors, so it also owns the
  // derived metrics: vpdKpa is computed once on the hub and carried on the wire
  // so sub-nodes consume it without recomputing (see domain/env_metrics.h).
  float tempC;
  float humidity;
  float pressurePa;
  float lux;
  float vpdKpa;  // derived: vapor pressure deficit (kPa)

  // EnvBroadcast time slice. The main node has an RTC (BM8563, SNTP-synced); sub-nodes
  // do not, so the hour/minute/month ride this frame to let them gate watering by
  // time-of-day and season. 0xFF in each field means the main node has no valid time
  // (RTC unset, pre-SNTP) -- sub-nodes ignore the time slice but still accept the env.
  uint8_t hour;    // 0-23
  uint8_t minute;  // 0-59
  uint8_t month;   // 1-12

  // StatusReport payload
  int32_t soilRaw;
  float soilPercent;
  uint8_t soilValid;
  uint8_t status;  // PumpStatus (derived once by the sub-node)
  // Diagnostic slice (v3): lets the main node forward to MQTT so a misbehaving
  // watering cycle is explainable from the persisted log without a serial cable.
  // `pulseCount` is the count within the current cycle (resets at idle entry);
  // `effDryPercent` is the env-fused dry threshold actually in force; `season`
  // is the active Season preset; `version` is the sub-node's firmware version
  // (from OtaStore) so an OTA's effect is remotely confirmable.
  uint8_t pulseCount;
  uint8_t effDryPercent;
  uint8_t season;
  uint32_t fwVersion;  // sub-node firmware version (OtaStore::loadVersion)

  // Command payloads (target is nodeId)
  uint8_t pumpOn;  // PumpCommand: 1 = force pump on, 0 = off
  uint8_t viewOn;  // ViewSpotlight: 1 = blue LED solid (being viewed), 0 = off

  // PairAssign payload: the main node's current radio channel (= the router's,
  // once it joins Wi-Fi). The sub-node locks onto and persists it so it follows
  // the main node instead of needing the router pinned to a fixed channel.
  uint8_t channel;

  // OtaAnnounce payload (main -> all). Carries only the firmware metadata, not
  // the bin itself: a sub-node that decides to update (phase 4) opens Wi-Fi and
  // HTTP-GETs the bin from the main node's ip:port. Wi-Fi credentials are NOT
  // carried here (PSK delivery is a separate, unresolved phase-4 concern); this
  // frame only lets a sub-node learn "a new version exists" + where to fetch it.
  // `seq` is monotonic per announce so a sub-node can drop stale replays.
  uint32_t otaVersion;     // monotonic firmware version
  uint32_t otaBinSize;     // expected bin size in bytes
  uint8_t otaSha256[32];   // expected SHA-256 of the bin
  uint8_t otaIp[4];        // NAS HTTP server address (sub-node HTTP-GETs the bin)
  uint16_t otaPort;        // NAS HTTP server port
  uint32_t otaSeq;         // monotonic per announce (anti-replay)

  // PskDelivery payload (main -> sub, at pairing). The home Wi-Fi SSID + PSK so
  // the sub-node can join the home network and HTTP-GET the OTA bin from the NAS
  // itself (the main node's heap cannot hold a 1MB bin and its single STA cannot
  // be on two networks). Delivered once at pairing, persisted in the sub's NVS.
  // All other frame types leave these zero. Inflates the shared layout to ~190B
  // (still < 250B ESP-NOW v1 limit); the cost is one broadcast per pairing, not
  // per cycle, so the airtime cost is negligible.
  char ssid[33];           // 32-byte SSID + NUL
  char psk[64];            // 63-byte PSK + NUL

  // Timetable payload (v5, ADR-0006). One Window's watering times, main -> sub (target is
  // nodeId). APPENDED after `psk` by the prefix-freeze discipline: nothing before this
  // moves, so a v4 sub-node still parses its own prefix, ignores these bytes, and can
  // receive the OtaAnnounce that upgrades it.
  //
  // It carries an INTENT per entry and nothing about the dose: the device owns the
  // intent-to-pulses table beside its seasonal presets (ADR-0002), so no pulse timing, no
  // soak and no threshold rides the wire. `ttCount` of 0 is a real Window that waters
  // nothing -- deliberately distinct from no Timetable arriving at all, which is what a
  // failed authoring produces and what lets the local policy run.
  uint32_t ttWindowSeq;  // the Window's identity
  uint8_t ttSeason;      // Season code its author reasoned under
  uint8_t ttCount;       // 0..kFleetTimetableEntries
  struct __attribute__((packed)) TimetableWireEntry {
    uint16_t offsetMinutes;  // minutes from receipt
    uint8_t intent;          // plan code: an intent, never pulse parameters
    uint8_t night;           // the author's usable-hours marker: water the pot cannot use before
                             // the low-evaporation night (ADR-0006 amendment 3), 0/1
  } ttEntries[kFleetTimetableEntries];

  // Timetable outcome telemetry (v6, ADR-0006). APPENDED after the Timetable block by the
  // same prefix-freeze discipline: nothing before this moves, so the frame this schema
  // builds stays a valid prefix for the schema after it.
  //
  // The executor's verdict on the LAST entry it consumed in the Window named by
  // `ttOutcomeWindowSeq`. A sequence of 0 means "no verdict yet" -- no Window has been
  // accepted, or none of its entries has come due -- which is why the main node stays
  // silent rather than inventing a Window. `ttOutcomeCode` is the EntryRefusal code, and
  // 0 is the code an entry that RAN reports (entryRefusalName spells it RAN). The two
  // counters are per-Window: entries that started a cycle, and entries refused.
  uint32_t ttOutcomeWindowSeq;
  uint8_t ttOutcomeIndex;
  uint8_t ttOutcomeCode;
  uint8_t ttRanCount;
  uint8_t ttRefusedCount;
};

static_assert(sizeof(FleetMessage) <= 250, "FleetMessage exceeds ESP-NOW v1 frame limit");

}  // namespace hydra
