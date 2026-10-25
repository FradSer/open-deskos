#pragma once

#include "shared/ota_writer.h"

namespace hydra {

// Main-node self-update uses the shared LAN HTTP transfer and ESP OTA writer.
// Application code owns version persistence and reboot after a successful call.
class OtaUpdater {
 public:
  bool fetchAndFlash(const char* url, uint32_t expectedSize, const uint8_t expectedSha[32]);

 private:
  OtaWriter writer_;
};

}  // namespace hydra
