/*
 * Tests for odk_svc_llm: the sole entry point for runtime LLM calls, its
 * daily request quota (persisted via the injected kv port), and its token
 * usage accounting (Open DeskOS-OS §6.2, compensating constraints 3/4). Every
 * port — HTTP transport, key/value persistence, and today's date — is a
 * fake; the suite performs zero network I/O and zero wall-clock reads.
 *
 * Given-state is seeded directly through the fake kv port under two keys
 * that this suite treats as the persistence contract task-007-impl must
 * honor: "llm_used_day" (yyyymmdd of the day the count below belongs to)
 * and "llm_used_count" (requests served so far that day). Assertions verify
 * both the persisted kv state and the service's own public query API, so a
 * future implementation cannot pass by satisfying one while breaking the
 * other.
 *
 * Each TEST_CASE corresponds to one Gherkin scenario in
 * tests/features/svc-llm-quota.feature (scenario title quoted in the
 * comment above each test). This is the RED half of a Red-Green pair: the
 * odk_svc_llm source under test is a placeholder body that unconditionally
 * returns ODK_ERR_NOT_IMPLEMENTED and never touches the http/kv/clock
 * ports, so every assertion below is expected to fail until task-007-impl
 * lands the real quota and token-accounting logic.
 */
#include <string.h>

#include "unity.h"

#include "odk_err.h"
#include "odk_svc_llm.h"

#include "fake_clock.h"
#include "fake_kv.h"
#include "fake_llm_http.h"

#define DAY_TODAY 20260710u
#define DAY_NEXT 20260711u

void setUp(void) {}
void tearDown(void) {}

/* Scenario: 配额内请求完成并计数 */
static void test_request_within_quota_completes_and_increments_the_daily_count(void)
{
    fake_kv_t kv;
    fake_kv_reset(&kv);
    fake_kv_seed_u32(&kv, "llm_used_day", DAY_TODAY);
    fake_kv_seed_u32(&kv, "llm_used_count", 10);

    fake_clock_t clk;
    fake_clock_set_today(&clk, DAY_TODAY);

    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    fake_llm_http_set_response(&http,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"hello there\"}}],"
        "\"usage\":{\"prompt_tokens\":12,\"completion_tokens\":34,\"total_tokens\":46}}");

    odk_svc_llm_t *s = svc_llm_create(&fake_llm_http_port, &http,
                                        &fake_kv_port, &kv,
                                        &fake_clock_port, &clk,
                                        /*daily_quota=*/50);
    TEST_ASSERT_NOT_NULL_MESSAGE(s, "svc_llm_create with valid ports must succeed");

    char out[256] = { 0 };
    odk_llm_usage_t usage = { 0 };
    odk_err_t err = svc_llm_complete(s, "you are a helpful assistant", "say hi",
                                       out, sizeof(out), &usage);

    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, err,
                                  "an in-quota request with a valid HTTP response must succeed");
    TEST_ASSERT_EQUAL_STRING_MESSAGE("hello there", out,
                                     "the assistant text from the canned response must be returned "
                                     "verbatim");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(12, usage.in_tokens,
                                     "the response's prompt_tokens must map to usage.in_tokens");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(34, usage.out_tokens,
                                     "the response's completion_tokens must map to usage.out_tokens");

    uint32_t persisted_count = 0;
    TEST_ASSERT_TRUE_MESSAGE(fake_kv_read_u32(&kv, "llm_used_count", &persisted_count),
                             "the day's request count must be persisted through the kv port");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(11, persisted_count,
                                     "a successful completion must increment today's count from 10 to 11");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(39, svc_llm_quota_remaining(s),
                                     "remaining quota must be daily_quota(50) - used(11) = 39");
}

