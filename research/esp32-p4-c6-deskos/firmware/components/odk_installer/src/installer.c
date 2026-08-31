/*
 * installer.c — staged-package atomic installer (NT-7, FR-5/14/22).
 *
 * Verification chain, in order: parse the staged manifest (which itself
 * rejects a bad app_id or an unsafe file path per FR-19/20) -> reject a
 * same-version reinstall or an unsatisfiable dependency before the user is
 * ever prompted -> reject on insufficient free space -> reject a capability
 * the board does not support -> ask the consent port -> verify every file's
 * SHA-256 against the manifest -> move the whole staged tree into place with
 * a single rename() -> write the provenance sidecar and update the
 * installed-package index. Every failure branch after the checksum pass
 * cleans the staging directory and never touches an existing install; every
 * failure branch before it makes zero mutating storage calls at all.
 *
 * A staged file's byte count is learned via the storage port's size_bytes(),
 * never by reading file content; the space precheck exists to fail closed
 * before any mutation, not to load package bytes twice.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

#include "cJSON.h"

#include "odk_installer.h"
#include "odk_path.h"
#include "odk_semver.h"

#define PKG_ROOT_BUF_LEN 192
#define PATH_BUF_LEN 256
#define JSON_READ_BUF_LEN 8192

/* Sized to pkg_root's own worst case ("<pkg_root>/.trash") rather than the
 * generic PATH_BUF_LEN, so that trash_dir -- built by appending a package id
 * and a timestamp onto trash_root -- can be proven not to truncate: reusing
 * PATH_BUF_LEN here would make trash_root's declared bound (256) the assumed
 * worst case for that later concatenation, leaving no provable headroom. */
#define TRASH_ROOT_BUF_LEN (PKG_ROOT_BUF_LEN + 16)
/* trash_dir = trash_root + '/' + app_id + '-' + decimal time_t */
#define TRASH_DIR_BUF_LEN (TRASH_ROOT_BUF_LEN + 1 + 64 + 1 + 24)

struct odk_installer {
    const odk_storage_port_t *st;
    void *st_ctx;
    const odk_checksum_port_t *ck;
    void *ck_ctx;
    const odk_consent_port_t *co;
    void *co_ctx;
    char pkg_root[PKG_ROOT_BUF_LEN];
    const char *const *board_caps;
    size_t n_board_caps;
};

odk_installer_t *installer_create(const odk_storage_port_t *st, void *st_ctx,
                                    const odk_checksum_port_t *ck, void *ck_ctx,
                                    const odk_consent_port_t *co, void *co_ctx,
                                    const char *pkg_root,
                                    const char *const *board_caps, size_t n_board_caps)
{
    if (st == NULL || ck == NULL || co == NULL || pkg_root == NULL) {
        return NULL;
    }
    if (strlen(pkg_root) >= PKG_ROOT_BUF_LEN) {
        return NULL;
    }

    odk_installer_t *ins = malloc(sizeof(*ins));
    if (ins == NULL) {
        return NULL;
    }

    ins->st = st;
    ins->st_ctx = st_ctx;
    ins->ck = ck;
    ins->ck_ctx = ck_ctx;
    ins->co = co;
    ins->co_ctx = co_ctx;
    memcpy(ins->pkg_root, pkg_root, strlen(pkg_root) + 1);
    ins->board_caps = board_caps;
    ins->n_board_caps = n_board_caps;
    return ins;
}

static const char *origin_to_string(odk_pkg_origin_t origin)
{
    switch (origin) {
        case ODK_SRC_GENERATED: return "generated";
        case ODK_SRC_SIDELOAD:  return "sideload";
        case ODK_SRC_STORE:     return "store";
        default:                 return "unknown";
    }
}

static odk_pkg_origin_t origin_from_string(const char *s)
{
    if (s != NULL && strcmp(s, "sideload") == 0) {
        return ODK_SRC_SIDELOAD;
    }
    if (s != NULL && strcmp(s, "store") == 0) {
        return ODK_SRC_STORE;
    }
    return ODK_SRC_GENERATED;
}

static const char *kind_to_string(odk_manifest_kind_t kind)
{
    switch (kind) {
        case ODK_MANIFEST_KIND_UI: return "ui";
        case ODK_MANIFEST_KIND_SERVICE: return "service";
        default: return "unknown";
    }
}

