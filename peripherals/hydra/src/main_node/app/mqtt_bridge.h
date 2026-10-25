#pragma once
#include <cstdint>
#include <cstdio>
#include <cstring>

#include "main_node/app/fleet_roster.h"
#include "main_node/app/ota.h"
#include "main_node/hal/main_clock.h"
#include "domain/env_metrics.h"
#include "domain/env_reading.h"
#include "domain/timetable.h"

namespace hydra {

// Pure HomeKit/MQTT behavior for the main node -- no Arduino or PubSubClient,
// so it is host-tested like the roster. It builds retained environment/node
// snapshots, classifies incoming pump and OTA messages, and owns the per-node
// force state machine (latch, keep-alive, release, safety auto-release). The
// HAL (MqttLink) moves bytes; the composition root executes physical commands.

struct MqttPayload {
  char topic[32];
  char value[80];
};

struct MainDiagnosticSnapshot {
  const char* firmwareVersion;
  const char* buildIdentity;
  const char* bootIdentity;
  const char* resetReason;
  uint32_t uptimeMs;
  bool hasSuccessfulPublish;
  uint32_t lastSuccessfulPublishMs;
};

inline void copyMqttPayload(MqttPayload& payload, const char* topic, const char* value) {
  snprintf(payload.topic, sizeof(payload.topic), "%s", topic);
  snprintf(payload.value, sizeof(payload.value), "%s", value);
}

// Builds a credential-free retained diagnostic snapshot for the running main-node
// boot. lastSuccessfulPublishMs is deliberately captured before this batch starts,
// so every topic in one snapshot describes the same point in history.
inline int buildMainDiagnosticPayloads(const MainDiagnosticSnapshot& snapshot,
                                       MqttPayload out[6]) {
  copyMqttPayload(out[0], "hydra/main/diag/firmware", snapshot.firmwareVersion);
  copyMqttPayload(out[1], "hydra/main/diag/build", snapshot.buildIdentity);
  copyMqttPayload(out[2], "hydra/main/diag/boot", snapshot.bootIdentity);
  copyMqttPayload(out[3], "hydra/main/diag/reset", snapshot.resetReason);

  snprintf(out[4].topic, sizeof(out[4].topic), "hydra/main/diag/uptime_s");
  snprintf(out[4].value, sizeof(out[4].value), "%lu",
           static_cast<unsigned long>(snapshot.uptimeMs / 1000U));
  snprintf(out[5].topic, sizeof(out[5].topic), "hydra/main/diag/last_publish_s");
  if (snapshot.hasSuccessfulPublish) {
    snprintf(out[5].value, sizeof(out[5].value), "%lu",
             static_cast<unsigned long>(snapshot.lastSuccessfulPublishMs / 1000U));
  } else {
    snprintf(out[5].value, sizeof(out[5].value), "never");
  }
  return 6;
}

// Appends the broadcast time slice to an environment payload. 0xFF in either
// field means the main node holds no trusted time; that is reported as NC rather
// than a number so a missing clock is never mistaken for midnight. Rides the
// payload as a string so a timezone or clock defect is visible from the NAS
// without a wire change or a serial cable.
inline void appendEnvTime(char* buf, int cap, const EnvTimeSnapshot& time) {
  if (time.hour == EnvTimeSnapshot::kInvalid || time.minute == EnvTimeSnapshot::kInvalid) {
    snprintf(buf, cap, ";hh=NC;mm=NC");
    return;
  }
  snprintf(buf, cap, ";hh=%u;mm=%u", static_cast<unsigned>(time.hour),
           static_cast<unsigned>(time.minute));
}

// Builds the retained env sensor payloads. Returns the number filled (0 when the
// reading is invalid; lux is skipped when luxValid is false). Lux is clamped to
// the HomeKit CurrentAmbientLightLevel minimum of 0.0001.
inline int buildEnvPayloads(const EnvReading& e, MqttPayload out[4]) {
  if (!e.valid) return 0;
  int n = 0;
  snprintf(out[n].topic, sizeof(out[n].topic), "hydra/main/temp");
  snprintf(out[n].value, sizeof(out[n].value), "%.1f", static_cast<double>(e.tempC));
  n++;
  snprintf(out[n].topic, sizeof(out[n].topic), "hydra/main/humidity");
  snprintf(out[n].value, sizeof(out[n].value), "%.1f", static_cast<double>(e.humidity));
  n++;
  snprintf(out[n].topic, sizeof(out[n].topic), "hydra/main/pressure");
  snprintf(out[n].value, sizeof(out[n].value), "%.1f", static_cast<double>(e.pressurePa) / 100.0);
  n++;
  if (e.luxValid) {
    float lux = e.lux < 0.0001f ? 0.0001f : e.lux;
    snprintf(out[n].topic, sizeof(out[n].topic), "hydra/main/lux");
    if (lux < 1.0f) {
      snprintf(out[n].value, sizeof(out[n].value), "%.4f", static_cast<double>(lux));
    } else {
      snprintf(out[n].value, sizeof(out[n].value), "%.1f", static_cast<double>(lux));
    }
    n++;
  }
  return n;
}

// Parses "hydra/node<N>/pump/set" -> N (1-255). Returns 0 on any other topic.
inline uint8_t parsePumpSetTopic(const char* topic) {
  int id = 0;
  char rest[16] = {};
  if (sscanf(topic, "hydra/node%d/%15s", &id, rest) != 2) return 0;
  if (strcmp(rest, "pump/set") != 0) return 0;
  if (id < 1 || id > 255) return 0;
  return static_cast<uint8_t>(id);
}

// mqttthing default booleans are "true"/"false"; accept the common spellings.
// (No strcasecmp: it lives in <strings.h> on some libcs, so compare by hand.)
inline bool equalsIgnoreCase(const char* a, const char* b) {
  for (; *a && *b; a++, b++) {
    char ca = (*a >= 'A' && *a <= 'Z') ? *a + 32 : *a;
    char cb = (*b >= 'A' && *b <= 'Z') ? *b + 32 : *b;
    if (ca != cb) return false;
  }
  return *a == *b;
}

enum class OnOffCommand { Invalid, Off, On };

inline OnOffCommand parseOnOffCommand(const char* payload) {
  if (strcmp(payload, "1") == 0 || equalsIgnoreCase(payload, "true") ||
      equalsIgnoreCase(payload, "on")) {
    return OnOffCommand::On;
  }
  if (strcmp(payload, "0") == 0 || equalsIgnoreCase(payload, "false") ||
      equalsIgnoreCase(payload, "off")) {
    return OnOffCommand::Off;
  }
  return OnOffCommand::Invalid;
}

inline bool parseOnOff(const char* payload) {
  return parseOnOffCommand(payload) == OnOffCommand::On;
}

// Parses "hydra/node<N>/timetable" -> N (1-255). Returns 0 on any other topic, including the
// acknowledgement the main node publishes under "timetable/ack", and rejecting a trailing
// tail or an id that does not fit a byte: this is the self-echo and command-injection seam,
// so it matches the whole topic rather than a prefix.
inline uint8_t parseTimetableTopic(const char* topic) {
  static const char kPrefix[] = "hydra/node";
  const size_t prefixLen = sizeof(kPrefix) - 1;
  if (strncmp(topic, kPrefix, prefixLen) != 0) return 0;
  const char* p = topic + prefixLen;
  if (*p < '1' || *p > '9') return 0;
  long id = 0;
  for (; *p >= '0' && *p <= '9'; p++) {
    id = id * 10 + (*p - '0');
    if (id > 255) return 0;
  }
  if (strcmp(p, "/timetable") != 0) return 0;
  return static_cast<uint8_t>(id);
}

// One entry field: "<offsetMinutes>/<intent>", with an optional "/night" marker. An
// unnameable intent is rejected rather than guessed at, and only a watering intent is
// accepted: an empty Window is how the model holds, so a `hold` code has no entry form.
inline bool parseTimetableEntry(const char* field, TimetableEntry& out) {
  const char* slash = strchr(field, '/');
  if (slash == nullptr || slash == field) return false;

  uint32_t offset = 0;
  for (const char* p = field; p < slash; p++) {
    if (*p < '0' || *p > '9') return false;
    offset = offset * 10u + static_cast<uint32_t>(*p - '0');
    if (offset > 0xFFFFu) return false;
  }

  const char* intentStart = slash + 1;
  const char* intentEnd = strchr(intentStart, '/');
  const bool night = intentEnd != nullptr;
  const size_t intentLen = night ? static_cast<size_t>(intentEnd - intentStart)
                                 : strlen(intentStart);
  if (intentLen == 0 || intentLen >= 16) return false;
  if (night && strcmp(intentEnd + 1, "night") != 0) return false;

  char name[16];
  memcpy(name, intentStart, intentLen);
  name[intentLen] = '\0';

  for (uint8_t code = 0; code < kPlanCodeCount; code++) {
    const Plan plan = static_cast<Plan>(code);
    if (!planWaters(plan)) continue;
    if (!equalsIgnoreCase(name, planName(plan))) continue;
    out = TimetableEntry{static_cast<uint16_t>(offset), plan, night};
    return true;
  }
  return false;
}

// Parses a Timetable payload, "<SEASON>[;<offset>/<intent>[/night]]...@<windowSeq>".
//
// A table without a sequence is deliberately NOT a Timetable, for the reason a bare plan
// name was not a Directive: accepting one would hand a retained publish a way around the
// replay drop. The sequence is the Window's identity, so a re-delivery cannot re-arm a
// schedule whose entries have already been attempted.
//
// The season is the one `seasonName` spells, matched case-insensitively so the publisher
// cannot drift on its capitalisation. The structural rules the device will apply are
// applied here too, so a malformed Window is dropped at ingress rather than forwarded and
// refused twice.
inline bool parseTimetableDirective(const char* payload, Timetable& out, uint32_t& seq) {
  const char* at = strrchr(payload, '@');
  if (at == nullptr || at == payload) return false;

  uint32_t value = 0;
  for (const char* p = at + 1; *p != '\0'; p++) {
    if (*p < '0' || *p > '9') return false;
    const uint32_t digit = static_cast<uint32_t>(*p - '0');
    if (value > (0xFFFFFFFFu - digit) / 10u) return false;  // would overflow
    value = value * 10u + digit;
  }
  // An empty sequence leaves `value` at zero, and zero is not a Window identity: the
  // publisher derives it from the clock, so a zero means no sequence was sent.
  if (value == 0) return false;

  const size_t bodyLen = static_cast<size_t>(at - payload);
  if (bodyLen >= 192) return false;
  char body[192];
  memcpy(body, payload, bodyLen);
  body[bodyLen] = '\0';

  Timetable table{};
  bool seasonKnown = false;
  // Split on ';' by hand rather than with strtok_r, which silently collapses a run of
  // delimiters: `SUMMER;;15/top_up@7` would then parse as two fields and an empty segment
  // would be accepted as a Table. The grammar has no optional segment -- the Python side
  // rejects the same payload -- and a device that executes what the authoring end calls
  // malformed is a device two ends disagree about. An empty field is refused here.
  char* field = body;
  for (;;) {
    char* separator = strchr(field, ';');
    if (separator != nullptr) *separator = '\0';
    if (*field == '\0') return false;

    if (!seasonKnown) {
      for (int s = 0; s < kSeasonCount; s++) {
        if (!equalsIgnoreCase(field, seasonName(static_cast<Season>(s)))) continue;
        table.season = static_cast<Season>(s);
        seasonKnown = true;
        break;
      }
      if (!seasonKnown) return false;
    } else {
      if (table.count >= kMaxTimetableEntries) return false;
      TimetableEntry entry{};
      if (!parseTimetableEntry(field, entry)) return false;
      table.entries[table.count++] = entry;
    }

    if (separator == nullptr) break;
    field = separator + 1;
  }

  if (validateTimetable(table) != TimetableFault::Ok) return false;

  table.windowSeq = value;
  out = table;
  seq = value;
  return true;
}

// Builds the forwarding acknowledgement, "standard@13:34", or "standard@NC" when
// the main node holds no trustworthy time. It names the intent and the clock it
// went out on; the logger's own line carries the full ISO timestamp. It is an
// acknowledgement of *forwarding*, not of the intent being upheld -- what the zone
// then does is on its status topics.
// "<entries>@<local time>": how many watering times the last forwarded Window carried, so a
// Window that never reached a zone is distinguishable from one that did.
inline void buildTimetableAckPayload(uint8_t nodeId, const Timetable& table,
                                     const EnvTimeSnapshot& time, MqttPayload& out) {
  char time_slice[8];
  if (time.hour == EnvTimeSnapshot::kInvalid || time.minute == EnvTimeSnapshot::kInvalid) {
    snprintf(time_slice, sizeof(time_slice), "NC");
  } else {
    snprintf(time_slice, sizeof(time_slice), "%u:%02u", static_cast<unsigned>(time.hour),
             static_cast<unsigned>(time.minute));
  }
  snprintf(out.topic, sizeof(out.topic), "hydra/node%u/timetable/ack", nodeId);
  snprintf(out.value, sizeof(out.value), "%u@%s", static_cast<unsigned>(table.count),
           time_slice);
}

inline void buildNodeTopic(uint8_t nodeId, const char* leaf, char* out, int cap) {
  snprintf(out, cap, "hydra/node%u/%s", nodeId, leaf);
}

inline bool isNodeMqttHeartbeatDue(uint32_t now, uint32_t last, uint32_t intervalMs) {
  return now - last >= intervalMs;
}

class MqttFleetBridge {
 public:
  static constexpr int kMaxNodes = FleetRoster::kMaxNodes;
  static constexpr int kMaxSnapshotPayloads = 8;
  static constexpr int kMaxDiagnosticPayloads = 6;

