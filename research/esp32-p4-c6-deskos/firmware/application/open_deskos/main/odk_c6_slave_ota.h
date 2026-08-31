#pragma once

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Upgrade the on-board ESP32-C6 esp-hosted slave over SDIO when its reported
 * firmware is older / incompatible with the host (Host 2.12.x vs co-proc 0.0.0).
 *
 * Streams the embedded `network_adapter.bin` (built from the same esp_hosted
 * tree as the host) via esp_hosted_slave_ota_{begin,write,end}. Returns
 * ESP_OK when an upgrade was applied (caller should restart the host),
 * ESP_ERR_INVALID_STATE when the slave is already current (no restart needed),
 * or an error if the OTA failed.
 *
 * Requires the esp-hosted transport to already be up (wifi_manager_init OK).
 */
esp_err_t odk_c6_slave_ota_if_needed(void);

#ifdef __cplusplus
}
#endif