/* Scenario: 配额耗尽时请求被拒绝且不发起网络调用 */
static void test_request_when_quota_is_exhausted_is_rejected_without_a_network_call(void)
{
    fake_kv_t kv;
    fake_kv_reset(&kv);
    fake_kv_seed_u32(&kv, "llm_used_day", DAY_TODAY);
    fake_kv_seed_u32(&kv, "llm_used_count", 50);

    fake_clock_t clk;
    fake_clock_set_today(&clk, DAY_TODAY);

    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    fake_llm_http_set_response(&http,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"should never be seen\"}}],"
        "\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2}}");

    odk_svc_llm_t *s = svc_llm_create(&fake_llm_http_port, &http,
                                        &fake_kv_port, &kv,
                                        &fake_clock_port, &clk,
                                        /*daily_quota=*/50);
    TEST_ASSERT_NOT_NULL_MESSAGE(s, "svc_llm_create with valid ports must succeed");

    char out[256] = { 0 };
    odk_llm_usage_t usage = { 0 };
    odk_err_t err = svc_llm_complete(s, "system", "user", out, sizeof(out), &usage);

    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_ERR_QUOTA_EXCEEDED, err,
                                  "a request at the exhausted daily quota must be rejected before any "
                                  "transport call");
    TEST_ASSERT_EQUAL_INT_MESSAGE(0, http.call_count,
                                  "the injected HTTP port must never be invoked once the quota is spent");
}

/* Scenario: 跨日配额自动重置 */
static void test_quota_resets_automatically_across_a_day_boundary(void)
{
    fake_kv_t kv;
    fake_kv_reset(&kv);
    fake_kv_seed_u32(&kv, "llm_used_day", DAY_TODAY);
    fake_kv_seed_u32(&kv, "llm_used_count", 50);

    fake_clock_t clk;
    fake_clock_set_today(&clk, DAY_TODAY);

    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    fake_llm_http_set_response(&http,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"new day\"}}],"
        "\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":7,\"total_tokens\":12}}");

    odk_svc_llm_t *s = svc_llm_create(&fake_llm_http_port, &http,
                                        &fake_kv_port, &kv,
                                        &fake_clock_port, &clk,
                                        /*daily_quota=*/50);
    TEST_ASSERT_NOT_NULL_MESSAGE(s, "svc_llm_create with valid ports must succeed");

    /* the injected clock advances one day past the exhausted day */
    fake_clock_set_today(&clk, DAY_NEXT);

    char out[256] = { 0 };
    odk_llm_usage_t usage = { 0 };
    odk_err_t err = svc_llm_complete(s, "system", "user", out, sizeof(out), &usage);

    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, err,
                                  "crossing into a new day must reset the quota so the request is "
                                  "served normally");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, http.call_count,
                                  "the reset request must actually reach the HTTP port");

    uint32_t persisted_count = 0;
    TEST_ASSERT_TRUE_MESSAGE(fake_kv_read_u32(&kv, "llm_used_count", &persisted_count),
                             "the new day's request count must be persisted");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(1, persisted_count,
                                     "today's count must restart at 1, not continue accumulating from 50");

    uint32_t persisted_day = 0;
    TEST_ASSERT_TRUE_MESSAGE(fake_kv_read_u32(&kv, "llm_used_day", &persisted_day),
                             "the tracked day must be persisted");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(DAY_NEXT, persisted_day,
                                     "the tracked day must advance to the clock's current day");

    TEST_ASSERT_EQUAL_UINT32_MESSAGE(49, svc_llm_quota_remaining(s),
                                     "remaining quota must be daily_quota(50) - used(1) = 49");
}

