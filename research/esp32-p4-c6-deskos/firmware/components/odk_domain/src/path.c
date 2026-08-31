#include "odk_path.h"

#include <string.h>

bool odk_app_id_valid(const char *id)
{
    if (id == NULL) {
        return false;
    }

    size_t len = strlen(id);
    if (len < 1 || len > 32) {
        return false;
    }

    for (size_t i = 0; i < len; i++) {
        char c = id[i];
        bool is_lower = (c >= 'a' && c <= 'z');
        bool is_digit = (c >= '0' && c <= '9');
        bool is_sep = (c == '_' || c == '-');
        if (!is_lower && !is_digit && !is_sep) {
            return false;
        }
    }

    return true;
}

bool odk_rel_path_safe(const char *rel_path)
{
    if (rel_path == NULL || rel_path[0] == '\0') {
        return false;
    }

    if (rel_path[0] == '/') {
        return false;
    }

    if (strchr(rel_path, '\\') != NULL) {
        return false;
    }

    /* Reject empty, ".", and ".." path segments. This keeps the path
     * canonical without silently rewriting untrusted input. */
    const char *segment = rel_path;
    for (const char *p = rel_path;; p++) {
        if (*p != '/' && *p != '\0') {
            continue;
        }
        size_t segment_len = (size_t)(p - segment);
        if (segment_len == 0 ||
            (segment_len == 1 && segment[0] == '.') ||
            (segment_len == 2 && segment[0] == '.' && segment[1] == '.')) {
            return false;
        }
        if (*p == '\0') {
            break;
        }
        segment = p + 1;
    }

    return true;
}
