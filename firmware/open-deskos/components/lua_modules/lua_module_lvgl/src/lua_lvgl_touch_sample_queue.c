/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include "lua_lvgl_touch_sample_queue.h"

#include <string.h>

static uint8_t queue_next(uint8_t index)
{
    return (uint8_t)((index + 1U) % LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN);
}

static uint8_t queue_previous(uint8_t index)
{
    return index == 0 ? LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN - 1 : (uint8_t)(index - 1U);
}

/* Make room by removing the oldest *complete* historical gesture. This never
 * breaks the edge ordering of the currently active gesture. */
static bool queue_discard_oldest_completed_gesture(lua_lvgl_touch_sample_queue_t *queue)
{
    uint8_t index = queue->head;
    uint8_t removed = 0;

    for (uint8_t i = 0; i < queue->count; ++i) {
        removed++;
        if (queue->samples[index].kind == LUA_LVGL_TOUCH_SAMPLE_RELEASE) {
            queue->head = queue_next(index);
            queue->count = (uint8_t)(queue->count - removed);
            return true;
        }
        index = queue_next(index);
    }
    return false;
}

/* A full queue without a release can only contain the active gesture. Drop an
 * intermediate MOVE before dropping an edge, preserving PRESS/RELEASE order. */
static bool queue_discard_oldest_move(lua_lvgl_touch_sample_queue_t *queue)
{
    uint8_t move_offset = queue->count;
    uint8_t index = queue->head;

    for (uint8_t i = 0; i < queue->count; ++i) {
        if (queue->samples[index].kind == LUA_LVGL_TOUCH_SAMPLE_MOVE) {
            move_offset = i;
            break;
        }
        index = queue_next(index);
    }
    if (move_offset == queue->count) {
        return false;
    }

    for (uint8_t i = move_offset; i + 1U < queue->count; ++i) {
        uint8_t dst = (uint8_t)((queue->head + i) % LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN);
        uint8_t src = queue_next(dst);
        queue->samples[dst] = queue->samples[src];
    }
    queue->tail = queue_previous(queue->tail);
    queue->count--;
    return true;
}

void lua_lvgl_touch_sample_queue_init(lua_lvgl_touch_sample_queue_t *queue)
{
    if (!queue) {
        return;
    }
    memset(queue, 0, sizeof(*queue));
}

uint8_t lua_lvgl_touch_sample_queue_discard_completed(lua_lvgl_touch_sample_queue_t *queue)
{
    uint8_t last_release_offset = LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN;
    uint8_t index;

    if (!queue) {
        return 0;
    }

    index = queue->head;
    for (uint8_t offset = 0; offset < queue->count; ++offset) {
        if (queue->samples[index].kind == LUA_LVGL_TOUCH_SAMPLE_RELEASE) {
            last_release_offset = offset;
        }
        index = queue_next(index);
    }
    if (last_release_offset == LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN) {
        return 0;
    }

    uint8_t discarded = (uint8_t)(last_release_offset + 1U);
    queue->head = (uint8_t)((queue->head + discarded) % LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN);
    queue->count = (uint8_t)(queue->count - discarded);
    return discarded;
}

bool lua_lvgl_touch_sample_queue_retain_release_boundary(lua_lvgl_touch_sample_queue_t *queue)
{
    uint8_t index;

    if (!queue) {
        return false;
    }

    index = queue->head;
    for (uint8_t offset = 0; offset < queue->count; ++offset) {
        if (queue->samples[index].kind == LUA_LVGL_TOUCH_SAMPLE_RELEASE) {
            lua_lvgl_touch_sample_t release = queue->samples[index];

            /* Canonicalize the retained boundary at head. The stale MOVE
             * samples before it would otherwise be replayed after a newer
             * physical finger has already started moving the other way. */
            queue->samples[queue->head] = release;
            queue->tail = queue_next(queue->head);
            queue->count = 1;
            return true;
        }
        index = queue_next(index);
    }

    return false;
}

bool lua_lvgl_touch_sample_queue_push(lua_lvgl_touch_sample_queue_t *queue,
                                      lua_lvgl_touch_sample_t sample)
{
    if (!queue) {
        return false;
    }

    if (sample.kind == LUA_LVGL_TOUCH_SAMPLE_MOVE && queue->count > 0) {
        uint8_t previous = queue_previous(queue->tail);
        if (queue->samples[previous].kind == LUA_LVGL_TOUCH_SAMPLE_MOVE) {
            queue->samples[previous] = sample;
            return true;
        }
    }

    if (queue->count == LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN &&
        !queue_discard_oldest_completed_gesture(queue) &&
        !queue_discard_oldest_move(queue)) {
        return false;
    }

    queue->samples[queue->tail] = sample;
    queue->tail = queue_next(queue->tail);
    queue->count++;
    return true;
}

bool lua_lvgl_touch_sample_queue_pop(lua_lvgl_touch_sample_queue_t *queue,
                                     lua_lvgl_touch_sample_t *out_sample,
                                     bool *out_has_more)
{
    if (!queue || !out_sample || queue->count == 0) {
        if (out_has_more) {
            *out_has_more = false;
        }
        return false;
    }

    *out_sample = queue->samples[queue->head];
    queue->head = queue_next(queue->head);
    queue->count--;
    if (out_has_more) {
        *out_has_more = queue->count > 0;
    }
    return true;
}
