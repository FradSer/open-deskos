#pragma once

#include <stdbool.h>
#include <stdint.h>

#define NAVIGATION_KEY_LEFT 0x50
#define NAVIGATION_KEY_RIGHT 0x4F

typedef bool (*navigation_send_fn)(void *context, uint8_t keycode);

typedef struct {
    bool active;
    bool waiting_for_release;
    uint8_t release_samples;
    int16_t start_x;
    int16_t start_y;
} navigation_gesture_t;

void navigation_gesture_touch(navigation_gesture_t *gesture, int16_t x, int16_t y,
                              navigation_send_fn send, void *context);
void navigation_gesture_release(navigation_gesture_t *gesture,
                                navigation_send_fn send, void *context);
