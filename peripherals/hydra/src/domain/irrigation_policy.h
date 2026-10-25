#pragma once
#include <cstdint>

#include "domain/i_clock.h"
#include "domain/plan.h"

// Pure irrigation decision logic with no hardware or Arduino dependencies, so
// it is unit-tested on the host (pio test -e native). Given a zone's config,
// its runtime state, and the latest soil reading, it returns what action to take.
//
// Pulse watering model: instead of one continuous pump run, water is delivered
// in short bursts (pulses) separated by soak pauses. This prevents runoff in
// fast-draining soil. A cycle consists of N pulses; it ends when the soil
// reaches wetPercent, all pulses are delivered, or a safety cap is hit.
//
// Seasonal awareness: caladiums are dormant in winter (Dec-Feb). The controller
// selects a seasonal config preset based on the current month and latches it
// at idle transitions only (never mid-cycle).

namespace hydra {

enum class Season { Spring, Summer, Autumn, Winter };

constexpr int kSeasonCount = 4;  // Spring, Summer, Autumn, Winter

// Map month (1-12) to season for caladium care in Shenzhen (subtropical).
// Shenzhen has a long hot-humid summer and short mild winter:
// Spring (Mar-Apr): ramp up after dormancy, warming up.
// Summer (May-Oct): peak growth, heavy watering, high evaporation.
// Autumn (Nov-Dec): taper off as temperatures cool.
// Winter (Jan-Feb): dormancy, no watering (Shenzhen winter is mild but
// caladiums still go dormant below ~15C).
inline Season seasonFromMonth(int month) {
  if (month >= 3 && month <= 4) return Season::Spring;
  if (month >= 5 && month <= 10) return Season::Summer;
  if (month >= 11 && month <= 12) return Season::Autumn;
  return Season::Winter;  // Jan, Feb
}

inline const char* seasonName(Season s) {
  switch (s) {
    case Season::Spring: return "SPRING";
    case Season::Summer: return "SUMMER";
    case Season::Autumn: return "AUTUMN";
    case Season::Winter: return "WINTER";
  }
  return "?";
}

struct PulseConfig {
  uint32_t pulseOnMs;   // duration of each pulse (pump ON)
  uint32_t pulseOffMs;  // soak time between pulses (pump OFF)
  int maxPulses;        // maximum pulses per cycle
};

// Time-of-day gate. Returns true only when the clock is valid AND the current
// hour is within [startHour, endHour). An invalid clock is treated as night, so
// routine watering waits for a trustworthy broadcast; critical dryness remains
// the controller's explicit override. WireClock advances only while the runtime's
// EnvBroadcast watchdog stays fresh. Pure so it is host-tested; the controller
// passes its clock + configured window from app/irrigation_config.h.
inline bool isWithinWateringWindow(const IClock& clock, int startHour, int endHour) {
  if (!clock.isValid()) return false;
  int hour = clock.currentHour();
  return hour >= startHour && hour < endHour;
}

// Autonomous watering gate. An unknown clock is deliberately treated as night:
// watering blind risks tuber rot. The caller may still pass critical dryness as a
// separate emergency override.

// The routine half of that gate: the hours in which the device's OWN cycle may fire without the
// pot being unusually dry. Care quality, not economy -- watering in the morning leaves the day's
// evaporation to dry the substrate back before the cool humid night that fungal infection and
// tuber rot live in. Pure, so the window itself is host-tested rather than trusted.
inline bool isRoutineWateringHour(int hour, int endHour) { return hour < endHour; }

// What the device's own policy asks for when it fires: a nudge or a soak. The narrow band the
// plant prefers is kept by dosing, not by lowering the trigger -- waiting for the pot to fall
// further is the wide swing the same guidance warns against. A pot that has NOT been watered
// recently, or whose last cycle the probe did not register, gets the full profile: a small dose
// into substrate that has genuinely dried out wets only the surface and channels past the root
// ball, which is the physics the pulse model exists for.
inline Plan autonomousPlan(float soilPercent, float effectiveDryPercent, bool absorptionConfirmed,
                           bool wateredRecently, float topUpBandPercent) {
  if (!absorptionConfirmed || !wateredRecently) return Plan::Standard;
  if (soilPercent < effectiveDryPercent - topUpBandPercent) return Plan::Standard;
  return Plan::TopUp;
}
inline bool isAutonomousWateringAllowed(const IClock& clock, int startHour, int endHour) {
  return isWithinWateringWindow(clock, startHour, endHour);
}

// Resolve the active season from the clock. An invalid clock (cold boot before
// the first EnvBroadcast) resolves to Summer -- NOT Winter. Summer keeps
// `disabled=false` and the real criticalPercent, so the critical-dry emergency
// override stays alive. Defaulting to Winter instead would set `disabled=true`
// and criticalPercent=0, which `decidePump` short-circuits before the critical
// override. Real winter (valid clock) still selects Winter/dormancy.
// The runtime invalidates WireClock after the EnvBroadcast stale window, so
// this fallback applies both before the first valid frame and after hub silence.
inline Season seasonFromClock(const IClock& clock) {
  if (!clock.isValid()) return Season::Summer;
  return seasonFromMonth(clock.currentMonth());
}

struct IrrigationConfig {
  float dryPercent;        // at/below this soil %, start a pulse cycle
  float wetPercent;        // at/above this soil %, cycle ends
  float criticalPercent;   // emergency: overrides time-of-day block
  uint32_t maxRunMs;       // safety: max accumulated ON time across all pulses
  uint32_t minIntervalMs;  // minimum gap between the end of one cycle and the next
  PulseConfig pulse;       // pulse timing parameters
  bool disabled;           // true = dormancy mode, no watering at all
};

enum class PumpPhase { Idle, PulseOn, PulseOff };

struct ZoneRuntime {
  PumpPhase phase;
  uint32_t pumpStartedAt;     // millis of the first PulseOn in current cycle
  uint32_t phaseStartedAt;    // millis when current phase began
  uint32_t lastCycleEndedAt;  // millis when last cycle ended (for cooldown)
  int pulseCount;             // pulses delivered in current cycle
  uint32_t accumulatedOnMs;   // total pump ON time in current cycle
  bool everStopped;           // false until first cycle ends (gates cooldown)
  float soilPercentStart;     // soil% at cycle start (for efficacy check)
  // The profile this cycle runs under, set at cycle start. Zero means "the seasonal
  // preset", which is what an autonomous cycle and `standard` both use; a Plan may
  // narrow the pulse cap or lengthen the soak without touching anything else.
  int cycleMaxPulses = 0;
  uint32_t cycleSoakMs = 0;
  // ARMED: a new cycle may start only once the soil has recovered above the trigger since the
  // last one ended. A pot whose probe never sees the water is disarmed by its own cycle and
  // stays disarmed, instead of firing again every time the minimum gap lapses -- which is how
  // one field zone came to be watered four times in a day with the probe moving +0.5, 0.0 and
  // -0.2 %. Critical dryness ignores this: a pot that far down is not left waiting on a
  // recovery that may be the very thing that is broken.
  bool armed = true;
};

enum class PumpAction { None, PulseOn, PulseOff, EndCycle, AbortCycle };

// The remote slice of env context: what the main node computes and broadcasts.
// The sub-node fuses this with its own locally-derived drying rate to build the
// full EnvContext. `valid` is false when no fresh broadcast has arrived -- main
// node absent or stale -- in which case the VPD/lux modulators stand down but the
// local drying-rate modulator (below) keeps working.
struct RemoteEnv {
  float vpdKpa;  // vapor pressure deficit (kPa), derived on the main node
  float lux;     // ambient light level (lux)
  bool valid;    // wire env is fresh (a broadcast landed within the stale window)
};

inline RemoteEnv defaultRemoteEnv() { return RemoteEnv{0.0f, 0.0f, false}; }

// The full environmental context decidePump modulates on. Two independently-valid
// halves: the wire-sourced env (VPD/lux, gated by envValid) and the locally-owned
// drying rate (gated by dryingValid). Splitting the validity is deliberate -- a
// down main node must not silence a sub-node's own local signal.
struct EnvContext {
  float vpdKpa;       // wire: vapor pressure deficit (kPa)
  float lux;          // wire: ambient light level (lux)
  float dryingRate;   // local: soil % change per hour (negative = drying)
  bool envValid;      // wire env (VPD/lux) is fresh
  bool dryingValid;   // local drying-rate signal is available
};

// Default env context: no modulation (watering uses base config only).
inline EnvContext defaultEnvContext() {
  return EnvContext{0.0f, 0.0f, 0.0f, false, false};
}

// Modulate the base dryPercent based on environmental conditions.
// High VPD (dry air) → water earlier (raise dryPercent).
// Low VPD (humid air) → water later (lower dryPercent).
// Low light (night/dim) → reduce watering (lower dryPercent).
// Fast drying (plant drinking) → water earlier (raise dryPercent).
// Env modulation tuning constants. Kept in the domain layer alongside the
// algorithm they parameterise, so the pure policy stays self-contained and
// host-testable without pulling in the hardware config.
namespace env_mod {
constexpr float kVpdHigh = 1.5f;       // kPa: above = dry air, water earlier
constexpr float kVpdLow = 0.5f;        // kPa: below = humid, water later
constexpr float kVpdHighDelta = 5.0f;  // % raise dryPercent at high VPD
constexpr float kVpdLowDelta = 3.0f;   // % lower dryPercent at low VPD
constexpr float kLuxLow = 1000.0f;     // lux: below = dim/night, reduce watering
constexpr float kLuxLowDelta = 5.0f;   // % lower dryPercent in dim light
// Drying-rate modulation: what the pot is actually losing, in %/hr (negative = drying).
// These were a STEP at -5 %/hr, and this fleet's pots dry at 0.2-0.4 %/hr, so the term was
// identically zero: the only thing left moving the threshold was the VPD step that flaps
// across 1.5 kPa, which is how the trigger became noise rather than a drying signal.
constexpr float kDryRateFloor = -0.15f;    // %/hr: below this the pot is really drying
constexpr float kDryRatePerUnit = 10.0f;   // +1 % dryPercent per 0.1 %/hr past the floor
constexpr float kDryRateDeltaMax = 3.0f;   // %: cap, so one noisy slope cannot move it far
}  // namespace env_mod

inline float modulateDryPercent(float baseDryPercent, const EnvContext& env) {
  float adjusted = baseDryPercent;

  // Wire-sourced env (VPD, lux): only when the main node's broadcast is fresh.
  if (env.envValid) {
    // VPD modulation: high VPD = dry air, water earlier
    if (env.vpdKpa > env_mod::kVpdHigh) {
      adjusted += env_mod::kVpdHighDelta;
    } else if (env.vpdKpa < env_mod::kVpdLow) {
      adjusted -= env_mod::kVpdLowDelta;
    }

    // Lux modulation: low light = reduce watering (plants transpire less)
    if (env.lux < env_mod::kLuxLow && env.lux >= 0.0f) {
      adjusted -= env_mod::kLuxLowDelta;
    }
  }

  // Drying-rate modulation: a local, per-zone signal, gated only by its own validity so it
  // keeps working when the main node is offline -- the sub-node stays autonomous. Fast drying
  // = plant drinking heavily, water earlier. PROPORTIONAL rather than a step: a pot at
  // -0.27 %/hr raises its own dry threshold by 1.2 %, so the water arrives while the pot is
  // still in band instead of only after it has fallen to the bottom of it.
  if (env.dryingValid && env.dryingRate < env_mod::kDryRateFloor) {
    float raised = (-env.dryingRate + env_mod::kDryRateFloor) * env_mod::kDryRatePerUnit;
    if (raised > env_mod::kDryRateDeltaMax) raised = env_mod::kDryRateDeltaMax;
    if (raised < 0.0f) raised = 0.0f;
    adjusted += raised;
  }

  // THE BAND EDGE IS A FLOOR. `baseDryPercent` is the seasonal band's own dry edge -- what the
  // plant needs -- and everything above this line is our best guess at wanting it EARLIER: a
  // hot dry afternoon, a pot losing water fast. None of those sensors may push the trigger
  // BELOW the plant's edge, because "the air is humid" and "the light is dim" are statements
  // about evaporation, not about how dry the substrate is. Left unclamped they did exactly
  // that: on a dim humid morning the trigger read 45 % against a band edge of 50, and a pot at
  // 47.3 % -- already BELOW the edge -- satisfied neither the device (47.3 > 45) nor, as it
  // happened, the author. A pot below its band edge is the one case nothing may decline.
  if (adjusted < baseDryPercent) adjusted = baseDryPercent;

  return adjusted;
}

// Efficacy / fault detection tuning. A capacitive probe is noisy and lags behind
// watering, so a single under-performing cycle is never enough to fault: the
// controller counts consecutive weak cycles (separated by hours of cooldown,
// which gives the soil time to settle) and only faults after the streak reaches
// maxConsecutiveFailures.
struct FaultConfig {
  float minDeltaPercent;       // soil rise below this counts as a weak cycle
  int maxConsecutiveFailures;  // fault flags only after this many in a row
};

enum class CycleEfficacy { Ok, Failed, Unjudged };

// Pure judgment of a just-ended cycle. Unjudged when the sensor was invalid or
// no pulses ran (the controller leaves the streak untouched); Failed when the
// soil rose less than minDeltaPercent; otherwise Ok.
//
// Judges against `soilPeak` -- the highest valid reading observed during the
// cycle -- NOT the reading at EndCycle. Water delivered in the 3 s pulses often
// has not percolated to the probe depth by cycle end (capacitive-probe lag + EMA
// smoothing time constant), so the EndCycle reading is a trough that underreports
// the rise. The peak captures "did any water reach the probe this cycle" and
// survives the lag. A truly dead pump/probe produces no peak and still faults.
inline CycleEfficacy evaluateCycle(const FaultConfig& fc, float soilStart, float soilPeak,
                                   bool soilValid, int pulseCount) {
  if (!soilValid || pulseCount <= 0) return CycleEfficacy::Unjudged;
  return (soilPeak - soilStart) < fc.minDeltaPercent ? CycleEfficacy::Failed : CycleEfficacy::Ok;
}

// The pulse-profile vocabulary a Plan is expressed in, defined here because
// `decidePump` reads the cycle's profile and because the table belongs beside the
// presets rather than on the NAS (ADR-0002).

// A Plan that asks for water. `hold` and `autonomous` ask for none: holding is the
// Supervisor withholding a cycle, and releasing hands the trigger back to the device's
// own policy.
inline bool planWaters(Plan plan) { return plan != Plan::Autonomous && plan != Plan::Hold; }

// The profile one Plan asks for, clamped by the seasonal preset so no Plan can exceed
// it. `top_up` narrows the count; `deep_soak` keeps the count and doubles the soak, so it
// differs from `standard` by soak time whenever the seasonal count is already at the
// preset's maximum. The run-time cap needs no clause here: the pulse engine enforces
// `maxRunMs` on every cycle, whatever profile started it.
struct PlanProfile {
  int maxPulses;
  uint32_t soakMs;
};

inline PlanProfile planProfile(Plan plan, const IrrigationConfig& cfg) {
  PlanProfile profile{cfg.pulse.maxPulses, cfg.pulse.pulseOffMs};
  if (plan == Plan::TopUp && profile.maxPulses > 2) profile.maxPulses = 2;
  if (plan == Plan::DeepSoak) profile.soakMs = profile.soakMs * 2;
  return profile;
}

// The profile in force for a running cycle: the one set at its start, or the seasonal
// preset when nothing set one -- an autonomous cycle, or a runtime a fixture built by
// hand. Zero is the "seasonal" sentinel rather than a plan's own value, so a fixture
// that predates the profile keeps behaving exactly as it did.
inline int cycleMaxPulses(const IrrigationConfig& cfg, const ZoneRuntime& rt) {
  return rt.cycleMaxPulses > 0 ? rt.cycleMaxPulses : cfg.pulse.maxPulses;
}

inline uint32_t cycleSoakMs(const IrrigationConfig& cfg, const ZoneRuntime& rt) {
  return rt.cycleSoakMs > 0 ? rt.cycleSoakMs : cfg.pulse.pulseOffMs;
}

// --- Supervision: deleted ------------------------------------------------------

// `SupervisionInputs`, `Supervision`, `supervision()`, `kSupervisionTimeoutMs` and
// `kSupervisionStallMs` are gone (ADR-0006). Authority is no longer derived from network
// liveness: a Timetable owns a zone's routine trigger for the length of its Window, and
// the Window is bounded, so there is nothing left for a heartbeat, a stand-down flag or a
// stall guard to decide. The trigger question is answered by which procedure runs -- the
// Timetable executor for a held Window, this threshold loop otherwise -- so `decidePump`
// needs no opinion about authority and takes no boolean for it.

// `now` is a millis() timestamp; unsigned subtraction handles the ~49-day wrap
// correctly. An invalid soil reading is fail-safe: never start, and end a
// running cycle. `wateringAllowed` is precomputed by the controller: on the fallback
// path it is the clock's time-of-day gate, and while a Timetable owns the trigger it is
// the critical-dryness override alone, because a live Window has already weighed the
// hour. Passing the override rather than skipping this call is what keeps the emergency
// reachable inside a Window (ADR-0004's actuator limit).
// A normal transition into nighttime preserves an
// active cycle, but `abortNonCriticalCycle` (set when trusted clock time becomes
// stale) ends a running cycle unless the current soil reading is critical.
// `env` modulates the base dryPercent based on environmental conditions (VPD,
// light, drying rate).
//
// `selfTriggerAllowed` is deleted with the rest of the supervision vocabulary: a
// Timetable owning the trigger is expressed by the executor not asking this question at
// all, so the engine keeps no opinion about authority and no boolean carries one.
//
// The default means "no Supervisor opinion", which is the device's behaviour before this
// feature existed.
inline PumpAction decidePump(const IrrigationConfig& cfg, const ZoneRuntime& rt,
                             float soilPercent, bool soilValid, uint32_t now,
                             bool wateringAllowed, bool abortNonCriticalCycle,
                             const EnvContext& env) {
  // Dormancy takes precedence over every active-cycle rule, including the
  // critical-dry stale-clock exception: a winter cycle must never continue.
  if (cfg.disabled) {
    return rt.phase == PumpPhase::Idle ? PumpAction::None : PumpAction::EndCycle;
  }

  bool criticalDry = soilValid && soilPercent <= cfg.criticalPercent;
  // --- Active cycle (PulseOn or PulseOff) ---
  if (rt.phase == PumpPhase::PulseOn) {
    if (abortNonCriticalCycle && soilValid && !criticalDry) return PumpAction::AbortCycle;
    if (!soilValid) return PumpAction::EndCycle;
    if (rt.accumulatedOnMs + (now - rt.phaseStartedAt) >= cfg.maxRunMs)
      return PumpAction::EndCycle;
    if (soilPercent >= cfg.wetPercent) return PumpAction::EndCycle;
    if (now - rt.phaseStartedAt >= cfg.pulse.pulseOnMs) return PumpAction::PulseOff;
    return PumpAction::None;
  }

  if (rt.phase == PumpPhase::PulseOff) {
    if (abortNonCriticalCycle && soilValid && !criticalDry) return PumpAction::AbortCycle;
    if (!soilValid) return PumpAction::EndCycle;
    if (soilPercent >= cfg.wetPercent) return PumpAction::EndCycle;
    if (rt.pulseCount >= cycleMaxPulses(cfg, rt)) return PumpAction::EndCycle;
    if (rt.accumulatedOnMs >= cfg.maxRunMs) return PumpAction::EndCycle;
    if (now - rt.phaseStartedAt >= cycleSoakMs(cfg, rt)) return PumpAction::PulseOn;
    return PumpAction::None;
  }

  // --- Idle ---
  if (!wateringAllowed) return PumpAction::None;
  if (!soilValid) return PumpAction::None;
  // Disarmed: the last cycle did not lift the soil above the trigger, so repeating it would
  // only add water the pot is not taking up. Re-armed by the controller on recovery.
  if (!rt.armed && !criticalDry) return PumpAction::None;

  // Modulate dryPercent based on env context
  float effectiveDry = modulateDryPercent(cfg.dryPercent, env);
  if (soilPercent > effectiveDry) return PumpAction::None;
  if (rt.everStopped && now - rt.lastCycleEndedAt < cfg.minIntervalMs)
    return PumpAction::None;
  return PumpAction::PulseOn;
}

// `decidePlan` is gone with the Directive it served (ADR-0006). A Timetable entry is
// judged by the executor's own `step`, which applies the same four Actuator limits --
// dormancy, the probe, a manual force and the inter-cycle gap -- and consumes the entry
// whether it runs or not. There is no second predicate beside `decidePump` any more, so
// there is one place where "may this cycle start?" is answered for a tabulated entry.

}  // namespace hydra
