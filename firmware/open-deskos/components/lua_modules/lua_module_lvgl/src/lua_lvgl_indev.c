/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Input device subsystem (P4 of RFC-single-script-ui.md).
 *
 * Scope of this revision: a single LV_INDEV_TYPE_POINTER backed by an
 * esp_lcd_touch_handle_t obtained from board_manager. Encoder and keypad
 * indevs are intentionally deferred to a follow-up PR (the registration
 * surface here accepts a kind string so adding them later is purely
 * additive).
 *
 * Threading model on hardware:
 *   - GT911 is wired without an interrupt line on the Guition P4, so a small
 *     core-0 task owns all I2C reads at a fixed 4 ms cadence. It stores only
 *     semantic PRESS/MOVE/RELEASE samples in a fixed, cross-core-safe queue.
 *   - The LVGL read callback runs inside lua_lvgl_lock(). It never touches
 *     I2C and consumes one semantic sample per LVGL task pass. This retains
 *     a short press-move-release gesture without replaying its historical
 *     movement in one frame after a busy render.
 *   - The esp_lcd_touch handle remains borrowed from board_manager. The
 *     sampler is stopped and joined before the indev is deleted; it never
 *     calls Lua or LVGL APIs itself.
 *
 * Native SDL has no target FreeRTOS/I2C execution path, so it retains the
 * direct callback as a simulation-only fallback.
 */

#include "lua_lvgl_private.h"

#include <inttypes.h>

#include "esp_lcd_touch.h"
#ifndef __EMSCRIPTEN__
#include "core/lv_obj_private.h"
#include "core/lv_obj_tree.h"
#include "lua_lvgl_touch_sample_queue.h"
#endif

static const char *TAG = "lua_lvgl_indev";

/* --- Internal helpers -------------------------------------------------- */

#ifdef __EMSCRIPTEN__

/* SDL does not run the target FreeRTOS task topology, so keep direct polling
 * only for the simulator. Hardware always uses the independent sampler below. */
static void lua_lvgl_touch_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    esp_lcd_touch_handle_t tp = (esp_lcd_touch_handle_t)lv_indev_get_user_data(indev);
    esp_lcd_touch_point_data_t point;
    uint8_t point_count = 0;

    if (!tp || esp_lcd_touch_read_data(tp) != ESP_OK) {
        data->state = LV_INDEV_STATE_RELEASED;
        return;
    }
    if (esp_lcd_touch_get_data(tp, &point, &point_count, 1) == ESP_OK && point_count > 0) {
        data->point.x = (int32_t)point.x;
        data->point.y = (int32_t)point.y;
        data->state = LV_INDEV_STATE_PRESSED;
    } else {
        data->state = LV_INDEV_STATE_RELEASED;
    }
}

/* The SDL compatibility path keeps timer-driven mouse polling; its event loop
 * already delivers input synchronously, so there is no hardware sampler to
 * bridge into LVGL event mode. */
void lua_lvgl_indev_process_pending_locked(void)
{
}

void lua_lvgl_indev_trace_pager_scroll_begin_locked(void)
{
}

void lua_lvgl_indev_trace_pager_scroll_end_locked(void)
{
}

void lua_lvgl_indev_trace_pager_phase_locked(lua_lvgl_pager_trace_phase_t phase)
{
    (void)phase;
}

void lua_lvgl_indev_trace_pager_flush_submitted(void)
{
}

void lua_lvgl_indev_trace_display_event_locked(lv_event_code_t code)
{
    (void)code;
}

void lua_lvgl_indev_trace_drain_locked(void)
{
}

#else

#define LUA_LVGL_TOUCH_SAMPLE_PERIOD_MS 4
#define LUA_LVGL_TOUCH_SAMPLE_MOVE_DELTA_PX 2
#define LUA_LVGL_TOUCH_ERROR_GRACE_SAMPLES 3
#define LUA_LVGL_TOUCH_NO_CONTACT_GRACE_SAMPLES 3
#define LUA_LVGL_TOUCH_SAMPLER_STACK 4096
#define LUA_LVGL_TOUCH_SAMPLER_PRIO LUA_MODULE_LVGL_TASK_PRIO
#define LUA_LVGL_TOUCH_SAMPLER_CORE 0
#define LUA_LVGL_TOUCH_BRIDGE_PERIOD_MS 2
/* A pager release snap normally completes in 180 ms. Leave enough room for
 * a slow frame and scanout, then report a missing terminal scroll event
 * instead of keeping the one-per-gesture trace armed indefinitely. */
#define LUA_LVGL_PAGER_TRACE_UNFINISHED_TIMEOUT_MS 750
/* Keep only the slowest frames from a completed physical gesture. Logging
 * inside the display-event callback would perturb the very refresh cadence we
 * are measuring, so frames are ranked here and emitted after the gesture. */
#define LUA_LVGL_PAGER_TRACE_SLOW_FRAME_COUNT 3
#define LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT 5
/* The home screen constructs its direct roots in a stable order: pager,
 * status bar, peek, then any later chrome. Capture only a small fixed prefix
 * so the diagnostic remains aggregate-only and never serializes widget names
 * or individual objects. */
#define LUA_LVGL_PAGER_TRACE_ACTIVE_BRANCH_COUNT 4
/* The pager itself has three moving bitmap wrappers followed by one floating
 * live input overlay. Keep this probe equally aggregate-only: it identifies
 * the branch that dirties layout without emitting object pointers or names. */
#define LUA_LVGL_PAGER_TRACE_PAGER_BRANCH_COUNT 4

/* `lv_refr.c` updates these display roots in this order. Capturing their
 * pre-refresh dirty bits and individual update durations distinguishes a
 * genuinely dirty home screen from a harmless layer traversal. */
typedef enum {
    LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_ACTIVE = 0,
    LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_PREVIOUS,
    LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BOTTOM,
    LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_TOP,
    LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_SYSTEM,
} lua_lvgl_pager_trace_layout_root_t;

#define LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BIT(root) ((uint8_t)(1u << (root)))

typedef struct {
    uint32_t refresh_ms;
    uint32_t layout_ms;
    uint32_t layout_step_ms[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT];
    uint32_t post_layout_ms;
    uint32_t pre_render_ms;
    uint32_t render_ms;
    uint32_t flush_ms;
    uint32_t flush_wait_ms;
    uint16_t refresh_index;
    lua_lvgl_pager_trace_phase_t phase;
    uint8_t layout_dirty_mask;
    uint8_t layout_present_mask;
    uint16_t layout_dirty_node_count[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT];
    uint16_t active_branch_dirty_node_count[LUA_LVGL_PAGER_TRACE_ACTIVE_BRANCH_COUNT];
    uint16_t pager_branch_dirty_node_count[LUA_LVGL_PAGER_TRACE_PAGER_BRANCH_COUNT];
} lua_lvgl_pager_trace_frame_t;

