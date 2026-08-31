/*
 * fake_storage.h — in-memory path->bytes tree standing in for
 * odk_storage_port_t (SD/flash filesystem on target).
 *
 * Every mutating call (mkdir_p/write_file/rename/remove_tree) is appended to
 * an operation log in call order, so a test can assert not just the final
 * tree state but the exact sequence the installer produced: no per-file
 * write ever lands directly under the final package root before the single
 * atomic rename, an existing install is never touched by a failed install,
 * and a rejected install performs zero mutating calls at all ("zero
 * residue"). fake_storage_seed_file bypasses the port and the log, so
 * Given-state setup never pollutes the log a test later inspects.
 *
 * Failure injection: fake_storage_set_rename_should_fail simulates a rename
 * failure partway through an install; fake_storage_set_free_bytes simulates
 * SD capacity; fake_storage_set_unmounted simulates a missing/unmounted SD
 * card, failing every call.
 */
#ifndef FAKE_STORAGE_H
#define FAKE_STORAGE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "odk_installer.h"

#define FAKE_STORAGE_MAX_ENTRIES 64
#define FAKE_STORAGE_MAX_OPS 128
#define FAKE_STORAGE_PATH_LEN 200

typedef enum {
    FAKE_STORAGE_OP_MKDIR_P,
    FAKE_STORAGE_OP_WRITE_FILE,
    FAKE_STORAGE_OP_READ_FILE,
    FAKE_STORAGE_OP_RENAME,
    FAKE_STORAGE_OP_REMOVE_TREE,
    FAKE_STORAGE_OP_FREE_BYTES,
    FAKE_STORAGE_OP_SIZE_BYTES,
    FAKE_STORAGE_OP_EXISTS,
} fake_storage_op_kind_t;

typedef struct {
    fake_storage_op_kind_t kind;
    char path[FAKE_STORAGE_PATH_LEN];
    char path2[FAKE_STORAGE_PATH_LEN]; /* rename destination; empty for every other op kind */
    odk_err_t result;
} fake_storage_op_t;

typedef struct {
    char path[FAKE_STORAGE_PATH_LEN];
    bool is_dir;
    bool present;
    uint8_t *data;
    size_t len;
} fake_storage_entry_t;

typedef struct {
    fake_storage_entry_t entries[FAKE_STORAGE_MAX_ENTRIES];
    fake_storage_op_t ops[FAKE_STORAGE_MAX_OPS];
    size_t n_ops;
    uint64_t free_bytes;
    bool rename_should_fail;
    bool unmounted;
} fake_storage_t;

void fake_storage_reset(fake_storage_t *fake);
void fake_storage_set_free_bytes(fake_storage_t *fake, uint64_t bytes);
void fake_storage_set_rename_should_fail(fake_storage_t *fake, bool fail);
void fake_storage_set_unmounted(fake_storage_t *fake, bool unmounted);

/* Given-state setup: writes directly into the tree, bypassing both the port
 * and the operation log, and overwriting any existing entry at path. */
bool fake_storage_seed_file(fake_storage_t *fake, const char *path,
                             const void *data, size_t len);

/* Then-state read-back; *data_out aliases the fake's own buffer. */
bool fake_storage_read(const fake_storage_t *fake, const char *path,
                        const uint8_t **data_out, size_t *len_out);
/* True for an exact file/dir entry, or a directory implied by a descendant
 * entry's path (matches the port's own exists() semantics). */
bool fake_storage_has(const fake_storage_t *fake, const char *path);

size_t fake_storage_op_count(const fake_storage_t *fake);
const fake_storage_op_t *fake_storage_op_at(const fake_storage_t *fake, size_t index);

/* True if any mkdir_p/write_file/rename/remove_tree call was ever made
 * through the port ("zero residue" on a rejected install). */
bool fake_storage_any_mutating_op(const fake_storage_t *fake);

/* True if any mutating call's source or destination path is exactly
 * path_prefix or nested under it. */
bool fake_storage_op_log_touches(const fake_storage_t *fake, const char *path_prefix);

extern const odk_storage_port_t fake_storage_port;

#endif /* FAKE_STORAGE_H */
