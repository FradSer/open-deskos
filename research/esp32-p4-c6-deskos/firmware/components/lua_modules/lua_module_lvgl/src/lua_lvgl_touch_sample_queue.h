/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

/* A queue of 64 entries covers more than 250 ms at a 4 ms polling period.
 * Consecutive MOVE entries are coalesced, so an ordinary in-progress gesture
 * needs only PRESS + MOVE + RELEASE even if the renderer is busy. */
#define LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN 64

typedef enum {
    LUA_LVGL_TOUCH_SAMPLE_PRESS = 0,
    LUA_LVGL_TOUCH_SAMPLE_MOVE,
    LUA_LVGL_TOUCH_SAMPLE_RELEASE,
} lua_lvgl_touch_sample_kind_t;

typedef struct {
    lua_lvgl_touch_sample_kind_t kind;
    int32_t x;
    int32_t y;
    uint32_t timestamp;
} lua_lvgl_touch_sample_t;

typedef struct {
    lua_lvgl_touch_sample_t samples[LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN];
    uint8_t head;
    uint8_t tail;
    uint8_t count;
} lua_lvgl_touch_sample_queue_t;

void lua_lvgl_touch_sample_queue_init(lua_lvgl_touch_sample_queue_t *queue);
bool lua_lvgl_touch_sample_queue_push(lua_lvgl_touch_sample_queue_t *queue,
                                      lua_lvgl_touch_sample_t sample);
/* Remove every fully completed, unread gesture and retain a possible active
 * tail. The sampler calls this when a newer physical PRESS arrives before
 * LVGL has consumed an earlier complete gesture. */
uint8_t lua_lvgl_touch_sample_queue_discard_completed(lua_lvgl_touch_sample_queue_t *queue);
/* LVGL has already received a PRESS, but the physical finger ended before the
 * next render pass. Keep only that matching RELEASE so a newer physical PRESS
 * cannot replay stale MOVE samples from the old gesture. */
bool lua_lvgl_touch_sample_queue_retain_release_boundary(lua_lvgl_touch_sample_queue_t *queue);
bool lua_lvgl_touch_sample_queue_pop(lua_lvgl_touch_sample_queue_t *queue,
                                     lua_lvgl_touch_sample_t *out_sample,
                                     bool *out_has_more);
