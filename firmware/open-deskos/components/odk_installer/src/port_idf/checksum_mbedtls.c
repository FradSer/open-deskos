/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 *
 * SPDX-License-Identifier: Apache-2.0
 *
 * odk_checksum_port_t stub — IDF 6.0 restructured mbedtls (removed the
 * public mbedtls/sha256.h + mbedtls_sha256_* API). The real streaming SHA-256
 * port needs porting to the 6.0 PSA/mbedtls API; until then this stub lets
 * the build link on IDF 6.0.1 (display bring-up does not exercise the
 * installer's checksum path). Reimplement with 6.0's API when installer
 * verification is needed.
 *
 * Excluded from the host build (src/port_idf/).
 */
#include "odk_installer.h"
#include "odk_err.h"

static odk_err_t stub_sha256_file_hex(void *ctx, const char *path, char out_hex[65])
{
    (void)ctx; (void)path; (void)out_hex;
    return ODK_ERR_NOT_IMPLEMENTED;
}

const odk_checksum_port_t odk_checksum_port_idf = {
    .sha256_file_hex = stub_sha256_file_hex,
};
