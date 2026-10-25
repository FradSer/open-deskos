#pragma once
#include <cstdint>

#include "domain/pump_status.h"

namespace hydra {

// RGB565 colour for each operating status, shared by every display so the look is
// consistent. Kept as plain values (no M5GFX dependency) -- they match the TFT_*
// constants the displays use elsewhere. Labels come from the pure pumpStatusLabel;
// only the colours live here, in the app/presentation layer.
inline uint16_t statusColor(PumpStatus s) {
  switch (s) {
    case PumpStatus::Watering: return 0x07FF;  // cyan
    case PumpStatus::Pulse: return 0x07E0;     // green
    case PumpStatus::Soak: return 0xFFE0;      // yellow
    case PumpStatus::Fault: return 0xF800;     // red
    case PumpStatus::Paused: return 0xFDA0;    // amber
    case PumpStatus::Wait: return 0xFDA0;      // amber
    case PumpStatus::Dormant: return 0x7BEF;   // grey
    case PumpStatus::Idle: return 0x7BEF;      // grey
  }
  return 0x7BEF;
}

}  // namespace hydra
