/* Host contract tests for the schema-v2 App generator. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "unity.h"

#include "cJSON.h"
#include "odk_gen.h"
#include "odk_manifest.h"
#include "odk_sandbox.h"
#include "odk_svc_llm.h"

#include "fake_clock.h"
#include "fake_kv.h"
#include "fake_llm_http.h"
#include "fake_storage.h"

#define DAY_TODAY 20260711u
#define STAGING_ROOT "/staging"

void setUp(void) {}
void tearDown(void) {}

static void build_llm_completion_response(const char *slots,
                                          uint32_t prompt_tokens,
                                          uint32_t completion_tokens,
                                          char *out, size_t outlen)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *choices = cJSON_AddArrayToObject(root, "choices");
    cJSON *choice = cJSON_CreateObject();
    cJSON_AddItemToArray(choices, choice);
    cJSON *message = cJSON_AddObjectToObject(choice, "message");
    cJSON_AddStringToObject(message, "role", "assistant");
    cJSON_AddStringToObject(message, "content", slots);
    cJSON *usage = cJSON_AddObjectToObject(root, "usage");
    cJSON_AddNumberToObject(usage, "prompt_tokens", prompt_tokens);
    cJSON_AddNumberToObject(usage, "completion_tokens", completion_tokens);
    cJSON_AddNumberToObject(usage, "total_tokens", prompt_tokens + completion_tokens);
    char *serialized = cJSON_PrintUnformatted(root);
    snprintf(out, outlen, "%s", serialized);
    free(serialized);
    cJSON_Delete(root);
}

static odk_gen_t *make_generator(fake_storage_t *storage, fake_llm_http_t *http,
                                  fake_kv_t *kv, fake_clock_t *clock)
{
    odk_svc_llm_t *llm = svc_llm_create(&fake_llm_http_port, http,
                                          &fake_kv_port, kv,
                                          &fake_clock_port, clock, 50);
    if (llm == NULL) {
        return NULL;
    }
    return gen_create(llm, &fake_storage_port, storage, STAGING_ROOT);
}

static void seed_llm_state(fake_kv_t *kv, fake_clock_t *clock)
{
    fake_kv_reset(kv);
    fake_kv_seed_u32(kv, "llm_used_day", DAY_TODAY);
    fake_kv_seed_u32(kv, "llm_used_count", 0);
    fake_clock_set_today(clock, DAY_TODAY);
}

static void test_generator_writes_schema_v2_app_entry(void)
{
    fake_storage_t storage;
    fake_storage_reset(&storage);
    fake_storage_set_free_bytes(&storage, 1024 * 1024);

    fake_kv_t kv;
    fake_clock_t clock;
    seed_llm_state(&kv, &clock);
    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    char response[1024];
    build_llm_completion_response(
        "{\"name\":\"Beijing Clock\",\"tick_body\":\"print(1)\","
        "\"capabilities\":[\"display\"]}", 12, 34, response, sizeof(response));
    fake_llm_http_set_response(&http, response);

    odk_gen_t *generator = make_generator(&storage, &http, &kv, &clock);
    TEST_ASSERT_NOT_NULL(generator);

    char staged_dir[256] = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        gen_create_app(generator, odk_template_builtin_app(), "clock", staged_dir,
                       sizeof(staged_dir)));

    char manifest_path[320];
    char entry_path[320];
    snprintf(manifest_path, sizeof(manifest_path), "%s/manifest.json", staged_dir);
    snprintf(entry_path, sizeof(entry_path), "%s/app/main.lua", staged_dir);
    const uint8_t *manifest_bytes = NULL;
    const uint8_t *entry_bytes = NULL;
    size_t manifest_len = 0;
    size_t entry_len = 0;
    TEST_ASSERT_TRUE(fake_storage_read(&storage, manifest_path, &manifest_bytes, &manifest_len));
    TEST_ASSERT_TRUE(fake_storage_read(&storage, entry_path, &entry_bytes, &entry_len));

    odk_manifest_t manifest = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_manifest_parse((const char *)manifest_bytes, manifest_len, &manifest));
    TEST_ASSERT_EQUAL_UINT(ODK_MANIFEST_SCHEMA_VERSION, manifest.schema_version);
    TEST_ASSERT_EQUAL_STRING("beijing_clock", manifest.app_id);
    TEST_ASSERT_EQUAL_STRING("Beijing Clock", manifest.name);
    TEST_ASSERT_EQUAL_STRING("app/main.lua", manifest.entry);
    TEST_ASSERT_EQUAL_INT(ODK_MANIFEST_KIND_UI, manifest.kind);

    char source[4096] = { 0 };
    size_t copy_len = entry_len < sizeof(source) - 1 ? entry_len : sizeof(source) - 1;
    memcpy(source, entry_bytes, copy_len);
    char error[128] = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_OK,
        odk_sandbox_check_source(source, strlen(source), error, sizeof(error)));
    TEST_ASSERT_NOT_NULL(strstr(source, "on_start"));
    TEST_ASSERT_NOT_NULL(strstr(source, "on_tick"));
    TEST_ASSERT_NOT_NULL(strstr(source, "on_stop"));
}

static void test_generator_rejects_unknown_slot_without_storage_residue(void)
{
    fake_storage_t storage;
    fake_storage_reset(&storage);
    fake_kv_t kv;
    fake_clock_t clock;
    seed_llm_state(&kv, &clock);
    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    char response[1024];
    build_llm_completion_response(
        "{\"name\":\"Bad\",\"tick_body\":\"print(1)\","
        "\"capabilities\":[],\"package_id\":\"legacy\"}", 1, 1,
        response, sizeof(response));
    fake_llm_http_set_response(&http, response);

    odk_gen_t *generator = make_generator(&storage, &http, &kv, &clock);
    TEST_ASSERT_NOT_NULL(generator);
    char staged_dir[256] = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_ERR_TEMPLATE_VIOLATION,
        gen_create_app(generator, odk_template_builtin_app(), "bad", staged_dir,
                       sizeof(staged_dir)));
    TEST_ASSERT_EQUAL_size_t(0, fake_storage_op_count(&storage));
}

static void test_generator_checks_quota_before_llm(void)
{
    fake_storage_t storage;
    fake_storage_reset(&storage);
    fake_kv_t kv;
    fake_clock_t clock;
    seed_llm_state(&kv, &clock);
    fake_kv_seed_u32(&kv, "llm_used_count", 50);
    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    fake_llm_http_set_response(&http, "not used");

    odk_gen_t *generator = make_generator(&storage, &http, &kv, &clock);
    TEST_ASSERT_NOT_NULL(generator);
    char staged_dir[256] = { 0 };
    TEST_ASSERT_EQUAL_INT(ODK_ERR_QUOTA_EXCEEDED,
        gen_create_app(generator, odk_template_builtin_app(), "any", staged_dir,
                       sizeof(staged_dir)));
    TEST_ASSERT_EQUAL_INT(0, http.call_count);
    TEST_ASSERT_EQUAL_size_t(0, fake_storage_op_count(&storage));
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_generator_writes_schema_v2_app_entry);
    RUN_TEST(test_generator_rejects_unknown_slot_without_storage_residue);
    RUN_TEST(test_generator_checks_quota_before_llm);
    return UNITY_END();
}
