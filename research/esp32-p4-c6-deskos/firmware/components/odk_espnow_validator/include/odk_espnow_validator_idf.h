#pragma once

#include "esp_err.h"
#include "odk_espnow_validator.h"

esp_err_t odk_espnow_validator_init(void);
esp_err_t odk_espnow_validator_start(void);
esp_err_t odk_espnow_validator_send_channel(uint8_t channel);
void odk_espnow_validator_log_stats(void);
