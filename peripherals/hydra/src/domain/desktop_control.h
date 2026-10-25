#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>
#include "domain/timetable.h"

namespace hydra {
constexpr size_t kControlBytes = 128;
constexpr size_t kControlSignedBytes = 96;
enum class ControlType : uint8_t { Query = 1, Challenge = 2, Water = 3, Stop = 4,
                                   Plan = 5, Ack = 6, Heartbeat = 7 };
enum class ControlCode : uint8_t { Accepted = 1, LeafInstalled = 2, LeafRejected = 3 };
struct ControlCrypto {
  void* context = nullptr;
  bool (*hmac)(void*, const uint8_t*, size_t, uint8_t[32]) = nullptr;
  bool (*random)(void*, uint8_t*, size_t) = nullptr;
};
inline uint64_t controlRead(const uint8_t* p, size_t count) {
  uint64_t value = 0;
  for (size_t i = 0; i < count; ++i) value |= uint64_t(p[i]) << (8 * i);
  return value;
}
inline void controlWrite(uint8_t* p, uint64_t value, size_t count) {
  for (size_t i = 0; i < count; ++i) p[i] = uint8_t(value >> (8 * i));
}
inline bool controlEqual(const uint8_t* a, const uint8_t* b, size_t size) {
  uint8_t diff = 0;
  for (size_t i = 0; i < size; ++i) diff |= a[i] ^ b[i];
  return diff == 0;
}
inline bool controlFuture(uint32_t deadline, uint32_t now, uint32_t bound) {
  uint32_t delta = deadline - now;
  return delta > 0 && delta <= bound;
}
struct ControlAction {
  bool valid = false;
  ControlType type = ControlType::Query;
  uint8_t node = 0;
  uint32_t durationMs = 0;
  Timetable plan{};
};

// All authentication runs in the main loop. The radio callback only copies bytes.
// One pending challenge, one cached result, and six independent finite leases.
class DesktopControl {
 public:
  bool begin(const uint8_t main[6], const uint8_t gateway[6], uint64_t boot,
             ControlCrypto crypto) {
    if (enabled_ || !main || !gateway || !boot || !crypto.hmac || !crypto.random ||
        (main[0] & 1) || (gateway[0] & 1)) return false;
    uint8_t anyMain = 0, anyGateway = 0;
    for (size_t i = 0; i < 6; ++i) { anyMain |= main[i]; anyGateway |= gateway[i]; }
    if (!anyMain || !anyGateway || controlEqual(main, gateway, 6)) return false;
    memcpy(main_, main, 6); memcpy(gateway_, gateway, 6);
    boot_ = boot; crypto_ = crypto; enabled_ = true;
    return true;
  }
  bool enabled() const { return enabled_; }
  uint64_t lastIssued() const { return issued_; }
  bool forced(uint8_t node, uint32_t now) const {
    if (node < 1 || node > 6) return false;
    const Lease& lease = leases_[node - 1];
    return lease.active && controlFuture(lease.end, now, 30000) &&
           now - lease.contact < 1000;
  }
  uint32_t leaseEnd(uint8_t node) const {
    return node >= 1 && node <= 6 ? leases_[node - 1].end : 0;
  }
  void expire(uint32_t now) {
    for (uint8_t n = 1; n <= 6; ++n) if (!forced(n, now)) leases_[n - 1].active = false;
  }
  bool receive(const uint8_t* input, size_t size, uint32_t now,
               uint8_t output[kControlBytes], ControlAction& action, bool physical = false) {
    action = {};
    if (!authenticate(input, size)) return false;
    const auto type = static_cast<ControlType>(input[4]);
    const uint64_t id = controlRead(input + 41, 8);
    const uint8_t length = input[53];
    if (type == ControlType::Query) {
      uint8_t zero[16] = {};
      if (length != 0 || controlRead(input + 17, 8) != 0 ||
          controlRead(input + 49, 4) != 0 || !controlEqual(input + 25, zero, 16)) return false;
      if (!id) {
        base(output, ControlType::Challenge, 0, nullptr, 0);
        output[53] = 8; controlWrite(output + 54, issued_, 8);
        return sign(output);
      }
      if (pending_ && id == issued_) {
        if (!controlFuture(deadline_, now, 5000)) return false;
      } else {
        if (id <= issued_) return false;
        issued_ = id; pending_ = false;
        if (!crypto_.random(crypto_.context, challenge_, sizeof(challenge_))) return false;
        uint8_t anyChallenge = 0;
        for (uint8_t byte : challenge_) anyChallenge |= byte;
        if (!anyChallenge) return false;
        deadline_ = now + 5000; pending_ = true;
      }
      base(output, ControlType::Challenge, id, challenge_, deadline_);
      output[53] = 8; controlWrite(output + 54, issued_, 8);
      return sign(output);
    }
    if (controlRead(input + 17, 8) != boot_) return false;
    if (type == ControlType::Heartbeat) {
      if (length != 5 || input[54] < 1 || input[54] > 6) return false;
      Lease& lease = leases_[input[54] - 1];
      uint32_t counter = controlRead(input + 55, 4);
      uint32_t expires = controlRead(input + 49, 4);
      if (!forced(input[54], now) || lease.id != id || !counter || counter <= lease.counter ||
          !controlEqual(input + 25, lease.challenge, 16) ||
          !controlFuture(expires, now, 1000) ||
          uint32_t(expires - now) > uint32_t(lease.end - now)) return false;
      lease.counter = counter; lease.contact = now;
      return false;  // authenticated liveness only; no action or ACK
    }
    if (cached_ && controlEqual(input, cachedRequest_, kControlBytes)) {
      memcpy(output, cachedReply_, kControlBytes); return true;
    }
    if (!id || !pending_ || id != issued_ ||
        controlRead(input + 49, 4) != deadline_ ||
        !controlFuture(deadline_, now, 5000) ||
        !controlEqual(input + 25, challenge_, 16)) return false;
    ControlAction next;
    next.node = input[54]; next.type = type;
    if (next.node < 1 || next.node > 6) return false;
    if (type == ControlType::Water) {
      if (length != 5) return false;
      next.durationMs = controlRead(input + 55, 4);
      if (!next.durationMs || next.durationMs > 30000) return false;
    } else if (type == ControlType::Stop) {
      if (length != 1) return false;
    } else if (type == ControlType::Plan) {
      if (length < 7) return false;
      next.plan.windowSeq = controlRead(input + 55, 4);
      next.plan.season = static_cast<Season>(input[59]); next.plan.count = input[60];
      if (!next.plan.windowSeq || next.plan.count > 4 || length != 7 + next.plan.count * 4 ||
          next.plan.windowSeq <= planSeq_[next.node - 1]) return false;
      for (uint8_t i = 0; i < next.plan.count; ++i) {
        const uint8_t* entry = input + 61 + i * 4;
        if (entry[3] > 1) return false;
        next.plan.entries[i] = {uint16_t(controlRead(entry, 2)),
                               static_cast<Plan>(entry[2]), entry[3] != 0};
      }
      if (validateTimetable(next.plan) != TimetableFault::Ok) return false;
    } else return false;
    // Produce the authenticated acceptance before admitting any state change.
    base(output, ControlType::Ack, id, challenge_, now + 5000);
    output[53] = 7; output[54] = next.node;
    output[55] = uint8_t(ControlCode::Accepted); output[56] = physical ? 1 : 0;
    const uint32_t end = type == ControlType::Water ? now + next.durationMs : 0;
    controlWrite(output + 57, end, 4);
    if (!sign(output)) return false;
    pending_ = false;
    if (type == ControlType::Water) {
      Lease& lease = leases_[next.node - 1];
      lease = {}; lease.active = true; lease.id = id; lease.end = end; lease.contact = now;
      memcpy(lease.challenge, challenge_, 16);
    } else if (type == ControlType::Stop) leases_[next.node - 1].active = false;
    else {
      planSeq_[next.node - 1] = next.plan.windowSeq;
      PlanObservation& observation = plans_[next.node - 1];
      observation.id = id; observation.table = next.plan;
      memcpy(observation.challenge, challenge_, 16);
    }
    next.valid = true; action = next;
    memcpy(cachedRequest_, input, kControlBytes); memcpy(cachedReply_, output, kControlBytes);
    cached_ = true;
    return true;
  }
  bool observePlan(uint8_t node, const Timetable& table, bool installed, uint32_t now,
                   bool physical, uint8_t output[kControlBytes]) const {
    if (!enabled_ || node < 1 || node > 6) return false;
    const PlanObservation& observed = plans_[node - 1];
    if (!observed.id || !samePlan(table, observed.table)) return false;
    base(output, ControlType::Ack, observed.id, observed.challenge, now + 5000);
    output[53] = 7; output[54] = node;
    output[55] = uint8_t(installed ? ControlCode::LeafInstalled : ControlCode::LeafRejected);
    output[56] = physical ? 1 : 0;
    return sign(output);
  }
  static bool samePlan(const Timetable& a, const Timetable& b) { return sameTimetable(a, b); }

