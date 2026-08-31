/*
 * sim_esp_compat.c — host shims for the ESP-IDF / FreeRTOS symbols that the
 * real lua_module_lvgl (lua_lvgl_runtime.c) calls.
 *
 * Mirrors the Emscripten web sim's sim_esp_compat.c, but with every EM_ASM /
 * canvas blit replaced by SDL2 (sim_sdl_blit_rgb565) and every
 * emscripten_get_now / emscripten_sleep replaced by POSIX clock_gettime / SDL.
 *
 * The build defines __EMSCRIPTEN__ for lua_module_lvgl so its process_events
 * drives lv_timer_handler and its xTaskCreatePinnedToCore path is skipped —
 * the same contract the web sim relies on, without any Emscripten dependency.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include <SDL2/SDL.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_touch.h"
#include "esp_lcd_mipi_dsi.h"
#include "esp_lv_adapter.h"
#include "display_arbiter.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "cap_lua.h"
#include "lua.h"
#include "lvgl.h"

#include "sdl_driver.h"

static const char *TAG = "sim_compat";

struct sim_semaphore {
    int  count;
    bool mutex;
};

struct sim_esp_timer {
    esp_timer_cb_t callback;
    void          *arg;
    uint64_t       period_us;
    int64_t        next_fire_us;
    bool           active;
};

static display_arbiter_owner_t s_display_owner = DISPLAY_ARBITER_OWNER_NONE;
static esp_lcd_panel_io_callbacks_t s_io_callbacks;
static void *s_io_user_ctx;
static struct sim_esp_timer *s_timers[16];
static int s_timer_count;

/* ---------------------------------------------------------------- esp_err */

const char *esp_err_to_name(esp_err_t err)
{
    switch (err) {
    case ESP_OK:                 return "ESP_OK";
    case ESP_FAIL:               return "ESP_FAIL";
    case ESP_ERR_NO_MEM:         return "ESP_ERR_NO_MEM";
    case ESP_ERR_INVALID_ARG:   return "ESP_ERR_INVALID_ARG";
    case ESP_ERR_INVALID_STATE: return "ESP_ERR_INVALID_STATE";
    case ESP_ERR_INVALID_SIZE:  return "ESP_ERR_INVALID_SIZE";
    case ESP_ERR_TIMEOUT:        return "ESP_ERR_TIMEOUT";
    case ESP_ERR_NOT_FOUND:     return "ESP_ERR_NOT_FOUND";
    case ESP_ERR_NOT_SUPPORTED: return "ESP_ERR_NOT_SUPPORTED";
    default:                     return "ESP_ERR_UNKNOWN";
    }
}

/* ---------------------------------------------------------- display_arbiter */

display_arbiter_owner_t display_arbiter_get_owner(void)
{
    return s_display_owner;
}

esp_err_t display_arbiter_acquire(display_arbiter_owner_t owner)
{
    if (s_display_owner != DISPLAY_ARBITER_OWNER_NONE && s_display_owner != owner) {
        return ESP_ERR_INVALID_STATE;
    }
    s_display_owner = owner;
    return ESP_OK;
}

esp_err_t display_arbiter_release(display_arbiter_owner_t owner)
{
    if (s_display_owner != owner) {
        return ESP_ERR_INVALID_STATE;
    }
    s_display_owner = DISPLAY_ARBITER_OWNER_NONE;
    return ESP_OK;
}

/* ------------------------------------------------------------ freertos sem */

SemaphoreHandle_t xSemaphoreCreateMutex(void)
{
    struct sim_semaphore *sem = (struct sim_semaphore *)calloc(1, sizeof(*sem));
    if (sem) {
        sem->count = 1;
        sem->mutex = true;
    }
    return (SemaphoreHandle_t)sem;
}

SemaphoreHandle_t xSemaphoreCreateBinary(void)
{
    /* Binary sem: start "given" so the first Take succeeds (matches the
     * firmware's flush_done usage). */
    struct sim_semaphore *sem = (struct sim_semaphore *)calloc(1, sizeof(*sem));
    if (sem) {
        sem->count = 1;
        sem->mutex = false;
    }
    return (SemaphoreHandle_t)sem;
}

BaseType_t xSemaphoreTake(SemaphoreHandle_t sem, TickType_t ticks)
{
    (void)ticks;
    if (!sem || sem->count <= 0) {
        return pdFALSE;
    }
    sem->count--;
    return pdTRUE;
}

BaseType_t xSemaphoreGive(SemaphoreHandle_t sem)
{
    if (!sem) {
        return pdFALSE;
    }
    sem->count = sem->mutex ? 1 : sem->count + 1;
    return pdTRUE;
}

BaseType_t xSemaphoreGiveFromISR(SemaphoreHandle_t sem, BaseType_t *high_task_woken)
{
    if (high_task_woken) {
        *high_task_woken = pdFALSE;
    }
    return xSemaphoreGive(sem);
}

