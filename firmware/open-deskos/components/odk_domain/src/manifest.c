#include "odk_manifest.h"

#include <ctype.h>
#include <string.h>

#include "cJSON.h"
#include "odk_path.h"
#include "odk_semver.h"

static bool copy_bounded(char *dst, size_t dst_size, const char *src)
{
    size_t len = strlen(src);
    if (len >= dst_size) {
        return false;
    }
    memcpy(dst, src, len + 1);
    return true;
}

static bool is_sha256_hex(const char *s)
{
    if (s == NULL || strlen(s) != 64) {
        return false;
    }
    for (size_t i = 0; i < 64; i++) {
        if (!isxdigit((unsigned char)s[i])) {
            return false;
        }
    }
    return true;
}

static const cJSON *get_required_string(const cJSON *obj, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (item == NULL || !cJSON_IsString(item) || item->valuestring == NULL) {
        return NULL;
    }
    return item;
}

static const cJSON *get_required_array(const cJSON *obj, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (item == NULL || !cJSON_IsArray(item)) {
        return NULL;
    }
    return item;
}

static const cJSON *get_required_number(const cJSON *obj, const char *key)
{
    const cJSON *item = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (item == NULL || !cJSON_IsNumber(item)) {
        return NULL;
    }
    return item;
}

static odk_err_t parse_kind(const cJSON *j_kind, odk_manifest_t *m)
{
    if (strcmp(j_kind->valuestring, "ui") == 0) {
        m->kind = ODK_MANIFEST_KIND_UI;
        return ODK_OK;
    }
    if (strcmp(j_kind->valuestring, "service") == 0) {
        m->kind = ODK_MANIFEST_KIND_SERVICE;
        return ODK_OK;
    }
    return ODK_ERR_INVALID_MANIFEST;
}

static odk_err_t parse_capabilities(const cJSON *j_capabilities, odk_manifest_t *m)
{
    int count = cJSON_GetArraySize(j_capabilities);
    if ((size_t)count > sizeof(m->capabilities) / sizeof(m->capabilities[0])) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    for (int i = 0; i < count; i++) {
        const cJSON *cap = cJSON_GetArrayItem(j_capabilities, i);
        if (!cJSON_IsString(cap) || cap->valuestring == NULL ||
            !copy_bounded(m->capabilities[i], sizeof(m->capabilities[i]), cap->valuestring)) {
            return ODK_ERR_INVALID_MANIFEST;
        }
    }

    m->n_capabilities = (size_t)count;
    return ODK_OK;
}

static odk_err_t parse_dependencies(const cJSON *j_dependencies, odk_manifest_t *m)
{
    int count = cJSON_GetArraySize(j_dependencies);
    if ((size_t)count > sizeof(m->deps) / sizeof(m->deps[0])) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    for (int i = 0; i < count; i++) {
        const cJSON *dep = cJSON_GetArrayItem(j_dependencies, i);
        if (!cJSON_IsObject(dep)) {
            return ODK_ERR_INVALID_MANIFEST;
        }

        const cJSON *dep_app_id = get_required_string(dep, "app_id");
        const cJSON *dep_constraint = get_required_string(dep, "constraint");
        if (dep_app_id == NULL || dep_constraint == NULL ||
            !copy_bounded(m->deps[i].app_id, sizeof(m->deps[i].app_id),
                          dep_app_id->valuestring) ||
            !copy_bounded(m->deps[i].constraint, sizeof(m->deps[i].constraint),
                          dep_constraint->valuestring)) {
            return ODK_ERR_INVALID_MANIFEST;
        }

        if (!odk_app_id_valid(m->deps[i].app_id)) {
            return ODK_ERR_BAD_APP_ID;
        }

        odk_semver_constraint_t constraints[8];
        size_t n_constraints = 0;
        odk_err_t err = odk_semver_constraints_parse(
            m->deps[i].constraint, constraints,
            sizeof(constraints) / sizeof(constraints[0]), &n_constraints);
        if (err != ODK_OK) {
            return err;
        }
    }

    m->n_deps = (size_t)count;
    return ODK_OK;
}

static odk_err_t parse_files(const cJSON *j_files, odk_manifest_t *m)
{
    int count = cJSON_GetArraySize(j_files);
    if ((size_t)count > sizeof(m->files) / sizeof(m->files[0])) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    for (int i = 0; i < count; i++) {
        const cJSON *file = cJSON_GetArrayItem(j_files, i);
        if (!cJSON_IsObject(file)) {
            return ODK_ERR_INVALID_MANIFEST;
        }

        const cJSON *file_path = get_required_string(file, "path");
        const cJSON *file_sha256 = get_required_string(file, "sha256");
        if (file_path == NULL || file_sha256 == NULL ||
            !copy_bounded(m->files[i].path, sizeof(m->files[i].path), file_path->valuestring) ||
            !copy_bounded(m->files[i].sha256_hex, sizeof(m->files[i].sha256_hex),
                          file_sha256->valuestring)) {
            return ODK_ERR_INVALID_MANIFEST;
        }

        if (!odk_rel_path_safe(m->files[i].path)) {
            return ODK_ERR_PATH_UNSAFE;
        }
        if (!is_sha256_hex(m->files[i].sha256_hex)) {
            return ODK_ERR_INVALID_MANIFEST;
        }
    }

    m->n_files = (size_t)count;
    return ODK_OK;
}

