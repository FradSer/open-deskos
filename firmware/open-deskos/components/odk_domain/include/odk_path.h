/*
 * odk_path.h — FR-19/20: reject unsafe input, never sanitize it.
 *
 * An app_id or file path that fails these checks makes the whole package
 * ineligible. Nothing here rewrites ".." into a safe form; it only classifies.
 */
#ifndef ODK_PATH_H
#define ODK_PATH_H

#include <stdbool.h>

#define ODK_APP_ID_LEN 33

/* ^[a-z0-9_-]{1,32}$ */
bool odk_app_id_valid(const char *id);

/* Rejects "..", a leading "/", and "\". */
bool odk_rel_path_safe(const char *rel_path);

#endif /* ODK_PATH_H */
