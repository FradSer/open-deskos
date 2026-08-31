/*
 * fake_checksum.h — programmable per-path SHA-256 test double for
 * odk_checksum_port_t.
 *
 * A test configures the exact hex digest each staged file path is deemed to
 * hash to; the installer's own checksum-verification logic (comparing that
 * digest against the manifest's declared value) is exercised without any
 * real hashing. Configuring a path to a hex string that differs from its
 * manifest entry simulates a checksum mismatch.
 */
#ifndef FAKE_CHECKSUM_H
#define FAKE_CHECKSUM_H

#include <stdbool.h>
#include <stddef.h>

#include "odk_installer.h"

#define FAKE_CHECKSUM_MAX_ENTRIES 32
#define FAKE_CHECKSUM_PATH_LEN 200

typedef struct {
    char path[FAKE_CHECKSUM_PATH_LEN];
    char hex[65];
    bool present;
} fake_checksum_entry_t;

typedef struct {
    fake_checksum_entry_t entries[FAKE_CHECKSUM_MAX_ENTRIES];
    int call_count;
    char last_path[FAKE_CHECKSUM_PATH_LEN];
} fake_checksum_t;

void fake_checksum_reset(fake_checksum_t *fake);
void fake_checksum_set_for_path(fake_checksum_t *fake, const char *path, const char *hex);

extern const odk_checksum_port_t fake_checksum_port;

#endif /* FAKE_CHECKSUM_H */
