/*
 * odk_sub.c — subscription snapshot store + refresh flag (host-testable core).
 *
 * See odk_sub.h for the contract. The object is a thin wrapper over the
 * injected string port: the snapshot lives under the "snapshot" key, the
 * refresh flag under "refresh" ("1" pending, absent otherwise). Field lookup
 * scans the single-line snapshot for a "key=" token and copies the value up
 * to whitespace, so the launcher never needs a JSON parser.
 */
#include "odk_sub.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ODK_SUB_KEY_SNAPSHOT "snapshot"
#define ODK_SUB_KEY_REFRESH  "refresh"
#define ODK_SUB_REFRESH_PENDING "1"

struct odk_sub {
    const odk_sub_port_t *port;
    void *port_ctx;
    char snapshot[ODK_SUB_SNAPSHOT_MAX];
    bool has_snapshot;
    bool needs_refresh;
};

odk_sub_t *odk_sub_create(const odk_sub_port_t *port, void *port_ctx)
{
    if (port == NULL || port->get_str == NULL || port->set_str == NULL) {
        return NULL;
    }
    odk_sub_t *s = (odk_sub_t *)calloc(1, sizeof(*s));
    if (s == NULL) {
        return NULL;
    }
    s->port = port;
    s->port_ctx = port_ctx;

    /* Hydrate in-memory snapshot cache from persistent storage at boot so field
     * lookups never open NVS handles or heap-allocate on the Lua event loop. */
    if (s->port->get_str(s->port_ctx, ODK_SUB_KEY_SNAPSHOT, s->snapshot, sizeof(s->snapshot)) &&
        s->snapshot[0] != '\0') {
        s->has_snapshot = true;
    }
    char ref[ODK_SUB_FIELD_MAX];
    if (s->port->get_str(s->port_ctx, ODK_SUB_KEY_REFRESH, ref, sizeof(ref)) &&
        strcmp(ref, ODK_SUB_REFRESH_PENDING) == 0) {
        s->needs_refresh = true;
    }
    return s;
}

void odk_sub_delete(odk_sub_t *s)
{
    free(s);
}

odk_err_t odk_sub_set_snapshot(odk_sub_t *s, const char *snapshot)
{
    if (s == NULL || snapshot == NULL) {
        return ODK_ERR_INVALID_ARG;
    }
    size_t len = strlen(snapshot);
    if (len == 0 || len >= ODK_SUB_SNAPSHOT_MAX) {
        return ODK_ERR_INVALID_ARG;
    }

    memcpy(s->snapshot, snapshot, len + 1);
    s->has_snapshot = true;
    s->needs_refresh = false;

    s->port->set_str(s->port_ctx, ODK_SUB_KEY_SNAPSHOT, s->snapshot);
    s->port->set_str(s->port_ctx, ODK_SUB_KEY_REFRESH, "");
    return ODK_OK;
}

odk_err_t odk_sub_get_snapshot(odk_sub_t *s, char *out, size_t outlen)
{
    if (s == NULL || out == NULL || outlen == 0) {
        return ODK_ERR_INVALID_ARG;
    }
    if (!s->has_snapshot) {
        return ODK_ERR_NOT_FOUND;
    }
    size_t len = strlen(s->snapshot);
    size_t copy = len < outlen - 1 ? len : outlen - 1;
    memcpy(out, s->snapshot, copy);
    out[copy] = '\0';
    return ODK_OK;
}

bool odk_sub_has_snapshot(odk_sub_t *s)
{
    return s != NULL && s->has_snapshot;
}

bool odk_sub_get_field(odk_sub_t *s, const char *key, char *out, size_t outlen)
{
    if (s == NULL || !s->has_snapshot || key == NULL || key[0] == '\0' || out == NULL || outlen == 0) {
        return false;
    }

    const char *snapshot = s->snapshot;
    size_t keylen = strlen(key);
    const char *p = snapshot;
    while ((p = strstr(p, key)) != NULL) {
        /* "key" must be a whole token, not a substring: preceded by start or
         * whitespace, followed by '='. */
        bool at_start = (p == snapshot);
        bool prev_ws = !at_start && (p[-1] == ' ' || p[-1] == '\t' || p[-1] == '\n');
        if ((at_start || prev_ws) && p[keylen] == '=') {
            const char *v = p + keylen + 1;
            size_t vlen = 0;
            while (v[vlen] != '\0' && v[vlen] != ' ' && v[vlen] != '\t' && v[vlen] != '\n') {
                vlen++;
            }
            if (vlen == 0) {
                return false; /* key= present but empty value */
            }
            size_t copy = vlen < outlen - 1 ? vlen : outlen - 1;
            memcpy(out, v, copy);
            out[copy] = '\0';
            return true;
        }
        p += keylen;
    }
    return false;
}

odk_err_t odk_sub_request_fresh(odk_sub_t *s)
{
    if (s == NULL) {
        return ODK_ERR_INVALID_ARG;
    }
    s->needs_refresh = true;
    s->port->set_str(s->port_ctx, ODK_SUB_KEY_REFRESH, ODK_SUB_REFRESH_PENDING);
    return ODK_OK;
}

bool odk_sub_needs_refresh(odk_sub_t *s)
{
    return s != NULL && s->needs_refresh;
}
