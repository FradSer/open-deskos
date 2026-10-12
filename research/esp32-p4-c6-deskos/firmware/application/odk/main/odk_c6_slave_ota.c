/*
 * One-shot C6 esp-hosted slave upgrade over SDIO.
 *
 * Guition JC4880P443C ships a factory C6 image that enumerates on SDIO but
 * reports co-proc version 0.0.0 against host 2.12.x → RPC timeouts. Direct
 * USB flash of the C6 (#4 Type-C) is unreliable on this board; Espressif's
 * recommended path for the P4+C6 EV-board class is host-driven slave OTA
 * over the existing transport. The matching network_adapter.bin is embedded
 * next to this translation unit (see main/CMakeLists.txt EMBED_FILES).
 */
#include "odk_c6_slave_ota.h"

#if CONFIG_IDF_TARGET_ESP32S3
volatile bool g_odk_c6_restart_allowed = false;
esp_err_t odk_c6_slave_ota_if_needed(void)
{
    return ESP_ERR_NOT_SUPPORTED;
}
#else

#include <string.h>
#include <inttypes.h>

#include "esp_log.h"
#include "esp_hosted.h"
#include "esp_hosted_ota.h"
#include "esp_hosted_api_types.h"

static const char *TAG = "odk_c6_ota";

/* Produced by EMBED_FILES of network_adapter.bin (basename → underscore). */
extern const uint8_t _binary_network_adapter_bin_start[];
extern const uint8_t _binary_network_adapter_bin_end[];

#ifndef ODK_C6_OTA_CHUNK
#define ODK_C6_OTA_CHUNK 1500
#endif

/* Host tree is 2.12.x; treat any 2.12.* slave as already matching. */
static bool slave_version_is_current(const esp_hosted_coprocessor_fwver_t *v)
{
    return v != NULL && v->major1 == 2 && v->minor1 == 12;
}

esp_err_t odk_c6_slave_ota_if_needed(void)
{
    esp_hosted_coprocessor_fwver_t ver = {0};
    esp_err_t vret = esp_hosted_get_coprocessor_fwversion(&ver);
    if (vret == ESP_OK) {
        ESP_LOGI(TAG, "C6 slave fw %u.%u.%u",
                 (unsigned)ver.major1, (unsigned)ver.minor1, (unsigned)ver.patch1);
        if (slave_version_is_current(&ver)) {
            ESP_LOGI(TAG, "C6 slave already matches host 2.12.x — OTA skipped");
            return ESP_ERR_INVALID_STATE;
        }
        ESP_LOGW(TAG, "C6 slave version mismatch with host 2.12.x — upgrading over SDIO");
    } else {
        ESP_LOGW(TAG, "could not read C6 slave version (%s) — attempting SDIO OTA anyway",
                 esp_err_to_name(vret));
    }

    const uint8_t *start = _binary_network_adapter_bin_start;
    const uint8_t *end = _binary_network_adapter_bin_end;
    size_t total = (size_t)(end - start);
    if (total < 1024 || start[0] != 0xE9) {
        ESP_LOGE(TAG, "embedded network_adapter.bin looks invalid (size=%u magic=0x%02x)",
                 (unsigned)total, total ? start[0] : 0);
        return ESP_ERR_INVALID_SIZE;
    }
    ESP_LOGI(TAG, "SDIO OTA: streaming %u bytes of network_adapter.bin", (unsigned)total);

    esp_err_t ret = esp_hosted_slave_ota_begin();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "esp_hosted_slave_ota_begin failed: %s", esp_err_to_name(ret));
        return ret;
    }

    size_t offset = 0;
    uint32_t chunks = 0;
    while (offset < total) {
        size_t n = total - offset;
        if (n > ODK_C6_OTA_CHUNK) {
            n = ODK_C6_OTA_CHUNK;
        }
        /* API takes non-const; the embedded blob is read-only but the write
         * path only reads the buffer. */
        ret = esp_hosted_slave_ota_write((uint8_t *)(start + offset), (uint32_t)n);
        if (ret != ESP_OK) {
            ESP_LOGE(TAG, "esp_hosted_slave_ota_write @%u failed: %s",
                     (unsigned)offset, esp_err_to_name(ret));
            (void)esp_hosted_slave_ota_end();
            return ret;
        }
        offset += n;
        chunks++;
        if ((chunks % 50) == 0) {
            ESP_LOGI(TAG, "SDIO OTA progress %u/%u (%.0f%%)",
                     (unsigned)offset, (unsigned)total,
                     (float)offset * 100.0f / (float)total);
        }
    }

    ret = esp_hosted_slave_ota_end();
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "esp_hosted_slave_ota_end failed: %s", esp_err_to_name(ret));
        return ret;
    }

    /* activate() only exists on slave FW >= 2.6; factory 0.0.6 / 0.0.0 just
     * needs end() then a host restart to re-handshake. Try activate anyway —
     * soft-fail if unsupported. */
    esp_err_t act = esp_hosted_slave_ota_activate();
    if (act != ESP_OK) {
        ESP_LOGW(TAG, "esp_hosted_slave_ota_activate returned %s (ok on pre-2.6 slaves)",
                 esp_err_to_name(act));
    }

    ESP_LOGW(TAG, "C6 slave OTA complete — host should restart to re-handshake");
    return ESP_OK;
}

// Global flag: main.c checks this before restarting C6
volatile bool g_odk_c6_restart_allowed = false;
#endif
