#pragma once
#include <cstdint>

// Pure VPD (Vapor Pressure Deficit) calculation with no hardware or Arduino
// dependencies. Used by the sub-node to modulate watering decisions based on
// env broadcasts from the main node.
//
// VPD = saturation vapor pressure - actual vapor pressure
// High VPD (>1.5 kPa) = dry air, plants transpire faster, water earlier
// Low VPD (<0.5 kPa) = humid air, plants transpire slower, water later
// Optimal for caladiums: 0.8-1.2 kPa (tropical understory)

namespace hydra {

// Tetens formula: saturation vapor pressure at temperature T (°C).
// Returns kPa. Accurate to ±0.1% for -20°C to +50°C.
// es(T) = 0.61078 * exp(17.27 * T / (T + 237.3))
inline float saturationVaporPressure(float tempC) {
  return 0.61078f * __builtin_expf(17.27f * tempC / (tempC + 237.3f));
}

// VPD = es - ea = es * (1 - RH/100), in kPa. Clamped to >=0: a capacitive RH
// sensor can momentarily read just over 100% in condensing air, which would
// otherwise yield a (physically meaningless) negative VPD.
inline float calculateVPD(float tempC, float humidityPercent) {
  float es = saturationVaporPressure(tempC);
  float vpd = es * (1.0f - humidityPercent / 100.0f);
  return vpd < 0.0f ? 0.0f : vpd;
}

}  // namespace hydra