typedef struct {
    bool active;
    bool scroll_started;
    bool scroll_ended;
    bool unfinished_scroll;
    bool first_present_observed;
    bool end_present_observed;
    uint32_t sequence;
    uint32_t press_sample_ms;
    uint32_t first_move_sample_ms;
    uint32_t release_sample_ms;
    uint32_t press_delivered_ms;
    uint32_t scroll_begin_ms;
    uint32_t scroll_end_ms;
    uint32_t first_present_ms;
    uint32_t end_present_ms;
    uint32_t first_flush_ms;
    uint32_t refresh_started_ms;
    uint32_t last_refresh_started_ms;
    uint32_t layout_completed_ms;
    uint32_t layout_step_started_ms;
    uint32_t render_started_ms;
    uint32_t flush_started_ms;
    uint32_t flush_wait_started_ms;
    uint32_t frame_layout_ms;
    uint32_t frame_layout_step_ms[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT];
    uint32_t frame_post_layout_ms;
    uint32_t frame_pre_render_ms;
    uint32_t frame_render_ms;
    uint32_t frame_flush_ms;
    uint32_t frame_flush_wait_ms;
    lua_lvgl_pager_trace_phase_t frame_phase;
    uint8_t frame_layout_dirty_mask;
    uint8_t frame_layout_present_mask;
    uint8_t frame_layout_completed_mask;
    uint16_t frame_layout_dirty_node_count[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT];
    uint16_t frame_active_branch_dirty_node_count[LUA_LVGL_PAGER_TRACE_ACTIVE_BRANCH_COUNT];
    uint16_t frame_pager_branch_dirty_node_count[LUA_LVGL_PAGER_TRACE_PAGER_BRANCH_COUNT];
    uint32_t max_refresh_ms;
    uint32_t max_frame_gap_ms;
    uint32_t max_layout_ms;
    uint32_t max_post_layout_ms;
    uint32_t max_pre_render_ms;
    uint32_t max_render_ms;
    uint32_t max_flush_ms;
    uint32_t max_flush_wait_ms;
    uint32_t present_sequence_at_begin;
    uint32_t present_sequence_at_end;
    uint32_t max_sample_lag_ms;
    uint32_t max_i2c_read_us;
    uint16_t sample_count;
    uint16_t move_count;
    uint16_t delivered_count;
    uint16_t refresh_count;
    uint16_t layout_count;
    uint16_t post_layout_count;
    uint16_t pre_render_count;
    uint16_t render_count;
    uint16_t flush_count;
    uint16_t flush_wait_count;
    uint16_t refresh_index;
    uint8_t slow_frame_count;
    lua_lvgl_pager_trace_frame_t slow_frames[LUA_LVGL_PAGER_TRACE_SLOW_FRAME_COUNT];
    uint8_t max_queue_depth;
    uint8_t max_no_contact_streak;
    uint8_t read_error_count;
    uint8_t press_count;
} lua_lvgl_pager_trace_t;

struct lua_lvgl_touch_sampler {
    esp_lcd_touch_handle_t touch;
    lua_lvgl_touch_sample_queue_t queue;
    portMUX_TYPE queue_lock;
    TaskHandle_t task;
    SemaphoreHandle_t stopped;
    StaticSemaphore_t stopped_storage;
    volatile bool stop_requested;
    bool sampled_pressed;
    bool lvgl_gesture_active;
    /* Protected by queue_lock. Set by the sampler whenever a semantic edge
     * or latest MOVE is available; consumed by the LVGL task in event mode. */
    bool input_event_pending;
    /* Protected by queue_lock. Updated by native pager lifecycle callbacks
     * and copied at each refresh start into the matching frame sample. */
    lua_lvgl_pager_trace_phase_t pager_trace_phase;
    uint8_t consecutive_read_errors;
    uint8_t consecutive_no_contact_samples;
    lv_point_t sampled_point;
    lv_point_t last_queued_point;
    lv_point_t delivered_point;
    lv_indev_state_t delivered_state;
    uint32_t read_errors;
    uint32_t rejected_samples;
    uint32_t discarded_completed_samples;
    lua_lvgl_pager_trace_t pager_trace;
};

static uint32_t lua_lvgl_elapsed_ms(uint32_t start, uint32_t end)
{
    return end - start;
}

typedef struct {
    uint16_t count;
} lua_lvgl_pager_trace_dirty_counter_t;

static lv_obj_tree_walk_res_t lua_lvgl_pager_trace_count_dirty_nodes_cb(lv_obj_t *obj,
                                                                         void *user_data)
{
    lua_lvgl_pager_trace_dirty_counter_t *counter = user_data;

    if (obj->layout_inv && counter->count < UINT16_MAX) {
        counter->count++;
    }
    return LV_OBJ_TREE_WALK_NEXT;
}

/* Count only already-invalid layout nodes. This runs while a one-shot pager
 * trace is active, before LVGL clears the root dirty bit, and retains numbers
 * rather than per-widget names so it cannot perturb the hot path with logs. */
static uint16_t lua_lvgl_pager_trace_count_dirty_nodes(lv_obj_t *root)
{
    lua_lvgl_pager_trace_dirty_counter_t counter = {0};

    if (root) {
        lv_obj_tree_walk(root, lua_lvgl_pager_trace_count_dirty_nodes_cb, &counter);
    }
    return counter.count;
}

/* This runs inside LVGL's display refresh callback, so the display roots are
 * stable. It deliberately reads the private root dirty bit before lv_refr.c
 * calls lv_obj_update_layout() and clears it. */
static void lua_lvgl_pager_trace_capture_layout_roots(uint8_t *present_mask,
                                                       uint8_t *dirty_mask,
                                                       uint16_t *dirty_node_count,
                                                       uint16_t *active_branch_dirty_node_count,
                                                       uint16_t *pager_branch_dirty_node_count)
{
    lv_display_t *display = s_lvgl.display;
    lv_obj_t *roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT];

    *present_mask = 0;
    *dirty_mask = 0;
    memset(dirty_node_count, 0,
           sizeof(uint16_t) * LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT);
    memset(active_branch_dirty_node_count, 0,
           sizeof(uint16_t) * LUA_LVGL_PAGER_TRACE_ACTIVE_BRANCH_COUNT);
    memset(pager_branch_dirty_node_count, 0,
           sizeof(uint16_t) * LUA_LVGL_PAGER_TRACE_PAGER_BRANCH_COUNT);
    if (!display) {
        return;
    }

    roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_ACTIVE] = lv_display_get_screen_active(display);
    roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_PREVIOUS] = lv_display_get_screen_prev(display);
    roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BOTTOM] = lv_display_get_layer_bottom(display);
    roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_TOP] = lv_display_get_layer_top(display);
    roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_SYSTEM] = lv_display_get_layer_sys(display);

    for (uint8_t root = 0; root < LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT; root++) {
        if (!roots[root]) {
            continue;
        }
        *present_mask |= LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BIT(root);
        if (roots[root]->scr_layout_inv) {
            *dirty_mask |= LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BIT(root);
            dirty_node_count[root] = lua_lvgl_pager_trace_count_dirty_nodes(roots[root]);
        }
    }

    /* The active screen is the only root with app UI. Its first three direct
     * branches are constructed by build_home() as pager, status bar, and peek;
     * retaining a fourth slot leaves this probe valid if a small chrome branch
     * is added later. */
    if (roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_ACTIVE] &&
        roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_ACTIVE]->scr_layout_inv) {
        lv_obj_t *active = roots[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_ACTIVE];
        uint32_t child_count = lv_obj_get_child_count(active);
        uint32_t branch_count = LV_MIN(child_count,
                                       LUA_LVGL_PAGER_TRACE_ACTIVE_BRANCH_COUNT);

        for (uint32_t branch = 0; branch < branch_count; branch++) {
            active_branch_dirty_node_count[branch] =
                lua_lvgl_pager_trace_count_dirty_nodes(lv_obj_get_child(active, branch));
        }

        /* build_home() places the pager at screen child zero. Its direct
         * children are the three bitmap wrappers and the fixed live overlay;
         * a separate count distinguishes which of those branches spreads the
         * layout invalidation without changing the gesture hot path. */
        lv_obj_t *pager = lv_obj_get_child(active, 0);
        uint32_t pager_child_count = pager ? lv_obj_get_child_count(pager) : 0;
        uint32_t pager_branch_count = LV_MIN(pager_child_count,
                                             LUA_LVGL_PAGER_TRACE_PAGER_BRANCH_COUNT);

        for (uint32_t branch = 0; branch < pager_branch_count; branch++) {
            pager_branch_dirty_node_count[branch] =
                lua_lvgl_pager_trace_count_dirty_nodes(lv_obj_get_child(pager, branch));
        }
    }
}

static int lua_lvgl_pager_trace_next_layout_root(uint8_t present_mask,
                                                  uint8_t completed_mask)
{
    for (uint8_t root = 0; root < LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_COUNT; root++) {
        uint8_t bit = LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BIT(root);

        if ((present_mask & bit) != 0 && (completed_mask & bit) == 0) {
            return root;
        }
    }
    return -1;
}

