/*
 * odk_installer_ports_idf.h — on-target (ESP-IDF) implementations of the
 * three ports odk_installer and odk_gen inject: storage (VFS/FAT),
 * checksum (mbedtls streaming SHA-256), and consent (serial y/n prompt).
 *
 * These are the real-target counterparts of the host fakes
 * (fake_storage/fake_checksum/fake_consent). The port structs themselves are
 * IDF-free (declared in odk_installer.h); only the .c files under
 * src/port_idf/ touch ESP-IDF, and the host CMake glob (each odk_* component's
 * src directory, non-recursive) never compiles them. The composition root owns the ctx structs
 * and hands &ctx to installer_create / gen_create.
 */
#ifndef ODK_INSTALLER_PORTS_IDF_H
#define ODK_INSTALLER_PORTS_IDF_H

#include "odk_installer.h"

#ifdef __cplusplus
extern "C" {
#endif

/* storage → VFS. base is the FAT mount whose free space free_bytes reports
 * (e.g. "/packages"); every other op takes an absolute path directly. */
typedef struct {
    char base[32];
} odk_storage_idf_ctx_t;

void odk_storage_idf_ctx_init(odk_storage_idf_ctx_t *ctx, const char *mount_base);
extern const odk_storage_port_t odk_storage_port_idf;

/* checksum → mbedtls streaming SHA-256. Stateless: pass NULL as ctx. */
extern const odk_checksum_port_t odk_checksum_port_idf;

/* consent → serial y/n prompt. timeout_ms elapsed with no 'y' == deny
 * (FR-14; headless boards have no consent screen yet). */
typedef struct {
    uint32_t timeout_ms;
} odk_consent_idf_ctx_t;

void odk_consent_idf_ctx_init(odk_consent_idf_ctx_t *ctx, uint32_t timeout_ms);
extern const odk_consent_port_t odk_consent_port_idf;

#ifdef __cplusplus
}
#endif

#endif /* ODK_INSTALLER_PORTS_IDF_H */
