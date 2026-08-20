#include "fake_storage.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* True if path is exactly prefix, or prefix followed by "/..." */
static bool path_is_or_under(const char *path, const char *prefix)
{
    size_t plen = strlen(prefix);
    if (strncmp(path, prefix, plen) != 0) {
        return false;
    }
    return path[plen] == '\0' || path[plen] == '/';
}

static fake_storage_entry_t *find_entry(fake_storage_t *fake, const char *path)
{
    for (size_t i = 0; i < FAKE_STORAGE_MAX_ENTRIES; i++) {
        if (fake->entries[i].present && strcmp(fake->entries[i].path, path) == 0) {
            return &fake->entries[i];
        }
    }
    return NULL;
}

static fake_storage_entry_t *alloc_entry(fake_storage_t *fake, const char *path)
{
    fake_storage_entry_t *e = find_entry(fake, path);
    if (e != NULL) {
        return e;
    }
    for (size_t i = 0; i < FAKE_STORAGE_MAX_ENTRIES; i++) {
        if (!fake->entries[i].present) {
            e = &fake->entries[i];
            strncpy(e->path, path, FAKE_STORAGE_PATH_LEN - 1);
            e->path[FAKE_STORAGE_PATH_LEN - 1] = '\0';
            e->present = true;
            return e;
        }
    }
    return NULL;
}

static void free_entry(fake_storage_entry_t *e)
{
    free(e->data);
    memset(e, 0, sizeof(*e));
}

static void log_op(fake_storage_t *fake, fake_storage_op_kind_t kind,
                    const char *path, const char *path2, odk_err_t result)
{
    if (fake->n_ops >= FAKE_STORAGE_MAX_OPS) {
        return;
    }
    fake_storage_op_t *op = &fake->ops[fake->n_ops++];
    op->kind = kind;
    strncpy(op->path, path != NULL ? path : "", FAKE_STORAGE_PATH_LEN - 1);
    op->path[FAKE_STORAGE_PATH_LEN - 1] = '\0';
    strncpy(op->path2, path2 != NULL ? path2 : "", FAKE_STORAGE_PATH_LEN - 1);
    op->path2[FAKE_STORAGE_PATH_LEN - 1] = '\0';
    op->result = result;
}

/* Doubles as the de-facto initializer for a freshly-declared, uninitialized
 * fake_storage_t (the pattern every test in this suite uses), so it must
 * never dereference or free() any pre-existing entry: on first call those
 * bytes are indeterminate stack garbage, not a real heap pointer. */
void fake_storage_reset(fake_storage_t *fake)
{
    memset(fake, 0, sizeof(*fake));
    fake->free_bytes = UINT64_MAX;
}

void fake_storage_set_free_bytes(fake_storage_t *fake, uint64_t bytes)
{
    fake->free_bytes = bytes;
}

void fake_storage_set_rename_should_fail(fake_storage_t *fake, bool fail)
{
    fake->rename_should_fail = fail;
}

void fake_storage_set_unmounted(fake_storage_t *fake, bool unmounted)
{
    fake->unmounted = unmounted;
}

bool fake_storage_seed_file(fake_storage_t *fake, const char *path,
                             const void *data, size_t len)
{
    fake_storage_entry_t *e = alloc_entry(fake, path);
    if (e == NULL) {
        return false;
    }
    free(e->data);
    e->data = NULL;
    e->len = 0;
    if (len > 0) {
        e->data = malloc(len);
        if (e->data == NULL) {
            return false;
        }
        memcpy(e->data, data, len);
    }
    e->len = len;
    e->is_dir = false;
    return true;
}

bool fake_storage_read(const fake_storage_t *fake, const char *path,
                        const uint8_t **data_out, size_t *len_out)
{
    for (size_t i = 0; i < FAKE_STORAGE_MAX_ENTRIES; i++) {
        if (fake->entries[i].present && !fake->entries[i].is_dir &&
            strcmp(fake->entries[i].path, path) == 0) {
            if (data_out != NULL) {
                *data_out = fake->entries[i].data;
            }
            if (len_out != NULL) {
                *len_out = fake->entries[i].len;
            }
            return true;
        }
    }
    return false;
}

bool fake_storage_has(const fake_storage_t *fake, const char *path)
{
    for (size_t i = 0; i < FAKE_STORAGE_MAX_ENTRIES; i++) {
        if (!fake->entries[i].present) {
            continue;
        }
        if (strcmp(fake->entries[i].path, path) == 0 || path_is_or_under(fake->entries[i].path, path)) {
            return true;
        }
    }
    return false;
}

