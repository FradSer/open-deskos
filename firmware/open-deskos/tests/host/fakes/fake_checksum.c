#include "fake_checksum.h"

#include <string.h>

void fake_checksum_reset(fake_checksum_t *fake)
{
    memset(fake, 0, sizeof(*fake));
}

void fake_checksum_set_for_path(fake_checksum_t *fake, const char *path, const char *hex)
{
    for (size_t i = 0; i < FAKE_CHECKSUM_MAX_ENTRIES; i++) {
        if (fake->entries[i].present && strcmp(fake->entries[i].path, path) == 0) {
            strncpy(fake->entries[i].hex, hex, sizeof(fake->entries[i].hex) - 1);
            fake->entries[i].hex[sizeof(fake->entries[i].hex) - 1] = '\0';
            return;
        }
    }
    for (size_t i = 0; i < FAKE_CHECKSUM_MAX_ENTRIES; i++) {
        if (!fake->entries[i].present) {
            strncpy(fake->entries[i].path, path, FAKE_CHECKSUM_PATH_LEN - 1);
            fake->entries[i].path[FAKE_CHECKSUM_PATH_LEN - 1] = '\0';
            strncpy(fake->entries[i].hex, hex, sizeof(fake->entries[i].hex) - 1);
            fake->entries[i].hex[sizeof(fake->entries[i].hex) - 1] = '\0';
            fake->entries[i].present = true;
            return;
        }
    }
}

static odk_err_t fake_sha256_file_hex(void *ctx, const char *path, char out_hex[65])
{
    fake_checksum_t *fake = (fake_checksum_t *)ctx;
    fake->call_count++;
    strncpy(fake->last_path, path, FAKE_CHECKSUM_PATH_LEN - 1);
    fake->last_path[FAKE_CHECKSUM_PATH_LEN - 1] = '\0';

    for (size_t i = 0; i < FAKE_CHECKSUM_MAX_ENTRIES; i++) {
        if (fake->entries[i].present && strcmp(fake->entries[i].path, path) == 0) {
            strncpy(out_hex, fake->entries[i].hex, 64);
            out_hex[64] = '\0';
            return ODK_OK;
        }
    }
    return ODK_ERR_NOT_FOUND;
}

const odk_checksum_port_t fake_checksum_port = {
    .sha256_file_hex = fake_sha256_file_hex,
};
