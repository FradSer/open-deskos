#pragma once

#include <cstdint>

#include "main_node/hal/pahub.h"

namespace hydra {

// Raw I2C driver for BH1750FVI ambient light sensor.
// I2C address: 0x23, measurement range: 1-65535 lux, resolution ~1 lux.
// Uses continuous high-resolution mode (command 0x10), ~120ms measurement time.
class BH1750Sensor {
 public:
  BH1750Sensor(PaHub& hub, uint8_t channel) : hub_(hub), channel_(channel) {}
  bool begin();
  bool read(float& lux);  // returns true on success, lux in range 1-65535
  bool ready() const { return initialized_; }

 private:
  PaHub& hub_;
  uint8_t channel_;
  bool initialized_ = false;
  static constexpr float kLuxDivider = 1.2f;  // datasheet: lux = raw / 1.2
};

}  // namespace hydra