size_t fake_storage_op_count(const fake_storage_t *fake)
{
    return fake->n_ops;
}

const fake_storage_op_t *fake_storage_op_at(const fake_storage_t *fake, size_t index)
{
    if (index >= fake->n_ops) {
        return NULL;
    }
    return &fake->ops[index];
}

bool fake_storage_any_mutating_op(const fake_storage_t *fake)
{
    for (size_t i = 0; i < fake->n_ops; i++) {
        fake_storage_op_kind_t k = fake->ops[i].kind;
        if (k == FAKE_STORAGE_OP_MKDIR_P || k == FAKE_STORAGE_OP_WRITE_FILE ||
            k == FAKE_STORAGE_OP_RENAME || k == FAKE_STORAGE_OP_REMOVE_TREE) {
            return true;
        }
    }
    return false;
}

bool fake_storage_op_log_touches(const fake_storage_t *fake, const char *path_prefix)
{
    for (size_t i = 0; i < fake->n_ops; i++) {
        const fake_storage_op_t *op = &fake->ops[i];
        bool mutating = op->kind == FAKE_STORAGE_OP_MKDIR_P || op->kind == FAKE_STORAGE_OP_WRITE_FILE ||
                        op->kind == FAKE_STORAGE_OP_RENAME || op->kind == FAKE_STORAGE_OP_REMOVE_TREE;
        if (!mutating) {
            continue;
        }
        if (strcmp(op->path, path_prefix) == 0 || path_is_or_under(op->path, path_prefix) ||
            (op->path2[0] != '\0' &&
             (strcmp(op->path2, path_prefix) == 0 || path_is_or_under(op->path2, path_prefix)))) {
            return true;
        }
    }
    return false;
}

/* --- odk_storage_port_t implementation --- */

