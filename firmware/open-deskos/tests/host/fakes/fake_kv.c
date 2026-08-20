#include "fake_kv.h"

#include <string.h>

void fake_kv_reset(fake_kv_t *kv)
{
    memset(kv, 0, sizeof(*kv));
}

void fake_kv_seed_u32(fake_kv_t *kv, const char *key, uint32_t value)
{
    fake_kv_entry_t *free_slot = NULL;
    for (size_t i = 0; i < FAKE_KV_MAX_ENTRIES; i++) {
        if (kv->entries[i].present && strncmp(kv->entries[i].key, key, FAKE_KV_KEY_LEN) == 0) {
            kv->entries[i].value = value;
            return;
        }
        if (!kv->entries[i].present && free_slot == NULL) {
            free_slot = &kv->entries[i];
        }
    }

    if (free_slot != NULL) {
        strncpy(free_slot->key, key, FAKE_KV_KEY_LEN - 1);
        free_slot->key[FAKE_KV_KEY_LEN - 1] = '\0';
        free_slot->value = value;
        free_slot->present = true;
    }
}

bool fake_kv_read_u32(const fake_kv_t *kv, const char *key, uint32_t *out)
{
    for (size_t i = 0; i < FAKE_KV_MAX_ENTRIES; i++) {
        if (kv->entries[i].present && strncmp(kv->entries[i].key, key, FAKE_KV_KEY_LEN) == 0) {
            *out = kv->entries[i].value;
            return true;
        }
    }
    return false;
}

static bool fake_kv_get_u32(void *ctx, const char *key, uint32_t *out)
{
    return fake_kv_read_u32((const fake_kv_t *)ctx, key, out);
}

static void fake_kv_set_u32(void *ctx, const char *key, uint32_t v)
{
    fake_kv_seed_u32((fake_kv_t *)ctx, key, v);
}

const odk_kv_port_t fake_kv_port = {
    .get_u32 = fake_kv_get_u32,
    .set_u32 = fake_kv_set_u32,
};
