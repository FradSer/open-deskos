/*
 * esp_lv_adapter_display.h — host shim. See esp_lv_adapter.h: the adapter
 * display path is never exercised at runtime (panel_if=IO), but the config
 * types and default-config macros are referenced at compile time by
 * lua_lvgl_runtime.c. register_display/unregister_display return NULL/OK.
 *
 * The struct layouts and designated-initializer macros mirror the real
 * espressif__esp_lvgl_adapter/include/esp_lv_adapter_display.h exactly enough
 * for lua_lvgl_runtime.c's use_adapter branch to compile.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    ESP_LV_ADAPTER_ROTATE_0   = 0,
    ESP_LV_ADAPTER_ROTATE_90  = 90,
    ESP_LV_ADAPTER_ROTATE_180 = 180,
    ESP_LV_ADAPTER_ROTATE_270 = 270,
} esp_lv_adapter_rotation_t;

/* Avoid pulling <gpio_num.h> — the host never uses TE sync. Provide the
 * intr_type enum name lua_lvgl_runtime may reference via the real macros
 * (none do in the use_adapter branch, but keep a compatible placeholder). */
typedef enum {
    ESP_LV_ADAPTER_GPIO_INTR_DISABLE_PLACEHOLDER = 0,
} esp_lv_adapter_gpio_intr_t;

typedef enum {
    ESP_LV_ADAPTER_TEAR_AVOID_MODE_NONE           = 0,
    ESP_LV_ADAPTER_TEAR_AVOID_MODE_DOUBLE_FULL    = 1,
    ESP_LV_ADAPTER_TEAR_AVOID_MODE_TRIPLE_FULL    = 2,
    ESP_LV_ADAPTER_TEAR_AVOID_MODE_DOUBLE_DIRECT  = 3,
    ESP_LV_ADAPTER_TEAR_AVOID_MODE_TRIPLE_PARTIAL = 4,
    ESP_LV_ADAPTER_TEAR_AVOID_MODE_TE_SYNC        = 5,
    ESP_LV_ADAPTER_TEAR_AVOID_MODE_DOUBLE_PARTIAL = 6,
} esp_lv_adapter_tear_avoid_mode_t;

#define ESP_LV_ADAPTER_TEAR_AVOID_MODE_DEFAULT_MIPI_DSI  ESP_LV_ADAPTER_TEAR_AVOID_MODE_TRIPLE_PARTIAL
#define ESP_LV_ADAPTER_TEAR_AVOID_MODE_DEFAULT_RGB       ESP_LV_ADAPTER_TEAR_AVOID_MODE_TRIPLE_PARTIAL
#define ESP_LV_ADAPTER_TEAR_AVOID_MODE_DEFAULT           ESP_LV_ADAPTER_TEAR_AVOID_MODE_NONE

typedef enum {
    ESP_LV_ADAPTER_PANEL_IF_RGB      = 0,
    ESP_LV_ADAPTER_PANEL_IF_MIPI_DSI = 1,
    ESP_LV_ADAPTER_PANEL_IF_OTHER    = 2,
} esp_lv_adapter_panel_interface_t;

typedef enum {
    ESP_LV_ADAPTER_MONO_LAYOUT_NONE = 0,
    ESP_LV_ADAPTER_MONO_LAYOUT_HTILED,
    ESP_LV_ADAPTER_MONO_LAYOUT_VTILED,
} esp_lv_adapter_mono_layout_t;

/* Minimal TE-sync struct — only gpio_num is touched by the disabled macro. */
typedef struct {
    int gpio_num;
    uint32_t time_tvdl_ms;
    uint32_t time_tvdh_ms;
    uint32_t bus_freq_hz;
    uint8_t data_lines;
    uint8_t bits_per_pixel;
    int intr_type;
    uint8_t refresh_window_percent;
} esp_lv_adapter_te_sync_config_t;

#define ESP_LV_ADAPTER_TE_SYNC_DISABLED() \
    (esp_lv_adapter_te_sync_config_t){ .gpio_num = -1 }

typedef struct {
    esp_lv_adapter_panel_interface_t interface;
    esp_lv_adapter_rotation_t rotation;
    uint16_t hor_res;
    uint16_t ver_res;
    uint16_t buffer_height;
    bool use_psram;
    bool enable_ppa_accel;
    bool require_double_buffer;
    esp_lv_adapter_mono_layout_t mono_layout;
} esp_lv_adapter_display_profile_t;

