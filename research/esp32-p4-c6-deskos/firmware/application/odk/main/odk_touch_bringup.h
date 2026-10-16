/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guition JC4880P443C GT911 touch bring-up (csvke BSP + pulse-esp verified).
 * I2C SDA=7 / SCL=8, RST/INT = NC (polled). Probe 0x5D then 0x14.
 */
#pragma once

#include "esp_err.h"
#include "esp_lcd_touch.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t odk_touch_bringup(void);
esp_lcd_touch_handle_t odk_touch_get_handle(void);

#ifdef __cplusplus
}
#endif
