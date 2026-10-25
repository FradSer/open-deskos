#pragma once

#include <cstdint>

#include "shared/config.h"

namespace hydra::config {

constexpr uint32_t kChannelSilenceTimeoutMs = 15000U;
constexpr uint32_t kChannelScanDwellMs = 700U;
constexpr uint32_t kButtonHoldMs = 250U;
constexpr uint32_t kPairRequestMs = 500U;
constexpr uint32_t kPairTimeoutMs = 30000U;
constexpr uint32_t kRemoteForceTimeoutMs = 1000U;
constexpr uint32_t kSpotlightTimeoutMs = 3000U;
constexpr uint32_t kStatusBroadcastMs = 2000U;
constexpr uint32_t kTickMs = 1000U;
constexpr uint32_t kEnvStaleMs = 180000U;

}  // namespace hydra::config