  struct Command {
    bool valid;
    uint8_t nodeId;
    bool on;
  };

  struct TimetableCommand {
    bool valid;
    uint8_t nodeId;
    Timetable table;
    uint32_t seq;
  };

  enum class IncomingKind { None, Pump, MainOta, SubOta, Timetable, TimetableReplay };

  struct Incoming {
    IncomingKind kind;
    Command pump;
    OtaCommand ota;
    TimetableCommand timetable;
  };

  // refreshMs: keep-alive re-send cadence while forced (matches the sub-node's
  // remote-force watchdog). maxForceMs: safety cap after which a force releases
  // on its own even if HomeKit never sends OFF.
  MqttFleetBridge(uint32_t refreshMs, uint32_t maxForceMs)
      : refreshMs_(refreshMs), maxForceMs_(maxForceMs) {}

  // Feed one incoming MQTT message. Returns the PumpCommand to send now, or
  // valid=false when the topic/payload is not a pump set command. An OFF is
  // emitted even when not currently forced -- it is idempotent on the sub-node.
  Command onSetMessage(const char* topic, const char* payload, uint32_t now) {
    uint8_t id = parsePumpSetTopic(topic);
    OnOffCommand command = parseOnOffCommand(payload);
    if (id == 0 || command == OnOffCommand::Invalid) return {false, 0, false};
    Slot* s = findOrCreate(id);
    if (!s) return {false, 0, false};
    bool on = command == OnOffCommand::On;
    s->forced = on;
    s->forcedAtMs = now;
    s->lastSentMs = now;
    return {true, id, on};
  }

