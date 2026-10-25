#pragma once

namespace hydra::config {

constexpr int kZone1SoilPin = 1;
constexpr int kZone1PumpPin = 2;
constexpr bool kPumpActiveHigh = true;
constexpr int kSoilRawDry = 1743;
constexpr int kSoilRawWet = 1318;
constexpr int kSoilSamples = 21;
constexpr int kSoilMaxSpread = 120;
constexpr int kSoilInvalidThreshold = 3;
constexpr float kSoilEmaAlpha = 0.15f;
constexpr int kSoilSlewRateLimit = 15;

}  // namespace hydra::config
