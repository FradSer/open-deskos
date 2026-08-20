/*
 * esp_lv_adapter.h — host shim. The esp_lvgl_adapter TRIPLE_PARTIAL path is
 * NOT exercised by the native sim (panel_if is forced to IO, which makes
 * lua_lvgl_init skip the use_adapter branch at runtime), but lua_lvgl_runtime.c
 * includes this header and references its types/macros at compile time.
 *
 * Provide only the config type, default-config macro, lifecycle signatures, and
 * the auto-sleep enum. Function impls are no-ops in sim_esp_compat.c.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "lvgl.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    ESP_LV_ADAPTER_AUTO_SLEEP_MODE_DISABLED = 0,
    ESP_LV_ADAPTER_AUTO_SLEEP_MODE_PAUSE,
    ESP_LV_ADAPTER_AUTO_SLEEP_MODE_USER,
} esp_lv_adapter_auto_sleep_mode_t;

typedef struct {
    esp_err_t (*on_enter_sleep)(void *user_ctx);
    esp_err_t (*on_exit_sleep)(void *user_ctx);
    void *user_ctx;
} esp_lv_adapter_auto_sleep_callbacks_t;

typedef struct {
    bool enable;
    esp_lv_adapter_auto_sleep_mode_t mode;
    uint32_t idle_timeout_ms;
    esp_lv_adapter_auto_sleep_callbacks_t callbacks;
} esp_lv_adapter_auto_sleep_config_t;

typedef struct {
    uint32_t task_stack_size;
    uint32_t task_priority;
    int task_core_id;
    uint32_t tick_period_ms;
    uint32_t task_min_delay_ms;
    uint32_t task_max_delay_ms;
    bool stack_in_psram;
    esp_lv_adapter_auto_sleep_config_t auto_sleep;
} esp_lv_adapter_config_t;

#define ESP_LV_ADAPTER_DEFAULT_STACK_SIZE        (8 * 1024)
#define ESP_LV_ADAPTER_DEFAULT_TASK_PRIORITY     6
#define ESP_LV_ADAPTER_DEFAULT_TASK_CORE_ID     (-1)
#define ESP_LV_ADAPTER_DEFAULT_TICK_PERIOD_MS    1
#define ESP_LV_ADAPTER_DEFAULT_TASK_MIN_DELAY_MS 1
#define ESP_LV_ADAPTER_DEFAULT_TASK_MAX_DELAY_MS 15
#define ESP_LV_ADAPTER_DEFAULT_AUTO_SLEEP_TIMEOUT_MS 5000

#define ESP_LV_ADAPTER_DEFAULT_CONFIG() {                            \
    .task_stack_size   = ESP_LV_ADAPTER_DEFAULT_STACK_SIZE,          \
    .task_priority     = ESP_LV_ADAPTER_DEFAULT_TASK_PRIORITY,       \
    .task_core_id      = ESP_LV_ADAPTER_DEFAULT_TASK_CORE_ID,        \
    .tick_period_ms    = ESP_LV_ADAPTER_DEFAULT_TICK_PERIOD_MS,      \
    .task_min_delay_ms = ESP_LV_ADAPTER_DEFAULT_TASK_MIN_DELAY_MS,   \
    .task_max_delay_ms = ESP_LV_ADAPTER_DEFAULT_TASK_MAX_DELAY_MS,   \
    .stack_in_psram    = false,                                      \
    .auto_sleep        = {                                           \
        .enable = false,                                            \
        .mode = ESP_LV_ADAPTER_AUTO_SLEEP_MODE_DISABLED,             \
        .idle_timeout_ms = ESP_LV_ADAPTER_DEFAULT_AUTO_SLEEP_TIMEOUT_MS, \
    },                                                               \
}

esp_err_t esp_lv_adapter_init(const esp_lv_adapter_config_t *config);
esp_err_t esp_lv_adapter_start(void);
bool esp_lv_adapter_is_initialized(void);
esp_err_t esp_lv_adapter_lock(int32_t timeout_ms);
esp_err_t esp_lv_adapter_unlock(void);

/* Forward-declare the display config type from the display header. */
#include "esp_lv_adapter_display.h"

#ifdef __cplusplus
}
#endif