  // Classifies one incoming MQTT message into an action the composition root
  // physically executes. OTA parsing stays pure here; flashing, NVS, ESP-NOW,
  // and rebooting remain in main.cpp.
  Incoming classifyIncoming(const char* topic, const char* payload, uint32_t now) {
    if (strcmp(topic, "hydra/main/ota/cmd") == 0) {
      OtaCommand ota = parseOtaCommand(payload);
      return ota.valid ? Incoming{IncomingKind::MainOta, {false, 0, false}, ota}
                       : Incoming{IncomingKind::None, {false, 0, false}, {}};
    }
    if (strcmp(topic, "hydra/main/ota/sub/cmd") == 0) {
      OtaCommand ota = parseOtaCommand(payload);
      return ota.valid ? Incoming{IncomingKind::SubOta, {false, 0, false}, ota}
                       : Incoming{IncomingKind::None, {false, 0, false}, {}};
    }
    uint8_t tableNode = parseTimetableTopic(topic);
    if (tableNode != 0) {
      Timetable table{};
      uint32_t seq = 0;
      if (!parseTimetableDirective(payload, table, seq)) {
        return Incoming{IncomingKind::None, {false, 0, false}, {}, {}};
      }
      Slot* s = findOrCreate(tableNode);
      if (!s) return Incoming{IncomingKind::None, {false, 0, false}, {}, {}};
      // Per zone, because the Supervisor authors each zone's Window on its own edge. A
      // Window identity the main node has already seen, or an older one, is a replay: it is
      // dropped here rather than forwarded, and the sub-node's own idempotence is the second
      // line of that defence.
      if (s->windowSeqInit && seq <= s->lastWindowSeq) {
        return Incoming{IncomingKind::TimetableReplay, {false, 0, false}, {},
                        {true, tableNode, table, seq}};
      }
      s->lastWindowSeq = seq;
      s->windowSeqInit = true;
      return Incoming{IncomingKind::Timetable, {false, 0, false}, {}, {true, tableNode, table, seq}};
    }
    Command pump = onSetMessage(topic, payload, now);
    return pump.valid ? Incoming{IncomingKind::Pump, pump, {}, {}}
                      : Incoming{IncomingKind::None, {false, 0, false}, {}, {}};
  }

