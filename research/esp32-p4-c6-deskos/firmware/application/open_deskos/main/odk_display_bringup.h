/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * Guition JC4880P443C display bring-up handle export for LVGL/Lua voice UI.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_lcd_panel_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ODK_DISPLAY_H_RES 480
#define ODK_DISPLAY_V_RES 800

/* Direct ST7701S MIPI-DSI bring-up. Returns panel handle or NULL. */
esp_lcd_panel_handle_t odk_display_bringup(void);

esp_lcd_panel_handle_t odk_display_get_panel(void);
void odk_display_get_size(int *width, int *height);

#ifdef __cplusplus
}
#endif
