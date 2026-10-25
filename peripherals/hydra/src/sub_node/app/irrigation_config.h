#pragma once

#include <cstdint>

#include "domain/irrigation_policy.h"

namespace hydra::config {

constexpr float kCriticalPercent = 35.0f;
constexpr uint32_t kPulseOnMs = 3000U;
constexpr uint32_t kPulseOffMs = 30000U;
constexpr IrrigationConfig kSeasonal[kSeasonCount] = {
    {55.0f, 73.0f, kCriticalPercent, 50000U, 9000000U, {kPulseOnMs, kPulseOffMs, 12}, false},
    {50.0f, 75.0f, kCriticalPercent, 60000U, 14400000U, {kPulseOnMs, kPulseOffMs, 10}, false},
    {45.0f, 65.0f, kCriticalPercent, 45000U, 10800000U, {kPulseOnMs, kPulseOffMs, 10}, false},
    {0.0f, 0.0f, 0.0f, 0U, 0U, {0U, 0U, 0}, true},
};

constexpr int kWateringStartHour = 6;
constexpr int kWateringEndHour = 21;
// CARE QUALITY, not economy. The plant's own guidance is "water in the morning and keep the
// foliage dry overnight": a free-moisture film through a warm humid night is the fungal
// infection window, and a substrate that stays wet through a low-evaporation night is the rot
// regime. So the device's OWN routine cycle only fires in the first part of the day, and the
// wide 06:00-21:00 gate is what a genuinely dry pot is still allowed to use. A Table is not
// subject to this: its author weighed the hour and `night` records what they chose.
constexpr int kRoutineWateringEndHour = 14;
// How far below the (env-modulated) trigger a pot must fall before the wide gate, rather than
// the morning window, applies to it. Deeper than this is not a pot that can wait until
// tomorrow: that is the drought-stress case, and drought stress costs growth.
constexpr float kDeepDryMarginPercent = 8.0f;
// At or just under the trigger, with absorption confirmed and a watering already in the recent
// past, the pot needs a nudge rather than a soak. This is the plant's own stated preference --
// a narrow band checked often beats a wide dry-then-soak swing -- expressed as a dose: the
// intent-to-profile table already knows what a top-up is (ADR-0002), so the policy only has to
// choose it. Wider gaps get the full profile, which is what rewets a root ball that has really
// dried out.
constexpr float kTopUpBandPercent = 5.0f;
constexpr uint32_t kTopUpRecentMs = 86400000U;  // watered within the last day
constexpr float kEfficacyMinDeltaPercent = 3.0f;
constexpr int kFaultAfterFailures = 3;
// How far above the modulated dry threshold the soil must come back before the zone is armed
// for another cycle. Without a margin the least noisy reading arms it, and a pot the probe
// cannot see being watered re-fires as soon as the minimum gap lapses.
constexpr float kRearmMarginPercent = 3.0f;
// How much lower a cycle stops when the last one did NOT show up on the probe. The wet cap is
// the rot-critical number and it is a reading of the substrate: when nothing has confirmed that
// this probe registers the water it is being given, "stop at 75 %" is a guess about a pot that
// may already be saturated. Ten points lower costs a little growth and buys the failure that is
// irreversible a margin instead. Recoverable either way: the next cycle with a confirmed
// absorption runs the full profile again.
constexpr float kUnconfirmedWetReductionPercent = 10.0f;
constexpr uint32_t kFaultRetryMs = 21600000U;
constexpr int kSoilHistorySize = 120;
constexpr uint32_t kDryRecordMs = 60000U;

}  // namespace hydra::config
