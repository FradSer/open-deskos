#pragma once
#include <cstdint>

#include "domain/i_env_sensor.h"
#include "main_node/hal/pahub.h"

namespace hydra {

// ENV III (SHT30 temp/humidity + QMP6988 pressure) sitting behind a PaHub
// channel. Every access opens the channel first, then reads with the latest
// M5Unit-ENV drivers on the shared Wire bus.
class EnvIIISensor : public IEnvSensor {
 public:
  EnvIIISensor(PaHub& hub, uint8_t channel) : hub_(hub), channel_(channel) {}
  bool begin() override;
  EnvReading read() override;
  bool ready() const { return ok_; }

 private:
  PaHub& hub_;
  uint8_t channel_;
  bool ok_ = false;
};

}  // namespace hydra
