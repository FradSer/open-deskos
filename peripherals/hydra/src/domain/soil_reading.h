#pragma once

namespace hydra {

// A single soil-moisture sample. `raw` is the 12-bit ADC value (0..4095);
// `percent` is the calibrated 0..100 moisture level.
struct SoilReading {
  int raw;
  float percent;
  bool valid;
};

}  // namespace hydra
