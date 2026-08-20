/* Host contract tests for atomic installation of schema-v2 App packages. */
#include <stdio.h>
#include <string.h>

#include "unity.h"

#include "odk_installer.h"

#include "fake_checksum.h"
#include "fake_consent.h"
#include "fake_storage.h"

#define STAGING_ROOT "/staging"
#define APP_ROOT "/apps"
#define HEX_A "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

void setUp(void) {}
void tearDown(void) {}

static void make_manifest(char *out, size_t outlen, const char *app_id,
                          const char *version, const char *entry,
                          const char *dependencies)
{
    snprintf(out, outlen,
        "{\"schema_version\":2,\"app_id\":\"%s\",\"version\":\"%s\","
        "\"name\":\"%s\",\"kind\":\"ui\",\"entry\":\"%s\","
        "\"capabilities\":[\"display\"],\"dependencies\":%s,"
        "\"files\":[{\"path\":\"%s\",\"sha256\":\"%s\"}]}",
        app_id, version, app_id, entry, dependencies, entry, HEX_A);
}

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

static void stage_app(fake_storage_t *storage, fake_checksum_t *checksum,
                      const char *app_id, const char *version,
                      const char *entry, const char *dependencies)
{
    char manifest[1024];
    make_manifest(manifest, sizeof(manifest), app_id, version, entry, dependencies);
    char manifest_path[256];
    char entry_path[256];
    snprintf(manifest_path, sizeof(manifest_path), "%s/%s/manifest.json",
             STAGING_ROOT, app_id);
    snprintf(entry_path, sizeof(entry_path), "%s/%s/%s",
             STAGING_ROOT, app_id, entry);
    const char source[] = "return { on_start = function(ctx) end }\n";
    fake_storage_seed_file(storage, manifest_path, manifest, strlen(manifest));
    fake_storage_seed_file(storage, entry_path, source, sizeof(source) - 1);
    fake_checksum_set_for_path(checksum, entry_path, HEX_A);
}

static void test_schema_v2_app_is_verified_and_placed_atomically(void)
{
    fake_storage_t storage;
    fake_checksum_t checksum;
    fake_consent_t consent;
    odk_installer_t *installer = make_installer(&storage, &checksum, &consent);
    TEST_ASSERT_NOT_NULL(installer);
    stage_app(&storage, &checksum, "gen_weather_01", "1.0.0", "app/main.lua", "[]");

    TEST_ASSERT_EQUAL_INT(ODK_OK,
        installer_install_staged(installer, STAGING_ROOT "/gen_weather_01",
                                 ODK_SRC_GENERATED));
    TEST_ASSERT_EQUAL_INT(1, consent.call_count);
    TEST_ASSERT_TRUE(installer_is_installed(installer, "gen_weather_01", NULL));

    const uint8_t *bytes = NULL;
    size_t len = 0;
    TEST_ASSERT_TRUE(fake_storage_read(&storage, APP_ROOT "/gen_weather_01/app/main.lua",
                                       &bytes, &len));
    TEST_ASSERT_GREATER_THAN_size_t(0, len);

    odk_installed_info_t list[2] = { 0 };
    size_t count = 0;
    TEST_ASSERT_EQUAL_INT(ODK_OK, installer_list(installer, list, 2, &count));
    TEST_ASSERT_EQUAL_size_t(1, count);
    TEST_ASSERT_EQUAL_STRING("gen_weather_01", list[0].app_id);
    TEST_ASSERT_EQUAL_INT(ODK_SRC_GENERATED, list[0].origin);
}

static void test_legacy_manifest_is_rejected_without_mutation(void)
{
    fake_storage_t storage;
    fake_checksum_t checksum;
    fake_consent_t consent;
    odk_installer_t *installer = make_installer(&storage, &checksum, &consent);
    const char legacy[] =
        "{\"package_id\":\"old\",\"version\":\"1.0.0\","
        "\"description\":\"old\",\"capabilities\":[],"
        "\"dependencies\":[],\"files\":[]}";
    fake_storage_seed_file(&storage, STAGING_ROOT "/old/manifest.json",
                            legacy, sizeof(legacy) - 1);

    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_MANIFEST,
        installer_install_staged(installer, STAGING_ROOT "/old", ODK_SRC_SIDELOAD));
    TEST_ASSERT_FALSE(fake_storage_any_mutating_op(&storage));
    TEST_ASSERT_EQUAL_INT(0, consent.call_count);
}

static void test_same_app_version_is_not_overwritten(void)
{
    fake_storage_t storage;
    fake_checksum_t checksum;
    fake_consent_t consent;
    odk_installer_t *installer = make_installer(&storage, &checksum, &consent);
    stage_app(&storage, &checksum, "demo", "1.0.0", "app/main.lua", "[]");
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        installer_install_staged(installer, STAGING_ROOT "/demo", ODK_SRC_SIDELOAD));

    fake_storage_t *same_storage = &storage;
    stage_app(same_storage, &checksum, "demo", "1.0.0", "app/main.lua", "[]");
    TEST_ASSERT_EQUAL_INT(ODK_ERR_EXISTS,
        installer_install_staged(installer, STAGING_ROOT "/demo", ODK_SRC_STORE));
}

static void test_dependency_uses_app_id_and_requires_installed_version(void)
{
    fake_storage_t storage;
    fake_checksum_t checksum;
    fake_consent_t consent;
    odk_installer_t *installer = make_installer(&storage, &checksum, &consent);
    stage_app(&storage, &checksum, "dependent", "1.0.0", "app/main.lua",
              "[{\"app_id\":\"missing\",\"constraint\":\">=1.0.0\"}]");

    TEST_ASSERT_EQUAL_INT(ODK_ERR_DEP_UNSATISFIED,
        installer_install_staged(installer, STAGING_ROOT "/dependent", ODK_SRC_STORE));
    TEST_ASSERT_EQUAL_INT(0, consent.call_count);
}

static void test_remove_rejects_path_traversal_app_id(void)
{
    fake_storage_t storage;
    fake_checksum_t checksum;
    fake_consent_t consent;
    odk_installer_t *installer = make_installer(&storage, &checksum, &consent);

    TEST_ASSERT_EQUAL_INT(ODK_ERR_BAD_APP_ID,
                          installer_remove(installer, "../outside"));
    TEST_ASSERT_FALSE(fake_storage_any_mutating_op(&storage));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_schema_v2_app_is_verified_and_placed_atomically);
    RUN_TEST(test_legacy_manifest_is_rejected_without_mutation);
    RUN_TEST(test_same_app_version_is_not_overwritten);
    RUN_TEST(test_dependency_uses_app_id_and_requires_installed_version);
    RUN_TEST(test_remove_rejects_path_traversal_app_id);
    return UNITY_END();
}
