#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

#include "font5x7.h"
#include "touchpad_gesture.h"

typedef struct {
    remote_input_t inputs[32];
    char action_ids[32][ACTION_ID_MAX_BYTES + 1];
    unsigned count;
} input_log_t;

static bool record_input(void *context, remote_input_t input, const char *action_id)
{
    input_log_t *log = context;
    log->inputs[log->count] = input;
    if (action_id != NULL) {
        strncpy(log->action_ids[log->count], action_id, ACTION_ID_MAX_BYTES);
        log->action_ids[log->count][ACTION_ID_MAX_BYTES] = '\0';
    } else {
        log->action_ids[log->count][0] = '\0';
    }
    log->count++;
    return true;
}

static void release(touchpad_gesture_t *gesture, input_log_t *log, uint32_t now_ms)
{
    for (unsigned i = 0; i < 6; ++i) {
        touchpad_gesture_release(gesture, now_ms, record_input, log);
    }
}

static void test_font_glyphs(void)
{
    // 1. Regression test: 'I' must NOT be blank
    const uint8_t *glyph_i = font5x7_get_glyph('I');
    bool has_bits_i = false;
    for (int col = 0; col < 5; ++col) {
        if (glyph_i[col] != 0) {
            has_bits_i = true;
            break;
        }
    }
    assert(has_bits_i && "Glyph 'I' must not be blank");
    assert(glyph_i[1] == 0x41);
    assert(glyph_i[2] == 0x7F);
    assert(glyph_i[3] == 0x41);

    // 2. All characters in "RIGHT" must render non-empty glyphs
    const char *word = "RIGHT";
    for (const char *p = word; *p != '\0'; ++p) {
        const uint8_t *glyph = font5x7_get_glyph(*p);
        bool has_bits = false;
        for (int col = 0; col < 5; ++col) {
            if (glyph[col] != 0) {
                has_bits = true;
                break;
            }
        }
        assert(has_bits && "Every character in RIGHT must have a non-empty glyph");
    }

    // 3. Lowercase 'i' maps to 'I'
    const uint8_t *glyph_lower_i = font5x7_get_glyph('i');
    assert(memcmp(glyph_lower_i, glyph_i, 5) == 0);

    // 4. Other glyphs with first column 0 ('1', '.', ':') must not be blank
    const char *empty_col0_chars = "1.:";
    for (const char *p = empty_col0_chars; *p != '\0'; ++p) {
        const uint8_t *glyph = font5x7_get_glyph(*p);
        bool has_bits = false;
        for (int col = 0; col < 5; ++col) {
            if (glyph[col] != 0) {
                has_bits = true;
                break;
            }
        }
        assert(has_bits && "Glyphs with empty col 0 must have valid bits");
    }

    // 5. Space and unmapped characters return all zeros
    const uint8_t *glyph_space = font5x7_get_glyph(' ');
    for (int col = 0; col < 5; ++col) {
        assert(glyph_space[col] == 0);
    }
    const uint8_t *glyph_unmapped = font5x7_get_glyph('@');
    for (int col = 0; col < 5; ++col) {
        assert(glyph_unmapped[col] == 0);
    }
}

