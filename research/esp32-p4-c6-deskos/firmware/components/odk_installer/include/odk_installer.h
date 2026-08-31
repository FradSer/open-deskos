/*
 * odk_installer.h — staged-package atomic installer (NT-7, FR-5/14/22).
 *
 * Installs a package from a pre-populated staging directory into the
 * package root: manifest validation, per-file SHA-256 verification,
 * dependency/capability compatibility (delegated to odk_domain), user
 * consent for the declared capabilities, then a single atomic rename() of
 * the whole staged tree into place, followed by a provenance sidecar and an
 * update to the installed-package index. Storage, checksumming, and consent
 * are all injected as ports — real targets are the SD/flash filesystem,
 * mbedtls, and the on-device capability-consent screen respectively; host
 * tests supply fakes — so this header and its implementation compile
 * unchanged on the host test harness and on-target.
 *
 * This slice covers local staged sources only: sideload and the one-prompt
 * generation pipeline (task-008) both write into a staging directory and
 * call installer_install_staged. Downloading a package from a store is
 * NT-8 and out of scope. esp_https_ota/app_update are never referenced by
 * this component (NFR-10) — package delivery is file-copy-and-verify, never
 * an OTA partition write.
 *
 * The installed-package index (<pkg_root>/.index.json) and each package's
 * provenance sidecar (<pkg_root>/<id>/.install/provenance.json) both live in
 * the file-backed package root, never NVS (NFR-8).
 */
#ifndef ODK_INSTALLER_H
#define ODK_INSTALLER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "odk_err.h"
#include "odk_manifest.h"

typedef struct {
    odk_err_t (*mkdir_p)(void *ctx, const char *path);
    odk_err_t (*write_file)(void *ctx, const char *path, const void *buf, size_t len);
    odk_err_t (*read_file)(void *ctx, const char *path, void *buf, size_t buflen, size_t *outlen);
    odk_err_t (*rename)(void *ctx, const char *from, const char *to);   /* atomic at the directory-entry level */
    odk_err_t (*remove_tree)(void *ctx, const char *path);
    odk_err_t (*free_bytes)(void *ctx, uint64_t *out);
    odk_err_t (*size_bytes)(void *ctx, const char *path, uint64_t *out);
    bool       (*exists)(void *ctx, const char *path);
} odk_storage_port_t;

/* Streaming SHA-256: mbedtls on target, a reference implementation on host. */
typedef struct {
    odk_err_t (*sha256_file_hex)(void *ctx, const char *path, char out_hex[65]);
} odk_checksum_port_t;

/* FR-14 install-time authorization: present the declared capability list and
 * get the user's decision. Headless boards (no screen yet) wire this to a
 * serial prompt or a fixed auto-decision fake. */
typedef struct {
    bool (*confirm)(void *ctx, const odk_manifest_t *m);
} odk_consent_port_t;

typedef enum { ODK_SRC_GENERATED, ODK_SRC_SIDELOAD, ODK_SRC_STORE } odk_pkg_origin_t;

typedef struct {
    char app_id[ODK_APP_ID_LEN];
    char version[ODK_APP_VERSION_LEN];
    odk_manifest_kind_t kind;
    odk_pkg_origin_t origin;
} odk_installed_info_t;

typedef struct odk_installer odk_installer_t;

odk_installer_t *installer_create(const odk_storage_port_t *st, void *st_ctx,
                                   const odk_checksum_port_t *ck, void *ck_ctx,
                                   const odk_consent_port_t *co, void *co_ctx,
                                   const char *pkg_root,          /* e.g. "/packages" — never hard-coded */
                                   const char *const *board_caps, size_t n_board_caps);

/* staged_dir contains manifest.json + files[]; only a fully-verified,
 * fully-authorized package is ever moved into pkg_root. */
odk_err_t installer_install_staged(odk_installer_t *ins, const char *staged_dir,
                                    odk_pkg_origin_t origin);
odk_err_t installer_list(odk_installer_t *ins, odk_installed_info_t *out,
                          size_t max, size_t *n);
odk_err_t installer_remove(odk_installer_t *ins, const char *app_id);
bool       installer_is_installed(odk_installer_t *ins, const char *app_id,
                                  char version_out[ODK_APP_VERSION_LEN]);

#endif /* ODK_INSTALLER_H */