odk_err_t odk_manifest_parse(const char *json, size_t len, odk_manifest_t *out)
{
    if (json == NULL || out == NULL) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    cJSON *root = cJSON_ParseWithLength(json, len);
    if (root == NULL || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return ODK_ERR_INVALID_MANIFEST;
    }

    const cJSON *j_schema_version = get_required_number(root, "schema_version");
    const cJSON *j_app_id = get_required_string(root, "app_id");
    const cJSON *j_version = get_required_string(root, "version");
    const cJSON *j_name = get_required_string(root, "name");
    const cJSON *j_kind = get_required_string(root, "kind");
    const cJSON *j_entry = get_required_string(root, "entry");
    const cJSON *j_capabilities = get_required_array(root, "capabilities");
    const cJSON *j_dependencies = get_required_array(root, "dependencies");
    const cJSON *j_files = get_required_array(root, "files");

    if (j_schema_version == NULL || j_app_id == NULL || j_version == NULL ||
        j_name == NULL || j_kind == NULL || j_entry == NULL ||
        j_capabilities == NULL || j_dependencies == NULL || j_files == NULL ||
        j_schema_version->valuedouble != ODK_MANIFEST_SCHEMA_VERSION) {
        cJSON_Delete(root);
        return ODK_ERR_INVALID_MANIFEST;
    }

    odk_manifest_t m;
    memset(&m, 0, sizeof(m));

    m.schema_version = (unsigned)j_schema_version->valuedouble;
    if (!copy_bounded(m.app_id, sizeof(m.app_id), j_app_id->valuestring) ||
        !copy_bounded(m.version, sizeof(m.version), j_version->valuestring) ||
        !copy_bounded(m.name, sizeof(m.name), j_name->valuestring) ||
        !copy_bounded(m.entry, sizeof(m.entry), j_entry->valuestring)) {
        cJSON_Delete(root);
        return ODK_ERR_INVALID_MANIFEST;
    }

    if (!odk_app_id_valid(m.app_id)) {
        cJSON_Delete(root);
        return ODK_ERR_BAD_APP_ID;
    }
    if (!odk_rel_path_safe(m.entry)) {
        cJSON_Delete(root);
        return ODK_ERR_PATH_UNSAFE;
    }
    if (strcmp(m.entry, "app/main.lua") != 0) {
        cJSON_Delete(root);
        return ODK_ERR_INVALID_MANIFEST;
    }

    odk_semver_t version;
    odk_err_t err = odk_semver_parse(m.version, &version);
    if (err != ODK_OK) {
        cJSON_Delete(root);
        return err;
    }

    err = parse_kind(j_kind, &m);
    if (err == ODK_OK) {
        err = parse_capabilities(j_capabilities, &m);
    }
    if (err == ODK_OK) {
        err = parse_dependencies(j_dependencies, &m);
    }
    if (err == ODK_OK) {
        err = parse_files(j_files, &m);
    }

    cJSON_Delete(root);
    if (err != ODK_OK) {
        return err;
    }

    bool entry_declared = false;
    for (size_t i = 0; i < m.n_files; i++) {
        if (strcmp(m.files[i].path, m.entry) == 0) {
            entry_declared = true;
            break;
        }
    }
    if (!entry_declared) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    *out = m;
    return ODK_OK;
}

bool odk_sha256_hex_eq(const char *a, const char *b)
{
    if (a == NULL || b == NULL) {
        return false;
    }

    size_t len_a = strlen(a);
    if (len_a != strlen(b)) {
        return false;
    }

    for (size_t i = 0; i < len_a; i++) {
        if (tolower((unsigned char)a[i]) != tolower((unsigned char)b[i])) {
            return false;
        }
    }

    return true;
}

odk_err_t odk_caps_check_board(const odk_manifest_t *m,
                                  const char *const *board_caps, size_t n_board_caps)
{
    if (m == NULL || (board_caps == NULL && n_board_caps > 0)) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    for (size_t i = 0; i < m->n_capabilities; i++) {
        bool found = false;
        for (size_t j = 0; j < n_board_caps; j++) {
            if (strcmp(m->capabilities[i], board_caps[j]) == 0) {
                found = true;
                break;
            }
        }
        if (!found) {
            return ODK_ERR_CAP_UNSUPPORTED;
        }
    }

    return ODK_OK;
}
