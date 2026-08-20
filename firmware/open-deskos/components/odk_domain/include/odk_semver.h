/*
 * odk_semver.h — strict semver (NFR-11).
 *
 * Deliberately does not port the LuaRocks version heuristics (which accept
 * strings like "scm" or "2.0beta3" as orderable versions). A package manifest
 * version that is not exactly MAJOR.MINOR.PATCH is rejected outright.
 */
#ifndef ODK_SEMVER_H
#define ODK_SEMVER_H

#include <stdbool.h>
#include <stddef.h>

#include "odk_err.h"

typedef struct {
    int major;
    int minor;
    int patch;
} odk_semver_t;

typedef struct {
    char op[3];
    odk_semver_t v;
} odk_semver_constraint_t;

odk_err_t odk_semver_parse(const char *s, odk_semver_t *out);

odk_err_t odk_semver_constraints_parse(const char *s, odk_semver_constraint_t *out,
                                          size_t max, size_t *n);

bool odk_semver_satisfies(const odk_semver_t *v,
                            const odk_semver_constraint_t *c, size_t n);

#endif /* ODK_SEMVER_H */
