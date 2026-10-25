#include "shared/ota_writer.h"

#include <Arduino.h>
#include <cstdlib>
#include <cstring>
#include <esp_ota_ops.h>
#include <esp_partition.h>
#include <mbedtls/md.h>

namespace hydra {

bool OtaWriter::begin(size_t expectedSize) {
  const esp_partition_t* running = esp_ota_get_running_partition();
  const esp_partition_t* next = esp_ota_get_next_update_partition(running);
  if (next == nullptr) {
    Serial.println("[ota] no standby OTA partition -- is the table dual-OTA?");
    return false;
  }
  Serial.printf("[ota] running=%s standby=%s, expecting %u bytes\n", running->label,
                next->label, static_cast<unsigned>(expectedSize));

  auto* md = static_cast<mbedtls_md_context_t*>(calloc(1, sizeof(mbedtls_md_context_t)));
  const mbedtls_md_info_t* sha = mbedtls_md_info_from_type(MBEDTLS_MD_SHA256);
  if (md == nullptr || sha == nullptr) {
    Serial.println("[ota] sha setup failed");
    free(md);
    return false;
  }
  mbedtls_md_init(md);
  if (mbedtls_md_setup(md, sha, 0) != 0) {
    Serial.println("[ota] sha setup failed");
    mbedtls_md_free(md);
    free(md);
    return false;
  }
  mbedtls_md_starts(md);

  esp_ota_handle_t handle = 0;
  esp_err_t err = esp_ota_begin(next, expectedSize, &handle);
  if (err != ESP_OK) {
    Serial.printf("[ota] esp_ota_begin failed: %s\n", esp_err_to_name(err));
    mbedtls_md_free(md);
    free(md);
    return false;
  }
  handle_ = reinterpret_cast<void*>(handle);
  mdContext_ = md;
  session_.begin();
  return true;
}

bool OtaWriter::write(const uint8_t* data, size_t len) {
  if (!session_.active()) return false;
  auto handle = reinterpret_cast<esp_ota_handle_t>(handle_);
  auto* md = reinterpret_cast<mbedtls_md_context_t*>(mdContext_);
  esp_err_t err = esp_ota_write(handle, data, len);
  if (err != ESP_OK) {
    Serial.printf("[ota] esp_ota_write failed: %s\n", esp_err_to_name(err));
    return false;
  }
  mbedtls_md_update(md, data, len);
  return true;
}

bool OtaWriter::finish(const uint8_t expectedSha[32]) {
  if (!session_.active()) return false;
  auto handle = reinterpret_cast<esp_ota_handle_t>(handle_);
  auto* md = reinterpret_cast<mbedtls_md_context_t*>(mdContext_);

  uint8_t digest[32];
  mbedtls_md_finish(md, digest);
  mbedtls_md_free(md);
  free(md);
  mdContext_ = nullptr;

  if (memcmp(digest, expectedSha, sizeof(digest)) != 0) {
    Serial.println("[ota] SHA mismatch -- keeping the running image");
    abort();
    return false;
  }

  esp_err_t err = esp_ota_end(handle);
  if (err != ESP_OK) {
    Serial.printf("[ota] esp_ota_end failed: %s\n", esp_err_to_name(err));
    abort();
    return false;
  }
  session_.finalize();
  handle_ = nullptr;

  const esp_partition_t* running = esp_ota_get_running_partition();
  const esp_partition_t* next = esp_ota_get_next_update_partition(running);
  if (next == nullptr) {
    Serial.println("[ota] standby vanished -- cannot set boot partition");
    return false;
  }
  err = esp_ota_set_boot_partition(next);
  if (err != ESP_OK) {
    Serial.printf("[ota] set_boot_partition failed: %s\n", esp_err_to_name(err));
    return false;
  }
  Serial.println("[ota] SHA ok, standby marked bootable");
  return true;
}

void OtaWriter::abort() {
  if (!session_.takeForAbort()) return;
  auto handle = reinterpret_cast<esp_ota_handle_t>(handle_);
  auto* md = reinterpret_cast<mbedtls_md_context_t*>(mdContext_);
  esp_ota_abort(handle);
  handle_ = nullptr;
  if (md != nullptr) {
    mbedtls_md_free(md);
    free(md);
    mdContext_ = nullptr;
  }
}

}  // namespace hydra