static bool kind_from_string(const char *s, odk_manifest_kind_t *out)
{
    if (s == NULL || out == NULL) {
        return false;
    }
    if (strcmp(s, "ui") == 0) {
        *out = ODK_MANIFEST_KIND_UI;
        return true;
    }
    if (strcmp(s, "service") == 0) {
        *out = ODK_MANIFEST_KIND_SERVICE;
        return true;
    }
    return false;
}

static void copy_bounded_field(char *dst, size_t dst_size, const char *src)
{
    if (dst_size == 0) {
        return;
    }
    strncpy(dst, src != NULL ? src : "", dst_size - 1);
    dst[dst_size - 1] = '\0';
}

/* Reads "<dir>/manifest.json" through the storage port and parses it.
 * Any read failure (including "not found", the common case for an
 * as-yet-uninstalled dependency) is surfaced as the read/parse error rather
 * than translated here, so callers checking an app_id that may or may not
 * be installed can treat "err != ODK_OK" uniformly as "not there". */
static odk_err_t read_manifest_at(odk_installer_t *ins, const char *dir, odk_manifest_t *out)
{
    char path[PATH_BUF_LEN];
    snprintf(path, sizeof(path), "%s/manifest.json", dir);

    char *buf = malloc(JSON_READ_BUF_LEN);
    if (buf == NULL) {
        return ODK_ERR_OOM;
    }

    size_t outlen = 0;
    odk_err_t err = ins->st->read_file(ins->st_ctx, path, buf, JSON_READ_BUF_LEN, &outlen);
    if (err != ODK_OK) {
        free(buf);
        return err;
    }

    err = odk_manifest_parse(buf, outlen, out);
    free(buf);
    return err;
}

bool installer_is_installed(odk_installer_t *ins, const char *app_id,
                            char version_out[ODK_APP_VERSION_LEN])
{
    if (version_out != NULL) {
        version_out[0] = '\0';
    }
    if (ins == NULL || !odk_app_id_valid(app_id)) {
        return false;
    }

    char dir[PATH_BUF_LEN];
    snprintf(dir, sizeof(dir), "%s/%s", ins->pkg_root, app_id);

    odk_manifest_t m;
    if (read_manifest_at(ins, dir, &m) != ODK_OK) {
        return false;
    }

    if (version_out != NULL) {
        copy_bounded_field(version_out, 16, m.version);
    }
    return true;
}

/* Every declared dependency must already be installed under pkg_root at a
 * version satisfying its constraint; this slice has no store/catalog, so
 * "not installed anywhere under pkg_root" is the whole unsatisfiability
 * condition. */
static odk_err_t check_dependencies(odk_installer_t *ins, const odk_manifest_t *manifest)
{
    for (size_t i = 0; i < manifest->n_deps; i++) {
        char installed_version[16];
        if (!installer_is_installed(ins, manifest->deps[i].app_id, installed_version)) {
            return ODK_ERR_DEP_UNSATISFIED;
        }

        odk_semver_t dep_version;
        if (odk_semver_parse(installed_version, &dep_version) != ODK_OK) {
            return ODK_ERR_DEP_UNSATISFIED;
        }

        odk_semver_constraint_t constraints[8];
        size_t n_constraints = 0;
        if (odk_semver_constraints_parse(manifest->deps[i].constraint, constraints,
                sizeof(constraints) / sizeof(constraints[0]), &n_constraints) != ODK_OK) {
            return ODK_ERR_DEP_UNSATISFIED;
        }

        if (!odk_semver_satisfies(&dep_version, constraints, n_constraints)) {
            return ODK_ERR_DEP_UNSATISFIED;
        }
    }
    return ODK_OK;
}

/* Sums the actual byte size of every staged file via the storage port's
 * size_bytes(), never by reading file content into memory (checksumming
 * reads each file once, through the checksum port, once consent has been
 * granted — this pass must not read it a second time just to measure it). */
