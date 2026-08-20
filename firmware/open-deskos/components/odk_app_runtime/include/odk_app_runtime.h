/*
 * odk_app_runtime.h — package-backed implementation of the canonical App
 * Runtime port.
 *
 * App Manager owns lifecycle state and this adapter owns one sandbox/runtime
 * instance per live App. The adapter never creates an LVGL task and never
 * retains a stopped runtime.
 */
#ifndef ODK_APP_RUNTIME_H
#define ODK_APP_RUNTIME_H

#include <stddef.h>

#include "odk_app_manager.h"
#include "odk_sandbox.h"

#define ODK_APP_RUNTIME_ENTRY "app/main.lua"
#define ODK_APP_RUNTIME_SOURCE_LEN 8192

typedef struct {
    odk_err_t (*read_file)(void *ctx, const char *app_id, const char *rel_path,
                            char *buf, size_t buflen, size_t *outlen);
} odk_app_source_port_t;

typedef struct {
    const odk_app_source_port_t *source;
    void *source_ctx;
    odk_sandbox_limits_t sandbox_limits;
} odk_app_runtime_config_t;

typedef struct odk_app_runtime odk_app_runtime_t;

odk_app_runtime_t *odk_app_runtime_create(const odk_app_runtime_config_t *config);
const odk_app_runtime_port_t *odk_app_runtime_port(const odk_app_runtime_t *runtime);
void odk_app_runtime_destroy(odk_app_runtime_t *runtime);

#endif /* ODK_APP_RUNTIME_H */