static void lua_lvgl_pager_trace_reset_locked(lua_lvgl_touch_sampler_t *sampler,
                                              const lua_lvgl_touch_sample_t *sample)
{
    uint32_t next_sequence = sampler->pager_trace.sequence + 1;

    memset(&sampler->pager_trace, 0, sizeof(sampler->pager_trace));
    sampler->pager_trace.active = true;
    sampler->pager_trace.sequence = next_sequence;
    sampler->pager_trace.press_sample_ms = sample->timestamp;
    sampler->pager_trace.sample_count = 1;
    sampler->pager_trace.press_count = 1;
}

static void lua_lvgl_pager_trace_note_sample_locked(lua_lvgl_touch_sampler_t *sampler,
                                                     const lua_lvgl_touch_sample_t *sample)
{
    lua_lvgl_pager_trace_t *trace = &sampler->pager_trace;

    if (sample->kind == LUA_LVGL_TOUCH_SAMPLE_PRESS) {
        if (!trace->active || (!trace->scroll_started && trace->release_sample_ms != 0)) {
            lua_lvgl_pager_trace_reset_locked(sampler, sample);
            return;
        }
        if (trace->press_count < UINT8_MAX) {
            trace->press_count++;
        }
    }
    if (!trace->active) {
        return;
    }
    if (sample->kind != LUA_LVGL_TOUCH_SAMPLE_PRESS && trace->sample_count < UINT16_MAX) {
        trace->sample_count++;
    }
    if (sample->kind == LUA_LVGL_TOUCH_SAMPLE_MOVE) {
        if (trace->first_move_sample_ms == 0) {
            trace->first_move_sample_ms = sample->timestamp;
        }
        if (trace->move_count < UINT16_MAX) {
            trace->move_count++;
        }
    } else if (sample->kind == LUA_LVGL_TOUCH_SAMPLE_RELEASE) {
        trace->release_sample_ms = sample->timestamp;
    }
    if (sampler->queue.count > trace->max_queue_depth) {
        trace->max_queue_depth = sampler->queue.count;
    }
}

static void lua_lvgl_pager_trace_note_delivery_locked(lua_lvgl_touch_sampler_t *sampler,
                                                       const lua_lvgl_touch_sample_t *sample,
                                                       uint32_t delivered_ms)
{
    lua_lvgl_pager_trace_t *trace = &sampler->pager_trace;
    uint32_t lag_ms;

    if (!trace->active) {
        return;
    }
    lag_ms = lua_lvgl_elapsed_ms(sample->timestamp, delivered_ms);
    if (lag_ms > trace->max_sample_lag_ms) {
        trace->max_sample_lag_ms = lag_ms;
    }
    if (sample->kind == LUA_LVGL_TOUCH_SAMPLE_PRESS && trace->press_delivered_ms == 0) {
        trace->press_delivered_ms = delivered_ms;
    }
    if (trace->delivered_count < UINT16_MAX) {
        trace->delivered_count++;
    }
}

