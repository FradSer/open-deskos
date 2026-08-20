/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "lua_lvgl_private.h"

#if CONFIG_IDF_TARGET_ESP32P4
#include "esp_lcd_mipi_dsi.h"
#endif
#include "esp_lv_adapter.h"
#include "esp_memory_utils.h"

static const char *TAG = "lua_lvgl";
lua_lvgl_state_t s_lvgl;

static void lua_lvgl_pager_trace_display_event_cb(lv_event_t *event)
{
    lv_event_code_t code = lv_event_get_code(event);

    switch (code) {
    case LV_EVENT_REFR_START:
    case LV_EVENT_REFR_READY:
    case LV_EVENT_RENDER_START:
    case LV_EVENT_RENDER_READY:
    case LV_EVENT_FLUSH_START:
    case LV_EVENT_FLUSH_FINISH:
    case LV_EVENT_FLUSH_WAIT_START:
    case LV_EVENT_FLUSH_WAIT_FINISH:
    case LV_EVENT_UPDATE_LAYOUT_COMPLETED:
        lua_lvgl_indev_trace_display_event_locked(code);
        break;
    default:
        break;
    }
}

static void lua_lvgl_register_pager_trace_events_locked(lv_display_t *display)
{
    /* LVGL invokes this callback under the same worker lock that performs the
     * refresh. A single all-events subscription avoids changing any adapter
     * render behaviour while still letting the trace distinguish draw, flush,
     * and wait time on MIPI partial rendering. */
    lv_display_add_event_cb(display, lua_lvgl_pager_trace_display_event_cb, LV_EVENT_ALL, NULL);
}

