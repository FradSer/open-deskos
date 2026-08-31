/* Host contract tests for the subscription snapshot store (odk_sub). */
#include <stdio.h>
#include <string.h>

#include "unity.h"

#include "odk_sub.h"

#include "fake_sub.h"

void setUp(void) {}
void tearDown(void) {}

static odk_sub_t *make_sub(fake_sub_t *store)
{
    fake_sub_reset(store);
    return odk_sub_create(&fake_sub_port, store);
}

void test_sub_no_snapshot_until_set(void)
{
    fake_sub_t store;
    odk_sub_t *s = make_sub(&store);
    TEST_ASSERT_NOT_NULL(s);

    char out[64];
    TEST_ASSERT_FALSE(odk_sub_has_snapshot(s));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_NOT_FOUND, odk_sub_get_snapshot(s, out, sizeof(out)));
    TEST_ASSERT_FALSE(odk_sub_get_field(s, "plan", out, sizeof(out)));

    odk_sub_delete(s);
}

void test_sub_set_and_get_roundtrip(void)
{
    fake_sub_t store;
    odk_sub_t *s = make_sub(&store);
    TEST_ASSERT_NOT_NULL(s);

    const char *snap = "plan=opencode-go primaryPct=62 primaryResetMin=18 weekPct=41 monthPct=33 zen=4.20";
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_sub_set_snapshot(s, snap));

    char out[ODK_SUB_SNAPSHOT_MAX];
    TEST_ASSERT_TRUE(odk_sub_has_snapshot(s));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_sub_get_snapshot(s, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING(snap, out);

    odk_sub_delete(s);
}

void test_sub_get_field_parses_tokens(void)
{
    fake_sub_t store;
    odk_sub_t *s = make_sub(&store);
    TEST_ASSERT_NOT_NULL(s);

    odk_sub_set_snapshot(s, "plan=opencode-go primaryPct=62 weekPct=41 zen=4.20");

    char out[32];
    TEST_ASSERT_TRUE(odk_sub_get_field(s, "plan", out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("opencode-go", out);
    TEST_ASSERT_TRUE(odk_sub_get_field(s, "primaryPct", out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("62", out);
    TEST_ASSERT_TRUE(odk_sub_get_field(s, "zen", out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING("4.20", out);

    /* Missing field -> false, out untouched. */
    memset(out, 'x', sizeof(out));
    out[sizeof(out) - 1] = '\0';
    TEST_ASSERT_FALSE(odk_sub_get_field(s, "nope", out, sizeof(out)));
    TEST_ASSERT_EQUAL_INT('x', out[0]);

    /* Partial-token match must not hit: "week" != "weekPct". */
    TEST_ASSERT_FALSE(odk_sub_get_field(s, "week", out, sizeof(out)));

    odk_sub_delete(s);
}

void test_sub_refresh_flag_lifecycle(void)
{
    fake_sub_t store;
    odk_sub_t *s = make_sub(&store);
    TEST_ASSERT_NOT_NULL(s);

    TEST_ASSERT_FALSE(odk_sub_needs_refresh(s));
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_sub_request_fresh(s));
    TEST_ASSERT_TRUE(odk_sub_needs_refresh(s));

    /* A fresh push satisfies the request. */
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_sub_set_snapshot(s, "plan=opencode-go primaryPct=62"));
    TEST_ASSERT_FALSE(odk_sub_needs_refresh(s));

    odk_sub_delete(s);
}

void test_sub_rejects_empty_and_oversized_snapshots(void)
{
    fake_sub_t store;
    odk_sub_t *s = make_sub(&store);
    TEST_ASSERT_NOT_NULL(s);

    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG, odk_sub_set_snapshot(s, ""));
    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG, odk_sub_set_snapshot(s, NULL));

    char big[ODK_SUB_SNAPSHOT_MAX + 2];
    memset(big, 'a', sizeof(big) - 1);
    big[sizeof(big) - 1] = '\0';
    TEST_ASSERT_EQUAL_INT(ODK_ERR_INVALID_ARG, odk_sub_set_snapshot(s, big));

    odk_sub_delete(s);
}

/* Regression: an empty key must not make get_field loop forever (strstr with
 * an empty needle never advances). */
void test_sub_empty_key_is_rejected(void)
{
    fake_sub_t store;
    odk_sub_t *s = make_sub(&store);
    TEST_ASSERT_NOT_NULL(s);
    odk_sub_set_snapshot(s, "plan=opencode-go primaryPct=62");

    char out[32];
    TEST_ASSERT_FALSE(odk_sub_get_field(s, "", out, sizeof(out)));
    TEST_ASSERT_FALSE(odk_sub_get_field(s, NULL, out, sizeof(out)));

    odk_sub_delete(s);
}

/* Regression: has_snapshot must report true for snapshots larger than the old
 * 64-byte probe (NVS nvs_get_str fails on a too-small buffer). */
void test_sub_has_snapshot_for_large_blob(void)
{
    fake_sub_t store;
    odk_sub_t *s = make_sub(&store);
    TEST_ASSERT_NOT_NULL(s);

    /* > ODK_SUB_FIELD_MAX (64) bytes, the size the old probe used. */
    const char *snap = "plan=opencode-go primaryPct=62 primaryResetMin=18 weekPct=41 monthPct=33 zen=4.20";
    TEST_ASSERT_TRUE(strlen(snap) >= ODK_SUB_FIELD_MAX);
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_sub_set_snapshot(s, snap));

    TEST_ASSERT_TRUE(odk_sub_has_snapshot(s));
    char out[ODK_SUB_SNAPSHOT_MAX];
    TEST_ASSERT_EQUAL_INT(ODK_OK, odk_sub_get_snapshot(s, out, sizeof(out)));
    TEST_ASSERT_EQUAL_STRING(snap, out);

    odk_sub_delete(s);
}

int main(void)
{
    UNITY_BEGIN();
    RUN_TEST(test_sub_no_snapshot_until_set);
    RUN_TEST(test_sub_set_and_get_roundtrip);
    RUN_TEST(test_sub_get_field_parses_tokens);
    RUN_TEST(test_sub_refresh_flag_lifecycle);
    RUN_TEST(test_sub_rejects_empty_and_oversized_snapshots);
    RUN_TEST(test_sub_empty_key_is_rejected);
    RUN_TEST(test_sub_has_snapshot_for_large_blob);
    return UNITY_END();
}
