#pragma once

#include "domain/i_watering_zone.h"

namespace hydra {

// A watering point wired directly to MCU pins: an analog soil probe and a
// digital pump line. Raw ADC is mapped to 0..100% via the dry/wet calibration.
class GpioWateringZone : public IWateringZone {
 public:
  // ADC sampling and validity tuning. Defaults are conservative; override for
  // noisy chargers (more samples, wider spread, higher invalid threshold).
  struct AdcTuning {
    int sampleCount;
    int maxSpread;
    int invalidThreshold;
    float emaAlpha;      // EMA smoothing: lower = more smoothing (0.05-1.0)
    int slewRateLimit;   // max ADC counts per tick; clips noise spikes
    AdcTuning() : sampleCount(21), maxSpread(120), invalidThreshold(3),
                  emaAlpha(0.15f), slewRateLimit(15) {}
    AdcTuning(int n, int spread, int thresh, float alpha, int slew)
        : sampleCount(n), maxSpread(spread), invalidThreshold(thresh),
          emaAlpha(alpha), slewRateLimit(slew) {}
  };

  GpioWateringZone(int soilPin, int pumpPin, int rawDry, int rawWet,
                   bool activeHigh, AdcTuning adc = {})
      : soilPin_(soilPin),
        pumpPin_(pumpPin),
        rawDry_(rawDry),
        rawWet_(rawWet),
        activeHigh_(activeHigh),
        adc_(adc) {}
  bool begin() override;
  SoilReading readSoil() override;
  void pump(bool on) override;

 private:
  int soilPin_;
  int pumpPin_;
  int rawDry_;
  int rawWet_;
  bool activeHigh_;
  AdcTuning adc_;
  int invalidStreak_ = 0;
  SoilReading lastValidSoil_{0, 0.0f, false};
  float emaRaw_ = -1.0f;  // -1 = uninitialized
};

}  // namespace hydra
