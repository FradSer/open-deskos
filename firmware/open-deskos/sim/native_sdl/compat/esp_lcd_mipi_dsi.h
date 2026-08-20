/*
 * esp_lcd_mipi_dsi.h — host shim. The MIPI-DSI / DPI panel path is not
 * exercised by the native sim (panel_if is forced to IO), but lua_lvgl_runtime.c
 * includes this header and references the DPI panel event/frame-buffer types.
 * Declared functions are no-ops in sim_esp_compat.c.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct esp_lcd_dpi_panel_event_data_t {
    int dummy;
} esp_lcd_dpi_panel_event_data_t;

typedef struct {
    bool (*on_color_trans_done)(esp_lcd_panel_handle_t panel,
                                esp_lcd_dpi_panel_event_data_t *edata,
                                void *user_ctx);
    bool (*on_refresh_done)(esp_lcd_panel_handle_t panel,
                            esp_lcd_dpi_panel_event_data_t *edata,
                            void *user_ctx);
} esp_lcd_dpi_panel_event_callbacks_t;

/* Returns ESP_ERR_NOT_SUPPORTED so the DIRECT/FULL fallback path yields NULL FBs
 * and lua_lvgl_init falls through to the PARTIAL SRAM path (our intended route). */
esp_err_t esp_lcd_dpi_panel_get_frame_buffer(esp_lcd_panel_handle_t panel,
                                             uint32_t fb_num, ...);
esp_err_t esp_lcd_dpi_panel_register_event_callbacks(
    esp_lcd_panel_handle_t panel,
    const esp_lcd_dpi_panel_event_callbacks_t *callbacks, void *user_ctx);

#ifdef __cplusplus
}
#endif
