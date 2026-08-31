/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * ESP32-S3 small-display bring-up for the Waveshare 2.8-inch pin map.
 */
#pragma once

#include "esp_err.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t odk_s3_display_bringup(void);
esp_err_t odk_s3_touch_bringup(void);
esp_lcd_panel_handle_t odk_s3_display_get_panel(void);
esp_lcd_panel_io_handle_t odk_s3_display_get_io(void);
esp_lcd_touch_handle_t odk_s3_touch_get_handle(void);
void odk_s3_display_get_size(int *width, int *height);

#ifdef __cplusplus
}
#endif
