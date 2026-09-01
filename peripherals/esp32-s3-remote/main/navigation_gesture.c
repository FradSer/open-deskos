#include "navigation_gesture.h"

#define DISPLAY_WIDTH 240
#define NAVIGATION_TARGET_TOP 158
#define NAVIGATION_TARGET_BOTTOM 300
#define SWIPE_MINIMUM_PIXELS 48
#define TOUCH_RELEASE_SAMPLES 6

void navigation_gesture_touch(navigation_gesture_t *gesture, int16_t x, int16_t y,
                              navigation_send_fn send, void *context)
{
    gesture->release_samples = 0;
    if (gesture->waiting_for_release) {
        return;
    }
    if (!gesture->active) {
        gesture->active = true;
        gesture->start_x = x;
        gesture->start_y = y;
        return;
    }
    const int delta_x = x - gesture->start_x;
    const int delta_y = y - gesture->start_y;
    if ((delta_x >= SWIPE_MINIMUM_PIXELS || delta_x <= -SWIPE_MINIMUM_PIXELS) &&
        delta_y < SWIPE_MINIMUM_PIXELS && delta_y > -SWIPE_MINIMUM_PIXELS &&
        send(context, delta_x > 0 ? NAVIGATION_KEY_LEFT : NAVIGATION_KEY_RIGHT)) {
        gesture->active = false;
        gesture->waiting_for_release = true;
    }
}

void navigation_gesture_release(navigation_gesture_t *gesture,
                                navigation_send_fn send, void *context)
{
    if (++gesture->release_samples < TOUCH_RELEASE_SAMPLES) {
        return;
    }
    gesture->release_samples = 0;
    if (gesture->waiting_for_release) {
        gesture->waiting_for_release = false;
        return;
    }
    if (!gesture->active) {
        return;
    }
    const bool is_navigation_target = gesture->start_y >= NAVIGATION_TARGET_TOP &&
                                      gesture->start_y < NAVIGATION_TARGET_BOTTOM;
    const uint8_t keycode = gesture->start_x < DISPLAY_WIDTH / 2 ?
                                NAVIGATION_KEY_LEFT : NAVIGATION_KEY_RIGHT;
    gesture->active = false;
    if (is_navigation_target) {
        send(context, keycode);
    }
}
