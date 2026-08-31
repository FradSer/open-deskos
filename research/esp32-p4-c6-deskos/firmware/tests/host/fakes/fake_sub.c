/*
 * fake_sub.c — in-memory string map standing in for the NVS-backed
 * odk_sub_port_t.
 */
#include "fake_sub.h"

#include <stdio.h>
#include <string.h>

void fake_sub_reset(fake_sub_t *sub)
{
    memset(sub, 0, sizeof(*sub));
}

void fake_sub_seed(fake_sub_t *sub, const char *key, const char *value)
{
    for (int i = 0; i < FAKE_SUB_MAX_ENTRIES; i++) {
        if (sub->entries[i].present && strcmp(sub->entries[i].key, key) == 0) {
            snprintf(sub->entries[i].value, sizeof(sub->entries[i].value), "%s", value);
            return;
        }
    }
    for (int i = 0; i < FAKE_SUB_MAX_ENTRIES; i++) {
        if (!sub->entries[i].present) {
            snprintf(sub->entries[i].key, sizeof(sub->entries[i].key), "%s", key);
            snprintf(sub->entries[i].value, sizeof(sub->entries[i].value), "%s", value);
            sub->entries[i].present = true;
            return;
        }
    }
}

bool fake_sub_read(const fake_sub_t *sub, const char *key, char *out, size_t outlen)
{
    for (int i = 0; i < FAKE_SUB_MAX_ENTRIES; i++) {
        if (sub->entries[i].present && strcmp(sub->entries[i].key, key) == 0) {
            if (out != NULL && outlen > 0) {
                snprintf(out, outlen, "%s", sub->entries[i].value);
            }
            return true;
        }
    }
    return false;
}

static bool fake_get_str(void *ctx, const char *key, char *out, size_t outlen)
{
    fake_sub_t *sub = (fake_sub_t *)ctx;
    if (sub == NULL || out == NULL || outlen == 0) {
        return false;
    }
    return fake_sub_read(sub, key, out, outlen);
}

static void fake_set_str(void *ctx, const char *key, const char *value)
{
    fake_sub_t *sub = (fake_sub_t *)ctx;
    if (sub == NULL) {
        return;
    }
    fake_sub_seed(sub, key, value);
}

const odk_sub_port_t fake_sub_port = {
    .get_str = fake_get_str,
    .set_str = fake_set_str,
};