static odk_err_t sum_staged_file_bytes(odk_installer_t *ins, const char *staged_dir,
                                         const odk_manifest_t *manifest, uint64_t *out_total)
{
    uint64_t total = 0;
    for (size_t i = 0; i < manifest->n_files; i++) {
        char file_path[PATH_BUF_LEN];
        snprintf(file_path, sizeof(file_path), "%s/%s", staged_dir, manifest->files[i].path);

        uint64_t flen = 0;
        odk_err_t err = ins->st->size_bytes(ins->st_ctx, file_path, &flen);
        if (err != ODK_OK) {
            return ODK_ERR_NO_SPACE;
        }
        total += flen;
    }

    *out_total = total;
    return ODK_OK;
}

static odk_err_t verify_checksums(odk_installer_t *ins, const char *staged_dir,
                                    const odk_manifest_t *manifest)
{
    for (size_t i = 0; i < manifest->n_files; i++) {
        char file_path[PATH_BUF_LEN];
        snprintf(file_path, sizeof(file_path), "%s/%s", staged_dir, manifest->files[i].path);

        char hex[65];
        odk_err_t err = ins->ck->sha256_file_hex(ins->ck_ctx, file_path, hex);
        if (err != ODK_OK || !odk_sha256_hex_eq(hex, manifest->files[i].sha256_hex)) {
            return ODK_ERR_CHECKSUM_MISMATCH;
        }
    }
    return ODK_OK;
}

/* Moves staged_dir into final_dir with a single rename(): an existing
 * final_dir is evicted to .trash/<id>-<ts> first (directory-entry-level
 * rename, so the tree is either fully at the old location or fully at the
 * new one, never partially at both). Any rename failure is rolled back
 * best-effort and reported as a storage error. */
static odk_err_t atomic_place(odk_installer_t *ins, const char *staged_dir,
                                const char *final_dir, const char *app_id)
{
    bool had_existing = ins->st->exists(ins->st_ctx, final_dir);
    char trash_dir[TRASH_DIR_BUF_LEN] = { 0 };

    if (had_existing) {
        char trash_root[TRASH_ROOT_BUF_LEN];
        snprintf(trash_root, sizeof(trash_root), "%s/.trash", ins->pkg_root);
        if (ins->st->mkdir_p(ins->st_ctx, trash_root) != ODK_OK) {
            return ODK_ERR_STORAGE;
        }
        snprintf(trash_dir, sizeof(trash_dir), "%s/%s-%ld", trash_root, app_id, (long)time(NULL));
        if (ins->st->rename(ins->st_ctx, final_dir, trash_dir) != ODK_OK) {
            return ODK_ERR_STORAGE;
        }
    }

    if (ins->st->rename(ins->st_ctx, staged_dir, final_dir) != ODK_OK) {
        if (had_existing) {
            ins->st->rename(ins->st_ctx, trash_dir, final_dir);
        }
        ins->st->remove_tree(ins->st_ctx, staged_dir);
        return ODK_ERR_STORAGE;
    }

    return ODK_OK;
}

static odk_err_t write_provenance(odk_installer_t *ins, const char *final_dir,
                                    odk_pkg_origin_t origin)
{
    char install_dir[PATH_BUF_LEN + 16];
    int n = snprintf(install_dir, sizeof(install_dir), "%s/.install", final_dir);
    if (n < 0 || (size_t)n >= sizeof(install_dir)) {
        return ODK_ERR_STORAGE;
    }
    odk_err_t err = ins->st->mkdir_p(ins->st_ctx, install_dir);
    if (err != ODK_OK) {
        return err;
    }

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return ODK_ERR_OOM;
    }
    cJSON_AddStringToObject(root, "origin", origin_to_string(origin));
    cJSON_AddNumberToObject(root, "installed_at", (double)time(NULL));
    cJSON_AddStringToObject(root, "checksum_status", "verified");

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (body == NULL) {
        return ODK_ERR_OOM;
    }

    char provenance_path[PATH_BUF_LEN + 32];
    int provenance_n = snprintf(provenance_path, sizeof(provenance_path), "%s/provenance.json", install_dir);
    if (provenance_n < 0 || (size_t)provenance_n >= sizeof(provenance_path)) {
        free(body);
        return ODK_ERR_PATH_UNSAFE;
    }
    err = ins->st->write_file(ins->st_ctx, provenance_path, body, strlen(body));
    free(body);
    return err;
}

