/* Host contract tests for the canonical App Console commands. */
#include <stdio.h>
#include <string.h>

#include "unity.h"

#include "odk_app_manager.h"
#include "odk_console.h"
#include "odk_installer.h"

#include "fake_checksum.h"
#include "fake_checksum_real.h"
#include "fake_clock.h"
#include "fake_consent.h"
#include "fake_kv.h"
#include "fake_llm_http.h"
#include "fake_storage.h"
#include "fake_sub.h"

#define APP_ROOT "/apps"
#define STAGING_ROOT "/staging"
#define HEX_A "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

void setUp(void) {}
void tearDown(void) {}

static odk_installer_t *make_installer(fake_storage_t *storage,
                                        fake_checksum_t *checksum,
                                        fake_consent_t *consent)
{
    fake_storage_reset(storage);
    fake_storage_set_free_bytes(storage, 1024 * 1024);
    fake_checksum_reset(checksum);
    fake_consent_reset(consent);
    static const char *const caps[] = { "display" };
    return installer_create(&fake_storage_port, storage,
                            &fake_checksum_port, checksum,
                            &fake_consent_port, consent,
                            APP_ROOT, caps, 1);
}

static void stage_app(fake_storage_t *storage, fake_checksum_t *checksum)
{
    const char manifest[] =
        "{\"schema_version\":2,\"app_id\":\"demo\",\"version\":\"1.0.0\","
        "\"name\":\"Demo\",\"kind\":\"ui\",\"entry\":\"app/main.lua\","
        "\"capabilities\":[\"display\"],\"dependencies\":[],"
        "\"files\":[{\"path\":\"app/main.lua\",\"sha256\":\"" HEX_A "\"}]}";
    const char source[] = "return { on_start = function(ctx) end }\n";
    fake_storage_seed_file(storage, STAGING_ROOT "/demo/manifest.json",
                            manifest, sizeof(manifest) - 1);
    fake_storage_seed_file(storage, STAGING_ROOT "/demo/app/main.lua",
                            source, sizeof(source) - 1);
    fake_checksum_set_for_path(checksum, STAGING_ROOT "/demo/app/main.lua", HEX_A);
}

typedef struct {
    int starts;
    int stops;
} fake_runtime_t;

static odk_err_t fake_runtime_start(void *ctx, const odk_app_descriptor_t *app,
                                     void **runtime)
{
    (void)app;
    fake_runtime_t *fake = ctx;
    fake->starts++;
    *runtime = fake;
    return ODK_OK;
}

static odk_err_t fake_runtime_tick(void *ctx, void *runtime)
{
    return runtime == ctx ? ODK_OK : ODK_ERR_STATE;
}

static odk_err_t fake_runtime_stop(void *ctx, void *runtime)
{
    fake_runtime_t *fake = ctx;
    if (runtime != ctx) {
        return ODK_ERR_STATE;
    }
    fake->stops++;
    return ODK_OK;
}

static void fake_runtime_destroy(void *ctx, void *runtime)
{
    (void)ctx;
    (void)runtime;
}

static odk_app_manager_t *make_manager(fake_runtime_t *runtime)
{
    static const odk_app_runtime_port_t port = {
        .start = fake_runtime_start,
        .tick = fake_runtime_tick,
        .stop = fake_runtime_stop,
        .destroy = fake_runtime_destroy,
    };
    const odk_app_manager_config_t config = {
        .max_instances = 2,
        .runtime = &port,
        .runtime_ctx = runtime,
    };
    odk_app_manager_t *manager = odk_app_manager_create(&config);
    odk_app_descriptor_t descriptor = {
        .app_id = "demo",
        .kind = ODK_APP_KIND_UI,
    };
    if (manager != NULL) {
        TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &descriptor));
    }
    return manager;
}

