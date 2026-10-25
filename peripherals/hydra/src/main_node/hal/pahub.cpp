#include "main_node/hal/pahub.h"

#include <Wire.h>

namespace hydra {

bool PaHub::begin(uint8_t addr) {
  addr_ = addr;
  Wire.beginTransmission(addr_);
  ready_ = (Wire.endTransmission() == 0);
  return ready_;
}

bool PaHub::select(uint8_t channel) {
  if (!ready_ || channel > 7) return false;
  Wire.beginTransmission(addr_);
  Wire.write(static_cast<uint8_t>(1u << channel));
  return Wire.endTransmission() == 0;
}

}  // namespace hydra
