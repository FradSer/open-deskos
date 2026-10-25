#pragma once
#include <cstdint>
#include <cstring>

#include "domain/fleet_message.h"
#include "domain/node_status.h"

namespace hydra {

// The main node's authoritative table of sub-nodes, keyed by MAC. Holds both the
// persistent identity (id <-> mac) and the latest volatile status. Pure -- no
// Arduino include -- so it links on the native test target; persistence to NVS is
// a thin HAL adapter (FleetStore) layered on serialize()/deserialize().
class FleetRoster {
 public:
  static constexpr int kMaxNodes = 6;
  // Persisted blob: count byte + per-entry {id, mac[6]}.
  static constexpr int kBlobSize = 1 + kMaxNodes * 7;

  int count() const { return count_; }
  const NodeStatus& at(int i) const { return nodes_[i]; }

  NodeStatus* find(const uint8_t mac[6]) {
    for (int i = 0; i < count_; i++) {
      if (memcmp(nodes_[i].mac, mac, 6) == 0) return &nodes_[i];
    }
    return nullptr;
  }

  NodeStatus* findById(uint8_t id) {
    for (int i = 0; i < count_; i++) {
      if (nodes_[i].nodeId == id) return &nodes_[i];
    }
    return nullptr;
  }

  // Pairing: find-or-create by MAC, returning the (fixed) node id. Re-pairing the
  // same device returns its existing id; a new device gets maxExistingId + 1 so a
  // number is never reused -- removing a plant never renumbers the others. Returns
  // 0 when the roster is full.
  uint8_t assign(const uint8_t mac[6], uint32_t now) {
    NodeStatus* n = findOrCreate(mac, 0);
    if (!n) return 0;
    n->lastSeenMs = now;
    return n->nodeId;
  }

  // Apply a StatusReport. Only provisioned nodes (id != 0) appear on the dashboard;
  // an unpaired node reports id 0 and is ignored until it is paired. A known id is
  // updated; an unknown-but-provisioned id is re-learned (resilience if the main's
  // NVS was wiped while the sub still remembers its id). Marks the node online.
  void applyStatus(const FleetMessage& m, uint32_t now) {
    if (m.nodeId == 0) return;  // unprovisioned: not on the dashboard until paired
    NodeStatus* n = findById(m.nodeId);
    if (!n) n = find(m.mac);
    if (!n) n = findOrCreate(m.mac, m.nodeId);
    if (!n) return;  // roster full
    n->nodeId = m.nodeId;  // keep id in sync with the device
    n->soil = SoilReading{m.soilRaw, m.soilPercent, m.soilValid != 0};
    n->status = static_cast<PumpStatus>(m.status);
    n->pulseCount = m.pulseCount;
    n->effDryPercent = m.effDryPercent;
    n->season = m.season;
    n->fwVersion = m.fwVersion;
    n->ttOutcomeWindowSeq = m.ttOutcomeWindowSeq;
    n->ttOutcomeIndex = m.ttOutcomeIndex;
    n->ttOutcomeCode = m.ttOutcomeCode;
    n->ttRanCount = m.ttRanCount;
    n->ttRefusedCount = m.ttRefusedCount;
    n->online = true;
    n->lastSeenMs = now;
  }

  // Mark nodes offline once their last report is older than the timeout. Unsigned
  // subtraction handles the millis() wrap the same way decidePump does.
  void tick(uint32_t now, uint32_t timeoutMs) {
    for (int i = 0; i < count_; i++) {
      if (now - nodes_[i].lastSeenMs > timeoutMs) nodes_[i].online = false;
    }
  }

  // Serialize the id <-> mac identities (not the volatile status) for NVS. Returns
  // the number of bytes written, 0 if the buffer is too small.
  int serialize(uint8_t* buf, int cap) const {
    if (cap < 1 + count_ * 7) return 0;
    int o = 0;
    buf[o++] = static_cast<uint8_t>(count_);
    for (int i = 0; i < count_; i++) {
      buf[o++] = nodes_[i].nodeId;
      memcpy(buf + o, nodes_[i].mac, 6);
      o += 6;
    }
    return o;
  }

  void deserialize(const uint8_t* buf, int len) {
    count_ = 0;
    if (len < 1) return;
    int n = buf[0];
    if (n > kMaxNodes) n = kMaxNodes;
    int o = 1;
    for (int i = 0; i < n && o + 7 <= len; i++) {
      NodeStatus& s = nodes_[count_++];
      s = NodeStatus{};
      s.nodeId = buf[o++];
      memcpy(s.mac, buf + o, 6);
      o += 6;
    }
  }

 private:
  uint8_t nextId() const {
    uint8_t id = 1;
    for (int i = 0; i < count_; i++) {
      if (nodes_[i].nodeId >= id) id = nodes_[i].nodeId + 1;
    }
    return id;
  }

  NodeStatus* findOrCreate(const uint8_t mac[6], uint8_t preferredId) {
    NodeStatus* n = find(mac);
    if (n) return n;
    if (count_ >= kMaxNodes) return nullptr;
    n = &nodes_[count_++];
    *n = NodeStatus{};
    memcpy(n->mac, mac, 6);
    n->nodeId = preferredId ? preferredId : nextId();
    return n;
  }

  NodeStatus nodes_[kMaxNodes] = {};
  int count_ = 0;
};

}  // namespace hydra