  // Builds one bounded MQTT snapshot for environment metrics. Availability is
  // always emitted, even when the core reading is invalid, so consumers can
  // distinguish an alive main node from stale retained sensor values.
  int buildEnvironmentSnapshot(const EnvMetrics& metrics, const EnvTimeSnapshot& time,
                               MqttPayload out[kMaxSnapshotPayloads]) {
    EnvReading reading{metrics.tempC, metrics.humidity, metrics.pressurePa, metrics.lux,
                       metrics.valid, metrics.luxValid};
    int count = buildEnvPayloads(reading, out);
    if (metrics.valid) {
      char vpd[16];
      char lux[16];
      snprintf(vpd, sizeof(vpd), "%.2f", static_cast<double>(metrics.vpdKpa));
      if (metrics.lux < 1.0f) {
        snprintf(lux, sizeof(lux), "%.4f", static_cast<double>(metrics.lux));
      } else {
        snprintf(lux, sizeof(lux), "%.1f", static_cast<double>(metrics.lux));
      }
      copyPayload(out[count++], "hydra/main/vpd", vpd);
      MqttPayload& env = out[count++];
      char time_slice[16];
      appendEnvTime(time_slice, sizeof(time_slice), time);
      snprintf(env.topic, sizeof(env.topic), "hydra/main/env");
      snprintf(env.value, sizeof(env.value), "v=1;l=%u;t=%.1f;h=%.1f;p=%.1f;x=%s;d=%s%s",
               metrics.luxValid ? 1 : 0, static_cast<double>(metrics.tempC),
               static_cast<double>(metrics.humidity), static_cast<double>(metrics.pressurePa) / 100.0,
               lux, vpd, time_slice);
    } else {
      copyPayload(out[count++], "hydra/main/vpd", "NC");
      copyPayload(out[count++], "hydra/main/env", "v=0");
    }
    copyPayload(out[count++], "hydra/main/online", "true");
    return count;
  }

