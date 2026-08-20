/*
 * odk_sub.h — host-pushed subscription snapshot store + refresh flag
 * (Homepage/#2 real OpenCode Go usage).
 *
 * The launcher's quota page used to render simulated placeholders
 * (simulated_claude_quota / kv-backed ark_*). This component replaces that
 * with a real, host-pushed snapshot: a Mac-side bridge fetches the user's
 * OpenCode Go usage from opencode.ai (session cookie in the macOS Keychain)
 * and pushes a flat "key=value key=value" snapshot over the USB serial
 * console. The device stores the snapshot and serves individual fields to
 * the Lua shell via odk_sub_get_field. A separate "refresh" flag lets the
 * launcher ask the host for fresh data when Homepage #2 is opened ("pull on
 * screen open" model).
 *
 * Storage (strings, the u32-only odk_kv port cannot hold a snapshot) is an
 * injected port — NVS on target (src/port_idf/sub_nvs.c), an in-memory map
 * in host tests. This core is pure C with no IDF include, so it compiles and
 * is fully exercisable on the host harness like its sibling components.
 */
#ifndef ODK_SUB_H
#define ODK_SUB_H

#include <stdbool.h>
#include <stddef.h>

#include "odk_err.h"

/* String-capable key/value store. Real target: NVS. Host tests: an in-memory
 * string map (fake_sub). */
typedef struct {
    bool (*get_str)(void *ctx, const char *key, char *out, size_t outlen);
    void (*set_str)(void *ctx, const char *key, const char *value);
} odk_sub_port_t;

typedef struct odk_sub odk_sub_t;

/* Snapshot + value limits. The snapshot is a single-line "k=v k=v ..." blob
 * (no newlines — it must survive one esp_console line); fields are small. */
#define ODK_SUB_SNAPSHOT_MAX 1024
#define ODK_SUB_FIELD_MAX 64

odk_sub_t *odk_sub_create(const odk_sub_port_t *port, void *port_ctx);
void odk_sub_delete(odk_sub_t *s);

/* Store a host-pushed snapshot (single-line "k=v k=v ...") and clear the
 * pending-refresh flag. ODK_ERR_INVALID_ARG if snapshot is NULL, empty, or
 * longer than ODK_SUB_SNAPSHOT_MAX. */
odk_err_t odk_sub_set_snapshot(odk_sub_t *s, const char *snapshot);

/* Copy the stored snapshot verbatim into out (NUL-terminated). Returns
 * ODK_OK when a snapshot is present, else ODK_ERR_NOT_FOUND. */
odk_err_t odk_sub_get_snapshot(odk_sub_t *s, char *out, size_t outlen);

/* Field lookup: the value of the "key=" token in the stored snapshot, copied
 * into out (NUL-terminated, truncated to outlen-1). Returns true when the
 * field exists; false otherwise (out untouched). Field terminators are
 * whitespace and end-of-blob, so both "k=v k=w" and "k=v\nk=w" snapshots
 * parse. */
bool odk_sub_get_field(odk_sub_t *s, const char *key, char *out, size_t outlen);

/* True while a snapshot is stored (even a stale one). */
bool odk_sub_has_snapshot(odk_sub_t *s);

/* Set the pending-refresh flag: the screen is asking the host bridge for a
 * fresh push. */
odk_err_t odk_sub_request_fresh(odk_sub_t *s);

/* True while a refresh is pending (set by request_fresh, cleared by
 * set_snapshot). */
bool odk_sub_needs_refresh(odk_sub_t *s);

#endif /* ODK_SUB_H */
