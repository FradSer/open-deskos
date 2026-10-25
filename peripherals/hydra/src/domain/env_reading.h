#pragma once

namespace hydra {

// A single environment sample from the ENV III unit + optional light sensor.
// `valid` is false until a good temp/humidity/pressure read has landed.
// `luxValid` is independent: true when lux read succeeded (BH1750 available).
struct EnvReading {
  float tempC;
  float humidity;
  float pressurePa;
  float lux;       // ambient light in lux (0-65535), 0 when unavailable
  bool valid;      // true when at least temp/humidity/pressure succeeded
  bool luxValid;   // true when lux read succeeded (independent of valid)
};

}  // namespace hydra
