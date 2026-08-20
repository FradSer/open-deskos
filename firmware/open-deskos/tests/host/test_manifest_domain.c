/* Host contract tests for manifest schema v2. */
#include <string.h>

#include "unity.h"

#include "odk_manifest.h"
#include "odk_path.h"
#include "odk_semver.h"

void setUp(void) {}
void tearDown(void) {}

static const char *valid_manifest(void)
{
    return "{"
        "\"schema_version\":2,"
        "\"app_id\":\"openai_voice_client_01\","
        "\"version\":\"1.0.0\","
        "\"name\":\"Voice-to-text via OpenAI\","
        "\"kind\":\"ui\","
        "\"entry\":\"app/main.lua\","
        "\"capabilities\":[\"audio_capture\",\"network_http\"],"
        "\"dependencies\":[{\"app_id\":\"lua_http_client\",\"constraint\":\">=1.2.0, <2.0.0\"}],"
        "\"files\":["
        "{\"path\":\"app/main.lua\",\"sha256\":"
        "\"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855\"},"
        "{\"path\":\"assets/icon.png\",\"sha256\":"
        "\"7247a5772b2196229993a2548346db0de2cf936b6926ed3083882cb84b139df1\"}"
        "]"
        "}";
}

static void test_schema_v2_manifest_is_fully_parsed(void)
{
    const char *json = valid_manifest();
    odk_manifest_t m = { 0 };

    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_manifest_parse(json, strlen(json), &m));
    TEST_ASSERT_EQUAL_UINT(ODK_MANIFEST_SCHEMA_VERSION, m.schema_version);
    TEST_ASSERT_EQUAL_STRING("openai_voice_client_01", m.app_id);
    TEST_ASSERT_EQUAL_STRING("Voice-to-text via OpenAI", m.name);
    TEST_ASSERT_EQUAL_INT(ODK_MANIFEST_KIND_UI, m.kind);
    TEST_ASSERT_EQUAL_STRING("app/main.lua", m.entry);
    TEST_ASSERT_EQUAL_size_t(2, m.n_capabilities);
    TEST_ASSERT_EQUAL_size_t(1, m.n_deps);
    TEST_ASSERT_EQUAL_STRING("lua_http_client", m.deps[0].app_id);
    TEST_ASSERT_EQUAL_size_t(2, m.n_files);
}

static void test_schema_v1_and_legacy_keys_are_rejected(void)
{
    const char *legacy =
        "{\"package_id\":\"old\",\"version\":\"1.0.0\","
        "\"description\":\"old\",\"capabilities\":[],"
        "\"dependencies\":[],\"files\":[]}";
    odk_manifest_t m = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_MANIFEST,
                          odk_manifest_parse(legacy, strlen(legacy), &m));
}

static void test_entry_must_be_the_canonical_app_entry(void)
{
    const char *json =
        "{\"schema_version\":2,\"app_id\":\"demo\",\"version\":\"1.0.0\","
        "\"name\":\"Demo\",\"kind\":\"ui\",\"entry\":\"script/main.lua\","
        "\"capabilities\":[],\"dependencies\":[],\"files\":[]}";
    odk_manifest_t m = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_MANIFEST,
                          odk_manifest_parse(json, strlen(json), &m));
}

static void test_app_id_and_path_whitelists_remain_strict(void)
{
    TEST_ASSERT_FALSE(odk_app_id_valid("Evil Pack!"));
    TEST_ASSERT_FALSE(odk_app_id_valid(""));
    TEST_ASSERT_TRUE(odk_app_id_valid("openai_voice_client_01"));
    TEST_ASSERT_FALSE(odk_rel_path_safe("../system/secret.bin"));
    TEST_ASSERT_FALSE(odk_rel_path_safe("assets//icon.png"));
    TEST_ASSERT_FALSE(odk_rel_path_safe("assets/./icon.png"));
    TEST_ASSERT_FALSE(odk_rel_path_safe("assets/icon.png/"));
    TEST_ASSERT_TRUE(odk_rel_path_safe("assets/icons/app.png"));
}

static void test_capability_compatibility_is_checked_in_c(void)
{
    odk_manifest_t m = { 0 };
    const char *json = valid_manifest();
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_manifest_parse(json, strlen(json), &m));

    const char *without_mic[] = { "network_http", "display" };
    TEST_ASSERT_EQUAL_INT(ODK_ERR_CAP_UNSUPPORTED,
        odk_caps_check_board(&m, without_mic, 2));
    const char *with_mic[] = { "network_http", "audio_capture" };
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_caps_check_board(&m, with_mic, 2));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_schema_v2_manifest_is_fully_parsed);
    RUN_TEST(test_schema_v1_and_legacy_keys_are_rejected);
    RUN_TEST(test_entry_must_be_the_canonical_app_entry);
    RUN_TEST(test_app_id_and_path_whitelists_remain_strict);
    RUN_TEST(test_capability_compatibility_is_checked_in_c);
    return UNITY_END();
}