 private:
  struct PlanObservation { uint64_t id = 0; uint8_t challenge[16]{}; Timetable table{}; };
  struct Lease {
    bool active = false;
    uint64_t id = 0;
    uint32_t end = 0, contact = 0, counter = 0;
    uint8_t challenge[16] = {};
  };
  bool authenticate(const uint8_t* input, size_t size) const {
    if (!enabled_ || !input || size != kControlBytes || memcmp(input, "HDC1", 4) ||
        !controlEqual(input + 5, main_, 6) || !controlEqual(input + 11, gateway_, 6) ||
        input[53] > 40) return false;
    for (size_t i = 54 + input[53]; i < kControlSignedBytes; ++i)
      if (input[i]) return false;
    uint8_t tag[32] = {};
    return crypto_.hmac(crypto_.context, input, kControlSignedBytes, tag) &&
           controlEqual(tag, input + kControlSignedBytes, sizeof(tag));
  }
  bool sign(uint8_t* out) const {
    return crypto_.hmac(crypto_.context, out, kControlSignedBytes, out + kControlSignedBytes);
  }
  void base(uint8_t* out, ControlType type, uint64_t id, const uint8_t* nonce,
            uint32_t deadline) const {
    memset(out, 0, kControlBytes); memcpy(out, "HDC1", 4); out[4] = uint8_t(type);
    memcpy(out + 5, main_, 6); memcpy(out + 11, gateway_, 6);
    controlWrite(out + 17, boot_, 8); if (nonce) memcpy(out + 25, nonce, 16);
    controlWrite(out + 41, id, 8); controlWrite(out + 49, deadline, 4);
  }
  bool enabled_ = false, pending_ = false, cached_ = false;
  ControlCrypto crypto_{};
  uint8_t main_[6] = {}, gateway_[6] = {}, challenge_[16] = {};
  uint64_t boot_ = 0, issued_ = 0;
  uint32_t deadline_ = 0, planSeq_[6] = {};
  Lease leases_[6]{};
  PlanObservation plans_[6]{};
  uint8_t cachedRequest_[kControlBytes]{}, cachedReply_[kControlBytes]{};
};
}  // namespace hydra