esp_err_t lua_lvgl_lock(void)
{
    /* Adapter owns the LVGL worker lock while active — must share it. */
    if (s_lvgl.adapter_active) {
        return esp_lv_adapter_lock(1000);
    }
    if (!s_lvgl.mutex) {
        s_lvgl.mutex = xSemaphoreCreateMutex();
    }
    if (!s_lvgl.mutex) {
        return ESP_ERR_NO_MEM;
    }
    if (xSemaphoreTake(s_lvgl.mutex, pdMS_TO_TICKS(1000)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }
    return ESP_OK;
}

void lua_lvgl_unlock(void)
{
    if (s_lvgl.adapter_active) {
        esp_lv_adapter_unlock();
        return;
    }
    if (s_lvgl.mutex) {
        xSemaphoreGive(s_lvgl.mutex);
    }
}

int lua_lvgl_error_esp(lua_State *L, const char *what, esp_err_t err)
{
    return luaL_error(L, "lvgl %s failed: %s", what, esp_err_to_name(err));
}
static const char *lua_lvgl_display_owner_name(display_arbiter_owner_t owner)
{
    switch (owner) {
    case DISPLAY_ARBITER_OWNER_NONE:
        return "none";
    case DISPLAY_ARBITER_OWNER_LUA:
        return "lua";
    case DISPLAY_ARBITER_OWNER_EMOTE:
        return "emote";
    default:
        return "unknown";
    }
}

static IRAM_ATTR bool lua_lvgl_flush_done_cb(esp_lcd_panel_io_handle_t panel_io,
                                             esp_lcd_panel_io_event_data_t *edata,
                                             void *user_ctx)
{
    lua_lvgl_state_t *state = (lua_lvgl_state_t *)user_ctx;
    BaseType_t high_task_woken = pdFALSE;

    (void)panel_io;
    (void)edata;

    /* DPI refresh callbacks run every scan. Only a callback that completes a
     * submitted LVGL frame may release a draw buffer; calling flush_ready for
     * an idle scan would corrupt LVGL's flush state machine. */
    if (state && state->flush_pending) {
        state->flush_pending = false;
        /* Keep this ISR-side record to a single aligned increment. The LVGL
         * task later turns it into one pager trace line after the gesture. */
        state->pager_trace_present_sequence++;
        /* Direct FB swaps are asynchronous. The DPI callback means the panel
         * no longer owns the submitted framebuffer, so this is the one safe
         * point to give it back to LVGL. Keeping the UI task out of the VSYNC
         * wait lets it keep accepting GT911 samples while the panel scans. */
        lv_display_t *display = state->display;
        if (display) {
            lv_display_flush_ready(display);
        }
        if (state->flush_done) {
            if (xPortInIsrContext()) {
                xSemaphoreGiveFromISR(state->flush_done, &high_task_woken);
            } else {
                xSemaphoreGive(state->flush_done);
            }
        }
    }

    return high_task_woken == pdTRUE;
}

/* DPI/MIPI: color copy done (PARTIAL DMA2D into panel FB). */
#if CONFIG_IDF_TARGET_ESP32P4
static IRAM_ATTR bool lua_lvgl_dpi_color_trans_done(esp_lcd_panel_handle_t panel,
                                                    esp_lcd_dpi_panel_event_data_t *edata,
                                                    void *user_ctx)
{
    (void)panel;
    (void)edata;
    return lua_lvgl_flush_done_cb(NULL, NULL, user_ctx);
}

/* DPI/MIPI: frame finished scanning out (FULL/FB-swap vsync). */
static IRAM_ATTR bool lua_lvgl_dpi_refresh_done(esp_lcd_panel_handle_t panel,
                                                esp_lcd_dpi_panel_event_data_t *edata,
                                                void *user_ctx)
{
    (void)panel;
    (void)edata;
    return lua_lvgl_flush_done_cb(NULL, NULL, user_ctx);
}

#endif

static esp_err_t lua_lvgl_register_flush_callbacks_locked(void)
{
    if (s_lvgl.panel_if == LUA_MODULE_LVGL_PANEL_IF_IO) {
        ESP_RETURN_ON_FALSE(s_lvgl.io != NULL, ESP_ERR_INVALID_STATE, TAG, "io handle missing");

        const esp_lcd_panel_io_callbacks_t callbacks = {
            .on_color_trans_done = lua_lvgl_flush_done_cb,
        };
        esp_err_t err = esp_lcd_panel_io_register_event_callbacks(s_lvgl.io, &callbacks, &s_lvgl);

        if (err == ESP_OK) {
            s_lvgl.flush_callbacks_registered = true;
        }
        return err;
    }

#if CONFIG_IDF_TARGET_ESP32P4
    if (s_lvgl.panel_if == LUA_MODULE_LVGL_PANEL_IF_MIPI_DSI ||
        s_lvgl.panel_if == LUA_MODULE_LVGL_PANEL_IF_RGB) {
        esp_lcd_dpi_panel_event_callbacks_t cbs = {0};
        /* FB swap paints into the panel's own buffers — there is no user-buf
         * copy. Wait on refresh_done (vsync) like esp_lvgl_port avoid_tearing.
         * Partial still copies strips → color_trans_done. */
        if (s_lvgl.fb_swap_mode) {
            cbs.on_refresh_done = lua_lvgl_dpi_refresh_done;
        } else {
            cbs.on_color_trans_done = lua_lvgl_dpi_color_trans_done;
        }
        esp_err_t err = esp_lcd_dpi_panel_register_event_callbacks(s_lvgl.panel, &cbs, &s_lvgl);
        if (err == ESP_OK) {
            s_lvgl.flush_callbacks_registered = true;
        }
        return err;
    }
    return ESP_OK;
#else
    return ESP_OK;
#endif
}

static esp_err_t lua_lvgl_clear_flush_callbacks_locked(void)
{
    if (!s_lvgl.flush_callbacks_registered) {
        return ESP_OK;
    }
    if (s_lvgl.panel_if == LUA_MODULE_LVGL_PANEL_IF_IO) {
        ESP_RETURN_ON_FALSE(s_lvgl.io != NULL, ESP_ERR_INVALID_STATE, TAG, "io handle missing");

        const esp_lcd_panel_io_callbacks_t callbacks = {0};
        esp_err_t err = esp_lcd_panel_io_register_event_callbacks(s_lvgl.io, &callbacks, NULL);

        if (err == ESP_OK) {
            s_lvgl.flush_callbacks_registered = false;
        }
        return err;
    }
#if CONFIG_IDF_TARGET_ESP32P4
    if ((s_lvgl.panel_if == LUA_MODULE_LVGL_PANEL_IF_MIPI_DSI ||
         s_lvgl.panel_if == LUA_MODULE_LVGL_PANEL_IF_RGB) &&
        s_lvgl.panel) {
        const esp_lcd_dpi_panel_event_callbacks_t cbs = {0};
        esp_err_t err = esp_lcd_dpi_panel_register_event_callbacks(s_lvgl.panel, &cbs, NULL);
        if (err == ESP_OK) {
            s_lvgl.flush_callbacks_registered = false;
        }
        return err;
    }
    s_lvgl.flush_callbacks_registered = false;
    return ESP_OK;
#else
    s_lvgl.flush_callbacks_registered = false;
    return ESP_OK;
#endif
}

static void lua_lvgl_wait_flush_done(void)
{
    if (!s_lvgl.flush_pending || !s_lvgl.flush_done) {
        return;
    }
    if (xSemaphoreTake(s_lvgl.flush_done, pdMS_TO_TICKS(1000)) != pdTRUE) {
        ESP_LOGW(TAG, "lvgl flush wait timeout");
    }
}

static bool lua_lvgl_panel_requires_color_swap(const lua_lvgl_state_t *state)
{
    return state && state->panel_if == LUA_MODULE_LVGL_PANEL_IF_IO;
}

static void lua_lvgl_bswap16_in_place(uint8_t *px_map, size_t pixel_count)
{
    uint16_t *pixels = (uint16_t *)px_map;

    for (size_t i = 0; i < pixel_count; i++) {
        pixels[i] = __builtin_bswap16(pixels[i]);
    }
}

static void lua_lvgl_flush_cb(lv_display_t *display, const lv_area_t *area, uint8_t *px_map)
{
    lua_lvgl_state_t *state = (lua_lvgl_state_t *)lv_display_get_user_data(display);
    bool wait_for_flush_done = state && state->flush_callbacks_registered;

    if (!state || !state->panel) {
        lv_display_flush_ready(display);
        return;
    }

    /* MIPI/RGB FULL: LVGL paints the whole frame into an inactive DPI FB;
     * last flush swaps via draw_bitmap(full, fb_ptr). Avoids DIRECT's
     * mid-scan partial paints that flicker on list scroll. */
    if (state->fb_swap_mode) {
        if (!lv_display_flush_is_last(display)) {
            /* Only the last invalid area presents a new DPI framebuffer.
             * Earlier areas already live in that same back buffer. */
            lv_display_flush_ready(display);
            return;
        }
        if (wait_for_flush_done && state->flush_done) {
            while (xSemaphoreTake(state->flush_done, 0) == pdTRUE) {
            }
            state->flush_pending = true;
        }
        esp_err_t err = esp_lcd_panel_draw_bitmap(state->panel,
                                                  0,
                                                  0,
                                                  state->width,
                                                  state->height,
                                                  px_map);
        if (err != ESP_OK) {
            state->flush_pending = false;
            ESP_LOGE(TAG, "fb-swap flush failed: %s", esp_err_to_name(err));
            lv_display_flush_ready(display);
        } else if (!wait_for_flush_done) {
            /* Non-DPI fallback: no completion callback exists to recycle the
             * framebuffer, so preserve the synchronous driver's contract. */
            lv_display_flush_ready(display);
        }
        if (err == ESP_OK) {
            lua_lvgl_indev_trace_pager_flush_submitted();
        }
        return;
    }

    if (lua_lvgl_panel_requires_color_swap(state)) {
        size_t pixel_count = (size_t)(area->x2 - area->x1 + 1) *
                             (size_t)(area->y2 - area->y1 + 1);
        lua_lvgl_bswap16_in_place(px_map, pixel_count);
    }
    if (wait_for_flush_done) {
        while (state->flush_done && xSemaphoreTake(state->flush_done, 0) == pdTRUE) {
        }
        state->flush_pending = true;
    }
    esp_err_t err = esp_lcd_panel_draw_bitmap(state->panel,
                                              area->x1,
                                              area->y1,
                                              area->x2 + 1,
                                              area->y2 + 1,
                                              px_map);
    if (err != ESP_OK) {
        state->flush_pending = false;
        ESP_LOGE(TAG, "flush failed: %s", esp_err_to_name(err));
        lv_display_flush_ready(display);
    }
    if (err == ESP_OK) {
        lua_lvgl_indev_trace_pager_flush_submitted();
    }
    if (!wait_for_flush_done) {
        lv_display_flush_ready(display);
    }
}

static void lua_lvgl_tick_timer_cb(void *arg)
{
    lua_lvgl_state_t *state = (lua_lvgl_state_t *)arg;

    lv_tick_inc(state && state->tick_ms ? state->tick_ms : LUA_MODULE_LVGL_DEFAULT_TICK_MS);
}

static void lua_lvgl_task(void *arg)
{
    lua_lvgl_state_t *state = (lua_lvgl_state_t *)arg;
    TickType_t next_wake = xTaskGetTickCount();

    while (!state->task_stop) {
        if (lua_lvgl_lock() == ESP_OK) {
            if (state->runtime_initialized) {
                lua_lvgl_indev_process_pending_locked();
                (void)lv_timer_handler();
                lua_lvgl_indev_trace_drain_locked();
            }
            lua_lvgl_unlock();
        }
        /* Schedule from the original wake phase rather than sleeping again
         * after a long render/flush pass. The latter adds one whole task
         * period to touch-to-scroll latency exactly when the UI is busy. */
        vTaskDelayUntil(&next_wake,
                         pdMS_TO_TICKS(state->task_period_ms ? state->task_period_ms :
                                                              LUA_MODULE_LVGL_DEFAULT_TASK_PERIOD_MS));
    }
    if (state->task_waiter) {
        xTaskNotifyGive(state->task_waiter);
        state->task_waiter = NULL;
    }
    state->task_handle = NULL;
    vTaskDelete(NULL);
}

static esp_err_t lua_lvgl_stop_task(void)
{
    TaskHandle_t task = s_lvgl.task_handle;

    if (!task) {
        return ESP_OK;
    }
    s_lvgl.task_waiter = xTaskGetCurrentTaskHandle();
    s_lvgl.task_stop = true;
    if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(LUA_MODULE_LVGL_TASK_STOP_TIMEOUT_MS)) == 0) {
        ESP_LOGW(TAG, "lvgl task stop timeout");
        s_lvgl.task_waiter = NULL;
        return ESP_ERR_TIMEOUT;
    }
    s_lvgl.task_waiter = NULL;
    s_lvgl.task_handle = NULL;
    return ESP_OK;
}

