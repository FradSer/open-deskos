#pragma once

#include "domain/env_reading.h"
#include "domain/vpd.h"

// Structured environment metrics, computed once on the main node from a raw
// EnvReading. This is the atomic data contract the sensor hub publishes to its
// consumers: sub-nodes over ESP-NOW and HomeKit over MQTT. Derived metrics (VPD
// today; dew point / PPFD / DLI later) are calculated here, in one place, so the
// algorithms live only on the node that owns the sensors. Consumers read the
// finished values and never recompute -- the watering logic on a sub-node stays
// decoupled from the environment math.
//
// Pure: no Arduino, no hardware. Host-tested like the rest of the domain layer.

namespace hydra {

struct EnvMetrics {
  // Raw measurements, passed through from the reading.
  float tempC;
  float humidity;
  float pressurePa;
  float lux;

  // Derived metrics, computed once here. Extend this block as new sensors land
  // (dew point, PPFD, DLI) -- consumers gain fields without learning algorithms.
  float vpdKpa;  // vapor pressure deficit (kPa), from T + RH

  bool valid;     // core temp/humidity/pressure reading succeeded
  bool luxValid;  // lux read succeeded (independent of valid)
};

// Compute the structured metrics from a raw reading. Derived values are only
// meaningful when the core reading is valid; an invalid reading yields zeroed
// metrics so a stale broadcast can never look authoritative.
inline EnvMetrics computeEnvMetrics(const EnvReading& e) {
  EnvMetrics m{};
  m.tempC = e.tempC;
  m.humidity = e.humidity;
  m.pressurePa = e.pressurePa;
  m.lux = e.lux;
  m.valid = e.valid;
  m.luxValid = e.luxValid;
  if (e.valid) {
    m.vpdKpa = calculateVPD(e.tempC, e.humidity);
  }
  return m;
}

}  // namespace hydra