  void buildSubOtaProgressPayload(const char* status, MqttPayload& out) const {
    copyPayload(out, "hydra/main/ota/sub/progress", status);
  }

  // Builds first-or-changed MQTT state for a fleet row. Topic construction,
  // formatting, NC handling, and retained-state de-duplication live together
  // so the composition root only publishes the returned records.
  int buildNodeSnapshot(const NodeStatus& node, MqttPayload out[kMaxSnapshotPayloads],
                        bool refresh = false) {
    int count = 0;
    bool pumpOn = node.online && node.status == PumpStatus::Watering;
    bool pumpDirty = pumpChanged(node.nodeId, pumpOn);
    bool onlineDirty = onlineChanged(node.nodeId, node.online);
    bool soilDirty = soilChanged(node.nodeId, node.soil.percent, node.soil.valid);
    bool statusDirty = statusChanged(node.nodeId, static_cast<uint8_t>(node.status));
    bool pulseDirty = pulseChanged(node.nodeId, node.pulseCount);
    bool effDryDirty = effDryChanged(node.nodeId, node.effDryPercent);
    bool seasonDirty = seasonChanged(node.nodeId, node.season);
    bool versionDirty = versionChanged(node.nodeId, node.fwVersion);
    if (refresh || pumpDirty) {
      appendNodePayload(out, count, node.nodeId, "pump", pumpOn ? "true" : "false");
    }
    if (refresh || onlineDirty) {
      appendNodePayload(out, count, node.nodeId, "online", node.online ? "true" : "false");
    }
    if (refresh || soilDirty) {
      if (node.soil.valid) {
        char value[16];
        snprintf(value, sizeof(value), "%.1f", static_cast<double>(node.soil.percent));
        appendNodePayload(out, count, node.nodeId, "soil", value);
      } else {
        appendNodePayload(out, count, node.nodeId, "soil", "NC");
      }
    }
    if (refresh || statusDirty) {
      appendNodePayload(out, count, node.nodeId, "status", pumpStatusLabel(node.status));
    }
    if (refresh || pulseDirty) {
      appendNumberPayload(out, count, node.nodeId, "pulse", node.pulseCount);
    }
    if (refresh || effDryDirty) {
      appendNumberPayload(out, count, node.nodeId, "effdry", node.effDryPercent);
    }
    if (refresh || seasonDirty) {
      appendNumberPayload(out, count, node.nodeId, "season", node.season);
    }
    if (refresh || versionDirty) {
      char value[16];
      snprintf(value, sizeof(value), "%lu", static_cast<unsigned long>(node.fwVersion));
      appendNodePayload(out, count, node.nodeId, "ver", value);
    }
    return count;
  }

