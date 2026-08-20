/*
 * fake_checksum_real.h — SHA-256-over-fake-storage test double for
 * odk_checksum_port_t.
 *
 * Unlike fake_checksum (a per-path pre-programmed digest), this fake reads
 * the actual bytes fake_storage holds at the given path and hashes them for
 * real. It exists for tests that chain a real gen_create_app into a real
 * installer_install_staged: gen computes its own manifest digest from the
 * exact main.lua bytes it writes, so the checksum port verifying those same
 * bytes for real — instead of a value the test would otherwise have to read
 * back out of gen's output and reprogram — proves the installer's checksum
 * step genuinely accepts what gen produced, the same way mbedtls does on
 * target.
 */
#ifndef FAKE_CHECKSUM_REAL_H
#define FAKE_CHECKSUM_REAL_H

#include "odk_installer.h"
#include "fake_storage.h"

typedef struct {
    fake_storage_t *storage; /* not owned */
} fake_checksum_real_t;

void fake_checksum_real_init(fake_checksum_real_t *fake, fake_storage_t *storage);

extern const odk_checksum_port_t fake_checksum_real_port;

#endif /* FAKE_CHECKSUM_REAL_H */
