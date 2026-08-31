/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * M5Stack PaperColor ESP32-S3 e-paper display bring-up.
 */
#pragma once

#include "esp_err.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ODK_M5PAPER_H_RES 400
#define ODK_M5PAPER_V_RES 600

esp_err_t odk_m5paper_display_bringup(void);
esp_lcd_panel_handle_t odk_m5paper_display_get_panel(void);
esp_lcd_panel_io_handle_t odk_m5paper_display_get_io(void);
esp_lcd_touch_handle_t odk_m5paper_touch_get_handle(void);
void odk_m5paper_display_get_size(int *width, int *height);
int odk_m5paper_get_btn_left(void);
int odk_m5paper_get_btn_center(void);
int odk_m5paper_get_btn_right(void);

#ifdef __cplusplus
}
#endif