#define ESP_LV_ADAPTER_DISPLAY_PROFILE_BASE_CONFIG(_hor_res, _ver_res, _rotation) \
    .rotation              = (_rotation),                                          \
    .hor_res               = (_hor_res),                                           \
    .ver_res               = (_ver_res),

#define ESP_LV_ADAPTER_DISPLAY_PROFILE_MIPI_DEFAULT_CONFIG(_hor_res, _ver_res, _rotation) \
    .interface             = ESP_LV_ADAPTER_PANEL_IF_MIPI_DSI,                             \
    ESP_LV_ADAPTER_DISPLAY_PROFILE_BASE_CONFIG(_hor_res, _ver_res, _rotation)             \
    .buffer_height         = 50,                                                          \
    .use_psram             = false,                                                       \
    .enable_ppa_accel      = false,                                                       \
    .require_double_buffer = false,                                                       \
    .mono_layout           = ESP_LV_ADAPTER_MONO_LAYOUT_NONE

#define ESP_LV_ADAPTER_DISPLAY_PROFILE_RGB_DEFAULT_CONFIG(_hor_res, _ver_res, _rotation)  \
    .interface             = ESP_LV_ADAPTER_PANEL_IF_RGB,                                  \
    ESP_LV_ADAPTER_DISPLAY_PROFILE_BASE_CONFIG(_hor_res, _ver_res, _rotation)             \
    .buffer_height         = 50,                                                          \
    .use_psram             = false,                                                       \
    .enable_ppa_accel      = false,                                                       \
    .require_double_buffer = false,                                                       \
    .mono_layout           = ESP_LV_ADAPTER_MONO_LAYOUT_NONE

typedef struct {
    esp_lcd_panel_handle_t panel;
    esp_lcd_panel_io_handle_t panel_io;
    esp_lv_adapter_display_profile_t profile;
    esp_lv_adapter_tear_avoid_mode_t tear_avoid_mode;
    esp_lv_adapter_te_sync_config_t te_sync;
} esp_lv_adapter_display_config_t;

#define ESP_LV_ADAPTER_DISPLAY_CONFIG(_panel, _panel_io, _profile_cfg, _tear_mode, _te_sync_cfg) \
    ((esp_lv_adapter_display_config_t){                                                  \
        .panel           = (_panel),                                                     \
        .panel_io        = (_panel_io),                                                  \
        .profile         = { _profile_cfg },                                             \
        .tear_avoid_mode = (_tear_mode),                                                 \
        .te_sync         = (_te_sync_cfg),                                               \
    })

#define ESP_LV_ADAPTER_DISPLAY_MIPI_DEFAULT_CONFIG(_panel, _panel_io, _hor_res, _ver_res, _rotation)                 \
    ESP_LV_ADAPTER_DISPLAY_CONFIG(_panel, _panel_io,                                                                 \
                                  ESP_LV_ADAPTER_DISPLAY_PROFILE_MIPI_DEFAULT_CONFIG(_hor_res, _ver_res, _rotation), \
                                  ESP_LV_ADAPTER_TEAR_AVOID_MODE_DEFAULT_MIPI_DSI,                                   \
                                  ESP_LV_ADAPTER_TE_SYNC_DISABLED())

#define ESP_LV_ADAPTER_DISPLAY_RGB_DEFAULT_CONFIG(_panel, _panel_io, _hor_res, _ver_res, _rotation)                  \
    ESP_LV_ADAPTER_DISPLAY_CONFIG(_panel, _panel_io,                                                                 \
                                  ESP_LV_ADAPTER_DISPLAY_PROFILE_RGB_DEFAULT_CONFIG(_hor_res, _ver_res, _rotation),  \
                                  ESP_LV_ADAPTER_TEAR_AVOID_MODE_DEFAULT_RGB,                                        \
                                  ESP_LV_ADAPTER_TE_SYNC_DISABLED())

#include "lvgl.h"
lv_display_t *esp_lv_adapter_register_display(const esp_lv_adapter_display_config_t *config);
esp_err_t esp_lv_adapter_unregister_display(lv_display_t *disp);

#ifdef __cplusplus
}
#endif
