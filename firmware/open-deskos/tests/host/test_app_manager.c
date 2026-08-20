/*
 * Behaviour tests for the canonical App Manager seam.
 *
 * These tests deliberately know nothing about Lua, LVGL, FreeRTOS, or package
 * storage.  They exercise the lifecycle contract through the injected Runtime
 * port so the same state machine can own UI and headless applications.
 */
#include <string.h>

#include "unity.h"

#include "odk_app_manager.h"

typedef struct {
    int start_calls;
    int pause_calls;
    int resume_calls;
    int tick_calls;
    int stop_calls;
    int destroy_calls;
    int fail_start;
    int fail_tick;
} fake_runtime_t;

static odk_err_t fake_start(void *ctx, const odk_app_descriptor_t *app, void **runtime)
{
    fake_runtime_t *fake = ctx;
    fake->start_calls++;
    *runtime = fake;
    if (fake->fail_start) {
        return ODK_ERR_STORAGE;
    }
    (void)app;
    return ODK_OK;
}

static odk_err_t fake_pause(void *ctx, void *runtime)
{
    fake_runtime_t *fake = ctx;
    fake->pause_calls++;
    TEST_ASSERT_EQUAL_PTR(fake, runtime);
    return ODK_OK;
}

static odk_err_t fake_resume(void *ctx, void *runtime)
{
    fake_runtime_t *fake = ctx;
    fake->resume_calls++;
    TEST_ASSERT_EQUAL_PTR(fake, runtime);
    return ODK_OK;
}

static odk_err_t fake_tick(void *ctx, void *runtime)
{
    fake_runtime_t *fake = ctx;
    fake->tick_calls++;
    TEST_ASSERT_EQUAL_PTR(fake, runtime);
    return fake->fail_tick ? ODK_ERR_SANDBOX_VIOLATION : ODK_OK;
}

static odk_err_t fake_stop(void *ctx, void *runtime)
{
    fake_runtime_t *fake = ctx;
    fake->stop_calls++;
    TEST_ASSERT_EQUAL_PTR(fake, runtime);
    return ODK_OK;
}

static void fake_destroy(void *ctx, void *runtime)
{
    fake_runtime_t *fake = ctx;
    fake->destroy_calls++;
    TEST_ASSERT_EQUAL_PTR(fake, runtime);
}

static const odk_app_runtime_port_t k_runtime = {
    .start = fake_start,
    .pause = fake_pause,
    .resume = fake_resume,
    .tick = fake_tick,
    .stop = fake_stop,
    .destroy = fake_destroy,
};

static odk_app_manager_t *make_manager(fake_runtime_t *fake)
{
    odk_app_manager_config_t config = {
        .max_instances = 4,
        .runtime = &k_runtime,
        .runtime_ctx = fake,
    };
    return odk_app_manager_create(&config);
}

static odk_app_descriptor_t app(const char *id, odk_app_kind_t kind)
{
    odk_app_descriptor_t descriptor;
    memset(&descriptor, 0, sizeof(descriptor));
    strncpy(descriptor.app_id, id, sizeof(descriptor.app_id) - 1);
    descriptor.kind = kind;
    return descriptor;
}

void setUp(void) {}
void tearDown(void) {}

static void test_ui_app_runs_then_stops_and_releases_runtime(void)
{
    fake_runtime_t fake = { 0 };
    odk_app_manager_t *manager = make_manager(&fake);
    TEST_ASSERT_NOT_NULL(manager);

    odk_app_descriptor_t descriptor = app("clock", ODK_APP_KIND_UI);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &descriptor));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_start(manager, "clock"));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_RUNNING, odk_app_manager_state(manager, "clock"));
    TEST_ASSERT_EQUAL_INT(1, fake.start_calls);
    TEST_ASSERT_EQUAL_STRING("clock", odk_app_manager_active_ui(manager));

    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_tick(manager));
    TEST_ASSERT_EQUAL_INT(1, fake.tick_calls);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_stop(manager, "clock"));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_STOPPED, odk_app_manager_state(manager, "clock"));
    TEST_ASSERT_EQUAL_INT(1, fake.stop_calls);
    TEST_ASSERT_EQUAL_INT(1, fake.destroy_calls);
    TEST_ASSERT_NULL(odk_app_manager_active_ui(manager));

    odk_app_manager_destroy(manager);
}

