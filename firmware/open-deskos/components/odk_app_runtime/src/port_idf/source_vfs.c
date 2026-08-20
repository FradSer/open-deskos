#include "odk_app_runtime_ports_idf.h"

#include <stdio.h>

#include "odk_path.h"

void odk_app_source_idf_ctx_init(odk_app_source_idf_ctx_t *ctx,
                                  const char *app_root)
{
    if (ctx == NULL) {
        return;
    }
    snprintf(ctx->app_root, sizeof(ctx->app_root), "%s", app_root != NULL ? app_root : "");
}

static odk_err_t source_read_file(void *ctx, const char *app_id, const char *rel_path,
                                   char *buf, size_t buflen, size_t *outlen)
{
    odk_app_source_idf_ctx_t *source = ctx;
    char path[192];
    if (source == NULL || !odk_app_id_valid(app_id)) {
        return ODK_ERR_BAD_APP_ID;
    }
    if (!odk_rel_path_safe(rel_path)) {
        return ODK_ERR_PATH_UNSAFE;
    }
    if (buf == NULL || outlen == NULL || buflen == 0) {
        return ODK_ERR_INVALID_MANIFEST;
    }
    int written = snprintf(path, sizeof(path), "%s/%s/%s", source->app_root, app_id, rel_path);
    if (written < 0 || (size_t)written >= sizeof(path)) {
        return ODK_ERR_PATH_UNSAFE;
    }
    FILE *file = fopen(path, "rb");
    if (file == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    size_t n = fread(buf, 1, buflen, file);
    int error = ferror(file);
    fclose(file);
    if (error != 0 || n == buflen) {
        return ODK_ERR_STORAGE;
    }
    if (outlen != NULL) {
        *outlen = n;
    }
    return ODK_OK;
}

const odk_app_source_port_t odk_app_source_port_idf = {
    .read_file = source_read_file,
};