/* Scenario: token 用量被累计并可查询(成本可见) */
static void test_token_usage_accrues_across_requests_and_is_queryable(void)
{
    fake_kv_t kv;
    fake_kv_reset(&kv);
    fake_kv_seed_u32(&kv, "llm_used_day", DAY_TODAY);
    fake_kv_seed_u32(&kv, "llm_used_count", 0);

    fake_clock_t clk;
    fake_clock_set_today(&clk, DAY_TODAY);

    fake_llm_http_t http;
    fake_llm_http_reset(&http);

    odk_svc_llm_t *s = svc_llm_create(&fake_llm_http_port, &http,
                                        &fake_kv_port, &kv,
                                        &fake_clock_port, &clk,
                                        /*daily_quota=*/50);
    TEST_ASSERT_NOT_NULL_MESSAGE(s, "svc_llm_create with valid ports must succeed");

    fake_llm_http_set_response(&http,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"reply one\"}}],"
        "\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":200,\"total_tokens\":300}}");
    char out1[256] = { 0 };
    odk_llm_usage_t usage1 = { 0 };
    odk_err_t err1 = svc_llm_complete(s, "system", "first", out1, sizeof(out1), &usage1);
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, err1, "the first request must succeed");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(100, usage1.in_tokens,
                                     "the first response's prompt_tokens must be reported as 100");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(200, usage1.out_tokens,
                                     "the first response's completion_tokens must be reported as 200");

    fake_llm_http_set_response(&http,
        "{\"choices\":[{\"message\":{\"role\":\"assistant\",\"content\":\"reply two\"}}],"
        "\"usage\":{\"prompt_tokens\":50,\"completion_tokens\":80,\"total_tokens\":130}}");
    char out2[256] = { 0 };
    odk_llm_usage_t usage2 = { 0 };
    odk_err_t err2 = svc_llm_complete(s, "system", "second", out2, sizeof(out2), &usage2);
    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_OK, err2, "the second request must succeed");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(50, usage2.in_tokens,
                                     "the second response's prompt_tokens must be reported as 50");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(80, usage2.out_tokens,
                                     "the second response's completion_tokens must be reported as 80");

    TEST_ASSERT_EQUAL_UINT64_MESSAGE(430, svc_llm_total_tokens_today(s),
                                     "total tokens today must be the sum of both requests: "
                                     "(100+200) + (50+80) = 430");
}

/* Scenario: 传输失败返回可恢复错误且配额计数不增加 */
static void test_transport_failure_returns_a_recoverable_error_and_does_not_increment_the_count(void)
{
    fake_kv_t kv;
    fake_kv_reset(&kv);
    fake_kv_seed_u32(&kv, "llm_used_day", DAY_TODAY);
    fake_kv_seed_u32(&kv, "llm_used_count", 10);

    fake_clock_t clk;
    fake_clock_set_today(&clk, DAY_TODAY);

    fake_llm_http_t http;
    fake_llm_http_reset(&http);
    fake_llm_http_set_transport_failure(&http, true);

    odk_svc_llm_t *s = svc_llm_create(&fake_llm_http_port, &http,
                                        &fake_kv_port, &kv,
                                        &fake_clock_port, &clk,
                                        /*daily_quota=*/50);
    TEST_ASSERT_NOT_NULL_MESSAGE(s, "svc_llm_create with valid ports must succeed");

    char out[256] = { 0 };
    odk_llm_usage_t usage = { 0 };
    odk_err_t err = svc_llm_complete(s, "system", "user", out, sizeof(out), &usage);

    TEST_ASSERT_EQUAL_INT_MESSAGE(ODK_ERR_HTTP, err,
                                  "a transport failure must surface as a recoverable HTTP error, not a "
                                  "generic failure");
    TEST_ASSERT_EQUAL_INT_MESSAGE(1, http.call_count,
                                  "the request must actually have reached the HTTP port before failing");

    uint32_t persisted_count = 0;
    TEST_ASSERT_TRUE_MESSAGE(fake_kv_read_u32(&kv, "llm_used_count", &persisted_count),
                             "the count key must remain present after a failed request");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(10, persisted_count,
                                     "a failed transport call must not increment today's count");
    TEST_ASSERT_EQUAL_UINT32_MESSAGE(40, svc_llm_quota_remaining(s),
                                     "remaining quota must stay at daily_quota(50) - used(10) = 40");
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_request_within_quota_completes_and_increments_the_daily_count);
    RUN_TEST(test_request_when_quota_is_exhausted_is_rejected_without_a_network_call);
    RUN_TEST(test_quota_resets_automatically_across_a_day_boundary);
    RUN_TEST(test_token_usage_accrues_across_requests_and_is_queryable);
    RUN_TEST(test_transport_failure_returns_a_recoverable_error_and_does_not_increment_the_count);
    return UNITY_END();
}