static odk_err_t port_mkdir_p(void *ctx, const char *path)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    if (fake->unmounted) {
        log_op(fake, FAKE_STORAGE_OP_MKDIR_P, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    fake_storage_entry_t *existing = find_entry(fake, path);
    if (existing != NULL && !existing->is_dir) {
        log_op(fake, FAKE_STORAGE_OP_MKDIR_P, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    fake_storage_entry_t *e = alloc_entry(fake, path);
    if (e == NULL) {
        log_op(fake, FAKE_STORAGE_OP_MKDIR_P, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    e->is_dir = true;
    log_op(fake, FAKE_STORAGE_OP_MKDIR_P, path, NULL, ODK_OK);
    return ODK_OK;
}

static odk_err_t port_write_file(void *ctx, const char *path, const void *buf, size_t len)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    if (fake->unmounted) {
        log_op(fake, FAKE_STORAGE_OP_WRITE_FILE, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    fake_storage_entry_t *existing = find_entry(fake, path);
    if (existing != NULL && existing->is_dir) {
        log_op(fake, FAKE_STORAGE_OP_WRITE_FILE, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    if (!fake_storage_seed_file(fake, path, buf, len)) {
        log_op(fake, FAKE_STORAGE_OP_WRITE_FILE, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    log_op(fake, FAKE_STORAGE_OP_WRITE_FILE, path, NULL, ODK_OK);
    return ODK_OK;
}

static odk_err_t port_read_file(void *ctx, const char *path, void *buf, size_t buflen, size_t *outlen)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    if (fake->unmounted) {
        log_op(fake, FAKE_STORAGE_OP_READ_FILE, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    const uint8_t *data = NULL;
    size_t len = 0;
    if (!fake_storage_read(fake, path, &data, &len)) {
        log_op(fake, FAKE_STORAGE_OP_READ_FILE, path, NULL, ODK_ERR_NOT_FOUND);
        return ODK_ERR_NOT_FOUND;
    }
    if (len > buflen) {
        log_op(fake, FAKE_STORAGE_OP_READ_FILE, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    if (len > 0) {
        memcpy(buf, data, len);
    }
    if (outlen != NULL) {
        *outlen = len;
    }
    log_op(fake, FAKE_STORAGE_OP_READ_FILE, path, NULL, ODK_OK);
    return ODK_OK;
}

static odk_err_t port_rename(void *ctx, const char *from, const char *to)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    if (fake->unmounted) {
        log_op(fake, FAKE_STORAGE_OP_RENAME, from, to, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    if (fake->rename_should_fail) {
        log_op(fake, FAKE_STORAGE_OP_RENAME, from, to, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }

    /* Collect the matching source entries before mutating anything: renaming
     * in place while walking the array would otherwise skip or double-visit
     * entries. */
    fake_storage_entry_t *matches[FAKE_STORAGE_MAX_ENTRIES];
    size_t n_matches = 0;
    for (size_t i = 0; i < FAKE_STORAGE_MAX_ENTRIES; i++) {
        if (fake->entries[i].present &&
            (strcmp(fake->entries[i].path, from) == 0 || path_is_or_under(fake->entries[i].path, from))) {
            matches[n_matches++] = &fake->entries[i];
        }
    }
    if (n_matches == 0) {
        log_op(fake, FAKE_STORAGE_OP_RENAME, from, to, ODK_ERR_NOT_FOUND);
        return ODK_ERR_NOT_FOUND;
    }

    /* An existing destination is displaced wholesale, mirroring a real
     * rename() onto an occupied path. */
    for (size_t i = 0; i < FAKE_STORAGE_MAX_ENTRIES; i++) {
        if (fake->entries[i].present &&
            (strcmp(fake->entries[i].path, to) == 0 || path_is_or_under(fake->entries[i].path, to))) {
            free_entry(&fake->entries[i]);
        }
    }

    size_t from_len = strlen(from);
    for (size_t i = 0; i < n_matches; i++) {
        char new_path[FAKE_STORAGE_PATH_LEN];
        const char *suffix = matches[i]->path + from_len; /* "" or "/..." */
        snprintf(new_path, sizeof(new_path), "%s%s", to, suffix);
        strncpy(matches[i]->path, new_path, FAKE_STORAGE_PATH_LEN - 1);
        matches[i]->path[FAKE_STORAGE_PATH_LEN - 1] = '\0';
    }

    log_op(fake, FAKE_STORAGE_OP_RENAME, from, to, ODK_OK);
    return ODK_OK;
}

static odk_err_t port_remove_tree(void *ctx, const char *path)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    if (fake->unmounted) {
        log_op(fake, FAKE_STORAGE_OP_REMOVE_TREE, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    bool removed_any = false;
    for (size_t i = 0; i < FAKE_STORAGE_MAX_ENTRIES; i++) {
        if (fake->entries[i].present &&
            (strcmp(fake->entries[i].path, path) == 0 || path_is_or_under(fake->entries[i].path, path))) {
            free_entry(&fake->entries[i]);
            removed_any = true;
        }
    }
    odk_err_t result = removed_any ? ODK_OK : ODK_ERR_NOT_FOUND;
    log_op(fake, FAKE_STORAGE_OP_REMOVE_TREE, path, NULL, result);
    return result;
}

static odk_err_t port_free_bytes(void *ctx, uint64_t *out)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    if (fake->unmounted) {
        log_op(fake, FAKE_STORAGE_OP_FREE_BYTES, "", NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    if (out != NULL) {
        *out = fake->free_bytes;
    }
    log_op(fake, FAKE_STORAGE_OP_FREE_BYTES, "", NULL, ODK_OK);
    return ODK_OK;
}

static odk_err_t port_size_bytes(void *ctx, const char *path, uint64_t *out)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    if (fake->unmounted) {
        log_op(fake, FAKE_STORAGE_OP_SIZE_BYTES, path, NULL, ODK_ERR_STORAGE);
        return ODK_ERR_STORAGE;
    }
    const uint8_t *data = NULL;
    size_t len = 0;
    if (!fake_storage_read(fake, path, &data, &len)) {
        log_op(fake, FAKE_STORAGE_OP_SIZE_BYTES, path, NULL, ODK_ERR_NOT_FOUND);
        return ODK_ERR_NOT_FOUND;
    }
    if (out != NULL) {
        *out = (uint64_t)len;
    }
    log_op(fake, FAKE_STORAGE_OP_SIZE_BYTES, path, NULL, ODK_OK);
    return ODK_OK;
}

static bool port_exists(void *ctx, const char *path)
{
    fake_storage_t *fake = (fake_storage_t *)ctx;
    bool found = !fake->unmounted && fake_storage_has(fake, path);
    log_op(fake, FAKE_STORAGE_OP_EXISTS, path, NULL, found ? ODK_OK : ODK_ERR_NOT_FOUND);
    return found;
}

const odk_storage_port_t fake_storage_port = {
    .mkdir_p = port_mkdir_p,
    .write_file = port_write_file,
    .read_file = port_read_file,
    .rename = port_rename,
    .remove_tree = port_remove_tree,
    .free_bytes = port_free_bytes,
    .size_bytes = port_size_bytes,
    .exists = port_exists,
};