int main(void)
{
    test_font_glyphs();

    touchpad_gesture_t gesture;
    touchpad_gesture_init(&gesture);
    input_log_t log = {0};

    // 1. Swiping in 4 directions on the upper Touchpad (center at y=84)
    // Swipe DOWN: y: 70 -> 120 (delta_y = +50 >= 40)
    touchpad_gesture_touch(&gesture, 120, 70, 0, record_input, &log);
    touchpad_gesture_touch(&gesture, 120, 120, 20, record_input, &log);
    release(&gesture, &log, 30);
    // Swipe UP: y: 100 -> 50 (delta_y = -50 <= -40)
    touchpad_gesture_touch(&gesture, 120, 100, 100, record_input, &log);
    touchpad_gesture_touch(&gesture, 120, 50, 120, record_input, &log);
    release(&gesture, &log, 130);
    // Swipe RIGHT: x: 90 -> 140 (delta_x = +50 >= 40)
    touchpad_gesture_touch(&gesture, 90, 84, 200, record_input, &log);
    touchpad_gesture_touch(&gesture, 140, 84, 220, record_input, &log);
    release(&gesture, &log, 230);
    // Swipe LEFT: x: 150 -> 100 (delta_x = -50 <= -40)
    touchpad_gesture_touch(&gesture, 150, 84, 300, record_input, &log);
    touchpad_gesture_touch(&gesture, 100, 84, 320, record_input, &log);
    release(&gesture, &log, 330);

    assert(log.count == 4);
    assert(log.inputs[0] == REMOTE_INPUT_DOWN);
    assert(log.inputs[1] == REMOTE_INPUT_UP);
    assert(log.inputs[2] == REMOTE_INPUT_RIGHT);
    assert(log.inputs[3] == REMOTE_INPUT_LEFT);

    // 2. Cardinal ring taps on Touchpad (centered at 120, 84)
    // Tap UP (120, 25) -> dy = -59, dist_sq = 3481 > 1444
    touchpad_gesture_touch(&gesture, 120, 25, 400, record_input, &log);
    release(&gesture, &log, 420);
    // Tap DOWN (120, 145) -> dy = 61, dist_sq = 3721 > 1444
    touchpad_gesture_touch(&gesture, 120, 145, 500, record_input, &log);
    release(&gesture, &log, 520);
    // Tap LEFT (30, 84) -> dx = -90, dist_sq = 8100 > 1444
    touchpad_gesture_touch(&gesture, 30, 84, 600, record_input, &log);
    release(&gesture, &log, 620);
    // Tap RIGHT (210, 84) -> dx = 90, dist_sq = 8100 > 1444
    touchpad_gesture_touch(&gesture, 210, 84, 700, record_input, &log);
    release(&gesture, &log, 720);

    assert(log.count == 8);
    assert(log.inputs[4] == REMOTE_INPUT_UP);
    assert(log.inputs[5] == REMOTE_INPUT_DOWN);
    assert(log.inputs[6] == REMOTE_INPUT_LEFT);
    assert(log.inputs[7] == REMOTE_INPUT_RIGHT);

    // 3. Center tap -> PRIMARY (Select) at new center (120, 84)
    touchpad_gesture_touch(&gesture, 120, 84, 800, record_input, &log);
    release(&gesture, &log, 850);
    assert(log.count == 9);
    assert(log.inputs[8] == REMOTE_INPUT_PRIMARY);

    // 4. Center long press -> SECONDARY at new center (120, 84)
    touchpad_gesture_touch(&gesture, 120, 84, 900, record_input, &log);
    touchpad_gesture_touch(&gesture, 120, 84, 1550, record_input, &log);
    release(&gesture, &log, 1560);
    assert(log.count == 10);
    assert(log.inputs[9] == REMOTE_INPUT_SECONDARY);

    // 5. System buttons in middle row (y in [160, 212))
    // BACK button (left half, e.g. x=60, y=185)
    touchpad_gesture_touch(&gesture, 60, 185, 1600, record_input, &log);
    release(&gesture, &log, 1610);
    assert(log.count == 11);
    assert(log.inputs[10] == REMOTE_INPUT_BACK);

    // 6. MIC button (right half, e.g. x=180, y=185)
    touchpad_gesture_touch(&gesture, 180, 185, 1700, record_input, &log);
    release(&gesture, &log, 1710);
    assert(log.count == 12);
    assert(log.inputs[11] == REMOTE_INPUT_MIC);

    // 7. Contextual Touch Bar in enlarged bottom area (y in [212, 320))
    const touchbar_action_t actions[2] = {
        {.id = "prev_track", .label = "PREV"},
        {.id = "next_track", .label = "NEXT"},
    };
    touchpad_gesture_set_actions(&gesture, 2, actions);

    // Tap first action in enlarged Touch Bar (y=230, which was previously in system row!)
    touchpad_gesture_touch(&gesture, 50, 230, 1800, record_input, &log);
    release(&gesture, &log, 1810);
    assert(log.count == 13);
    assert(log.inputs[12] == REMOTE_INPUT_ACTION);
    assert(strcmp(log.action_ids[12], "prev_track") == 0);

    // Tap second action near bottom of Touch Bar (y=290)
    touchpad_gesture_touch(&gesture, 170, 290, 1900, record_input, &log);
    release(&gesture, &log, 1910);
    assert(log.count == 14);
    assert(log.inputs[13] == REMOTE_INPUT_ACTION);
    assert(strcmp(log.action_ids[13], "next_track") == 0);

    // 8. Empty Touch Bar does not emit actions
    touchpad_gesture_set_actions(&gesture, 0, NULL);
    touchpad_gesture_touch(&gesture, 120, 260, 2000, record_input, &log);
    release(&gesture, &log, 2010);
    assert(log.count == 14);

    // 9. Debounce stability test: Touch during release debounce window is ignored
    touchpad_gesture_touch(&gesture, 60, 185, 2100, record_input, &log);
    assert(log.count == 15);
    assert(log.inputs[14] == REMOTE_INPUT_BACK);
    for (unsigned i = 0; i < 3; ++i) {
        touchpad_gesture_release(&gesture, 2110, record_input, &log);
    }
    touchpad_gesture_touch(&gesture, 60, 185, 2120, record_input, &log);
    assert(log.count == 15);

    for (unsigned i = 0; i < 6; ++i) {
        touchpad_gesture_release(&gesture, 2130, record_input, &log);
    }
    touchpad_gesture_touch(&gesture, 60, 185, 2140, record_input, &log);
    release(&gesture, &log, 2150);
    assert(log.count == 16);
    assert(log.inputs[15] == REMOTE_INPUT_BACK);

    // 10. Dynamic Touch Bar with 3 actions in enlarged area
    const touchbar_action_t actions3[3] = {
        {.id = "act_a", .label = "A"},
        {.id = "act_b", .label = "B"},
        {.id = "act_c", .label = "C"},
    };
    touchpad_gesture_set_actions(&gesture, 3, actions3);
    // Button width = 216 / 3 = 72.
    // X=12..83 -> A, X=84..155 -> B, X=156..227 -> C.
    touchpad_gesture_touch(&gesture, 40, 240, 2200, record_input, &log);
    release(&gesture, &log, 2210);
    touchpad_gesture_touch(&gesture, 120, 270, 2220, record_input, &log);
    release(&gesture, &log, 2230);
    touchpad_gesture_touch(&gesture, 200, 300, 2240, record_input, &log);
    release(&gesture, &log, 2250);

    assert(log.count == 19);
    assert(log.inputs[16] == REMOTE_INPUT_ACTION);
    assert(strcmp(log.action_ids[16], "act_a") == 0);
    assert(log.inputs[17] == REMOTE_INPUT_ACTION);
    assert(strcmp(log.action_ids[17], "act_b") == 0);
    assert(log.inputs[18] == REMOTE_INPUT_ACTION);
    assert(strcmp(log.action_ids[18], "act_c") == 0);

    // 11. Boundary checks: touches at extreme edges of upper Touchpad
    touchpad_gesture_touch(&gesture, 15, 20, 2300, record_input, &log);
    touchpad_gesture_touch(&gesture, 75, 20, 2320, record_input, &log);
    release(&gesture, &log, 2330);
    assert(log.count == 20);
    assert(log.inputs[19] == REMOTE_INPUT_RIGHT);

    return 0;
}
