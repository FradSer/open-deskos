#include "sub_node/hal/gpio_watering_zone.h"

#include <Arduino.h>

namespace hydra {

bool GpioWateringZone::begin() {
  pinMode(soilPin_, INPUT);
  pinMode(pumpPin_, OUTPUT);
  pump(false);  // drive the OFF level for this module's polarity
  return true;
}

SoilReading GpioWateringZone::readSoil() {
  // Dummy read to let the ADC MUX settle on the correct channel.
  // Without this, the first real sample can be off by 100-200 counts.
  analogRead(soilPin_);
  delay(10);

  const int n = adc_.sampleCount;
  int s[24];  // capped at 24 samples
  const int cnt = (n < 24) ? n : 24;
  for (int i = 0; i < cnt; i++) {
    s[i] = analogRead(soilPin_);
    if (i < cnt - 1) delay(5);
  }
  // Bubble sort for trimmed mean (reject outliers more aggressively than median)
  for (int i = 0; i < cnt - 1; i++) {
    for (int j = i + 1; j < cnt; j++) {
      if (s[i] > s[j]) { int t = s[i]; s[i] = s[j]; s[j] = t; }
    }
  }

  // Trimmed mean: drop lowest 2 and highest 2 (outliers), average the rest.
  // With 15 samples: drop s[0..1] and s[13..14], average s[2..12] (11 values).
  // This is more robust than median alone against persistent ripple.
  const int trimCount = (cnt > 4) ? 2 : 0;
  int sum = 0;
  int validCount = 0;
  for (int i = trimCount; i < cnt - trimCount; i++) {
    sum += s[i];
    validCount++;
  }
  int raw = (validCount > 0) ? (sum / validCount) : s[cnt / 2];

  // Validity: a connected capacitive probe gives stable readings. A floating
  // (disconnected) pin is erratic -- the spread between min and max samples
  // will be large. maxSpread is tunable: 120 tolerates cheap chargers while
  // still catching a truly disconnected probe (typically >150 spread).
  int spread = s[cnt - 1] - s[0];
  bool sampleValid = (spread <= adc_.maxSpread) && (raw >= 500) && (raw <= 3500);

  // Consecutive-invalid gating: a single noisy sample (cheap charger ripple)
  // won't flip the display to "-- NC". Only sustained bad data marks the zone
  // disconnected. Between glitches, return the last known-good reading.
  if (!sampleValid) {
    if (++invalidStreak_ < adc_.invalidThreshold) {
      return lastValidSoil_;  // transient noise, keep last good
    }
    float pct = 100.0f * float(rawDry_ - raw) / float(rawDry_ - rawWet_);
    if (pct < 0.0f) pct = 0.0f;
    if (pct > 100.0f) pct = 100.0f;
    return SoilReading{raw, pct, false};  // sustained bad -> NC
  }

  invalidStreak_ = 0;

  // Cross-tick EMA smoothing: persistent ripple survives per-sample median
  // filtering but gets averaged out over multiple ticks. Alpha controls how
  // much weight the new reading gets vs the smoothed history.
  // Lower alpha = more smoothing (0.1-0.3 good for noisy PSUs).
  if (emaRaw_ < 0.0f) {
    emaRaw_ = static_cast<float>(raw);  // first valid reading
  } else {
    emaRaw_ = adc_.emaAlpha * raw + (1.0f - adc_.emaAlpha) * emaRaw_;
  }
  int smoothedRaw = static_cast<int>(emaRaw_ + 0.5f);

  // Slew rate limiter: soil moisture changes slowly (seconds to minutes).
  // Any change > slewRateLimit counts per tick is physically impossible and
  // must be noise. Clamp the change to prevent residual jitter from slipping
  // through the EMA.
  if (lastValidSoil_.valid) {
    int delta = smoothedRaw - lastValidSoil_.raw;
    if (delta > adc_.slewRateLimit) {
      smoothedRaw = lastValidSoil_.raw + adc_.slewRateLimit;
    } else if (delta < -adc_.slewRateLimit) {
      smoothedRaw = lastValidSoil_.raw - adc_.slewRateLimit;
    }
    emaRaw_ = static_cast<float>(smoothedRaw);  // sync EMA to clamped value
  }

  float pct = 100.0f * float(rawDry_ - smoothedRaw) / float(rawDry_ - rawWet_);
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;

  lastValidSoil_ = SoilReading{smoothedRaw, pct, true};
  return lastValidSoil_;
}

void GpioWateringZone::pump(bool on) {
  bool level = activeHigh_ ? on : !on;
  digitalWrite(pumpPin_, level ? HIGH : LOW);
}

}  // namespace hydra
