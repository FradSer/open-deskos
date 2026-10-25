#include "main_node/hal/desktop_control_crypto.h"
#include <Preferences.h>
#include <esp_system.h>
#include <mbedtls/md.h>
namespace hydra {
namespace {
uint8_t controlKey[32]{};
bool hmac(void* context, const uint8_t* data, size_t size, uint8_t tag[32]) {
  const mbedtls_md_info_t* algorithm = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  return algorithm && mbedtls_md_hmac(algorithm, static_cast<uint8_t*>(context), 32,
                                    data, size, tag) == 0;
}
bool random(void*, uint8_t* out, size_t size) { esp_fill_random(out, size); return true; }
}
ControlCrypto loadDesktopControlCrypto() {
  memset(controlKey, 0, sizeof(controlKey));
  Preferences store;
  if (!store.begin("hydra-control", true)) return {};
  bool valid = readDesktopControlKey(store, controlKey);
  store.end();
  if (!valid) return {};
  return {controlKey, hmac, random};
}
}  // namespace hydra