  // Drives keep-alives and the safety auto-release. Returns one due command per
  // call; call repeatedly until valid=false. Unsigned subtraction handles the
  // millis() wrap the same way decidePump does.
  Command tick(uint32_t now) {
    for (int i = 0; i < count_; i++) {
      Slot& s = slots_[i];
      if (!s.forced) continue;
      if (now - s.forcedAtMs >= maxForceMs_) {
        s.forced = false;
        return {true, s.nodeId, false};
      }
      if (now - s.lastSentMs >= refreshMs_) {
        s.lastSentMs = now;
        return {true, s.nodeId, true};
      }
    }
    return {false, 0, false};
  }

  // Change detection for the retained per-node topics: true means "publish now".
  // The first call for a node always reports a change so the broker gets seeded.
  bool pumpChanged(uint8_t nodeId, bool on) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    int8_t v = on ? 1 : 0;
    if (s->pumpPublished == v) return false;
    s->pumpPublished = v;
    return true;
  }

  bool onlineChanged(uint8_t nodeId, bool online) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    int8_t v = online ? 1 : 0;
    if (s->onlinePublished == v) return false;
    s->onlinePublished = v;
    return true;
  }

  // Change detection for the retained soil topic. Compares the rounded integer
  // percent (or -1 for invalid/NC) so a noisy capacitive probe does not flood
  // the broker on every 2 s status report; only a whole-percent change
  // republishes. Always publishes — including the NC state — so the app can
  // distinguish "probe NC" from "no data yet". -2 = never published.
  bool soilChanged(uint8_t nodeId, float percent, bool valid) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    int8_t v = valid ? static_cast<int8_t>(percent + 0.5f) : -1;
    if (s->soilPublished == v) return false;
    s->soilPublished = v;
    return true;
  }

  // Change detection for the diagnostic topics. Each republishes only on a value
  // transition so the 2 s cadence does not flood. statusPublished starts at -1
  // (never published) so the first report always seeds the broker. The numeric
  // ones use a sentinel that never collides with a real value (status is 0-7,
  // pulse 0-255, effdry 0-100, season 0-3, version 0+).
  bool statusChanged(uint8_t nodeId, uint8_t status) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    if (s->statusPublished == static_cast<int8_t>(status)) return false;
    s->statusPublished = static_cast<int8_t>(status);
    return true;
  }

  bool pulseChanged(uint8_t nodeId, uint8_t pulse) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    if (s->pulsePublished == pulse && s->pulseInit) return false;
    s->pulseInit = true;
    s->pulsePublished = pulse;
    return true;
  }

  bool effDryChanged(uint8_t nodeId, uint8_t effDry) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    if (s->effDryPublished == effDry && s->effDryInit) return false;
    s->effDryInit = true;
    s->effDryPublished = effDry;
    return true;
  }

  bool seasonChanged(uint8_t nodeId, uint8_t season) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    if (s->seasonPublished == season && s->seasonInit) return false;
    s->seasonInit = true;
    s->seasonPublished = season;
    return true;
  }

  bool versionChanged(uint8_t nodeId, uint32_t version) {
    Slot* s = findOrCreate(nodeId);
    if (!s) return false;
    if (s->versionPublished == version && s->versionInit) return false;
    s->versionInit = true;
    s->versionPublished = version;
    return true;
  }

  // The retained Timetable outcome record for one zone. False when there is nothing to
  // report: a Window sequence of 0 means the sub-node has no verdict yet, and publishing
  // `window=0` would invent a Window the author never wrote. `last` names the entry (its
  // index in the Window) and its fate, spelled the way the sub-node's serial line spells it.
  bool buildTimetableOutcomePayload(const NodeStatus& node, MqttPayload& out) const {
    if (node.ttOutcomeWindowSeq == 0) return false;
    snprintf(out.topic, sizeof(out.topic), "hydra/node%u/timetable/outcome", node.nodeId);
    snprintf(out.value, sizeof(out.value), "window=%lu;ran=%u;refused=%u;last=%u/%s",
             static_cast<unsigned long>(node.ttOutcomeWindowSeq),
             static_cast<unsigned>(node.ttRanCount),
             static_cast<unsigned>(node.ttRefusedCount),
             static_cast<unsigned>(node.ttOutcomeIndex),
             entryRefusalName(static_cast<EntryRefusal>(node.ttOutcomeCode)));
    return true;
  }

  // Publish-on-change for the outcome topic. The sub-node repeats its verdict on every
  // status report (~2 s), so comparing the whole verdict keeps the broker from flooding while
  // still republishing the instant a different entry is consumed. A zero Window is never a
  // transition: the retained record keeps the last real verdict rather than being cleared.
  bool outcomeChanged(const NodeStatus& node) {
    if (node.ttOutcomeWindowSeq == 0) return false;
    Slot* s = findOrCreate(node.nodeId);
    if (!s) return false;
    if (s->outcomeInit && s->outcomeWindowSeq == node.ttOutcomeWindowSeq &&
        s->outcomeIndex == node.ttOutcomeIndex && s->outcomeCode == node.ttOutcomeCode &&
        s->outcomeRan == node.ttRanCount && s->outcomeRefused == node.ttRefusedCount) {
      return false;
    }
    s->outcomeInit = true;
    s->outcomeWindowSeq = node.ttOutcomeWindowSeq;
    s->outcomeIndex = node.ttOutcomeIndex;
    s->outcomeCode = node.ttOutcomeCode;
    s->outcomeRan = node.ttRanCount;
    s->outcomeRefused = node.ttRefusedCount;
    return true;
  }

 private:
  static void copyPayload(MqttPayload& payload, const char* topic, const char* value) {
    copyMqttPayload(payload, topic, value);
  }

  static void appendNodePayload(MqttPayload out[kMaxSnapshotPayloads], int& count,
                                uint8_t nodeId, const char* leaf, const char* value) {
    buildNodeTopic(nodeId, leaf, out[count].topic, sizeof(out[count].topic));
    snprintf(out[count].value, sizeof(out[count].value), "%s", value);
    count++;
  }

  static void appendNumberPayload(MqttPayload out[kMaxSnapshotPayloads], int& count,
                                  uint8_t nodeId, const char* leaf, uint8_t value) {
    char text[4];
    snprintf(text, sizeof(text), "%u", value);
    appendNodePayload(out, count, nodeId, leaf, text);
  }

  struct Slot {
    uint8_t nodeId = 0;
    bool forced = false;
    uint32_t forcedAtMs = 0;
    uint32_t lastSentMs = 0;
    int8_t pumpPublished = -1;    // -1 = never published
    int8_t onlinePublished = -1;
    int8_t soilPublished = -2;    // -2 = never published; -1 = invalid/NC
    // Diagnostic change-detection state. statusPublished uses -1 = never
    // published (0 is a real PumpStatus::Idle); the rest carry an *Init flag
    // because 0 is a legitimate value for each.
    int8_t statusPublished = -1;
    uint8_t pulsePublished = 0;
    bool pulseInit = false;
    uint8_t effDryPublished = 0;
    bool effDryInit = false;
    uint8_t seasonPublished = 0;
    bool seasonInit = false;
    uint32_t versionPublished = 0;
    bool versionInit = false;
    // Publish-on-change state for the Timetable outcome topic. `outcomeInit` separates
    // "no verdict published yet" from the zero verdict a zone with nothing to report sends.
    uint32_t outcomeWindowSeq = 0;
    uint8_t outcomeIndex = 0;
    uint8_t outcomeCode = 0;
    uint8_t outcomeRan = 0;
    uint8_t outcomeRefused = 0;
    bool outcomeInit = false;
    // Anti-replay for the Supervisor's Timetables. `fleet_message.h` carries the Window
    // sequence but not the publisher's ordering, so the last accepted Window is remembered
    // per zone here; see parseTimetableDirective.
    uint32_t lastWindowSeq = 0;
    bool windowSeqInit = false;
  };

  Slot* findOrCreate(uint8_t nodeId) {
    for (int i = 0; i < count_; i++) {
      if (slots_[i].nodeId == nodeId) return &slots_[i];
    }
    if (count_ >= kMaxNodes) return nullptr;
    slots_[count_] = Slot{};
    slots_[count_].nodeId = nodeId;
    return &slots_[count_++];
  }

  uint32_t refreshMs_;
  uint32_t maxForceMs_;
  Slot slots_[kMaxNodes] = {};
  int count_ = 0;
};

}  // namespace hydra
