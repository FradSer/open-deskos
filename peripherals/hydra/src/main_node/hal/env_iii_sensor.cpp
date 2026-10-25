#include "main_node/hal/env_iii_sensor.h"

#include <Wire.h>
#include <M5UnitENV.h>

#include "main_node/config.h"

namespace hydra {
namespace {
SHT3X g_sht;
QMP6988 g_qmp;
}  // namespace

bool EnvIIISensor::begin() {
  if (!hub_.select(channel_)) return false;
  bool qmp = g_qmp.begin(&Wire, QMP6988_SLAVE_ADDRESS_L, config::kI2cSda, config::kI2cScl,
                         config::kI2cFreq);
  bool sht = g_sht.begin(&Wire, SHT3X_I2C_ADDR, config::kI2cSda, config::kI2cScl, config::kI2cFreq);
  ok_ = qmp && sht;
  return ok_;
}

EnvReading EnvIIISensor::read() {
  EnvReading r{};
  if (!ok_ || !hub_.select(channel_)) return r;
  bool got = false;
  if (g_sht.update()) {
    r.tempC = g_sht.cTemp;
    r.humidity = g_sht.humidity;
    got = true;
  }
  if (g_qmp.update()) {
    r.pressurePa = g_qmp.pressure;
    got = true;
  }
  r.valid = got;
  return r;
}

}  // namespace hydra
