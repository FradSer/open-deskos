#pragma once
#include <cstdint>

// Pure soil-moisture history + drying-rate derivation. No Arduino, no hardware,
// no config -- the window size is a template parameter so the owning layer (the
// IrrigationController) picks it. Host-tested like the rest of the domain.
//
// Drying rate is the per-zone signal "how fast is this plant drinking?": the
// slope of soil% over the window, in %/hour. Negative = drying, positive =
// wetting. It is a LOCAL property of a zone -- it needs no main node -- so the
// sub-node derives it itself and keeps using it even when the hub is offline.

namespace hydra {

struct SoilSample {
  float percent;
  uint32_t atMs;
};

template <int N>
class SoilHistory {
 public:
  // Append a sample. The caller throttles cadence (e.g. one per minute); this
  // just rings the buffer.
  void record(float percent, uint32_t atMs) {
    samples_[head_] = {percent, atMs};
    head_ = (head_ + 1) % N;
    if (count_ < N) count_++;
  }

  // True once there are enough samples to derive a rate.
  bool valid() const { return count_ >= 2; }

  // Least-squares slope of soil% over the whole window, in %/hour: using every
  // sample keeps the rate steady on a jittery probe where two lone endpoints would
  // swing it. Returns 0 with fewer than two samples or a span below minSpanMs. Times
  // are oldest-relative (unsigned subtraction) so the ~49-day millis() wrap is handled.
  float dryingRate(uint32_t minSpanMs = 60000) const {
    if (count_ < 2) return 0.0f;
    int oldest = (head_ - count_ + N) % N;
    int newest = (head_ - 1 + N) % N;
    uint32_t span = samples_[newest].atMs - samples_[oldest].atMs;
    if (span < minSpanMs) return 0.0f;
    uint32_t base = samples_[oldest].atMs;
    double sumT = 0, sumY = 0, sumTY = 0, sumTT = 0;
    for (int k = 0; k < count_; k++) {
      int idx = (oldest + k) % N;
      double t = static_cast<double>(samples_[idx].atMs - base);  // ms since oldest
      double y = samples_[idx].percent;
      sumT += t;
      sumY += y;
      sumTY += t * y;
      sumTT += t * t;
    }
    double n = count_;
    double slopePerMs = (n * sumTY - sumT * sumY) / (n * sumTT - sumT * sumT);
    return static_cast<float>(slopePerMs * 3600000.0);  // %/ms -> %/h
  }

 private:
  SoilSample samples_[N] = {};
  int head_ = 0;
  int count_ = 0;
};

}  // namespace hydra
