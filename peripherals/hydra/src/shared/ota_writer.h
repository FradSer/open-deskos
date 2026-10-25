#pragma once

#include <cstddef>
#include <cstdint>

#include "domain/ota_session.h"

namespace hydra {

// Shared ESP OTA flash writer. It owns standby partition selection, streaming
// SHA-256, exactly-once abort cleanup before finalization, and boot selection.
class OtaWriter {
 public:
  bool begin(size_t expectedSize);
  bool write(const uint8_t* data, size_t len);
  bool finish(const uint8_t expectedSha[32]);
  void abort();

 private:
  OtaSession session_;
  void* handle_ = nullptr;
  void* mdContext_ = nullptr;
};

}  // namespace hydra
