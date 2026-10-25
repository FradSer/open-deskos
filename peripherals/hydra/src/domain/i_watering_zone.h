#pragma once
#include "soil_reading.h"

namespace hydra {

// One irrigation point: a soil probe plus the pump that waters it. The
// controller drives any number of these through this interface, so a future
// PbHub-backed multi-zone implementation drops in without touching the policy
// or the controller.
class IWateringZone {
 public:
  virtual ~IWateringZone() = default;
  virtual bool begin() = 0;
  virtual SoilReading readSoil() = 0;
  virtual void pump(bool on) = 0;
};

}  // namespace hydra
