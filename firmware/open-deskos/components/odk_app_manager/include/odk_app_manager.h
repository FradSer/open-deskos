/*
 * odk_app_manager.h — canonical Open DeskOS App lifecycle.
 *
 * The manager is the single owner of App state transitions. Runtime details
 * (Lua, LVGL, or a headless worker) stay behind the injected Runtime port.
 * UI runtimes must execute on the LVGL owner task; Service runtimes may be
 * ticked by the composition root's worker but must release their runtime from
 * stop/destroy.
 */
#ifndef ODK_APP_MANAGER_H
#define ODK_APP_MANAGER_H

#include <stddef.h>

#include "odk_err.h"
#include "odk_path.h"

#ifdef __cplusplus
extern "C" {
#endif

#define ODK_APP_MANAGER_MAX_INSTANCES 8
#define ODK_APP_MANAGER_TICK_FAILURE_LIMIT 3

typedef enum {
    ODK_APP_KIND_UI = 0,
    ODK_APP_KIND_SERVICE,
} odk_app_kind_t;

typedef enum {
    ODK_APP_STATE_INSTALLED = 0,
    ODK_APP_STATE_STARTING,
    ODK_APP_STATE_RUNNING,
    ODK_APP_STATE_PAUSED,
    ODK_APP_STATE_RESUMING,
    ODK_APP_STATE_STOPPING,
    ODK_APP_STATE_STOPPED,
    ODK_APP_STATE_ERROR,
} odk_app_state_t;

typedef struct {
    char app_id[ODK_APP_ID_LEN];
    odk_app_kind_t kind;
} odk_app_descriptor_t;

typedef struct {
    odk_err_t (*start)(void *ctx, const odk_app_descriptor_t *app, void **runtime);
    odk_err_t (*pause)(void *ctx, void *runtime);
    odk_err_t (*resume)(void *ctx, void *runtime);
    odk_err_t (*tick)(void *ctx, void *runtime);
    odk_err_t (*stop)(void *ctx, void *runtime);
    void (*destroy)(void *ctx, void *runtime);
} odk_app_runtime_port_t;

typedef struct {
    size_t max_instances;
    const odk_app_runtime_port_t *runtime;
    void *runtime_ctx;
} odk_app_manager_config_t;

typedef struct odk_app_manager odk_app_manager_t;

odk_app_manager_t *odk_app_manager_create(const odk_app_manager_config_t *config);
odk_err_t odk_app_manager_register(odk_app_manager_t *manager,
                                     const odk_app_descriptor_t *app);
odk_err_t odk_app_manager_unregister(odk_app_manager_t *manager, const char *app_id);
odk_err_t odk_app_manager_start(odk_app_manager_t *manager, const char *app_id);
odk_err_t odk_app_manager_pause(odk_app_manager_t *manager, const char *app_id);
odk_err_t odk_app_manager_resume(odk_app_manager_t *manager, const char *app_id);
odk_err_t odk_app_manager_stop(odk_app_manager_t *manager, const char *app_id);
odk_err_t odk_app_manager_tick(odk_app_manager_t *manager);

odk_app_state_t odk_app_manager_state(const odk_app_manager_t *manager,
                                        const char *app_id);
const char *odk_app_manager_active_ui(const odk_app_manager_t *manager);
size_t odk_app_manager_live_count(const odk_app_manager_t *manager);

void odk_app_manager_destroy(odk_app_manager_t *manager);

#ifdef __cplusplus
}
#endif

#endif /* ODK_APP_MANAGER_H */