static odk_app_manager_t *make_full_manager(fake_runtime_t *runtime)
{
    static const odk_app_runtime_port_t port = {
        .start = fake_runtime_start,
        .tick = fake_runtime_tick,
        .stop = fake_runtime_stop,
        .destroy = fake_runtime_destroy,
    };
    const odk_app_manager_config_t config = {
        .max_instances = 1,
        .runtime = &port,
        .runtime_ctx = runtime,
    };
    odk_app_manager_t *manager = odk_app_manager_create(&config);
    odk_app_descriptor_t descriptor = {
        .app_id = "existing",
        .kind = ODK_APP_KIND_UI,
    };
    if (manager != NULL) {
        TEST_ASSERT_EQUAL_INT(ODK_OK, odk_app_manager_register(manager, &descriptor));
    }
    return manager;
}

static void test_apps_and_uninstall_use_new_names(void)
{
    fake_storage_t storage;
    fake_checksum_t checksum;
    fake_consent_t consent;
    odk_installer_t *installer = make_installer(&storage, &checksum, &consent);
    stage_app(&storage, &checksum);
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        installer_install_staged(installer, STAGING_ROOT "/demo", ODK_SRC_GENERATED));

    odk_console_deps_t deps = { .installer = installer };
    const char *apps_argv[] = { "apps" };
    char output[256] = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 1, apps_argv, output, sizeof(output)));
    TEST_ASSERT_NOT_NULL(strstr(output, "demo"));

    const char *uninstall_argv[] = { "uninstall", "demo" };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 2, uninstall_argv, output, sizeof(output)));
    TEST_ASSERT_FALSE(installer_is_installed(installer, "demo", NULL));
}

static void test_open_and_close_route_to_app_manager(void)
{
    fake_runtime_t runtime = { 0 };
    odk_app_manager_t *manager = make_manager(&runtime);
    TEST_ASSERT_NOT_NULL(manager);
    odk_console_deps_t deps = { .app_manager = manager };
    char output[128] = { 0 };
    const char *open_argv[] = { "open", "demo" };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 2, open_argv, output, sizeof(output)));
    TEST_ASSERT_EQUAL_INT(1, runtime.starts);

    const char *close_argv[] = { "close", "demo" };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 2, close_argv, output, sizeof(output)));
    TEST_ASSERT_EQUAL_INT(1, runtime.stops);
    odk_app_manager_destroy(manager);
}

static void test_generation_rolls_back_install_when_manager_registration_fails(void)
{
    fake_storage_t storage;
    fake_storage_reset(&storage);
    fake_storage_set_free_bytes(&storage, 1024 * 1024);

    fake_kv_t kv;
    fake_kv_reset(&kv);
    fake_kv_seed_u32(&kv, "llm_used_day", 20260711u);
    fake_kv_seed_u32(&kv, "llm_used_count", 0);
    fake_clock_t clock;
    fake_clock_set_today(&clock, 20260711u);
    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    static const char response[] =
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":"
        "\"{\\\"name\\\":\\\"Generated\\\",\\\"tick_body\\\":\\\"print(1)\\\","
        "\\\"capabilities\\\":[\\\"display\\\"]}\"}}],"
        "\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}";
    fake_llm_http_set_response(&http, response);
    odk_svc_llm_t *llm = svc_llm_create(&fake_llm_http_port, &http,
                                         &fake_kv_port, &kv,
                                         &fake_clock_port, &clock, 50);
    TEST_ASSERT_NOT_NULL(llm);

    fake_checksum_real_t checksum;
    fake_checksum_real_init(&checksum, &storage);
    fake_consent_t consent;
    fake_consent_reset(&consent);
    static const char *const caps[] = { "display" };
    odk_installer_t *installer = installer_create(
        &fake_storage_port, &storage,
        &fake_checksum_real_port, &checksum,
        &fake_consent_port, &consent,
        APP_ROOT, caps, 1);
    TEST_ASSERT_NOT_NULL(installer);
    odk_gen_t *generator = gen_create(llm, &fake_storage_port, &storage,
                                       STAGING_ROOT);
    TEST_ASSERT_NOT_NULL(generator);

    fake_runtime_t runtime = { 0 };
    odk_app_manager_t *manager = make_full_manager(&runtime);
    TEST_ASSERT_NOT_NULL(manager);
    odk_console_deps_t deps = {
        .gen = generator,
        .tpl = odk_template_builtin_app(),
        .installer = installer,
        .app_manager = manager,
        .llm = llm,
    };
    const char *argv[] = { "gen", "make a generated app" };
    char output[256] = { 0 };

    TEST_ASSERT_EQUAL_INT(ODK_ERR_STATE_QUOTA,
                          odk_console_exec(&deps, 2, argv, output, sizeof(output)));
    TEST_ASSERT_FALSE(installer_is_installed(installer, "generated", NULL));
    TEST_ASSERT_FALSE(fake_storage_has(&storage, APP_ROOT "/generated"));
    TEST_ASSERT_NOT_NULL(strstr(output, "rolled back"));

    odk_app_manager_destroy(manager);
}

