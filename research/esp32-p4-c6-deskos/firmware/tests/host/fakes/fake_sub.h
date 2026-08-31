/*
 * fake_sub.h — in-memory string map standing in for the NVS-backed
 * odk_sub_port_t. Backs get_str/set_str; fake_sub_seed lets a test set up
 * Given-state before creating the component under test, and fake_sub_read
 * lets a test inspect persisted state directly.
 */
#ifndef FAKE_SUB_H
#define FAKE_SUB_H

#include <stdbool.h>
#include <stddef.h>

#include "odk_sub.h"

#define FAKE_SUB_MAX_ENTRIES 16
#define FAKE_SUB_KEY_LEN 32
#define FAKE_SUB_VAL_LEN ODK_SUB_SNAPSHOT_MAX

typedef struct {
    char key[FAKE_SUB_KEY_LEN];
    char value[FAKE_SUB_VAL_LEN];
    bool present;
} fake_sub_entry_t;

typedef struct {
    fake_sub_entry_t entries[FAKE_SUB_MAX_ENTRIES];
} fake_sub_t;

void fake_sub_reset(fake_sub_t *sub);
void fake_sub_seed(fake_sub_t *sub, const char *key, const char *value);
bool fake_sub_read(const fake_sub_t *sub, const char *key, char *out, size_t outlen);

extern const odk_sub_port_t fake_sub_port;

#endif /* FAKE_SUB_H */
