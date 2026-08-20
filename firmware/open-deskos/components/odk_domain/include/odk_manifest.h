/*
 * odk_manifest.h — App package manifest schema v2.
 *
 * This is the only package contract accepted by the installer. A package
 * identifies an App with app_id, declares its lifecycle kind and entry point,
 * and carries all files needed to verify that entry point.
 */
#ifndef ODK_MANIFEST_H
#define ODK_MANIFEST_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "odk_err.h"
#include "odk_path.h"

#define ODK_MANIFEST_SCHEMA_VERSION 2u
#define ODK_APP_VERSION_LEN 16
#define ODK_APP_NAME_LEN 128
#define ODK_APP_ENTRY_LEN 128
#define ODK_APP_KIND_LEN 16
#define ODK_APP_CAPABILITY_LEN 48
#define ODK_APP_CONSTRAINT_LEN 48
#define ODK_APP_FILE_PATH_LEN 128
#define ODK_APP_MAX_CAPABILITIES 8
#define ODK_APP_MAX_DEPENDENCIES 4
#define ODK_APP_MAX_FILES 16

typedef enum {
    ODK_MANIFEST_KIND_UI = 0,
    ODK_MANIFEST_KIND_SERVICE,
} odk_manifest_kind_t;

typedef struct {
    char path[ODK_APP_FILE_PATH_LEN];
    char sha256_hex[65];
} odk_file_entry_t;

typedef struct {
    unsigned schema_version;
    char app_id[ODK_APP_ID_LEN];
    char version[ODK_APP_VERSION_LEN];
    char name[ODK_APP_NAME_LEN];
    odk_manifest_kind_t kind;
    char entry[ODK_APP_ENTRY_LEN];
    char capabilities[ODK_APP_MAX_CAPABILITIES][ODK_APP_CAPABILITY_LEN];
    size_t n_capabilities;
    struct {
        char app_id[ODK_APP_ID_LEN];
        char constraint[ODK_APP_CONSTRAINT_LEN];
    } deps[ODK_APP_MAX_DEPENDENCIES];
    size_t n_deps;
    odk_file_entry_t files[ODK_APP_MAX_FILES];
    size_t n_files;
} odk_manifest_t;

odk_err_t odk_manifest_parse(const char *json, size_t len, odk_manifest_t *out);

/* Case-insensitive. */
bool odk_sha256_hex_eq(const char *a, const char *b);

/* Deterministic C-side compatibility check; no LLM participates. */
odk_err_t odk_caps_check_board(const odk_manifest_t *m,
                                 const char *const *board_caps, size_t n_board_caps);

#endif /* ODK_MANIFEST_H */
