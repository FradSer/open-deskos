#pragma once
#include <cstdint>

namespace hydra {

// The Supervisor's closed set of watering intentions (ADR-0002), and the contract
// for the code byte a Directive rides on the wire. A Plan is an intent, never
// pulse parameters: the device maps it to pulses beside its seasonal presets and
// clamps it with them, so every watering parameter stays in one place.
enum class Plan : uint8_t {
  Autonomous = 0,  // Release: hand the zone back to its own policy (ADR-0004)
  Hold = 1,        // do not water even though the soil may read dry
  TopUp = 2,       // a short replenishment
  Standard = 3,    // the seasonal pulse profile
  DeepSoak = 4,    // the seasonal profile with a longer soak between pulses
};

constexpr uint8_t kPlanCodeCount = 5;

// An unrecognised code leaves the zone untouched rather than guessing: a firmware
// that predates this vocabulary must not turn a stray byte into pump time.
inline bool isKnownPlan(uint8_t code) { return code < kPlanCodeCount; }

// Wire spelling of a Plan, used by the MQTT contract and the forwarding ack so
// both ends name the same intent without a second vocabulary.
inline const char* planName(Plan plan) {
  switch (plan) {
    case Plan::Autonomous: return "autonomous";
    case Plan::Hold: return "hold";
    case Plan::TopUp: return "top_up";
    case Plan::Standard: return "standard";
    case Plan::DeepSoak: return "deep_soak";
  }
  return "?";
}

}  // namespace hydra
