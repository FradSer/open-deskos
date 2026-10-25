#include "main_node/hal/bh1750_sensor.h"

#include <Wire.h>

namespace hydra {

namespace {
constexpr uint8_t kBH1750Addr = 0x23;
constexpr uint8_t kContinuousHResMode = 0x10;  // 1 lx resolution, ~120ms
}  // namespace

bool BH1750Sensor::begin() {
  if (!hub_.select(channel_)) {
    return false;
  }
  Wire.beginTransmission(kBH1750Addr);
  Wire.write(kContinuousHResMode);
  initialized_ = (Wire.endTransmission() == 0);
  return initialized_;
}

bool BH1750Sensor::read(float& lux) {
  if (!initialized_ || !hub_.select(channel_)) {
    lux = 0;
    return false;
  }

  Wire.requestFrom(kBH1750Addr, (uint8_t)2);
  if (Wire.available() < 2) {
    lux = 0;
    return false;
  }

  uint16_t raw = Wire.read();
  raw <<= 8;
  raw |= Wire.read();

  lux = raw / kLuxDivider;
  return true;
}

}  // namespace hydra
