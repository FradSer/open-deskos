/* Regression tests for the GT911-to-LVGL buffered input handoff. */
#include "unity.h"

#include "lua_lvgl_touch_sample_queue.h"

void setUp(void) {}
void tearDown(void) {}

static lua_lvgl_touch_sample_t sample(lua_lvgl_touch_sample_kind_t kind,
                                      int32_t x,
                                      int32_t y,
                                      uint32_t timestamp)
{
    return (lua_lvgl_touch_sample_t) {
        .kind = kind,
        .x = x,
        .y = y,
        .timestamp = timestamp,
    };
}

void test_short_gesture_preserves_edges_and_latest_motion(void)
{
    lua_lvgl_touch_sample_queue_t queue;
    lua_lvgl_touch_sample_t out;
    bool more = false;

    lua_lvgl_touch_sample_queue_init(&queue);
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 420, 300, 100)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_MOVE, 360, 300, 104)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_MOVE, 240, 300, 108)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, 240, 300, 112)));

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_PRESS, out.kind);
    TEST_ASSERT_EQUAL_UINT32(100, out.timestamp);
    TEST_ASSERT_TRUE(more);

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_MOVE, out.kind);
    TEST_ASSERT_EQUAL_INT32(240, out.x);
    TEST_ASSERT_EQUAL_UINT32(108, out.timestamp);
    TEST_ASSERT_TRUE(more);

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_RELEASE, out.kind);
    TEST_ASSERT_EQUAL_UINT32(112, out.timestamp);
    TEST_ASSERT_FALSE(more);
}

void test_full_queue_discards_completed_history_before_current_gesture(void)
{
    lua_lvgl_touch_sample_queue_t queue;
    lua_lvgl_touch_sample_t out;
    bool more = false;

    lua_lvgl_touch_sample_queue_init(&queue);
    for (uint32_t i = 0; i < LUA_LVGL_TOUCH_SAMPLE_QUEUE_LEN / 2; ++i) {
        TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
            &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, (int32_t)i, 0, i * 2)));
        TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
            &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, (int32_t)i, 0, i * 2 + 1)));
    }

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 999, 0, 1000)));

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_PRESS, out.kind);
    TEST_ASSERT_EQUAL_INT32(1, out.x);

    while (lua_lvgl_touch_sample_queue_pop(&queue, &out, &more)) {
        if (out.x == 999) {
            TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_PRESS, out.kind);
            return;
        }
    }
    TEST_FAIL_MESSAGE("new gesture was discarded while evicting completed history");
}

void test_new_gesture_discards_unread_completed_gesture(void)
{
    lua_lvgl_touch_sample_queue_t queue;
    lua_lvgl_touch_sample_t out;
    bool more = false;

    lua_lvgl_touch_sample_queue_init(&queue);
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 420, 300, 100)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_MOVE, 240, 300, 104)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, 240, 300, 108)));

    TEST_ASSERT_EQUAL_UINT8(3, lua_lvgl_touch_sample_queue_discard_completed(&queue));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 60, 300, 112)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_MOVE, 220, 300, 116)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, 220, 300, 120)));

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_PRESS, out.kind);
    TEST_ASSERT_EQUAL_INT32(60, out.x);
    TEST_ASSERT_TRUE(more);

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_MOVE, out.kind);
    TEST_ASSERT_EQUAL_INT32(220, out.x);
    TEST_ASSERT_TRUE(more);

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_RELEASE, out.kind);
    TEST_ASSERT_FALSE(more);
}

void test_discard_completed_keeps_an_active_unread_gesture(void)
{
    lua_lvgl_touch_sample_queue_t queue;
    lua_lvgl_touch_sample_t out;
    bool more = false;

    lua_lvgl_touch_sample_queue_init(&queue);
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 420, 300, 100)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, 240, 300, 108)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 60, 300, 112)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_MOVE, 180, 300, 116)));

    TEST_ASSERT_EQUAL_UINT8(2, lua_lvgl_touch_sample_queue_discard_completed(&queue));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_PRESS, out.kind);
    TEST_ASSERT_EQUAL_INT32(60, out.x);
    TEST_ASSERT_TRUE(more);
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_MOVE, out.kind);
    TEST_ASSERT_EQUAL_INT32(180, out.x);
    TEST_ASSERT_FALSE(more);
}

void test_new_press_keeps_only_release_of_a_delivered_gesture(void)
{
    lua_lvgl_touch_sample_queue_t queue;
    lua_lvgl_touch_sample_t out;
    bool more = false;

    lua_lvgl_touch_sample_queue_init(&queue);
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_MOVE, 240, 300, 104)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, 240, 300, 108)));

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_retain_release_boundary(&queue));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 60, 300, 112)));

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_RELEASE, out.kind);
    TEST_ASSERT_EQUAL_INT32(240, out.x);
    TEST_ASSERT_TRUE(more);

    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_PRESS, out.kind);
    TEST_ASSERT_EQUAL_INT32(60, out.x);
    TEST_ASSERT_FALSE(more);
}

void test_discard_completed_handles_a_wrapped_queue(void)
{
    lua_lvgl_touch_sample_queue_t queue;
    lua_lvgl_touch_sample_t out;
    bool more = false;

    lua_lvgl_touch_sample_queue_init(&queue);
    for (uint32_t i = 0; i < 30; ++i) {
        TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
            &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, (int32_t)i, 0, i * 2)));
        TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
            &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, (int32_t)i, 0, i * 2 + 1)));
    }
    for (uint32_t i = 0; i < 40; ++i) {
        TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    }
    for (uint32_t i = 30; i < 45; ++i) {
        TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
            &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, (int32_t)i, 0, i * 2)));
        TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
            &queue, sample(LUA_LVGL_TOUCH_SAMPLE_RELEASE, (int32_t)i, 0, i * 2 + 1)));
    }
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_PRESS, 500, 0, 100)));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_push(
        &queue, sample(LUA_LVGL_TOUCH_SAMPLE_MOVE, 300, 0, 104)));

    TEST_ASSERT_EQUAL_UINT8(50, lua_lvgl_touch_sample_queue_discard_completed(&queue));
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_PRESS, out.kind);
    TEST_ASSERT_EQUAL_INT32(500, out.x);
    TEST_ASSERT_TRUE(more);
    TEST_ASSERT_TRUE(lua_lvgl_touch_sample_queue_pop(&queue, &out, &more));
    TEST_ASSERT_EQUAL_INT(LUA_LVGL_TOUCH_SAMPLE_MOVE, out.kind);
    TEST_ASSERT_EQUAL_INT32(300, out.x);
    TEST_ASSERT_FALSE(more);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_short_gesture_preserves_edges_and_latest_motion);
    RUN_TEST(test_full_queue_discards_completed_history_before_current_gesture);
    RUN_TEST(test_new_gesture_discards_unread_completed_gesture);
    RUN_TEST(test_discard_completed_keeps_an_active_unread_gesture);
    RUN_TEST(test_new_press_keeps_only_release_of_a_delivered_gesture);
    RUN_TEST(test_discard_completed_handles_a_wrapped_queue);
    return UNITY_END();
}