/* Rewrites <pkg_root>/.index.json's "packages" map, replacing any prior
 * entry for manifest->app_id. The index is a plain file, never NVS
 * (NFR-8); its exact shape beyond containing the app_id is not part of
 * the contract. */
static odk_err_t update_index(odk_installer_t *ins, const odk_manifest_t *manifest,
                                odk_pkg_origin_t origin)
{
    char index_path[PATH_BUF_LEN];
    snprintf(index_path, sizeof(index_path), "%s/.index.json", ins->pkg_root);

    char *buf = malloc(JSON_READ_BUF_LEN);
    if (buf == NULL) {
        return ODK_ERR_OOM;
    }
    size_t outlen = 0;
    odk_err_t read_err = ins->st->read_file(ins->st_ctx, index_path, buf, JSON_READ_BUF_LEN, &outlen);

    cJSON *root = (read_err == ODK_OK) ? cJSON_ParseWithLength(buf, outlen) : NULL;
    free(buf);
    if (root == NULL || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        root = cJSON_CreateObject();
        if (root == NULL) {
            return ODK_ERR_OOM;
        }
    }

    cJSON *packages = cJSON_GetObjectItemCaseSensitive(root, "packages");
    if (!cJSON_IsObject(packages)) {
        packages = cJSON_AddObjectToObject(root, "packages");
    }

    cJSON_DeleteItemFromObjectCaseSensitive(packages, manifest->app_id);
    cJSON *entry = cJSON_AddObjectToObject(packages, manifest->app_id);
    cJSON_AddStringToObject(entry, "version", manifest->version);
    cJSON_AddStringToObject(entry, "kind", kind_to_string(manifest->kind));
    cJSON_AddStringToObject(entry, "origin", origin_to_string(origin));

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (body == NULL) {
        return ODK_ERR_OOM;
    }

    odk_err_t err = ins->st->write_file(ins->st_ctx, index_path, body, strlen(body));
    free(body);
    return err;
}

static odk_err_t remove_from_index(odk_installer_t *ins, const char *app_id)
{
    char index_path[PATH_BUF_LEN];
    snprintf(index_path, sizeof(index_path), "%s/.index.json", ins->pkg_root);

    char *buf = malloc(JSON_READ_BUF_LEN);
    if (buf == NULL) {
        return ODK_ERR_OOM;
    }
    size_t outlen = 0;
    odk_err_t read_err = ins->st->read_file(ins->st_ctx, index_path, buf, JSON_READ_BUF_LEN, &outlen);

    cJSON *root = (read_err == ODK_OK) ? cJSON_ParseWithLength(buf, outlen) : NULL;
    free(buf);
    if (root == NULL || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return ODK_OK; /* no index means nothing to remove */
    }

    cJSON *packages = cJSON_GetObjectItemCaseSensitive(root, "packages");
    if (cJSON_IsObject(packages)) {
        cJSON_DeleteItemFromObjectCaseSensitive(packages, app_id);
    }

    char *body = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    if (body == NULL) {
        return ODK_ERR_OOM;
    }

    odk_err_t err = ins->st->write_file(ins->st_ctx, index_path, body, strlen(body));
    free(body);
    return err;
}

