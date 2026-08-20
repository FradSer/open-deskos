/*
 * Behaviour test for the package-backed canonical App Runtime.
 *
 * Given an App package with app/main.lua, the Runtime must create one
 * sandbox, expose the canonical callbacks through the Manager port, and
 * release that sandbox when the App stops.
 */
#include <string.h>

#include "unity.h"

#include "odk_app_manager.h"
#include "odk_app_runtime.h"

typedef struct {
    int reads;
} source_fixture_t;

static odk_err_t read_app(void *ctx, const char *app_id, const char *rel_path,
                           char *buf, size_t buflen, size_t *outlen)
{
    source_fixture_t *fixture = ctx;
    static const char source[] =
        "return {\n"
        "  on_start = function(ctx) assert(ctx.app_id == 'demo') end,\n"
        "  on_pause = function(ctx) assert(ctx.app_id == 'demo') end,\n"
        "  on_resume = function(ctx) assert(ctx.app_id == 'demo') end,\n"
        "  on_tick = function(ctx) assert(ctx.app_id == 'demo') end,\n"
        "  on_stop = function(ctx) assert(ctx.app_id == 'demo') end,\n"
        "}\n";
    size_t source_len = strlen(source);

    fixture->reads++;
    TEST_ASSERT_EQUAL_STRING("demo", app_id);
    TEST_ASSERT_EQUAL_STRING(ODK_APP_RUNTIME_ENTRY, rel_path);
    TEST_ASSERT_TRUE(buflen > source_len);
    memcpy(buf, source, source_len + 1);
    *outlen = source_len;
    return ODK_OK;
}

void setUp(void) {}
void tearDown(void) {}

static void test_package_runtime_owns_canonical_lua_lifecycle(void)
{
    source_fixture_t source_fixture = { 0 };
    const odk_app_source_port_t source = { .read_file = read_app };
    const odk_app_runtime_config_t runtime_config = {
        .source = &source,
        .source_ctx = &source_fixture,
        .sandbox_limits = {
            .pool_size = 64 * 1024,
            .instr_budget = 100000,
        },
    };
    odk_app_runtime_t *runtime = odk_app_runtime_create(&runtime_config);
    TEST_ASSERT_NOT_NULL(runtime);

    const odk_app_manager_config_t manager_config = {
        .max_instances = 2,
        .runtime = odk_app_runtime_port(runtime),
        .runtime_ctx = runtime,
    };
    odk_app_manager_t *manager = odk_app_manager_create(&manager_config);
    TEST_ASSERT_NOT_NULL(manager);

    const odk_app_descriptor_t app = {
        .app_id = "demo",
        .kind = ODK_APP_KIND_SERVICE,
    };
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &app));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_start(manager, "demo"));
    TEST_ASSERT_EQUAL_INT(1, source_fixture.reads);
    TEST_ASSERT_EQUAL_INT(1, odk_app_manager_live_count(manager));

    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_tick(manager));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_pause(manager, "demo"));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_resume(manager, "demo"));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_stop(manager, "demo"));
    TEST_ASSERT_EQUAL_INT(ODK_APP_STATE_STOPPED,
                          odk_app_manager_state(manager, "demo"));
    TEST_ASSERT_EQUAL_INT(0, odk_app_manager_live_count(manager));

    odk_app_manager_destroy(manager);
    odk_app_runtime_destroy(runtime);
}

static void test_runtime_rejects_an_invalid_app_id_before_reading_source(void)
{
    source_fixture_t source_fixture = { 0 };
    const odk_app_source_port_t source = { .read_file = read_app };
    const odk_app_runtime_config_t runtime_config = {
        .source = &source,
        .source_ctx = &source_fixture,
        .sandbox_limits = {
            .pool_size = 64 * 1024,
            .instr_budget = 100000,
        },
    };
    odk_app_runtime_t *runtime = odk_app_runtime_create(&runtime_config);
    TEST_ASSERT_NOT_NULL(runtime);

    const odk_app_descriptor_t invalid_app = {
        .app_id = "../outside",
        .kind = ODK_APP_KIND_SERVICE,
    };
    void *instance = NULL;
    TEST_ASSERT_EQUAL_INT(ODK_ERR_BAD_APP_ID,
                          odk_app_runtime_port(runtime)->start(
                              runtime, &invalid_app, &instance));
    TEST_ASSERT_NULL(instance);
    TEST_ASSERT_EQUAL_INT(0, source_fixture.reads);

    odk_app_runtime_destroy(runtime);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_package_runtime_owns_canonical_lua_lifecycle);
    RUN_TEST(test_runtime_rejects_an_invalid_app_id_before_reading_source);
    return UNITY_END();
}