static void test_pause_resume_is_only_for_a_live_instance(void)
{
    fake_runtime_t fake = { 0 };
    odk_app_manager_t *manager = make_manager(&fake);
    odk_app_descriptor_t descriptor = app("sensor", ODK_APP_KIND_SERVICE);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &descriptor));

    TEST_ASSERT_EQUAL_INT(ODK_ERR_STATE, odk_app_manager_pause(manager, "sensor"));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_start(manager, "sensor"));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_pause(manager, "sensor"));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_PAUSED, odk_app_manager_state(manager, "sensor"));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_resume(manager, "sensor"));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_RUNNING, odk_app_manager_state(manager, "sensor"));
    TEST_ASSERT_EQUAL_INT(1, fake.pause_calls);
    TEST_ASSERT_EQUAL_INT(1, fake.resume_calls);

    odk_app_manager_destroy(manager);
}

static void test_only_one_ui_app_can_be_foreground(void)
{
    fake_runtime_t fake = { 0 };
    odk_app_manager_t *manager = make_manager(&fake);
    odk_app_descriptor_t first = app("first", ODK_APP_KIND_UI);
    odk_app_descriptor_t second = app("second", ODK_APP_KIND_UI);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &first));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &second));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_start(manager, "first"));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_DENIED, odk_app_manager_start(manager, "second"));
    TEST_ASSERT_EQUAL_STRING("first", odk_app_manager_active_ui(manager));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_INSTALLED, odk_app_manager_state(manager, "second"));

    odk_app_manager_destroy(manager);
}

static void test_start_failure_releases_runtime_and_enters_error(void)
{
    fake_runtime_t fake = { .fail_start = 1 };
    odk_app_manager_t *manager = make_manager(&fake);
    odk_app_descriptor_t descriptor = app("broken", ODK_APP_KIND_UI);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &descriptor));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_STORAGE, odk_app_manager_start(manager, "broken"));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_ERROR, odk_app_manager_state(manager, "broken"));
    TEST_ASSERT_NULL(odk_app_manager_active_ui(manager));
    TEST_ASSERT_EQUAL_INT(1, fake.destroy_calls);

    odk_app_manager_destroy(manager);
}

static void test_repeated_tick_failure_stops_only_the_offending_app(void)
{
    fake_runtime_t fake = { .fail_tick = 1 };
    odk_app_manager_t *manager = make_manager(&fake);
    odk_app_descriptor_t descriptor = app("unstable", ODK_APP_KIND_SERVICE);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &descriptor));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_start(manager, "unstable"));

    TEST_ASSERT_EQUAL_INT(ODK_ERR_SANDBOX_VIOLATION, odk_app_manager_tick(manager));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_SANDBOX_VIOLATION, odk_app_manager_tick(manager));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_SANDBOX_VIOLATION, odk_app_manager_tick(manager));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_STOPPED, odk_app_manager_state(manager, "unstable"));
    TEST_ASSERT_EQUAL_INT(1, fake.stop_calls);
    TEST_ASSERT_EQUAL_INT(1, fake.destroy_calls);

    odk_app_manager_destroy(manager);
}

static void test_unregistered_app_cannot_be_restarted_after_removal(void)
{
    fake_runtime_t fake = { 0 };
    odk_app_manager_t *manager = make_manager(&fake);
    odk_app_descriptor_t descriptor = app("removed", ODK_APP_KIND_UI);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &descriptor));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_start(manager, "removed"));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_stop(manager, "removed"));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_unregister(manager, "removed"));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_ERROR,
                          odk_app_manager_state(manager, "removed"));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_NOT_FOUND,
                          odk_app_manager_start(manager, "removed"));
    odk_app_manager_destroy(manager);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_ui_app_runs_then_stops_and_releases_runtime);
    RUN_TEST(test_pause_resume_is_only_for_a_live_instance);
    RUN_TEST(test_only_one_ui_app_can_be_foreground);
    RUN_TEST(test_start_failure_releases_runtime_and_enters_error);
    RUN_TEST(test_repeated_tick_failure_stops_only_the_offending_app);
    RUN_TEST(test_unregistered_app_cannot_be_restarted_after_removal);
    return UNITY_END();
}
