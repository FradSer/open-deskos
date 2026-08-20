#include "odk_semver.h"

#include <limits.h>
#include <string.h>

/* Ten digits is enough to hold INT_MAX (2147483647); anything longer is
 * rejected before it ever risks overflowing the long long accumulator. */
#define MAX_COMPONENT_DIGITS 10

static odk_err_t parse_component(const char *s, size_t len, int *out)
{
    if (len == 0 || len > MAX_COMPONENT_DIGITS) {
        return ODK_ERR_BAD_SEMVER;
    }

    long long val = 0;
    for (size_t i = 0; i < len; i++) {
        char c = s[i];
        if (c < '0' || c > '9') {
            return ODK_ERR_BAD_SEMVER;
        }
        val = val * 10 + (c - '0');
    }

    if (val > INT_MAX) {
        return ODK_ERR_BAD_SEMVER;
    }

    *out = (int)val;
    return ODK_OK;
}

odk_err_t odk_semver_parse(const char *s, odk_semver_t *out)
{
    if (s == NULL || out == NULL || s[0] == '\0') {
        return ODK_ERR_BAD_SEMVER;
    }

    const char *first_dot = strchr(s, '.');
    if (first_dot == NULL) {
        return ODK_ERR_BAD_SEMVER;
    }
    const char *second_dot = strchr(first_dot + 1, '.');
    if (second_dot == NULL) {
        return ODK_ERR_BAD_SEMVER;
    }
    /* Exactly two dots: a third would split off a fourth component. */
    if (strchr(second_dot + 1, '.') != NULL) {
        return ODK_ERR_BAD_SEMVER;
    }

    odk_semver_t v;
    odk_err_t err;

    err = parse_component(s, (size_t)(first_dot - s), &v.major);
    if (err != ODK_OK) {
        return err;
    }
    err = parse_component(first_dot + 1, (size_t)(second_dot - first_dot - 1), &v.minor);
    if (err != ODK_OK) {
        return err;
    }
    err = parse_component(second_dot + 1, strlen(second_dot + 1), &v.patch);
    if (err != ODK_OK) {
        return err;
    }

    *out = v;
    return ODK_OK;
}

/* -1 if a<b, 0 if a==b, 1 if a>b. */
static int compare_semver(const odk_semver_t *a, const odk_semver_t *b)
{
    if (a->major != b->major) {
        return a->major < b->major ? -1 : 1;
    }
    if (a->minor != b->minor) {
        return a->minor < b->minor ? -1 : 1;
    }
    if (a->patch != b->patch) {
        return a->patch < b->patch ? -1 : 1;
    }
    return 0;
}

static const char *skip_spaces(const char *s)
{
    while (*s == ' ') {
        s++;
    }
    return s;
}

/* Recognizes ">=", "<=", "=", ">", "<", "^"; writes the matched operator into
 * op (NUL-terminated) and returns a pointer to the version text that follows
 * it, or NULL if no known operator is found at *s. */
static const char *match_operator(const char *s, char op[3])
{
    if (s[0] == '>' && s[1] == '=') {
        op[0] = '>';
        op[1] = '=';
        op[2] = '\0';
        return s + 2;
    }
    if (s[0] == '<' && s[1] == '=') {
        op[0] = '<';
        op[1] = '=';
        op[2] = '\0';
        return s + 2;
    }
    if (s[0] == '>' || s[0] == '<' || s[0] == '=' || s[0] == '^') {
        op[0] = s[0];
        op[1] = '\0';
        return s + 1;
    }
    return NULL;
}

odk_err_t odk_semver_constraints_parse(const char *s, odk_semver_constraint_t *out,
                                          size_t max, size_t *n)
{
    if (s == NULL || out == NULL || n == NULL) {
        return ODK_ERR_BAD_SEMVER;
    }

    *n = 0;
    const char *cursor = s;

    while (1) {
        cursor = skip_spaces(cursor);
        if (*cursor == '\0') {
            break;
        }

        char op[3];
        const char *version_start = match_operator(cursor, op);
        if (version_start == NULL) {
            return ODK_ERR_BAD_SEMVER;
        }
        version_start = skip_spaces(version_start);

        const char *token_end = strchr(version_start, ',');
        size_t version_len = token_end != NULL
                                  ? (size_t)(token_end - version_start)
                                  : strlen(version_start);
        /* Trim trailing spaces from the version token. */
        while (version_len > 0 && version_start[version_len - 1] == ' ') {
            version_len--;
        }
        if (version_len == 0 || version_len >= 32) {
            return ODK_ERR_BAD_SEMVER;
        }

        char version_buf[32];
        memcpy(version_buf, version_start, version_len);
        version_buf[version_len] = '\0';

        odk_semver_t v;
        odk_err_t err = odk_semver_parse(version_buf, &v);
        if (err != ODK_OK) {
            return err;
        }

        if (*n >= max) {
            return ODK_ERR_BAD_SEMVER;
        }
        strcpy(out[*n].op, op);
        out[*n].v = v;
        (*n)++;

        if (token_end == NULL) {
            break;
        }
        cursor = token_end + 1;
    }

    if (*n == 0) {
        return ODK_ERR_BAD_SEMVER;
    }

    return ODK_OK;
}

static bool satisfies_one(const odk_semver_t *v, const odk_semver_constraint_t *c)
{
    int cmp = compare_semver(v, &c->v);

    if (strcmp(c->op, ">=") == 0) {
        return cmp >= 0;
    }
    if (strcmp(c->op, "<=") == 0) {
        return cmp <= 0;
    }
    if (strcmp(c->op, ">") == 0) {
        return cmp > 0;
    }
    if (strcmp(c->op, "<") == 0) {
        return cmp < 0;
    }
    if (strcmp(c->op, "=") == 0) {
        return cmp == 0;
    }
    if (strcmp(c->op, "^") == 0) {
        /* Caret range: compatible-with, holding the leftmost non-zero
         * component fixed. With major>0 this is [c.v, next-major). */
        if (cmp < 0) {
            return false;
        }
        return v->major == c->v.major;
    }

    return false;
}

bool odk_semver_satisfies(const odk_semver_t *v,
                            const odk_semver_constraint_t *c, size_t n)
{
    if (v == NULL || (c == NULL && n > 0)) {
        return false;
    }

    for (size_t i = 0; i < n; i++) {
        if (!satisfies_one(v, &c[i])) {
            return false;
        }
    }

    return true;
}
