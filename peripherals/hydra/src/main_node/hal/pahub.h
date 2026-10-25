#pragma once
#include <cstdint>

namespace hydra {

// Thin driver for the PaHub v2.1 (PCA9548A) I2C multiplexer. The PCA9548A
// channel register is a single byte where bit N enables channel N; selecting a
// channel is one I2C write (this is exactly what the M5Unit-HUB library does
// internally). begin() probes the hub by ACK; select() opens one channel, after
// which the caller talks to the downstream device on the shared `Wire` bus.
class PaHub {
 public:
  bool begin(uint8_t addr);
  bool select(uint8_t channel);

 private:
  uint8_t addr_ = 0;
  bool ready_ = false;
};

}  // namespace hydra
