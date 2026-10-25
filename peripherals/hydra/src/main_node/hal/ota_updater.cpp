#include "main_node/hal/ota_updater.h"

#include "shared/ota_transfer.h"

namespace hydra {

bool OtaUpdater::fetchAndFlash(const char* url, uint32_t expectedSize,
                               const uint8_t expectedSha[32]) {
  return transferOtaHttp(url, expectedSize, expectedSha, writer_);
}

}  // namespace hydra
