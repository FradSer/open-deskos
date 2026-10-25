#include "main_node/hal/composite_env_sensor.h"

namespace hydra {

bool CompositeEnvSensor::begin() {
  bool envOk = env_.begin();
  bool lightOk = light_.begin();
  return envOk || lightOk;  // success if at least one sensor works
}

EnvReading CompositeEnvSensor::read() {
  EnvReading r{};

  // Read ENV III (handles its own PaHub channel selection)
  if (env_.ready()) {
    EnvReading env = env_.read();
    if (env.valid) {
      r.tempC = env.tempC;
      r.humidity = env.humidity;
      r.pressurePa = env.pressurePa;
      r.valid = true;
    }
  }

  // Read BH1750 (handles its own PaHub channel selection)
  if (light_.ready()) {
    float lux;
    if (light_.read(lux)) {
      r.lux = lux;
      r.luxValid = true;
    }
  }

  return r;
}

}  // namespace hydra