/* -------------------------------------------------------------- esp_timer */

int64_t esp_timer_get_time(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000000LL + (int64_t)ts.tv_nsec / 1000LL;
}

esp_err_t esp_timer_create(const esp_timer_create_args_t *args, esp_timer_handle_t *out_handle)
{
    struct sim_esp_timer *timer;
    if (!args || !args->callback || !out_handle) {
        return ESP_ERR_INVALID_ARG;
    }
    timer = (struct sim_esp_timer *)calloc(1, sizeof(*timer));
    if (!timer) {
        return ESP_ERR_NO_MEM;
    }
    timer->callback = args->callback;
    timer->arg = args->arg;
    *out_handle = timer;
    if (s_timer_count < (int)(sizeof(s_timers) / sizeof(s_timers[0]))) {
        s_timers[s_timer_count++] = timer;
    } else {
        ESP_LOGE(TAG, "timer slot table full");
    }
    return ESP_OK;
}

esp_err_t esp_timer_start_periodic(esp_timer_handle_t handle, uint64_t period_us)
{
    if (!handle || period_us == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    handle->period_us = period_us;
    handle->next_fire_us = esp_timer_get_time() + (int64_t)period_us;
    handle->active = true;
    return ESP_OK;
}

esp_err_t esp_timer_stop(esp_timer_handle_t handle)
{
    if (!handle) {
        return ESP_ERR_INVALID_ARG;
    }
    handle->active = false;
    return ESP_OK;
}

esp_err_t esp_timer_delete(esp_timer_handle_t handle)
{
    if (!handle) {
        return ESP_ERR_INVALID_ARG;
    }
    for (int i = 0; i < s_timer_count; i++) {
        if (s_timers[i] == handle) {
            memmove(&s_timers[i], &s_timers[i + 1],
                    (size_t)(s_timer_count - i - 1) * sizeof(s_timers[0]));
            s_timer_count--;
            break;
        }
    }
    free(handle);
    return ESP_OK;
}

static void sim_pump_timers(void)
{
    int64_t now = esp_timer_get_time();
    for (int i = 0; i < s_timer_count; i++) {
        struct sim_esp_timer *timer = s_timers[i];
        if (!timer || !timer->active || now < timer->next_fire_us) {
            continue;
        }
        timer->callback(timer->arg);
        do {
            timer->next_fire_us += (int64_t)timer->period_us;
        } while (now >= timer->next_fire_us);
    }
}

void sim_esp_compat_pump_once(void)
{
    sim_pump_timers();
    /* lv_timer_handler is also driven from launcher.tick() -> process_events
     * (via __EMSCRIPTEN__), but pumping here keeps timers self-contained. */
}

/* ------------------------------------------------------------ freertos task */

/* With __EMSCRIPTEN__ defined, lua_lvgl_runtime never calls
 * xTaskCreatePinnedToCore. xTaskCreate is provided for completeness but is a
 * no-op store — the main loop drives all ticking. */
BaseType_t xTaskCreate(TaskFunction_t task, const char *name, uint32_t stack_depth,
                       void *arg, UBaseType_t priority, TaskHandle_t *out_handle)
{
    (void)task; (void)name; (void)stack_depth; (void)arg; (void)priority;
    if (out_handle) {
        *out_handle = NULL;
    }
    return pdPASS;
}

void vTaskDelay(TickType_t ticks)
{
    if (ticks > 0) {
        SDL_Delay((unsigned int)ticks);
    }
}

TickType_t xTaskGetTickCount(void)
{
    return (TickType_t)SDL_GetTicks();
}

void vTaskDelayUntil(TickType_t *previous_wake_time, TickType_t time_increment)
{
    TickType_t next_wake;
    int32_t wait_ms;

    if (!previous_wake_time) {
        vTaskDelay(time_increment);
        return;
    }
    next_wake = *previous_wake_time + time_increment;
    wait_ms = (int32_t)(next_wake - xTaskGetTickCount());
    if (wait_ms > 0) {
        SDL_Delay((uint32_t)wait_ms);
    }
    *previous_wake_time = next_wake;
}

void vTaskDelete(TaskHandle_t task)
{
    (void)task;
}

TaskHandle_t xTaskGetCurrentTaskHandle(void)
{
    return NULL;
}

uint32_t ulTaskNotifyTake(BaseType_t clear_on_exit, TickType_t ticks_to_wait)
{
    (void)clear_on_exit; (void)ticks_to_wait;
    return 1;
}

void xTaskNotifyGive(TaskHandle_t task)
{
    (void)task;
}

/* -------------------------------------------------------- panel IO + LCD */

esp_err_t esp_lcd_panel_io_register_event_callbacks(esp_lcd_panel_io_handle_t io,
                                                    const esp_lcd_panel_io_callbacks_t *callbacks,
                                                    void *user_ctx)
{
    (void)io;
    if (callbacks) {
        s_io_callbacks = *callbacks;
    } else {
        memset(&s_io_callbacks, 0, sizeof(s_io_callbacks));
    }
    s_io_user_ctx = user_ctx;
    return ESP_OK;
}

/* The flush terminus: the real lua_lvgl_flush_cb hands us an RGB565 (IO path,
 * byte-swapped) sub-rect. Blit into the SDL texture. */
esp_err_t esp_lcd_panel_draw_bitmap(esp_lcd_panel_handle_t panel,
                                    int x_start, int y_start,
                                    int x_end, int y_end,
                                    const void *color_data)
{
    (void)panel;
    int w = x_end - x_start;
    int h = y_end - y_start;
    if (!color_data || w <= 0 || h <= 0) {
        return ESP_ERR_INVALID_ARG;
    }
    sim_sdl_blit_rgb565(x_start, y_start, w, h, (const uint8_t *)color_data);
    /* Fire on_color_trans_done so the IO-panel flush-completion path advances.
     * lua_lvgl_register_flush_callbacks wires this; harmless if unregistered. */
    if (s_io_callbacks.on_color_trans_done) {
        esp_lcd_panel_io_event_data_t edata = { .dummy = 0 };
        (void)s_io_callbacks.on_color_trans_done(NULL, &edata, s_io_user_ctx);
    }
    return ESP_OK;
}

/* ----------------------------------------------------------------- touch */

esp_err_t esp_lcd_touch_read_data(esp_lcd_touch_handle_t tp)
{
    (void)tp;
    return ESP_OK;
}

esp_err_t esp_lcd_touch_get_data(esp_lcd_touch_handle_t tp,
                                 esp_lcd_touch_point_data_t *point,
                                 uint8_t *point_count,
                                 uint8_t max_point_count)
{
    (void)tp;
    if (!point || !point_count || max_point_count == 0) {
        return ESP_ERR_INVALID_ARG;
    }
    int x = 0, y = 0;
    bool pressed = false;
    sim_sdl_pointer_get(&x, &y, &pressed);
    if (pressed) {
        point[0].x = (uint16_t)x;
        point[0].y = (uint16_t)y;
        point[0].strength = 1;
        *point_count = 1;
    } else {
        *point_count = 0;
    }
    return ESP_OK;
}

/* ------------------------------------------------------------- cap_lua */

/* No-ops mirroring the web sim: the lvgl module is registered manually by
 * sim_main.c via luaL_requiref; these registry calls are vestigial. */
esp_err_t cap_lua_register_module(const char *name, lua_CFunction openf)
{
    (void)name; (void)openf;
    return ESP_OK;
}

esp_err_t cap_lua_register_exit_cleanup(void (*cleanup)(lua_State *L))
{
    (void)cleanup;
    return ESP_OK;
}

bool cap_lua_runtime_stop_requested(lua_State *L)
{
    (void)L;
    return false;
}

/* --------------------------------------------------- esp_lv_adapter stubs */

/* Never called at runtime (panel_if=IO skips the use_adapter branch), but
 * linked so lua_lvgl_runtime.c resolves. Return failure/NULL. */
esp_err_t esp_lv_adapter_init(const esp_lv_adapter_config_t *config)
{
    (void)config;
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t esp_lv_adapter_start(void)
{
    return ESP_ERR_NOT_SUPPORTED;
}

bool esp_lv_adapter_is_initialized(void)
{
    return false;
}

esp_err_t esp_lv_adapter_lock(int32_t timeout_ms)
{
    (void)timeout_ms;
    return ESP_OK;
}

esp_err_t esp_lv_adapter_unlock(void)
{
    return ESP_OK;
}

lv_display_t *esp_lv_adapter_register_display(const esp_lv_adapter_display_config_t *config)
{
    (void)config;
    return NULL;
}

esp_err_t esp_lv_adapter_unregister_display(lv_display_t *disp)
{
    (void)disp;
    return ESP_OK;
}

/* --------------------------------------------------- DPI panel stubs */

/* Returns NOT_SUPPORTED so the DIRECT/FULL fallback yields NULL FBs and
 * lua_lvgl_init falls through to PARTIAL (our intended route). */
esp_err_t esp_lcd_dpi_panel_get_frame_buffer(esp_lcd_panel_handle_t panel,
                                             uint32_t fb_num, ...)
{
    (void)panel; (void)fb_num;
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t esp_lcd_dpi_panel_register_event_callbacks(
    esp_lcd_panel_handle_t panel,
    const esp_lcd_dpi_panel_event_callbacks_t *callbacks, void *user_ctx)
{
    (void)panel; (void)callbacks; (void)user_ctx;
    return ESP_OK;
}
