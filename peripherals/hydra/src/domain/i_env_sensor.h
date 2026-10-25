#pragma once
#include "env_reading.h"

namespace hydra {

// Environment sensor abstraction. The application depends on this, not on the
// concrete ENV III + PaHub wiring.
class IEnvSensor {
 public:
  virtual ~IEnvSensor() = default;
  virtual bool begin() = 0;
  virtual EnvReading read() = 0;
};

}  // namespace hydra
