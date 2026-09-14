#include "touchpad_gesture.h"

#include <string.h>

void touchpad_gesture_init(touchpad_gesture_t *gesture)
{
    memset(gesture, 0, sizeof(*gesture));
}

void touchpad_gesture_set_actions(touchpad_gesture_t *gesture, uint8_t count, const touchbar_action_t *actions)
{
    if (count > MAX_TOUCHBAR_ACTIONS) count = MAX_TOUCHBAR_ACTIONS;
    gesture->action_count = count;
    for (uint8_t i = 0; i < count; ++i) {
        strncpy(gesture->actions[i].id, actions[i].id, ACTION_ID_MAX_BYTES);
        gesture->actions[i].id[ACTION_ID_MAX_BYTES] = '\0';
        strncpy(gesture->actions[i].label, actions[i].label, ACTION_LABEL_MAX_BYTES);
        gesture->actions[i].label[ACTION_LABEL_MAX_BYTES] = '\0';
    }
}

void touchpad_gesture_touch(touchpad_gesture_t *gesture, int16_t x, int16_t y,
                            uint32_t now_ms, touchpad_send_fn send, void *context)
{
    gesture->release_samples = 0;
    if (gesture->waiting_for_release) return;

    // 1. Bottom Section: Contextual Touch Bar (Expanded height)
    if (y >= TOUCHBAR_TOP) {
        if (gesture->action_count > 0) {
            int rel_x = x - TOUCHBAR_START_X;
            if (rel_x < 0) rel_x = 0;
            int btn_w = TOUCHBAR_WIDTH / gesture->action_count;
            if (btn_w <= 0) btn_w = TOUCHBAR_WIDTH;
            int idx = rel_x / btn_w;
            if (idx >= gesture->action_count) idx = gesture->action_count - 1;
            if (send(context, REMOTE_INPUT_ACTION, gesture->actions[idx].id)) {
                gesture->waiting_for_release = true;
            }
        }
        return;
    }

    // 2. Middle Section: System row (Back and Voice/Mic)
    if (y >= SYSTEM_ROW_TOP) {
        if (x < SYSTEM_ROW_DIVIDER_X) {
            if (send(context, REMOTE_INPUT_BACK, NULL)) {
                gesture->waiting_for_release = true;
            }
        } else {
            if (send(context, REMOTE_INPUT_MIC, NULL)) {
                gesture->waiting_for_release = true;
            }
        }
        return;
    }

    // 3. Top Section: Apple TV Touchpad / Clickpad (Upper display area)
    if (!gesture->active) {
        gesture->active = true;
        gesture->start_x = x;
        gesture->start_y = y;
        gesture->started_at_ms = now_ms;
        return;
    }

    const int delta_x = x - gesture->start_x;
    const int delta_y = y - gesture->start_y;

    // Check long press (secondary) in center area
    const int center_dx = gesture->start_x - TOUCHPAD_CENTER_X;
    const int center_dy = gesture->start_y - TOUCHPAD_CENTER_Y;
    if (!gesture->secondary_sent && (now_ms - gesture->started_at_ms >= LONG_PRESS_MS) &&
        (center_dx * center_dx + center_dy * center_dy <= TOUCHPAD_CENTER_RADIUS_SQ)) {
        if (send(context, REMOTE_INPUT_SECONDARY, NULL)) {
            gesture->secondary_sent = true;
        }
        return;
    }

    // Check directional swipe on touch surface
    const int abs_x = delta_x >= 0 ? delta_x : -delta_x;
    const int abs_y = delta_y >= 0 ? delta_y : -delta_y;
    if (abs_x >= DIRECTION_MINIMUM_PIXELS || abs_y >= DIRECTION_MINIMUM_PIXELS) {
        remote_input_t dir;
        if (abs_x >= abs_y) {
            dir = delta_x > 0 ? REMOTE_INPUT_RIGHT : REMOTE_INPUT_LEFT;
        } else {
            dir = delta_y > 0 ? REMOTE_INPUT_DOWN : REMOTE_INPUT_UP;
        }
        if (send(context, dir, NULL)) {
            gesture->active = false;
            gesture->waiting_for_release = true;
        }
    }
}

void touchpad_gesture_release(touchpad_gesture_t *gesture, uint32_t now_ms,
                              touchpad_send_fn send, void *context)
{
    (void)now_ms;
    gesture->release_samples++;

    if (gesture->active) {
        gesture->active = false;
        if (!gesture->secondary_sent) {
            // Evaluate tap position on Clickpad
            const int dx = gesture->start_x - TOUCHPAD_CENTER_X;
            const int dy = gesture->start_y - TOUCHPAD_CENTER_Y;
            const int dist_sq = dx * dx + dy * dy;

            if (dist_sq <= TOUCHPAD_CENTER_RADIUS_SQ) {
                send(context, REMOTE_INPUT_PRIMARY, NULL);
            } else {
                const int abs_dx = dx >= 0 ? dx : -dx;
                const int abs_dy = dy >= 0 ? dy : -dy;
                if (abs_dx >= abs_dy) {
                    send(context, dx > 0 ? REMOTE_INPUT_RIGHT : REMOTE_INPUT_LEFT, NULL);
                } else {
                    send(context, dy > 0 ? REMOTE_INPUT_DOWN : REMOTE_INPUT_UP, NULL);
                }
            }
        }
        gesture->secondary_sent = false;
        gesture->waiting_for_release = true;
        return;
    }

    if (gesture->waiting_for_release) {
        if (gesture->release_samples >= TOUCH_RELEASE_SAMPLES) {
            gesture->waiting_for_release = false;
            gesture->release_samples = 0;
        }
    }
}