static esp_err_t lua_lvgl_quiesce_runtime(void)
{
    esp_err_t err = lua_lvgl_lock();

    if (err != ESP_OK) {
        return err;
    }
    if (s_lvgl.runtime_initialized) {
        s_lvgl.runtime_initialized = false;
        lua_lvgl_indev_release_locked();
        lv_anim_delete_all();
    }
    lua_lvgl_unlock();
    return ESP_OK;
}

static void lua_lvgl_drain_event_queue_locked(void)
{
    /* After lv_display_delete + invalidate_records, every record's events
     * list has already been emptied via record_release_resources. Anything
     * still sitting in the event queue is a `dead` sub waiting for the
     * script task to free it. We do that here, while still on the script
     * task and still holding the lock. */
    while (s_lvgl.event_queue_head) {
        lua_lvgl_event_sub_t *sub = s_lvgl.event_queue_head;

        s_lvgl.event_queue_head = sub->queue_next;
        sub->queue_next = NULL;
        sub->queued = false;
        lua_lvgl_queue_pending_unref_locked(sub->callback_ref);
        sub->callback_ref = LUA_NOREF;
        free(sub);
    }
    s_lvgl.event_queue_tail = NULL;
}

static void lua_lvgl_release_runtime_locked(void)
{
    /* Snapshot the owner before we clear it: lv_display_delete will fire
     * LV_EVENT_DELETE on every widget which calls record_release_resources
     * which in turn fills s_lvgl.pending_unrefs. We must drain pending
     * unrefs against the still-live owner state below. */
    lua_State *owner = s_lvgl.runtime_owner;

    /* Release input devices before tearing down the display: the LVGL
     * task is already stopped (see lua_lvgl_deinit_runtime), so no
     * read_cb can run, and lv_display_delete should not have to chase
     * dangling indev->display pointers. */
    lua_lvgl_indev_release_locked();

    if (!s_lvgl.adapter_active) {
        if (s_lvgl.flush_callbacks_registered) {
            esp_err_t err = lua_lvgl_clear_flush_callbacks_locked();
            if (err != ESP_OK) {
                ESP_LOGW(TAG, "clear flush callback failed: %s", esp_err_to_name(err));
            }
        }

        if (s_lvgl.display) {
            lv_display_set_user_data(s_lvgl.display, NULL);
            lv_display_delete(s_lvgl.display);
            s_lvgl.display = NULL;
        }
    } else {
        /* Display already unregistered outside this lock (adapter owns it). */
        s_lvgl.display = NULL;
        s_lvgl.adapter_active = false;
    }
    lua_lvgl_invalidate_records_locked();
    lua_lvgl_release_fonts_locked();
    lua_lvgl_drain_event_queue_locked();
    lua_lvgl_drain_pending_unrefs_locked(owner);
    if (s_lvgl.draw_buf_owned) {
        heap_caps_free(s_lvgl.draw_buf);
        heap_caps_free(s_lvgl.draw_buf2);
    }
    s_lvgl.draw_buf = NULL;
    s_lvgl.draw_buf2 = NULL;
    s_lvgl.draw_buf_size = 0;
    s_lvgl.draw_buf_owned = false;
    s_lvgl.fb_swap_mode = false;
    s_lvgl.panel = NULL;
    s_lvgl.io = NULL;
    s_lvgl.width = 0;
    s_lvgl.height = 0;
    s_lvgl.panel_if = LUA_MODULE_LVGL_PANEL_IF_IO;
    s_lvgl.runtime_initialized = false;
    s_lvgl.runtime_owner = NULL;
    s_lvgl.flush_callbacks_registered = false;
    s_lvgl.flush_pending = false;
    s_lvgl.generation++;
}

