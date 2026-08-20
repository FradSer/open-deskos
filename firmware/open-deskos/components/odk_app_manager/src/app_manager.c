#include "odk_app_manager.h"

#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    bool registered;
    odk_app_descriptor_t descriptor;
    odk_app_state_t state;
    void *runtime;
    unsigned int consecutive_tick_failures;
} app_slot_t;

struct odk_app_manager {
    size_t max_instances;
    const odk_app_runtime_port_t *runtime;
    void *runtime_ctx;
    app_slot_t slots[ODK_APP_MANAGER_MAX_INSTANCES];
    char active_ui[ODK_APP_ID_LEN];
};

static app_slot_t *find_slot(odk_app_manager_t *manager, const char *app_id)
{
    for (size_t i = 0; i < manager->max_instances; i++) {
        if (manager->slots[i].registered && strcmp(manager->slots[i].descriptor.app_id, app_id) == 0) {
            return &manager->slots[i];
        }
    }
    return NULL;
}

static const app_slot_t *find_slot_const(const odk_app_manager_t *manager, const char *app_id)
{
    for (size_t i = 0; i < manager->max_instances; i++) {
        if (manager->slots[i].registered && strcmp(manager->slots[i].descriptor.app_id, app_id) == 0) {
            return &manager->slots[i];
        }
    }
    return NULL;
}

static void clear_active_ui(odk_app_manager_t *manager, const char *app_id)
{
    if (strcmp(manager->active_ui, app_id) == 0) {
        manager->active_ui[0] = '\0';
    }
}

static void release_runtime(odk_app_manager_t *manager, app_slot_t *slot)
{
    if (slot->runtime != NULL && manager->runtime->destroy != NULL) {
        manager->runtime->destroy(manager->runtime_ctx, slot->runtime);
    }
    slot->runtime = NULL;
}

static void fail_and_release(odk_app_manager_t *manager, app_slot_t *slot)
{
    clear_active_ui(manager, slot->descriptor.app_id);
    release_runtime(manager, slot);
    slot->state = ODK_APP_STATE_ERROR;
    slot->consecutive_tick_failures = 0;
}

odk_app_manager_t *odk_app_manager_create(const odk_app_manager_config_t *config)
{
    if (config == NULL || config->runtime == NULL || config->runtime->start == NULL ||
        config->runtime->tick == NULL || config->runtime->destroy == NULL) {
        return NULL;
    }

    size_t max_instances = config->max_instances;
    if (max_instances == 0 || max_instances > ODK_APP_MANAGER_MAX_INSTANCES) {
        max_instances = ODK_APP_MANAGER_MAX_INSTANCES;
    }

    odk_app_manager_t *manager = calloc(1, sizeof(*manager));
    if (manager == NULL) {
        return NULL;
    }
    manager->max_instances = max_instances;
    manager->runtime = config->runtime;
    manager->runtime_ctx = config->runtime_ctx;
    return manager;
}

odk_err_t odk_app_manager_register(odk_app_manager_t *manager,
                                     const odk_app_descriptor_t *app)
{
    if (manager == NULL || app == NULL || !odk_app_id_valid(app->app_id) ||
        (app->kind != ODK_APP_KIND_UI && app->kind != ODK_APP_KIND_SERVICE)) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    app_slot_t *existing = find_slot(manager, app->app_id);
    if (existing != NULL) {
        if (existing->descriptor.kind != app->kind) {
            return ODK_ERR_EXISTS;
        }
        return ODK_OK;
    }

    for (size_t i = 0; i < manager->max_instances; i++) {
        app_slot_t *slot = &manager->slots[i];
        if (!slot->registered) {
            memset(slot, 0, sizeof(*slot));
            slot->registered = true;
            slot->descriptor = *app;
            slot->state = ODK_APP_STATE_INSTALLED;
            return ODK_OK;
        }
    }
    return ODK_ERR_STATE_QUOTA;
}

