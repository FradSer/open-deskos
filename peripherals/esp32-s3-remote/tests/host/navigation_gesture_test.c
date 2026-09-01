#include <assert.h>
#include <stdbool.h>
#include <stdint.h>

#include "navigation_gesture.h"

typedef struct {
    uint8_t keys[4];
    unsigned count;
} navigation_log_t;

static bool record_key(void *context, uint8_t keycode)
{
    navigation_log_t *log = context;
    log->keys[log->count++] = keycode;
    return true;
}

static void tap_right(navigation_gesture_t *gesture, navigation_log_t *log)
{
    navigation_gesture_touch(gesture, 180, 200, record_key, log);
    for (unsigned i = 0; i < 6; ++i) {
        navigation_gesture_release(gesture, record_key, log);
    }
    for (unsigned i = 0; i < 6; ++i) {
        navigation_gesture_release(gesture, record_key, log);
    }
}

int main(void)
{
    navigation_gesture_t gesture = {0};
    navigation_log_t log = {0};

    tap_right(&gesture, &log);
    tap_right(&gesture, &log);

    assert(log.count == 2);
    assert(log.keys[0] == NAVIGATION_KEY_RIGHT);
    assert(log.keys[1] == NAVIGATION_KEY_RIGHT);
    return 0;
}