static void test_legacy_console_commands_are_not_accepted(void)
{
    odk_console_deps_t deps = { 0 };
    char output[256] = { 0 };
    const char *legacy_argv[] = { "start", "demo" };
    TEST_ASSERT_NOT_EQUAL(ODK_OK,
        odk_console_exec(&deps, 2, legacy_argv, output, sizeof(output)));
    TEST_ASSERT_NOT_NULL(strstr(output, "usage"));
}

/* The `cerb sub` bridge surface: the host Mac polls `status`, pushes a
 * snapshot with `push`, and reads it back with `get`. */
static void test_console_sub_bridge_surface(void)
{
    fake_sub_t store;
    fake_sub_reset(&store);
    odk_sub_t *sub = odk_sub_create(&fake_sub_port, &store);
    TEST_ASSERT_NOT_NULL(sub);
    odk_console_deps_t deps = { .sub = sub };
    char output[256] = { 0 };

    /* status: no data, no refresh pending initially. */
    const char *status_argv[] = { "sub", "status" };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 2, status_argv, output, sizeof(output)));
    TEST_ASSERT_NOT_NULL(strstr(output, "data=no"));
    TEST_ASSERT_NOT_NULL(strstr(output, "refresh=no"));

    /* status reports a pending refresh once the screen asks. */
    odk_sub_request_fresh(sub);
    output[0] = '\0';
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 2, status_argv, output, sizeof(output)));
    TEST_ASSERT_NOT_NULL(strstr(output, "refresh=yes"));

    /* push stores a single-line snapshot and clears the refresh flag. */
    const char *push_argv[] = { "sub", "push", "plan=opencode-go", "primaryPct=62", "zen=4.20" };
    output[0] = '\0';
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 5, push_argv, output, sizeof(output)));
    TEST_ASSERT_NOT_NULL(strstr(output, "stored"));

    /* status now shows data, refresh cleared. */
    output[0] = '\0';
    odk_console_exec(&deps, 2, status_argv, output, sizeof(output));
    TEST_ASSERT_NOT_NULL(strstr(output, "data=yes"));
    TEST_ASSERT_NOT_NULL(strstr(output, "refresh=no"));

    /* get echoes the stored snapshot. */
    const char *get_argv[] = { "sub", "get" };
    output[0] = '\0';
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_console_exec(&deps, 2, get_argv, output, sizeof(output)));
    TEST_ASSERT_NOT_NULL(strstr(output, "plan=opencode-go"));
    TEST_ASSERT_NOT_NULL(strstr(output, "primaryPct=62"));

    odk_sub_delete(sub);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_apps_and_uninstall_use_new_names);
    RUN_TEST(test_open_and_close_route_to_app_manager);
    RUN_TEST(test_generation_rolls_back_install_when_manager_registration_fails);
    RUN_TEST(test_legacy_console_commands_are_not_accepted);
    RUN_TEST(test_console_sub_bridge_surface);
    return UNITY_END();
}
