/*
 * fake_kv.h — in-memory string->uint32_t map standing in for NVS.
 *
 * Backs odk_kv_port_t's get_u32/set_u32; fake_kv_seed_u32 lets a test set
 * up Given-state before creating the service under test, and
 * fake_kv_read_u32 lets a test inspect persisted state directly (in
 * addition to whatever the service's own query API reports).
 */
#ifndef FAKE_KV_H
#define FAKE_KV_H

#include <stdbool.h>
#include <stdint.h>

#include "odk_svc_llm.h"

#define FAKE_KV_MAX_ENTRIES 16
#define FAKE_KV_KEY_LEN 32

typedef struct {
    char key[FAKE_KV_KEY_LEN];
    uint32_t value;
    bool present;
} fake_kv_entry_t;

typedef struct {
    fake_kv_entry_t entries[FAKE_KV_MAX_ENTRIES];
} fake_kv_t;

void fake_kv_reset(fake_kv_t *kv);
void fake_kv_seed_u32(fake_kv_t *kv, const char *key, uint32_t value);
bool fake_kv_read_u32(const fake_kv_t *kv, const char *key, uint32_t *out);

extern const odk_kv_port_t fake_kv_port;

#endif /* FAKE_KV_H */