static void lua_lvgl_pager_trace_note_i2c_read(lua_lvgl_touch_sampler_t *sampler,
                                                uint32_t elapsed_us)
{
    portENTER_CRITICAL(&sampler->queue_lock);
    if (sampler->pager_trace.active && elapsed_us > sampler->pager_trace.max_i2c_read_us) {
        sampler->pager_trace.max_i2c_read_us = elapsed_us;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
}

static void lua_lvgl_pager_trace_note_no_contact(lua_lvgl_touch_sampler_t *sampler,
                                                  uint8_t streak)
{
    portENTER_CRITICAL(&sampler->queue_lock);
    if (sampler->pager_trace.active && streak > sampler->pager_trace.max_no_contact_streak) {
        sampler->pager_trace.max_no_contact_streak = streak;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
}

static void lua_lvgl_pager_trace_note_read_error(lua_lvgl_touch_sampler_t *sampler)
{
    portENTER_CRITICAL(&sampler->queue_lock);
    if (sampler->pager_trace.active && sampler->pager_trace.read_error_count < UINT8_MAX) {
        sampler->pager_trace.read_error_count++;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
}

static void lua_lvgl_touch_wake_task(void)
{
    TaskHandle_t task = s_lvgl.task_handle;

    /* This is a FreeRTOS scheduling signal only: the sampler never invokes
     * LVGL. If the UI task is in its fixed-cadence delay, wake it so a fresh
     * PRESS/MOVE/RELEASE can be consumed without waiting another period. */
    if (task) {
        (void)xTaskAbortDelay(task);
    }
}

static bool lua_lvgl_touch_sample_push(lua_lvgl_touch_sampler_t *sampler,
                                       lua_lvgl_touch_sample_t sample)
{
    bool pushed;
    uint8_t discarded = 0;

    portENTER_CRITICAL(&sampler->queue_lock);
    /* When LVGL has not yet consumed an earlier complete gesture, executing it
     * after a newer press feels like the user's current drag jumped two pages.
     * Preserve an already-delivered gesture's RELEASE boundary, but let the
     * newest physical gesture replace unread completed history. */
    if (sample.kind == LUA_LVGL_TOUCH_SAMPLE_PRESS) {
        if (!sampler->lvgl_gesture_active) {
            discarded = lua_lvgl_touch_sample_queue_discard_completed(&sampler->queue);
        } else {
            uint8_t before = sampler->queue.count;

            /* LVGL has already accepted the old PRESS, so it must receive one
             * RELEASE before the new physical PRESS. Drop the old movement
             * instead of replaying it after a quick direction reversal. */
            if (lua_lvgl_touch_sample_queue_retain_release_boundary(&sampler->queue)) {
                discarded = (uint8_t)(before - sampler->queue.count);
            }
        }
    }
    pushed = lua_lvgl_touch_sample_queue_push(&sampler->queue, sample);
    if (pushed) {
        lua_lvgl_pager_trace_note_sample_locked(sampler, &sample);
        sampler->input_event_pending = true;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
    sampler->discarded_completed_samples += discarded;
    if (pushed) {
        lua_lvgl_touch_wake_task();
    }
    return pushed;
}

static bool lua_lvgl_touch_sample_pop(lua_lvgl_touch_sampler_t *sampler,
                                      lua_lvgl_touch_sample_t *sample,
                                      bool *has_more)
{
    bool popped;

    portENTER_CRITICAL(&sampler->queue_lock);
    popped = lua_lvgl_touch_sample_queue_pop(&sampler->queue, sample, has_more);
    if (popped) {
        lua_lvgl_pager_trace_note_delivery_locked(sampler, sample, lv_tick_get());
        sampler->lvgl_gesture_active = sample->kind != LUA_LVGL_TOUCH_SAMPLE_RELEASE;
        /* One semantic sample is deliberately rendered at a time. Keep the
         * next task pass armed when PRESS/MOVE/RELEASE was already buffered
         * while a frame was being drawn. */
        sampler->input_event_pending = has_more && *has_more;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
    return popped;
}

static bool lua_lvgl_touch_point_moved(const lv_point_t *from, const lv_point_t *to)
{
    int32_t dx = to->x - from->x;
    int32_t dy = to->y - from->y;

    return dx >= LUA_LVGL_TOUCH_SAMPLE_MOVE_DELTA_PX ||
           dx <= -LUA_LVGL_TOUCH_SAMPLE_MOVE_DELTA_PX ||
           dy >= LUA_LVGL_TOUCH_SAMPLE_MOVE_DELTA_PX ||
           dy <= -LUA_LVGL_TOUCH_SAMPLE_MOVE_DELTA_PX;
}

static bool lua_lvgl_touch_sampler_emit(lua_lvgl_touch_sampler_t *sampler,
                                        lua_lvgl_touch_sample_kind_t kind,
                                        const lv_point_t *point,
                                        uint32_t timestamp)
{
    lua_lvgl_touch_sample_t sample = {
        .kind = kind,
        .x = point->x,
        .y = point->y,
        .timestamp = timestamp,
    };

    if (lua_lvgl_touch_sample_push(sampler, sample)) {
        return true;
    }
    sampler->rejected_samples++;
    return false;
}

static void lua_lvgl_touch_sampler_release(lua_lvgl_touch_sampler_t *sampler, uint32_t timestamp)
{
    if (!sampler->sampled_pressed) {
        return;
    }
    if (lua_lvgl_touch_sampler_emit(sampler, LUA_LVGL_TOUCH_SAMPLE_RELEASE,
                                    &sampler->sampled_point, timestamp)) {
        sampler->sampled_pressed = false;
        sampler->consecutive_no_contact_samples = 0;
    }
}

static void lua_lvgl_touch_sampler_note_read_error(lua_lvgl_touch_sampler_t *sampler,
                                                    uint32_t timestamp)
{
    sampler->read_errors++;
    lua_lvgl_pager_trace_note_read_error(sampler);
    sampler->consecutive_no_contact_samples = 0;
    if (sampler->consecutive_read_errors < LUA_LVGL_TOUCH_ERROR_GRACE_SAMPLES) {
        sampler->consecutive_read_errors++;
    }
    /* A single failed I2C transaction is not a physical release. Holding the
     * last confirmed state for at most 12 ms keeps a transient bus glitch from
     * splitting one finger drag into two page swipes. */
    if (sampler->consecutive_read_errors >= LUA_LVGL_TOUCH_ERROR_GRACE_SAMPLES) {
        lua_lvgl_touch_sampler_release(sampler, timestamp);
    }
}

static void lua_lvgl_touch_sampler_poll(lua_lvgl_touch_sampler_t *sampler)
{
    esp_lcd_touch_point_data_t point;
    uint8_t point_count = 0;
    esp_err_t err;
    uint32_t timestamp;
    int64_t read_started_us = esp_timer_get_time();

    err = esp_lcd_touch_read_data(sampler->touch);
    timestamp = lv_tick_get();
    if (err != ESP_OK) {
        lua_lvgl_touch_sampler_note_read_error(sampler, timestamp);
        return;
    }
    err = esp_lcd_touch_get_data(sampler->touch, &point, &point_count, 1);
    lua_lvgl_pager_trace_note_i2c_read(sampler,
                                       (uint32_t)(esp_timer_get_time() - read_started_us));
    if (err != ESP_OK) {
        lua_lvgl_touch_sampler_note_read_error(sampler, timestamp);
        return;
    }
    sampler->consecutive_read_errors = 0;
    if (point_count == 0) {
        if (sampler->sampled_pressed &&
            sampler->consecutive_no_contact_samples < LUA_LVGL_TOUCH_NO_CONTACT_GRACE_SAMPLES) {
            sampler->consecutive_no_contact_samples++;
            lua_lvgl_pager_trace_note_no_contact(sampler,
                                                  sampler->consecutive_no_contact_samples);
        }
        /* Brief empty reports can occur while a finger is still moving on a
         * polled GT911. Wait 12 ms for confirmation so two missing samples
         * cannot turn one physical drag into RELEASE + PRESS and two flips. */
        if (sampler->consecutive_no_contact_samples >= LUA_LVGL_TOUCH_NO_CONTACT_GRACE_SAMPLES) {
            lua_lvgl_touch_sampler_release(sampler, timestamp);
        }
        return;
    }
    sampler->consecutive_no_contact_samples = 0;

    lv_point_t sampled_point = {
        .x = (int32_t)point.x,
        .y = (int32_t)point.y,
    };
    sampler->sampled_point = sampled_point;
    if (!sampler->sampled_pressed) {
        if (lua_lvgl_touch_sampler_emit(sampler, LUA_LVGL_TOUCH_SAMPLE_PRESS,
                                        &sampled_point, timestamp)) {
            sampler->sampled_pressed = true;
            sampler->last_queued_point = sampled_point;
        }
        return;
    }
    if (lua_lvgl_touch_point_moved(&sampler->last_queued_point, &sampled_point) &&
        lua_lvgl_touch_sampler_emit(sampler, LUA_LVGL_TOUCH_SAMPLE_MOVE,
                                    &sampled_point, timestamp)) {
        sampler->last_queued_point = sampled_point;
    }
}

static void lua_lvgl_touch_sampler_task(void *arg)
{
    lua_lvgl_touch_sampler_t *sampler = arg;
    TickType_t next_poll = xTaskGetTickCount();

    while (!sampler->stop_requested) {
        lua_lvgl_touch_sampler_poll(sampler);
        /* Keep the polling phase stable: waiting a relative 4 ms after every
         * I2C read turns the read time itself into additional input latency. */
        vTaskDelayUntil(&next_poll, pdMS_TO_TICKS(LUA_LVGL_TOUCH_SAMPLE_PERIOD_MS));
    }
    sampler->task = NULL;
    xSemaphoreGive(sampler->stopped);
    vTaskDelete(NULL);
}

static lua_lvgl_touch_sampler_t *lua_lvgl_touch_sampler_create(esp_lcd_touch_handle_t touch)
{
    lua_lvgl_touch_sampler_t *sampler = calloc(1, sizeof(*sampler));

    if (!sampler) {
        return NULL;
    }
    sampler->touch = touch;
    sampler->delivered_state = LV_INDEV_STATE_RELEASED;
    lua_lvgl_touch_sample_queue_init(&sampler->queue);
    portMUX_INITIALIZE(&sampler->queue_lock);
    sampler->stopped = xSemaphoreCreateBinaryStatic(&sampler->stopped_storage);
    if (!sampler->stopped ||
        xTaskCreatePinnedToCore(lua_lvgl_touch_sampler_task, "lv_touch",
                                LUA_LVGL_TOUCH_SAMPLER_STACK, sampler,
                                LUA_LVGL_TOUCH_SAMPLER_PRIO, &sampler->task,
                                LUA_LVGL_TOUCH_SAMPLER_CORE) != pdPASS) {
        free(sampler);
        return NULL;
    }
    ESP_LOGI(TAG, "GT911 sampler: %d ms, core %d", LUA_LVGL_TOUCH_SAMPLE_PERIOD_MS,
             LUA_LVGL_TOUCH_SAMPLER_CORE);
    return sampler;
}

static void lua_lvgl_touch_sampler_destroy(lua_lvgl_touch_sampler_t *sampler)
{
    if (!sampler) {
        return;
    }
    sampler->stop_requested = true;
    if (sampler->task) {
        /* The sampler never takes the LVGL lock, so joining here cannot
         * deadlock runtime teardown or indev_unregister. Its fixed 4 ms
         * sleep bounds the normal shutdown wait. */
        (void)xSemaphoreTake(sampler->stopped, portMAX_DELAY);
    }
    if (sampler->read_errors || sampler->rejected_samples || sampler->discarded_completed_samples) {
        ESP_LOGW(TAG, "GT911 sampler ended: read_errors=%" PRIu32
                 " rejected=%" PRIu32 " discarded=%" PRIu32,
                 sampler->read_errors, sampler->rejected_samples,
                 sampler->discarded_completed_samples);
    }
    free(sampler);
}

static void lua_lvgl_touch_read_cb(lv_indev_t *indev, lv_indev_data_t *data)
{
    lua_lvgl_touch_sampler_t *sampler = lv_indev_get_user_data(indev);
    lua_lvgl_touch_sample_t sample;
    bool has_more = false;

    if (!sampler) {
        data->state = LV_INDEV_STATE_RELEASED;
        return;
    }
    if (lua_lvgl_touch_sample_pop(sampler, &sample, &has_more)) {
        sampler->delivered_point.x = sample.x;
        sampler->delivered_point.y = sample.y;
        sampler->delivered_state = sample.kind == LUA_LVGL_TOUCH_SAMPLE_RELEASE
                                       ? LV_INDEV_STATE_RELEASED
                                       : LV_INDEV_STATE_PRESSED;
        data->point = sampler->delivered_point;
        data->state = sampler->delivered_state;
        /* Sample timestamps use lv_tick_get(), the same clock domain LVGL
         * uses for velocity and long-press calculations. */
        data->timestamp = sample.timestamp;
        /* Never drain buffered history in one lv_timer_handler(): render
         * between semantic samples so the page follows the current finger
         * rather than jumping through an old gesture after a busy frame. */
        data->continue_reading = false;
        return;
    }

    data->point = sampler->delivered_point;
    data->state = sampler->delivered_state;
    data->continue_reading = false;
}

void lua_lvgl_indev_process_pending_locked(void)
{
    lua_lvgl_touch_sampler_t *sampler = s_lvgl.touch_sampler;
    lv_timer_t *read_timer;
    bool pending = false;

    if (!sampler || !s_lvgl.touch_indev) {
        return;
    }
    portENTER_CRITICAL(&sampler->queue_lock);
    pending = sampler->input_event_pending;
    sampler->input_event_pending = false;
    portEXIT_CRITICAL(&sampler->queue_lock);

    /* Let LVGL's normal input timer consume the sample in the same handler
     * pass as refresh. Calling lv_indev_read() here as well as leaving the
     * timer active lets a rapid press/move/release be processed twice before
     * a frame is rendered. That skips the first visible drag frame and makes
     * short reverse swipes feel detached from the finger. */
    if (pending) {
        read_timer = lv_indev_get_read_timer(s_lvgl.touch_indev);
        if (read_timer) {
            lv_timer_ready(read_timer);
        }
    }
}

static void lua_lvgl_pager_trace_note_present_locked(lua_lvgl_touch_sampler_t *sampler,
                                                      uint32_t observed_ms)
{
    lua_lvgl_pager_trace_t *trace = &sampler->pager_trace;
    uint32_t present_sequence = s_lvgl.pager_trace_present_sequence;

    /* Keep profiling from PRESS onward, including a gesture that never becomes
     * a scroll. Otherwise the exact blocked-refresh interval that makes a
     * fast horizontal swipe miss LVGL's scroll threshold is invisible. */
    if (!trace->active) {
        return;
    }
    if (!trace->first_present_observed && present_sequence != trace->present_sequence_at_begin) {
        trace->first_present_observed = true;
        trace->first_present_ms = observed_ms;
    }
    if (trace->scroll_ended && !trace->end_present_observed &&
        present_sequence != trace->present_sequence_at_end) {
        trace->end_present_observed = true;
        trace->end_present_ms = observed_ms;
    }
}

void lua_lvgl_indev_trace_pager_scroll_begin_locked(void)
{
    lua_lvgl_touch_sampler_t *sampler = s_lvgl.touch_sampler;
    uint32_t now_ms = lv_tick_get();

    if (!sampler) {
        return;
    }
    portENTER_CRITICAL(&sampler->queue_lock);
    if (!sampler->pager_trace.active) {
        uint32_t next_sequence = sampler->pager_trace.sequence + 1;

        /* Programmatic pager diagnostics have no touch PRESS to arm the
         * trace. Start one at the native scroll boundary so render timing is
         * measurable for the same animation path without synthesizing input. */
        memset(&sampler->pager_trace, 0, sizeof(sampler->pager_trace));
        sampler->pager_trace.active = true;
        sampler->pager_trace.sequence = next_sequence;
        sampler->pager_trace.press_sample_ms = now_ms;
    }
    if (!sampler->pager_trace.scroll_started) {
        sampler->pager_trace.scroll_started = true;
        sampler->pager_trace.scroll_begin_ms = now_ms;
        sampler->pager_trace.present_sequence_at_begin = s_lvgl.pager_trace_present_sequence;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
}

void lua_lvgl_indev_trace_pager_scroll_end_locked(void)
{
    lua_lvgl_touch_sampler_t *sampler = s_lvgl.touch_sampler;
    uint32_t now_ms = lv_tick_get();

    if (!sampler) {
        return;
    }
    portENTER_CRITICAL(&sampler->queue_lock);
    if (sampler->pager_trace.active && sampler->pager_trace.scroll_started &&
        !sampler->pager_trace.scroll_ended) {
        sampler->pager_trace.scroll_ended = true;
        sampler->pager_trace.scroll_end_ms = now_ms;
        sampler->pager_trace.present_sequence_at_end = s_lvgl.pager_trace_present_sequence;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
}

void lua_lvgl_indev_trace_pager_phase_locked(lua_lvgl_pager_trace_phase_t phase)
{
    lua_lvgl_touch_sampler_t *sampler = s_lvgl.touch_sampler;

    if (!sampler) {
        return;
    }
    portENTER_CRITICAL(&sampler->queue_lock);
    sampler->pager_trace_phase = phase;
    portEXIT_CRITICAL(&sampler->queue_lock);
}

void lua_lvgl_indev_trace_pager_flush_submitted(void)
{
    lua_lvgl_touch_sampler_t *sampler = s_lvgl.touch_sampler;
    uint32_t now_ms = lv_tick_get();

    if (!sampler) {
        return;
    }
    portENTER_CRITICAL(&sampler->queue_lock);
    if (sampler->pager_trace.active && sampler->pager_trace.scroll_started &&
        sampler->pager_trace.first_flush_ms == 0) {
        sampler->pager_trace.first_flush_ms = now_ms;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
}

static void lua_lvgl_pager_trace_complete_phase(uint32_t *started_ms,
                                                 uint32_t now_ms,
                                                 uint32_t *max_elapsed_ms,
                                                 uint16_t *count)
{
    uint32_t elapsed_ms;

    if (*started_ms == 0) {
        return;
    }
    elapsed_ms = lua_lvgl_elapsed_ms(*started_ms, now_ms);
    if (elapsed_ms > *max_elapsed_ms) {
        *max_elapsed_ms = elapsed_ms;
    }
    if (*count < UINT16_MAX) {
        (*count)++;
    }
    *started_ms = 0;
}

/* Called under queue_lock at REFRESH_READY. Keep the top three complete
 * refreshes together: the existing max fields can legitimately describe
 * different frames and therefore cannot identify a single hitch. */
static void lua_lvgl_pager_trace_record_frame(lua_lvgl_pager_trace_t *trace,
                                              uint32_t refresh_ms)
{
    lua_lvgl_pager_trace_frame_t frame = {
        .refresh_ms = refresh_ms,
        .layout_ms = trace->frame_layout_ms,
        .post_layout_ms = trace->frame_post_layout_ms,
        .pre_render_ms = trace->frame_pre_render_ms,
        .render_ms = trace->frame_render_ms,
        .flush_ms = trace->frame_flush_ms,
        .flush_wait_ms = trace->frame_flush_wait_ms,
        .refresh_index = trace->refresh_index,
        .phase = trace->frame_phase,
        .layout_dirty_mask = trace->frame_layout_dirty_mask,
        .layout_present_mask = trace->frame_layout_present_mask,
    };
    uint8_t index = 0;
    uint8_t count = trace->slow_frame_count;

    memcpy(frame.layout_step_ms,
           trace->frame_layout_step_ms,
           sizeof(frame.layout_step_ms));
    memcpy(frame.layout_dirty_node_count,
           trace->frame_layout_dirty_node_count,
           sizeof(frame.layout_dirty_node_count));
    memcpy(frame.active_branch_dirty_node_count,
           trace->frame_active_branch_dirty_node_count,
           sizeof(frame.active_branch_dirty_node_count));
    memcpy(frame.pager_branch_dirty_node_count,
           trace->frame_pager_branch_dirty_node_count,
           sizeof(frame.pager_branch_dirty_node_count));

    while (index < count && trace->slow_frames[index].refresh_ms >= frame.refresh_ms) {
        index++;
    }
    if (index == LUA_LVGL_PAGER_TRACE_SLOW_FRAME_COUNT) {
        return;
    }
    if (count < LUA_LVGL_PAGER_TRACE_SLOW_FRAME_COUNT) {
        count++;
    }
    for (uint8_t i = count - 1; i > index; i--) {
        trace->slow_frames[i] = trace->slow_frames[i - 1];
    }
    trace->slow_frames[index] = frame;
    trace->slow_frame_count = count;
}

void lua_lvgl_indev_trace_display_event_locked(lv_event_code_t code)
{
    lua_lvgl_touch_sampler_t *sampler = s_lvgl.touch_sampler;
    uint32_t now_ms = lv_tick_get();
    lua_lvgl_pager_trace_t *trace;

    if (!sampler) {
        return;
    }

    /* Display events run inside the owning LVGL worker. This probe only
     * timestamps completed phases; it must not request a refresh, touch Lua,
     * or add any work to the input path it is measuring. */
    portENTER_CRITICAL(&sampler->queue_lock);
    trace = &sampler->pager_trace;
    if (!trace->active || !trace->scroll_started) {
        portEXIT_CRITICAL(&sampler->queue_lock);
        return;
    }

    switch (code) {
    case LV_EVENT_REFR_START:
        if (trace->last_refresh_started_ms != 0) {
            uint32_t elapsed_ms = lua_lvgl_elapsed_ms(trace->last_refresh_started_ms, now_ms);
            if (elapsed_ms > trace->max_frame_gap_ms) {
                trace->max_frame_gap_ms = elapsed_ms;
            }
        }
        trace->last_refresh_started_ms = now_ms;
        trace->refresh_started_ms = now_ms;
        trace->layout_completed_ms = 0;
        trace->layout_step_started_ms = now_ms;
        trace->render_started_ms = 0;
        trace->flush_started_ms = 0;
        trace->flush_wait_started_ms = 0;
        trace->frame_layout_ms = 0;
        memset(trace->frame_layout_step_ms, 0, sizeof(trace->frame_layout_step_ms));
        trace->frame_post_layout_ms = 0;
        trace->frame_pre_render_ms = 0;
        trace->frame_render_ms = 0;
        trace->frame_flush_ms = 0;
        trace->frame_flush_wait_ms = 0;
        trace->frame_phase = sampler->pager_trace_phase;
        trace->frame_layout_completed_mask = 0;
        memset(trace->frame_layout_dirty_node_count, 0,
               sizeof(trace->frame_layout_dirty_node_count));
        memset(trace->frame_active_branch_dirty_node_count, 0,
               sizeof(trace->frame_active_branch_dirty_node_count));
        memset(trace->frame_pager_branch_dirty_node_count, 0,
               sizeof(trace->frame_pager_branch_dirty_node_count));
        lua_lvgl_pager_trace_capture_layout_roots(&trace->frame_layout_present_mask,
                                                   &trace->frame_layout_dirty_mask,
                                                   trace->frame_layout_dirty_node_count,
                                                   trace->frame_active_branch_dirty_node_count,
                                                   trace->frame_pager_branch_dirty_node_count);
        if (trace->refresh_index < UINT16_MAX) {
            trace->refresh_index++;
        }
        break;
    case LV_EVENT_REFR_READY:
        if (trace->refresh_started_ms != 0) {
            lua_lvgl_pager_trace_record_frame(trace,
                                              lua_lvgl_elapsed_ms(trace->refresh_started_ms,
                                                                  now_ms));
        }
        lua_lvgl_pager_trace_complete_phase(&trace->refresh_started_ms,
                                            now_ms,
                                            &trace->max_refresh_ms,
                                            &trace->refresh_count);
        break;
    case LV_EVENT_UPDATE_LAYOUT_COMPLETED:
        if (trace->refresh_started_ms != 0) {
            uint32_t elapsed_ms = lua_lvgl_elapsed_ms(trace->refresh_started_ms, now_ms);
            int root = lua_lvgl_pager_trace_next_layout_root(
                trace->frame_layout_present_mask,
                trace->frame_layout_completed_mask);

            if (elapsed_ms > trace->max_layout_ms) {
                trace->max_layout_ms = elapsed_ms;
            }
            if (trace->layout_count < UINT16_MAX) {
                trace->layout_count++;
            }
            trace->layout_completed_ms = now_ms;
            trace->frame_layout_ms = elapsed_ms;
            if (root >= 0) {
                trace->frame_layout_step_ms[root] =
                    lua_lvgl_elapsed_ms(trace->layout_step_started_ms, now_ms);
                trace->frame_layout_completed_mask |=
                    LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BIT(root);
            }
            trace->layout_step_started_ms = now_ms;
        }
        break;
    case LV_EVENT_RENDER_START:
        /* `LV_EVENT_REFR_START` precedes layout, invalid-area joining, and
         * draw-task creation. Separating that pre-render interval from the
         * actual renderer tells us whether a swipe hitch is tree/layout work
         * or bitmap composition, without adding work to the refresh path. */
        if (trace->refresh_started_ms != 0) {
            uint32_t elapsed_ms = lua_lvgl_elapsed_ms(trace->refresh_started_ms, now_ms);
            if (elapsed_ms > trace->max_pre_render_ms) {
                trace->max_pre_render_ms = elapsed_ms;
            }
            if (trace->pre_render_count < UINT16_MAX) {
                trace->pre_render_count++;
            }
            trace->frame_pre_render_ms = elapsed_ms;
        }
        if (trace->layout_completed_ms != 0) {
            uint32_t elapsed_ms = lua_lvgl_elapsed_ms(trace->layout_completed_ms, now_ms);
            if (elapsed_ms > trace->max_post_layout_ms) {
                trace->max_post_layout_ms = elapsed_ms;
            }
            if (trace->post_layout_count < UINT16_MAX) {
                trace->post_layout_count++;
            }
            trace->frame_post_layout_ms = elapsed_ms;
        }
        trace->render_started_ms = now_ms;
        break;
    case LV_EVENT_RENDER_READY:
        if (trace->render_started_ms != 0) {
            trace->frame_render_ms = lua_lvgl_elapsed_ms(trace->render_started_ms, now_ms);
        }
        lua_lvgl_pager_trace_complete_phase(&trace->render_started_ms,
                                            now_ms,
                                            &trace->max_render_ms,
                                            &trace->render_count);
        break;
    case LV_EVENT_FLUSH_START:
        trace->flush_started_ms = now_ms;
        break;
    case LV_EVENT_FLUSH_FINISH:
        if (trace->flush_started_ms != 0) {
            uint32_t elapsed_ms = lua_lvgl_elapsed_ms(trace->flush_started_ms, now_ms);

            if (elapsed_ms > trace->frame_flush_ms) {
                trace->frame_flush_ms = elapsed_ms;
            }
        }
        lua_lvgl_pager_trace_complete_phase(&trace->flush_started_ms,
                                            now_ms,
                                            &trace->max_flush_ms,
                                            &trace->flush_count);
        break;
    case LV_EVENT_FLUSH_WAIT_START:
        trace->flush_wait_started_ms = now_ms;
        break;
    case LV_EVENT_FLUSH_WAIT_FINISH:
        if (trace->flush_wait_started_ms != 0) {
            uint32_t elapsed_ms = lua_lvgl_elapsed_ms(trace->flush_wait_started_ms, now_ms);

            if (elapsed_ms > trace->frame_flush_wait_ms) {
                trace->frame_flush_wait_ms = elapsed_ms;
            }
        }
        lua_lvgl_pager_trace_complete_phase(&trace->flush_wait_started_ms,
                                            now_ms,
                                            &trace->max_flush_wait_ms,
                                            &trace->flush_wait_count);
        break;
    default:
        break;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);
}

static const char *lua_lvgl_pager_trace_phase_name(lua_lvgl_pager_trace_phase_t phase)
{
    switch (phase) {
    case LUA_LVGL_PAGER_TRACE_PHASE_DRAG:
        return "drag";
    case LUA_LVGL_PAGER_TRACE_PHASE_SNAP:
        return "snap";
    case LUA_LVGL_PAGER_TRACE_PHASE_RESTORE:
        return "restore";
    case LUA_LVGL_PAGER_TRACE_PHASE_IDLE:
    default:
        return "idle";
    }
}

static void lua_lvgl_pager_trace_log(const lua_lvgl_pager_trace_t *trace)
{
    const char *result = !trace->scroll_started
                             ? "result=no-scroll"
                             : trace->unfinished_scroll ? "result=unfinished-scroll"
                                                        : "result=scroll";
    uint32_t press_to_lvgl = trace->press_delivered_ms
                                 ? lua_lvgl_elapsed_ms(trace->press_sample_ms,
                                                       trace->press_delivered_ms)
                                 : 0;
    uint32_t press_to_scroll = trace->scroll_begin_ms
                                   ? lua_lvgl_elapsed_ms(trace->press_sample_ms,
                                                         trace->scroll_begin_ms)
                                   : 0;
    uint32_t move_to_scroll = trace->first_move_sample_ms && trace->scroll_begin_ms
                                  ? lua_lvgl_elapsed_ms(trace->first_move_sample_ms,
                                                        trace->scroll_begin_ms)
                                  : 0;
    uint32_t scroll_to_present = trace->first_present_observed
                                     ? lua_lvgl_elapsed_ms(trace->scroll_begin_ms,
                                                           trace->first_present_ms)
                                     : 0;
    uint32_t scroll_to_flush = trace->first_flush_ms
                                   ? lua_lvgl_elapsed_ms(trace->scroll_begin_ms,
                                                         trace->first_flush_ms)
                                   : 0;
    uint32_t flush_to_present = trace->first_present_observed && trace->first_flush_ms
                                    ? lua_lvgl_elapsed_ms(trace->first_flush_ms,
                                                          trace->first_present_ms)
                                    : 0;
    uint32_t end_to_present = trace->end_present_observed
                                  ? lua_lvgl_elapsed_ms(trace->scroll_end_ms,
                                                        trace->end_present_ms)
                                  : 0;

    ESP_LOGI(TAG,
             "[pager-trace] %s #%" PRIu32 " press->lvgl=%" PRIu32
             "ms press->scroll=%" PRIu32 "ms move->scroll=%" PRIu32
             "ms scroll->present=%" PRIu32
             "ms scroll->flush=%" PRIu32 "ms flush->present=%" PRIu32
             "ms end->present=%" PRIu32 "ms max-input-lag=%" PRIu32
             "ms i2c-max=%" PRIu32 "us samples=%u moves=%u delivered=%u"
             " maxq=%u empty=%u errors=%u presses=%u refreshes=%u"
             " max-refresh=%" PRIu32 "ms max-frame-gap=%" PRIu32
             "ms layouts=%u max-layout=%" PRIu32
             "ms post-layouts=%u max-post-layout=%" PRIu32
             "ms pre-renders=%u max-pre-render=%" PRIu32
             "ms renders=%u max-render=%" PRIu32
             "ms flushes=%u max-flush=%" PRIu32 "ms waits=%u"
             " max-wait=%" PRIu32 "ms",
             result, trace->sequence, press_to_lvgl, press_to_scroll, move_to_scroll,
             scroll_to_present,
             scroll_to_flush, flush_to_present, end_to_present, trace->max_sample_lag_ms,
             trace->max_i2c_read_us,
             trace->sample_count, trace->move_count, trace->delivered_count,
             trace->max_queue_depth, trace->max_no_contact_streak,
             trace->read_error_count, trace->press_count,
             trace->refresh_count, trace->max_refresh_ms, trace->max_frame_gap_ms,
             trace->layout_count, trace->max_layout_ms,
             trace->post_layout_count, trace->max_post_layout_ms,
             trace->pre_render_count, trace->max_pre_render_ms,
             trace->render_count, trace->max_render_ms,
             trace->flush_count, trace->max_flush_ms,
             trace->flush_wait_count, trace->max_flush_wait_ms);

    for (uint8_t i = 0; i < trace->slow_frame_count; i++) {
        const lua_lvgl_pager_trace_frame_t *frame = &trace->slow_frames[i];

        ESP_LOGI(TAG,
                 "[pager-frame] #%" PRIu32 " rank=%u frame=%" PRIu16
                 " phase=%s total=%" PRIu32 "ms layout=%" PRIu32
                 "ms post-layout=%" PRIu32 "ms pre-render=%" PRIu32
                 "ms render=%" PRIu32 "ms flush=%" PRIu32
                 "ms wait=%" PRIu32 "ms layout-dirty=0x%02x"
                 " layout-present=0x%02x layout-steps=a:%" PRIu32
                 "/p:%" PRIu32 "/b:%" PRIu32 "/t:%" PRIu32 "/s:%" PRIu32
                 " layout-nodes=a:%u/p:%u/b:%u/t:%u/s:%u"
                 " active-branches=0:%u/1:%u/2:%u/3:%u"
                 " pager-branches=0:%u/1:%u/2:%u/3:%u",
                 trace->sequence, (unsigned int)(i + 1), frame->refresh_index,
                 lua_lvgl_pager_trace_phase_name(frame->phase), frame->refresh_ms,
                 frame->layout_ms, frame->post_layout_ms,
                 frame->pre_render_ms, frame->render_ms, frame->flush_ms,
                 frame->flush_wait_ms,
                 (unsigned int)frame->layout_dirty_mask,
                 (unsigned int)frame->layout_present_mask,
                 frame->layout_step_ms[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_ACTIVE],
                 frame->layout_step_ms[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_PREVIOUS],
                 frame->layout_step_ms[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BOTTOM],
                 frame->layout_step_ms[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_TOP],
                 frame->layout_step_ms[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_SYSTEM],
                 (unsigned int)frame->layout_dirty_node_count[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_ACTIVE],
                 (unsigned int)frame->layout_dirty_node_count[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_PREVIOUS],
                 (unsigned int)frame->layout_dirty_node_count[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_BOTTOM],
                 (unsigned int)frame->layout_dirty_node_count[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_TOP],
                 (unsigned int)frame->layout_dirty_node_count[LUA_LVGL_PAGER_TRACE_LAYOUT_ROOT_SYSTEM],
                 (unsigned int)frame->active_branch_dirty_node_count[0],
                 (unsigned int)frame->active_branch_dirty_node_count[1],
                 (unsigned int)frame->active_branch_dirty_node_count[2],
                 (unsigned int)frame->active_branch_dirty_node_count[3],
                 (unsigned int)frame->pager_branch_dirty_node_count[0],
                 (unsigned int)frame->pager_branch_dirty_node_count[1],
                 (unsigned int)frame->pager_branch_dirty_node_count[2],
                 (unsigned int)frame->pager_branch_dirty_node_count[3]);
    }
}

void lua_lvgl_indev_trace_drain_locked(void)
{
    lua_lvgl_touch_sampler_t *sampler = s_lvgl.touch_sampler;
    lua_lvgl_pager_trace_t completed = {0};
    uint32_t now_ms = lv_tick_get();
    bool should_log = false;

    if (!sampler) {
        return;
    }
    portENTER_CRITICAL(&sampler->queue_lock);
    lua_lvgl_pager_trace_note_present_locked(sampler, now_ms);
    if (sampler->pager_trace.active && sampler->pager_trace.scroll_ended &&
        (sampler->pager_trace.end_present_observed ||
         lua_lvgl_elapsed_ms(sampler->pager_trace.scroll_end_ms, now_ms) >= 500)) {
        completed = sampler->pager_trace;
        sampler->pager_trace.active = false;
        sampler->pager_trace_phase = LUA_LVGL_PAGER_TRACE_PHASE_IDLE;
        should_log = true;
    } else if (sampler->pager_trace.active && sampler->pager_trace.scroll_started &&
               !sampler->pager_trace.scroll_ended &&
               sampler->pager_trace.release_sample_ms != 0 &&
               !sampler->lvgl_gesture_active && sampler->queue.count == 0 &&
               lua_lvgl_elapsed_ms(sampler->pager_trace.release_sample_ms, now_ms) >=
                   LUA_LVGL_PAGER_TRACE_UNFINISHED_TIMEOUT_MS) {
        /* The real symptom is a page that remains between snap points: input
         * delivered RELEASE, native scroll began, but LVGL never emitted its
         * terminal scroll event. Preserve the timings and report it once
         * rather than letting this trace absorb later gestures silently. */
        sampler->pager_trace.unfinished_scroll = true;
        completed = sampler->pager_trace;
        sampler->pager_trace.active = false;
        sampler->pager_trace_phase = LUA_LVGL_PAGER_TRACE_PHASE_IDLE;
        should_log = true;
    } else if (sampler->pager_trace.active && !sampler->pager_trace.scroll_started &&
               sampler->pager_trace.release_sample_ms != 0 &&
               !sampler->lvgl_gesture_active && sampler->queue.count == 0 &&
               sampler->pager_trace.move_count > 0) {
        /* A short move that LVGL fully consumed but never turned into scroll
         * is the precise "swipe did not trigger" symptom. Report it once
         * after the RELEASE has been delivered; logging raw moves would make
         * the timing probe itself perturb the live drag. */
        completed = sampler->pager_trace;
        sampler->pager_trace.active = false;
        sampler->pager_trace_phase = LUA_LVGL_PAGER_TRACE_PHASE_IDLE;
        should_log = true;
    }
    portEXIT_CRITICAL(&sampler->queue_lock);

    if (should_log) {
        lua_lvgl_pager_trace_log(&completed);
    }
}

/* The adapter owns the production lv_timer_handler() loop, whereas the
 * hand-rolled runtime calls process_pending and trace_drain around that loop
 * directly. This timer is created after the pointer indev, so LVGL places it
 * ahead of the indev read timer. It can therefore arm that normal timer in the
 * same handler pass without asking the core-0 sampler to call LVGL. */
static void lua_lvgl_indev_adapter_bridge_timer_cb(lv_timer_t *timer)
{
    (void)timer;

    lua_lvgl_indev_process_pending_locked();
    lua_lvgl_indev_trace_drain_locked();
}

#endif

/* Attach a pointer indev backed by `touch_handle`. Caller holds the lock.
 * Returns NULL on success; on failure returns a static error message and
 * leaves s_lvgl.touch_indev / touch_handle untouched. */
static const char *lua_lvgl_indev_attach_touch_locked(void *touch_handle)
{
    lv_indev_t *indev;
#ifndef __EMSCRIPTEN__
    lua_lvgl_touch_sampler_t *sampler;
    lv_timer_t *bridge_timer = NULL;
#endif

    if (s_lvgl.touch_indev) {
        return "lvgl touch indev is already registered";
    }
    indev = lv_indev_create();
    if (!indev) {
        return "lvgl indev create failed";
    }
#ifndef __EMSCRIPTEN__
    sampler = lua_lvgl_touch_sampler_create((esp_lcd_touch_handle_t)touch_handle);
    if (!sampler) {
        lv_indev_delete(indev);
        return "lvgl GT911 sampler create failed";
    }
#endif
    lv_indev_set_type(indev, LV_INDEV_TYPE_POINTER);
    lv_indev_set_read_cb(indev, lua_lvgl_touch_read_cb);
#ifdef __EMSCRIPTEN__
    lv_indev_set_user_data(indev, touch_handle);
#else
    lv_indev_set_user_data(indev, sampler);
#endif
    /* The pager uses LVGL's SCROLL_ONE bound to cap a flick at the adjacent
     * snap point. Throw 15 predicts a deliberate short flick far enough to
     * select that neighbor; SCROLL_ONE remains the hard one-page bound.
     * A small drag limit starts direct manipulation promptly. */
    lv_indev_set_scroll_throw(indev, 15);
    lv_indev_set_scroll_limit(indev, 4);
    lv_timer_set_period(lv_indev_get_read_timer(indev), 4);
    if (s_lvgl.display) {
        lv_indev_set_display(indev, s_lvgl.display);
    }

#ifndef __EMSCRIPTEN__
    if (s_lvgl.adapter_active) {
        bridge_timer = lv_timer_create(lua_lvgl_indev_adapter_bridge_timer_cb,
                                       LUA_LVGL_TOUCH_BRIDGE_PERIOD_MS,
                                       NULL);
        if (!bridge_timer) {
            lua_lvgl_touch_sampler_destroy(sampler);
            lv_indev_delete(indev);
            return "lvgl adapter touch bridge timer create failed";
        }
    }
#endif

    s_lvgl.touch_indev = indev;
    s_lvgl.touch_handle = touch_handle;
#ifndef __EMSCRIPTEN__
    s_lvgl.touch_sampler = sampler;
    s_lvgl.touch_bridge_timer = bridge_timer;
#endif
    return NULL;
}

/* --- Public C API (called from runtime teardown) ----------------------- */

void lua_lvgl_indev_release_locked(void)
{
#ifndef __EMSCRIPTEN__
    if (s_lvgl.touch_bridge_timer) {
        lv_timer_delete(s_lvgl.touch_bridge_timer);
        s_lvgl.touch_bridge_timer = NULL;
    }
    lua_lvgl_touch_sampler_destroy(s_lvgl.touch_sampler);
    s_lvgl.touch_sampler = NULL;
#endif
    if (s_lvgl.touch_indev) {
        /* The owning Lua handle is just a borrowed pointer; we never
         * free the esp_lcd_touch handle itself. */
        lv_indev_set_user_data(s_lvgl.touch_indev, NULL);
        lv_indev_delete(s_lvgl.touch_indev);
        s_lvgl.touch_indev = NULL;
    }
    s_lvgl.touch_handle = NULL;
}

/* --- Lua entries ------------------------------------------------------- */

static int lua_lvgl_indev_register(lua_State *L)
{
    const char *kind = luaL_checkstring(L, 1);
    void *handle = NULL;
    esp_err_t err;
    const char *attach_err = NULL;
    bool unsupported = false;

    luaL_argcheck(L, lua_islightuserdata(L, 2), 2, "indev handle (light userdata) expected");
    handle = lua_touserdata(L, 2);
    luaL_argcheck(L, handle != NULL, 2, "indev handle must be non-NULL");

    if (!s_lvgl.runtime_initialized) {
        return luaL_error(L, "lvgl runtime is not initialized");
    }

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    if (!s_lvgl.runtime_initialized) {
        lua_lvgl_unlock();
        return luaL_error(L, "lvgl runtime is not initialized");
    }
    if (strcmp(kind, "touch") == 0) {
        attach_err = lua_lvgl_indev_attach_touch_locked(handle);
    } else {
        unsupported = true;
    }
    lua_lvgl_unlock();

    if (unsupported) {
        return luaL_error(L, "lvgl unsupported indev kind: %s", kind);
    }
    if (attach_err) {
        return luaL_error(L, "%s", attach_err);
    }
    ESP_LOGI(TAG, "registered %s indev handle=%p", kind, handle);
    lua_pushboolean(L, 1);
    return 1;
}

static int lua_lvgl_indev_unregister(lua_State *L)
{
    const char *kind = luaL_checkstring(L, 1);
    esp_err_t err;
    bool removed = false;
    bool unsupported = false;

    if (!s_lvgl.runtime_initialized) {
        lua_pushboolean(L, 0);
        return 1;
    }

    err = lua_lvgl_lock();
    if (err != ESP_OK) {
        return lua_lvgl_error_esp(L, "lock", err);
    }
    if (strcmp(kind, "touch") == 0) {
        if (s_lvgl.touch_indev) {
            lua_lvgl_indev_release_locked();
            removed = true;
        }
    } else {
        unsupported = true;
    }
    lua_lvgl_unlock();

    if (unsupported) {
        return luaL_error(L, "lvgl unsupported indev kind: %s", kind);
    }
    lua_pushboolean(L, removed);
    return 1;
}

const luaL_Reg lua_lvgl_indev_module_funcs[] = {
    {"indev_register", lua_lvgl_indev_register},
    {"indev_unregister", lua_lvgl_indev_unregister},
    {NULL, NULL},
};
