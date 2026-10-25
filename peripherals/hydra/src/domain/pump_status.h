#pragma once
#include <cstdint>

#include "irrigation_policy.h"  // PumpPhase

namespace hydra {

// The single operating state of a watering node, derived in exactly one place from
// the controller's primitives and shared by every display and the fleet wire
// protocol. (Offline is not here -- it is a fleet-level fact the main node adds from
// NodeStatus.online.) Pure, so it is host-tested like decidePump.
enum class PumpStatus : uint8_t {
  Idle,      // auto mode, ready, not pumping
  Pulse,     // auto cycle: pump on
  Soak,      // auto cycle: soaking between pulses
  Watering,  // manual / remote forced pump
  Paused,    // user-paused
  Wait,      // blocked by the time-of-day gate
  Dormant,   // seasonal dormancy (no watering)
  Fault,     // efficacy fault
};

// One priority ladder -- the single source of truth for "what is this zone doing".
// A forced pump outranks paused: a manual pump sets paused=true while driving the
// pin, and conflating those two is exactly what made watering show up as PAUSE
// before this existed.
inline PumpStatus derivePumpStatus(bool fault, bool forced, PumpPhase phase,
                                   bool paused, bool disabled, bool timeBlocked) {
  if (fault) return PumpStatus::Fault;
  if (forced) return PumpStatus::Watering;
  if (phase == PumpPhase::PulseOn) return PumpStatus::Pulse;
  if (phase == PumpPhase::PulseOff) return PumpStatus::Soak;
  if (paused) return PumpStatus::Paused;
  if (disabled) return PumpStatus::Dormant;
  if (timeBlocked) return PumpStatus::Wait;
  return PumpStatus::Idle;
}

// Short ASCII label for any display (no M5GFX dependency; colours live in the
// display layer because they need TFT_* constants).
inline const char* pumpStatusLabel(PumpStatus s) {
  switch (s) {
    case PumpStatus::Idle: return "IDLE";
    case PumpStatus::Pulse: return "PULSE";
    case PumpStatus::Soak: return "SOAK";
    case PumpStatus::Watering: return "WATER";
    case PumpStatus::Paused: return "PAUSE";
    case PumpStatus::Wait: return "WAIT";
    case PumpStatus::Dormant: return "DORM";
    case PumpStatus::Fault: return "FAULT";
  }
  return "?";
}

}  // namespace hydra