esp_err_t lua_lvgl_deinit_runtime(void)
{
    esp_timer_handle_t timer = s_lvgl.tick_timer;
    lv_display_t *adapter_disp = NULL;
    bool was_adapter = false;
    esp_err_t err;

    err = lua_lvgl_quiesce_runtime();
    if (err != ESP_OK) {
        return err;
    }

    was_adapter = s_lvgl.adapter_active;
    adapter_disp = s_lvgl.display;

    if (!was_adapter) {
        if (timer) {
            (void)esp_timer_stop(timer);
            (void)esp_timer_delete(timer);
            s_lvgl.tick_timer = NULL;
        }

        if (s_lvgl.task_handle) {
            err = lua_lvgl_stop_task();
            if (err != ESP_OK) {
                return err;
            }
        }
        lua_lvgl_wait_flush_done();
    } else if (adapter_disp) {
        /* Must not hold adapter lock: unregister pauses worker then locks. */
        err = esp_lv_adapter_unregister_display(adapter_disp);
        if (err != ESP_OK) {
            ESP_LOGW(TAG, "adapter unregister_display failed: %s", esp_err_to_name(err));
        }
        s_lvgl.display = NULL;
    }

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        return err;
    }
    lua_lvgl_release_runtime_locked();
    lua_lvgl_unlock();

    if (s_lvgl.display_owner_acquired) {
        err = display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
        if (err != ESP_OK && err != ESP_ERR_INVALID_STATE) {
            ESP_LOGW(TAG, "display owner release failed: %s", esp_err_to_name(err));
        }
        s_lvgl.display_owner_acquired = false;
    }
    return ESP_OK;
}
static int lua_lvgl_init(lua_State *L)
{
    esp_lcd_panel_handle_t panel = (esp_lcd_panel_handle_t)lua_touserdata(L, 1);
    esp_lcd_panel_io_handle_t io = (esp_lcd_panel_io_handle_t)lua_touserdata(L, 2);
    int width = (int)luaL_checkinteger(L, 3);
    int height = (int)luaL_checkinteger(L, 4);
    int panel_if = lua_isnoneornil(L, 5) ? LUA_MODULE_LVGL_PANEL_IF_IO : (int)luaL_checkinteger(L, 5);
    int buffer_lines = LUA_MODULE_LVGL_DEFAULT_BUFFER_LINES;
    int tick_ms = LUA_MODULE_LVGL_DEFAULT_TICK_MS;
    int task_period_ms = LUA_MODULE_LVGL_DEFAULT_TASK_PERIOD_MS;
    /* -1 = auto: MIPI/RGB → adapter-selected tear-avoidance mode;
     * explicit values select the legacy hand-rolled renderer. */
    int render_pref = -1;
    size_t draw_buf_size;
    void *draw_buf = NULL;
    void *draw_buf2 = NULL;
    lv_display_t *display = NULL;
    esp_timer_handle_t tick_timer = NULL;
    display_arbiter_owner_t owner;
    esp_timer_create_args_t timer_args = {
        .callback = lua_lvgl_tick_timer_cb,
        .arg = &s_lvgl,
        .name = "lua_lvgl_tick",
    };
    esp_err_t err;

    luaL_argcheck(L, panel != NULL, 1, "panel_handle lightuserdata expected");
    if (panel_if == LUA_MODULE_LVGL_PANEL_IF_IO) {
        luaL_argcheck(L, io != NULL, 2, "io_handle lightuserdata expected for IO panels");
    }
    luaL_argcheck(L, width > 0 && height > 0, 3, "width and height must be positive");
    luaL_argcheck(L,
                  panel_if >= LUA_MODULE_LVGL_PANEL_IF_IO && panel_if <= LUA_MODULE_LVGL_PANEL_IF_MIPI_DSI,
                  5,
                  "panel_if must be 0, 1, or 2");

    if (lua_lvgl_opt_table(L, 6)) {
        buffer_lines = lua_lvgl_get_opt_int_field(L, 6, "buffer_lines", buffer_lines);
        tick_ms = lua_lvgl_get_opt_int_field(L, 6, "tick_ms", tick_ms);
        task_period_ms = lua_lvgl_get_opt_int_field(L, 6, "task_period_ms", task_period_ms);
        /* render: omit → adapter TRIPLE_FULL on MIPI/RGB.
         * "direct"|"full"|"partial"|"legacy" → hand-rolled path. */
        lua_getfield(L, 6, "render");
        if (lua_isstring(L, -1)) {
            const char *mode = lua_tostring(L, -1);
            if (strcmp(mode, "direct") == 0 || strcmp(mode, "legacy") == 0) {
                render_pref = 0;
            } else if (strcmp(mode, "full") == 0) {
                render_pref = 1;
            } else if (strcmp(mode, "partial") == 0) {
                render_pref = 2;
            }
        }
        lua_pop(L, 1);
        if (lua_lvgl_get_opt_bool_field(L, 6, "fb_swap", false)) {
            render_pref = 1;
        }
    }
    luaL_argcheck(L, buffer_lines > 0 && buffer_lines <= height, 6, "buffer_lines must be in range 1..height");
    luaL_argcheck(L, tick_ms > 0, 6, "tick_ms must be positive");
    luaL_argcheck(L, task_period_ms > 0, 6, "task_period_ms must be positive");

    if (!s_lvgl.mutex) {
        s_lvgl.mutex = xSemaphoreCreateMutex();
        if (!s_lvgl.mutex) {
            return lua_lvgl_error_esp(L, "create mutex", ESP_ERR_NO_MEM);
        }
    }
    if (!s_lvgl.flush_done) {
        s_lvgl.flush_done = xSemaphoreCreateBinary();
        if (!s_lvgl.flush_done) {
            return lua_lvgl_error_esp(L, "create flush semaphore", ESP_ERR_NO_MEM);
        }
    }

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    if (s_lvgl.runtime_initialized) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl runtime is already initialized");
    }
    lua_lvgl_unlock();

    owner = display_arbiter_get_owner();
    if (owner == DISPLAY_ARBITER_OWNER_LUA) {
        return luaL_error(L,
                          "display is already owned by Lua; deinit display/lvgl before lvgl.init");
    }
    if (owner != DISPLAY_ARBITER_OWNER_NONE && owner != DISPLAY_ARBITER_OWNER_EMOTE) {
        return luaL_error(L,
                          "display is already owned by %s",
                          lua_lvgl_display_owner_name(owner));
    }

    err = display_arbiter_acquire(DISPLAY_ARBITER_OWNER_LUA);
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "acquire display", err);
    }
    s_lvgl.display_owner_acquired = true;

    /* MIPI/RGB default: esp_lvgl_adapter TRIPLE_FULL. The pager moves opaque
     * page bitmaps across most of the viewport for every drag frame, so it
     * benefits from rendering straight into one of the three non-visible DPI
     * framebuffers instead of repeatedly composing 100-line partial stripes.
     * Hand-rolled DIRECT/FULL/PARTIAL remains available through `render`. */
    bool use_adapter =
        (panel_if == LUA_MODULE_LVGL_PANEL_IF_MIPI_DSI ||
         panel_if == LUA_MODULE_LVGL_PANEL_IF_RGB) &&
        (render_pref < 0);

    if (use_adapter) {
        esp_lv_adapter_config_t acfg = ESP_LV_ADAPTER_DEFAULT_CONFIG();
        int buf_h = buffer_lines;

        acfg.task_core_id = LUA_MODULE_LVGL_TASK_CORE;
        acfg.tick_period_ms = (uint32_t)tick_ms;
        acfg.task_min_delay_ms = 1;
        acfg.task_max_delay_ms = (uint32_t)task_period_ms;
        acfg.task_priority = LUA_MODULE_LVGL_TASK_PRIO + 1;
        acfg.task_stack_size = LUA_MODULE_LVGL_TASK_STACK;

        /* Preserve the safe strip value for an explicitly selected partial
         * renderer. TRIPLE_FULL binds the three panel framebuffers directly,
         * so this value does not allocate an additional production strip. */
        if (buf_h < 100) {
            buf_h = 100;
        }
        if (buf_h > height) {
            buf_h = height;
        }

        if (!esp_lv_adapter_is_initialized()) {
            err = esp_lv_adapter_init(&acfg);
            if (err != ESP_OK) {
                (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
                s_lvgl.display_owner_acquired = false;
                return lua_lvgl_error_esp(L, "adapter init", err);
            }
        }

        esp_lv_adapter_display_config_t disp_cfg =
            (panel_if == LUA_MODULE_LVGL_PANEL_IF_RGB)
                ? ESP_LV_ADAPTER_DISPLAY_RGB_DEFAULT_CONFIG(
                      panel, io, (uint16_t)width, (uint16_t)height, ESP_LV_ADAPTER_ROTATE_0)
                : ESP_LV_ADAPTER_DISPLAY_MIPI_DEFAULT_CONFIG(
                      panel, io, (uint16_t)width, (uint16_t)height, ESP_LV_ADAPTER_ROTATE_0);
        disp_cfg.profile.buffer_height = (uint16_t)buf_h;
        disp_cfg.profile.enable_ppa_accel = true;
        disp_cfg.tear_avoid_mode = ESP_LV_ADAPTER_TEAR_AVOID_MODE_TRIPLE_FULL;

        display = esp_lv_adapter_register_display(&disp_cfg);
        if (!display) {
            (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
            s_lvgl.display_owner_acquired = false;
            return luaL_error(L, "esp_lv_adapter_register_display failed");
        }

        err = esp_lv_adapter_start();
        if (err != ESP_OK) {
            (void)esp_lv_adapter_unregister_display(display);
            (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
            s_lvgl.display_owner_acquired = false;
            return lua_lvgl_error_esp(L, "adapter start", err);
        }

        /* Adapter owns display user_data (display_node). Do not overwrite. */
        s_lvgl.adapter_active = true;
        err = lua_lvgl_lock();
        if (err != ESP_OK) {
            s_lvgl.adapter_active = false;
            (void)esp_lv_adapter_unregister_display(display);
            (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
            s_lvgl.display_owner_acquired = false;
            return lua_lvgl_error_esp(L, "lock", err);
        }

        s_lvgl.lvgl_initialized = true;
        err = lua_lvgl_register_fs_locked();
        if (err != ESP_OK) {
            lua_lvgl_unlock();
            s_lvgl.adapter_active = false;
            (void)esp_lv_adapter_unregister_display(display);
            (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
            s_lvgl.display_owner_acquired = false;
            return lua_lvgl_error_esp(L, "register fs", err);
        }

        s_lvgl.panel = panel;
        s_lvgl.io = io;
        s_lvgl.width = width;
        s_lvgl.height = height;
        s_lvgl.panel_if = panel_if;
        s_lvgl.tick_ms = (uint32_t)tick_ms;
        s_lvgl.task_period_ms = (uint32_t)task_period_ms;
        s_lvgl.draw_buf = NULL;
        s_lvgl.draw_buf2 = NULL;
        s_lvgl.draw_buf_size = 0;
        s_lvgl.draw_buf_owned = false;
        s_lvgl.fb_swap_mode = false;
        s_lvgl.display = display;
        s_lvgl.runtime_initialized = true;
        s_lvgl.runtime_owner = L;
        s_lvgl.task_stop = false;
        s_lvgl.flush_callbacks_registered = false;
        lua_lvgl_register_pager_trace_events_locked(display);
        lua_lvgl_unlock();

        ESP_LOGI(TAG,
                 "LVGL adapter TRIPLE_FULL: %dx%d RGB565, 3 panel FBs, PPA on",
                 width, height);
        lua_pushboolean(L, 1);
        return 1;
    }

    bool use_fb_swap = false;
    bool buf_owned = true;
    lv_display_render_mode_t render_mode = LV_DISPLAY_RENDER_MODE_PARTIAL;

    /* Default DPI/MIPI render mode: FULL (1) ensures every frame is drawn
     * completely into the inactive back buffer before VSYNC swap, eliminating
     * partial-dirty tearing during screen animations across multi-buffer displays. */
#if CONFIG_IDF_TARGET_ESP32P4
    if (render_pref < 0 &&
        (panel_if == LUA_MODULE_LVGL_PANEL_IF_MIPI_DSI ||
         panel_if == LUA_MODULE_LVGL_PANEL_IF_RGB)) {
        render_pref = 1; /* FULL */
    }
    if ((render_pref == 0 || render_pref == 1) &&
        (panel_if == LUA_MODULE_LVGL_PANEL_IF_MIPI_DSI ||
         panel_if == LUA_MODULE_LVGL_PANEL_IF_RGB)) {
        void *fb0 = NULL;
        void *fb1 = NULL;
        if (esp_lcd_dpi_panel_get_frame_buffer(panel, 2, &fb0, &fb1) == ESP_OK &&
            fb0 != NULL && fb1 != NULL) {
            draw_buf = fb0;
            draw_buf2 = fb1;
            draw_buf_size = (size_t)width * (size_t)height * 2; /* RGB565 */
            use_fb_swap = true;
            buf_owned = false;
            if (render_pref == 1) {
                render_mode = LV_DISPLAY_RENDER_MODE_FULL;
                ESP_LOGI(TAG, "LVGL FULL: DPI FBs %dx%d RGB565 (%u B x2, vsync swap)",
                         width, height, (unsigned)draw_buf_size);
            } else {
                render_mode = LV_DISPLAY_RENDER_MODE_DIRECT;
                ESP_LOGI(TAG, "LVGL DIRECT: DPI FBs %dx%d RGB565 (%u B x2, vsync swap)",
                         width, height, (unsigned)draw_buf_size);
            }
        } else {
            ESP_LOGW(TAG, "DPI get_frame_buffer failed — falling back to partial SRAM");
            render_pref = 2;
        }
    }
#endif

    if (!use_fb_swap) {
        /* Prefer fewer, taller strips on DSI: less DMA round-trips while scrolling. */
        if ((panel_if == LUA_MODULE_LVGL_PANEL_IF_MIPI_DSI ||
             panel_if == LUA_MODULE_LVGL_PANEL_IF_RGB) &&
            buffer_lines < height / 4) {
            int prefer = height / 4; /* ~200 lines on 800p */
            if (prefer > buffer_lines) {
                buffer_lines = prefer;
            }
        }
        draw_buf_size = (size_t)width * (size_t)buffer_lines * 2; /* RGB565 bytes */
        if (panel_if == LUA_MODULE_LVGL_PANEL_IF_IO) {
            draw_buf = heap_caps_malloc(draw_buf_size, MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
        } else {
            /* P4 best practice: internal DMA draw buf + DMA2D flush beats PSRAM
             * canvas for partial mode (ESPHome / esp_lvgl_port guidance). */
            draw_buf = heap_caps_aligned_alloc(64, draw_buf_size,
                                               MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
            if (!draw_buf) {
                draw_buf = heap_caps_malloc(draw_buf_size,
                                            MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
            }
            if (!draw_buf) {
                ESP_LOGW(TAG, "internal draw buf OOM (%u bytes) — falling back to PSRAM",
                         (unsigned)draw_buf_size);
                draw_buf = heap_caps_aligned_alloc(64, draw_buf_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
            }
        }
        if (!draw_buf && panel_if != LUA_MODULE_LVGL_PANEL_IF_IO) {
            draw_buf = heap_caps_malloc(draw_buf_size, MALLOC_CAP_8BIT);
        }
        if (!draw_buf && panel_if == LUA_MODULE_LVGL_PANEL_IF_IO) {
            draw_buf = heap_caps_malloc(draw_buf_size, MALLOC_CAP_8BIT | MALLOC_CAP_DMA);
        }
        if (!draw_buf) {
            (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
            s_lvgl.display_owner_acquired = false;
            return luaL_error(L, "lvgl draw buffer allocation failed; reduce buffer_lines");
        }
        /* Second partial buffer pipelines render while DMA2D copies the first. */
        if (panel_if != LUA_MODULE_LVGL_PANEL_IF_IO) {
            draw_buf2 = heap_caps_aligned_alloc(64, draw_buf_size,
                                                MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
            if (!draw_buf2) {
                draw_buf2 = heap_caps_malloc(draw_buf_size,
                                             MALLOC_CAP_INTERNAL | MALLOC_CAP_DMA | MALLOC_CAP_8BIT);
            }
            if (!draw_buf2) {
                draw_buf2 = heap_caps_aligned_alloc(64, draw_buf_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
            }
            if (!draw_buf2) {
                draw_buf2 = heap_caps_malloc(draw_buf_size, MALLOC_CAP_8BIT);
            }
            ESP_LOGI(TAG, "LVGL draw buffers: %u lines x%s (%u B each, %s/%s)",
                     (unsigned)buffer_lines, draw_buf2 ? "2" : "1", (unsigned)draw_buf_size,
                     esp_ptr_internal(draw_buf) ? "SRAM" : "PSRAM",
                     draw_buf2 ? (esp_ptr_internal(draw_buf2) ? "SRAM" : "PSRAM") : "-");
        }
    }

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        if (buf_owned) {
            heap_caps_free(draw_buf);
            heap_caps_free(draw_buf2);
        }
        (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
        s_lvgl.display_owner_acquired = false;
        return lua_lvgl_error_esp(L, "lock", err);
    }

    if (!s_lvgl.lvgl_initialized) {
        ESP_LOGI(TAG, "TRACE: calling lv_init()");
        lv_init();
        s_lvgl.lvgl_initialized = true;
        ESP_LOGI(TAG, "TRACE: lv_init() done");
    }
    ESP_LOGI(TAG, "TRACE: calling register_fs_locked");
    err = lua_lvgl_register_fs_locked();
    if (err != ESP_OK) {
        lua_lvgl_unlock();
        if (buf_owned) {
            heap_caps_free(draw_buf);
            heap_caps_free(draw_buf2);
        }
        (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
        s_lvgl.display_owner_acquired = false;
        return lua_lvgl_error_esp(L, "register fs", err);
    }
    ESP_LOGI(TAG, "TRACE: register_fs_locked done, creating display");

    display = lv_display_create(width, height);
    if (!display) {
        lua_lvgl_unlock();
        if (buf_owned) {
            heap_caps_free(draw_buf);
            heap_caps_free(draw_buf2);
        }
        (void)display_arbiter_release(DISPLAY_ARBITER_OWNER_LUA);
        s_lvgl.display_owner_acquired = false;
        return luaL_error(L, "lvgl display create failed");
    }

    s_lvgl.panel = panel;
    s_lvgl.io = io;
    s_lvgl.width = width;
    s_lvgl.height = height;
    s_lvgl.panel_if = panel_if;
    s_lvgl.tick_ms = (uint32_t)tick_ms;
    s_lvgl.task_period_ms = (uint32_t)task_period_ms;
    s_lvgl.draw_buf = draw_buf;
    s_lvgl.draw_buf2 = draw_buf2;
    s_lvgl.draw_buf_size = draw_buf_size;
    s_lvgl.draw_buf_owned = buf_owned;
    s_lvgl.fb_swap_mode = use_fb_swap;
    s_lvgl.display = display;
    s_lvgl.runtime_initialized = true;
    s_lvgl.runtime_owner = L;
    s_lvgl.task_stop = false;

    lv_display_set_user_data(display, &s_lvgl);
    /* Match ST7701 DPI RGB565 — avoid LVGL's default 24-bit internal canvas. */
    lv_display_set_color_format(display, LV_COLOR_FORMAT_RGB565);
    lv_display_set_buffers(display, draw_buf, draw_buf2, (uint32_t)draw_buf_size, render_mode);
    lv_display_set_flush_cb(display, lua_lvgl_flush_cb);
    lua_lvgl_register_pager_trace_events_locked(display);
    err = lua_lvgl_register_flush_callbacks_locked();
    if (err != ESP_OK) {
        lua_lvgl_unlock();
        (void)lua_lvgl_deinit_runtime();
        return lua_lvgl_error_esp(L, "register flush callback", err);
    }
    lua_lvgl_unlock();

    err = esp_timer_create(&timer_args, &tick_timer);
    if (err != ESP_OK) {
        (void)lua_lvgl_deinit_runtime();
        return lua_lvgl_error_esp(L, "create tick timer", err);
    }
    s_lvgl.tick_timer = tick_timer;
    err = esp_timer_start_periodic(tick_timer, (uint64_t)tick_ms * 1000ULL);
    if (err != ESP_OK) {
        (void)lua_lvgl_deinit_runtime();
        return lua_lvgl_error_esp(L, "start tick timer", err);
    }

#ifndef __EMSCRIPTEN__
    if (xTaskCreatePinnedToCore(lua_lvgl_task,
                                "lua_lvgl",
                                LUA_MODULE_LVGL_TASK_STACK,
                                &s_lvgl,
                                LUA_MODULE_LVGL_TASK_PRIO,
                                &s_lvgl.task_handle,
                                LUA_MODULE_LVGL_TASK_CORE) != pdPASS) {
        (void)lua_lvgl_deinit_runtime();
        return lua_lvgl_error_esp(L, "create task", ESP_ERR_NO_MEM);
    }
#endif

    lua_pushboolean(L, 1);
    return 1;
}

static int lua_lvgl_deinit(lua_State *L)
{
    esp_err_t err;

    if (s_lvgl.runtime_initialized && s_lvgl.runtime_owner != L) {
        return luaL_error(L, "lvgl runtime is owned by another Lua runtime");
    }

    err = lua_lvgl_deinit_runtime();

    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "deinit", err);
    }
    lua_pushboolean(L, 1);
    return 1;
}

static int lua_lvgl_tick_ms(lua_State *L)
{
    lua_pushinteger(L, (lua_Integer)lv_tick_get());
    return 1;
}

void lua_lvgl_exit_cleanup(lua_State *L)
{
    /* Single-script subsystem: only the runtime owner triggers a deinit on
     * exit. Non-owner Lua states are expected to never create LVGL objects
     * per the single-script rule (see RFC-single-script-ui.md), so no
     * per-state object cleanup is performed here. */
    if (!L) {
        return;
    }
    if (s_lvgl.runtime_initialized && s_lvgl.runtime_owner == L) {
        ESP_LOGI(TAG, "Lua exit cleanup: deinitializing lvgl owned by exiting state");
        (void)lua_lvgl_deinit_runtime();
    }
}

const luaL_Reg lua_lvgl_runtime_funcs[] = {
    {"init", lua_lvgl_init},
    {"deinit", lua_lvgl_deinit},
    {"tick_ms", lua_lvgl_tick_ms},
    {NULL, NULL},
};
