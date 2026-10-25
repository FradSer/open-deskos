#pragma once

#include "domain/env_reading.h"
#include "domain/i_env_sensor.h"
#include "main_node/hal/bh1750_sensor.h"
#include "main_node/hal/env_iii_sensor.h"

namespace hydra {

// Merges ENV III (temp/humidity/pressure on PaHub ch0) and BH1750 (lux on ch1)
// into a single EnvReading. Each child sensor owns its own PaHub channel
// selection. Partial failure: if BH1750 fails but ENV III succeeds, returns
// valid=true, luxValid=false.
class CompositeEnvSensor : public IEnvSensor {
 public:
  CompositeEnvSensor(EnvIIISensor& env, BH1750Sensor& light)
      : env_(env), light_(light) {}

  bool begin() override;
  EnvReading read() override;

 private:
  EnvIIISensor& env_;
  BH1750Sensor& light_;
};

}  // namespace hydra
