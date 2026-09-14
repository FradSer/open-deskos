#pragma once

#include <stdbool.h>
#include <stdint.h>

#define DISPLAY_WIDTH 240
#define DISPLAY_HEIGHT 320

#define TOUCHPAD_X 12
#define TOUCHPAD_Y 12
#define TOUCHPAD_WIDTH 216
#define TOUCHPAD_HEIGHT 144
#define TOUCHPAD_CENTER_X 120
#define TOUCHPAD_CENTER_Y 84
#define TOUCHPAD_CENTER_RADIUS_SQ (38 * 38)
#define TOUCHPAD_BOTTOM_BOUNDARY 160

#define SYSTEM_ROW_TOP 160
#define SYSTEM_ROW_BOTTOM 212
#define SYSTEM_ROW_DIVIDER_X 120

#define TOUCHBAR_TOP 212
#define TOUCHBAR_X 12
#define TOUCHBAR_START_X 12
#define TOUCHBAR_WIDTH 216
#define TOUCHBAR_Y 216
#define TOUCHBAR_HEIGHT 92

#define DIRECTION_MINIMUM_PIXELS 40
#define LONG_PRESS_MS 600
#define TOUCH_RELEASE_SAMPLES 6

#define MAX_TOUCHBAR_ACTIONS 4
#define ACTION_ID_MAX_BYTES 31
#define ACTION_LABEL_MAX_BYTES 15

typedef enum {
    REMOTE_INPUT_LEFT,
    REMOTE_INPUT_RIGHT,
    REMOTE_INPUT_UP,
    REMOTE_INPUT_DOWN,
    REMOTE_INPUT_PRIMARY,
    REMOTE_INPUT_SECONDARY,
    REMOTE_INPUT_BACK,
    REMOTE_INPUT_MIC,
    REMOTE_INPUT_ACTION,
} remote_input_t;

typedef bool (*touchpad_send_fn)(void *context, remote_input_t input, const char *action_id);

typedef struct {
    char id[ACTION_ID_MAX_BYTES + 1];
    char label[ACTION_LABEL_MAX_BYTES + 1];
} touchbar_action_t;

typedef struct {
    bool active;
    bool waiting_for_release;
    bool secondary_sent;
    uint8_t release_samples;
    int16_t start_x;
    int16_t start_y;
    uint32_t started_at_ms;
    uint8_t action_count;
    touchbar_action_t actions[MAX_TOUCHBAR_ACTIONS];
} touchpad_gesture_t;

void touchpad_gesture_init(touchpad_gesture_t *gesture);
void touchpad_gesture_set_actions(touchpad_gesture_t *gesture, uint8_t count, const touchbar_action_t *actions);
void touchpad_gesture_touch(touchpad_gesture_t *gesture, int16_t x, int16_t y,
                            uint32_t now_ms, touchpad_send_fn send, void *context);
void touchpad_gesture_release(touchpad_gesture_t *gesture, uint32_t now_ms,
                              touchpad_send_fn send, void *context);