odk_err_t odk_app_manager_unregister(odk_app_manager_t *manager, const char *app_id)
{
    if (manager == NULL || app_id == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    app_slot_t *slot = find_slot(manager, app_id);
    if (slot == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    if (slot->state == ODK_APP_STATE_STARTING || slot->state == ODK_APP_STATE_RUNNING ||
        slot->state == ODK_APP_STATE_PAUSED || slot->state == ODK_APP_STATE_RESUMING ||
        slot->state == ODK_APP_STATE_STOPPING) {
        return ODK_ERR_STATE;
    }
    clear_active_ui(manager, app_id);
    release_runtime(manager, slot);
    memset(slot, 0, sizeof(*slot));
    return ODK_OK;
}

odk_err_t odk_app_manager_start(odk_app_manager_t *manager, const char *app_id)
{
    if (manager == NULL || app_id == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    app_slot_t *slot = find_slot(manager, app_id);
    if (slot == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    if (slot->state == ODK_APP_STATE_RUNNING || slot->state == ODK_APP_STATE_PAUSED) {
        return ODK_OK;
    }
    if (slot->state == ODK_APP_STATE_STARTING || slot->state == ODK_APP_STATE_STOPPING) {
        return ODK_ERR_STATE;
    }
    if (slot->descriptor.kind == ODK_APP_KIND_UI && manager->active_ui[0] != '\0' &&
        strcmp(manager->active_ui, app_id) != 0) {
        return ODK_ERR_DENIED;
    }

    slot->state = ODK_APP_STATE_STARTING;
    slot->runtime = NULL;
    odk_err_t err = manager->runtime->start(manager->runtime_ctx, &slot->descriptor, &slot->runtime);
    if (err != ODK_OK) {
        fail_and_release(manager, slot);
        return err;
    }
    slot->state = ODK_APP_STATE_RUNNING;
    slot->consecutive_tick_failures = 0;
    if (slot->descriptor.kind == ODK_APP_KIND_UI) {
        strncpy(manager->active_ui, app_id, sizeof(manager->active_ui) - 1);
        manager->active_ui[sizeof(manager->active_ui) - 1] = '\0';
    }
    return ODK_OK;
}

odk_err_t odk_app_manager_pause(odk_app_manager_t *manager, const char *app_id)
{
    if (manager == NULL || app_id == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    app_slot_t *slot = find_slot(manager, app_id);
    if (slot == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    if (slot->state != ODK_APP_STATE_RUNNING) {
        return ODK_ERR_STATE;
    }
    if (manager->runtime->pause != NULL) {
        odk_err_t err = manager->runtime->pause(manager->runtime_ctx, slot->runtime);
        if (err != ODK_OK) {
            fail_and_release(manager, slot);
            return err;
        }
    }
    slot->state = ODK_APP_STATE_PAUSED;
    return ODK_OK;
}

odk_err_t odk_app_manager_resume(odk_app_manager_t *manager, const char *app_id)
{
    if (manager == NULL || app_id == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    app_slot_t *slot = find_slot(manager, app_id);
    if (slot == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    if (slot->state != ODK_APP_STATE_PAUSED) {
        return ODK_ERR_STATE;
    }
    slot->state = ODK_APP_STATE_RESUMING;
    if (manager->runtime->resume != NULL) {
        odk_err_t err = manager->runtime->resume(manager->runtime_ctx, slot->runtime);
        if (err != ODK_OK) {
            fail_and_release(manager, slot);
            return err;
        }
    }
    slot->state = ODK_APP_STATE_RUNNING;
    slot->consecutive_tick_failures = 0;
    return ODK_OK;
}

odk_err_t odk_app_manager_stop(odk_app_manager_t *manager, const char *app_id)
{
    if (manager == NULL || app_id == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    app_slot_t *slot = find_slot(manager, app_id);
    if (slot == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    if (slot->state == ODK_APP_STATE_STOPPED || slot->state == ODK_APP_STATE_INSTALLED) {
        return ODK_OK;
    }

    slot->state = ODK_APP_STATE_STOPPING;
    odk_err_t err = ODK_OK;
    if (manager->runtime->stop != NULL && slot->runtime != NULL) {
        err = manager->runtime->stop(manager->runtime_ctx, slot->runtime);
    }
    clear_active_ui(manager, app_id);
    release_runtime(manager, slot);
    slot->consecutive_tick_failures = 0;
    slot->state = (err == ODK_OK) ? ODK_APP_STATE_STOPPED : ODK_APP_STATE_ERROR;
    return err;
}

odk_err_t odk_app_manager_tick(odk_app_manager_t *manager)
{
    if (manager == NULL) {
        return ODK_ERR_NOT_FOUND;
    }
    odk_err_t first_error = ODK_OK;
    for (size_t i = 0; i < manager->max_instances; i++) {
        app_slot_t *slot = &manager->slots[i];
        if (!slot->registered || slot->state != ODK_APP_STATE_RUNNING) {
            continue;
        }
        odk_err_t err = manager->runtime->tick(manager->runtime_ctx, slot->runtime);
        if (err == ODK_OK) {
            slot->consecutive_tick_failures = 0;
            continue;
        }
        if (first_error == ODK_OK) {
            first_error = err;
        }
        slot->consecutive_tick_failures++;
        if (slot->consecutive_tick_failures >= ODK_APP_MANAGER_TICK_FAILURE_LIMIT) {
            (void)odk_app_manager_stop(manager, slot->descriptor.app_id);
        }
    }
    return first_error;
}

odk_app_state_t odk_app_manager_state(const odk_app_manager_t *manager,
                                        const char *app_id)
{
    if (manager == NULL || app_id == NULL) {
        return ODK_APP_STATE_ERROR;
    }
    const app_slot_t *slot = find_slot_const(manager, app_id);
    return slot != NULL ? slot->state : ODK_APP_STATE_ERROR;
}

const char *odk_app_manager_active_ui(const odk_app_manager_t *manager)
{
    if (manager == NULL || manager->active_ui[0] == '\0') {
        return NULL;
    }
    return manager->active_ui;
}

size_t odk_app_manager_live_count(const odk_app_manager_t *manager)
{
    if (manager == NULL) {
        return 0;
    }
    size_t count = 0;
    for (size_t i = 0; i < manager->max_instances; i++) {
        odk_app_state_t state = manager->slots[i].state;
        if (manager->slots[i].registered &&
            (state == ODK_APP_STATE_STARTING || state == ODK_APP_STATE_RUNNING ||
             state == ODK_APP_STATE_PAUSED || state == ODK_APP_STATE_RESUMING ||
             state == ODK_APP_STATE_STOPPING)) {
            count++;
        }
    }
    return count;
}

void odk_app_manager_destroy(odk_app_manager_t *manager)
{
    if (manager == NULL) {
        return;
    }
    for (size_t i = 0; i < manager->max_instances; i++) {
        app_slot_t *slot = &manager->slots[i];
        if (!slot->registered) {
            continue;
        }
        if (slot->state != ODK_APP_STATE_INSTALLED && slot->state != ODK_APP_STATE_STOPPED &&
            slot->state != ODK_APP_STATE_ERROR) {
            (void)odk_app_manager_stop(manager, slot->descriptor.app_id);
        } else {
            release_runtime(manager, slot);
        }
    }
    free(manager);
}