odk_err_t installer_install_staged(odk_installer_t *ins, const char *staged_dir,
                                     odk_pkg_origin_t origin)
{
    if (ins == NULL || staged_dir == NULL) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    odk_manifest_t manifest;
    odk_err_t err = read_manifest_at(ins, staged_dir, &manifest);
    if (err != ODK_OK) {
        return err;
    }

    /* Same app_id, same version already installed: reject outright,
     * never silently overwrite. A version bump is allowed to proceed. */
    char existing_version[16];
    if (installer_is_installed(ins, manifest.app_id, existing_version) &&
        strcmp(existing_version, manifest.version) == 0) {
        return ODK_ERR_EXISTS;
    }

    err = check_dependencies(ins, &manifest);
    if (err != ODK_OK) {
        return err;
    }

    uint64_t total_bytes = 0;
    err = sum_staged_file_bytes(ins, staged_dir, &manifest, &total_bytes);
    if (err != ODK_OK) {
        return err;
    }
    uint64_t free_bytes = 0;
    if (ins->st->free_bytes(ins->st_ctx, &free_bytes) != ODK_OK) {
        return ODK_ERR_STORAGE;
    }
    if (total_bytes > free_bytes) {
        return ODK_ERR_NO_SPACE;
    }

    err = odk_caps_check_board(&manifest, ins->board_caps, ins->n_board_caps);
    if (err != ODK_OK) {
        return err;
    }

    if (!ins->co->confirm(ins->co_ctx, &manifest)) {
        return ODK_ERR_DENIED;
    }

    err = verify_checksums(ins, staged_dir, &manifest);
    if (err != ODK_OK) {
        ins->st->remove_tree(ins->st_ctx, staged_dir);
        return err;
    }

    char final_dir[PATH_BUF_LEN];
    snprintf(final_dir, sizeof(final_dir), "%s/%s", ins->pkg_root, manifest.app_id);
    err = atomic_place(ins, staged_dir, final_dir, manifest.app_id);
    if (err != ODK_OK) {
        return err;
    }

    err = write_provenance(ins, final_dir, origin);
    if (err != ODK_OK) {
        return err;
    }

    return update_index(ins, &manifest, origin);
}

odk_err_t installer_list(odk_installer_t *ins, odk_installed_info_t *out,
                           size_t max, size_t *n)
{
    if (n != NULL) {
        *n = 0;
    }
    if (ins == NULL) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    char index_path[PATH_BUF_LEN];
    snprintf(index_path, sizeof(index_path), "%s/.index.json", ins->pkg_root);

    char *buf = malloc(JSON_READ_BUF_LEN);
    if (buf == NULL) {
        return ODK_ERR_OOM;
    }
    size_t outlen = 0;
    odk_err_t read_err = ins->st->read_file(ins->st_ctx, index_path, buf, JSON_READ_BUF_LEN, &outlen);
    if (read_err != ODK_OK) {
        free(buf);
        return ODK_OK; /* no index yet: zero packages installed */
    }

    cJSON *root = cJSON_ParseWithLength(buf, outlen);
    free(buf);
    if (root == NULL) {
        return ODK_ERR_STORAGE;
    }

    cJSON *packages = cJSON_GetObjectItemCaseSensitive(root, "packages");
    size_t count = 0;
    if (cJSON_IsObject(packages)) {
        cJSON *entry = NULL;
        cJSON_ArrayForEach(entry, packages) {
            if (out != NULL && count < max) {
                copy_bounded_field(out[count].app_id, sizeof(out[count].app_id), entry->string);
                cJSON *version = cJSON_GetObjectItemCaseSensitive(entry, "version");
                copy_bounded_field(out[count].version, sizeof(out[count].version),
                                    cJSON_IsString(version) ? version->valuestring : "");
                cJSON *kind = cJSON_GetObjectItemCaseSensitive(entry, "kind");
                if (!kind_from_string(cJSON_IsString(kind) ? kind->valuestring : NULL,
                                      &out[count].kind)) {
                    cJSON_Delete(root);
                    return ODK_ERR_INVALID_MANIFEST;
                }
                cJSON *origin_field = cJSON_GetObjectItemCaseSensitive(entry, "origin");
                out[count].origin =
                    origin_from_string(cJSON_IsString(origin_field) ? origin_field->valuestring : NULL);
            }
            count++;
        }
    }

    cJSON_Delete(root);
    if (n != NULL) {
        *n = count;
    }
    return ODK_OK;
}

odk_err_t installer_remove(odk_installer_t *ins, const char *app_id)
{
    if (ins == NULL || !odk_app_id_valid(app_id)) {
        return ODK_ERR_BAD_APP_ID;
    }

    if (!installer_is_installed(ins, app_id, NULL)) {
        return ODK_ERR_NOT_FOUND;
    }

    char final_dir[PATH_BUF_LEN];
    snprintf(final_dir, sizeof(final_dir), "%s/%s", ins->pkg_root, app_id);
    odk_err_t err = ins->st->remove_tree(ins->st_ctx, final_dir);
    if (err != ODK_OK) {
        return err;
    }

    return remove_from_index(ins, app_id);
}
