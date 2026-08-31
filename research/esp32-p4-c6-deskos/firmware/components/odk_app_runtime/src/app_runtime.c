#include "odk_app_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define ODK_APP_RUNTIME_ERRBUF_LEN 160
#define ODK_APP_RUNTIME_WRAPPER_EXTRA 512

typedef struct {
    odk_sandbox_t *sandbox;
    unsigned char *pool;
} app_runtime_instance_t;

struct odk_app_runtime {
    const odk_app_source_port_t *source;
    void *source_ctx;
    odk_sandbox_limits_t sandbox_limits;
    odk_app_runtime_port_t port;
};

static odk_err_t call_callback(app_runtime_instance_t *instance, const char *name)
{
    char error[ODK_APP_RUNTIME_ERRBUF_LEN];
    return odk_sandbox_call(instance->sandbox, name, error, sizeof(error));
}

static odk_err_t runtime_start(void *ctx, const odk_app_descriptor_t *app, void **runtime)
{
    odk_app_runtime_t *factory = ctx;
    app_runtime_instance_t *instance = NULL;
    char source[ODK_APP_RUNTIME_SOURCE_LEN];
    size_t source_len = 0;
    if (factory == NULL || app == NULL || runtime == NULL) {
        return ODK_ERR_INVALID_MANIFEST;
    }
    if (!odk_app_id_valid(app->app_id)) {
        return ODK_ERR_BAD_APP_ID;
    }
    if (app->kind != ODK_APP_KIND_UI && app->kind != ODK_APP_KIND_SERVICE) {
        return ODK_ERR_INVALID_MANIFEST;
    }

    odk_err_t err = factory->source->read_file(factory->source_ctx, app->app_id,
                                                ODK_APP_RUNTIME_ENTRY, source,
                                                sizeof(source) - 1, &source_len);
    if (err != ODK_OK) {
        return err;
    }
    if (source_len >= sizeof(source)) {
        return ODK_ERR_STORAGE;
    }
    source[source_len] = '\0';

    instance = calloc(1, sizeof(*instance));
    if (instance == NULL) {
        return ODK_ERR_OOM;
    }
    instance->pool = malloc(factory->sandbox_limits.pool_size);
    if (instance->pool == NULL) {
        free(instance);
        return ODK_ERR_OOM;
    }
    odk_sandbox_limits_t limits = factory->sandbox_limits;
    limits.pool = instance->pool;
    instance->sandbox = odk_sandbox_create(&limits, NULL, 0, NULL);
    if (instance->sandbox == NULL) {
        free(instance->pool);
        free(instance);
        return ODK_ERR_OOM;
    }

    size_t wrapper_len = source_len + ODK_APP_RUNTIME_WRAPPER_EXTRA + ODK_APP_ID_LEN;
    char *wrapper = malloc(wrapper_len);
    if (wrapper == NULL) {
        odk_sandbox_destroy(instance->sandbox);
        free(instance->pool);
        free(instance);
        return ODK_ERR_OOM;
    }
    int written = snprintf(wrapper, wrapper_len,
        "local __app = (function()\n%s\nend)()\n"
        "local __ctx = { app_id = \"%s\" }\n"
        "function on_start() return __app.on_start(__ctx) end\n"
        "function on_pause() if __app.on_pause then return __app.on_pause(__ctx) end end\n"
        "function on_resume() if __app.on_resume then return __app.on_resume(__ctx) end end\n"
        "function on_tick() if __app.on_tick then return __app.on_tick(__ctx) end end\n"
        "function on_stop() if __app.on_stop then return __app.on_stop(__ctx) end end\n",
        source, app->app_id);
    if (written < 0 || (size_t)written >= wrapper_len) {
        free(wrapper);
        odk_sandbox_destroy(instance->sandbox);
        free(instance->pool);
        free(instance);
        return ODK_ERR_SANDBOX_VIOLATION;
    }

    err = odk_sandbox_load_source(instance->sandbox, wrapper, (size_t)written,
                                   ODK_APP_RUNTIME_ENTRY);
    free(wrapper);
    if (err == ODK_OK) {
        err = call_callback(instance, "on_start");
    }
    if (err != ODK_OK) {
        odk_sandbox_destroy(instance->sandbox);
        free(instance->pool);
        free(instance);
        return err;
    }
    *runtime = instance;
    return ODK_OK;
}

static odk_err_t runtime_pause(void *ctx, void *runtime)
{
    (void)ctx;
    return call_callback(runtime, "on_pause");
}

static odk_err_t runtime_resume(void *ctx, void *runtime)
{
    (void)ctx;
    return call_callback(runtime, "on_resume");
}

static odk_err_t runtime_tick(void *ctx, void *runtime)
{
    (void)ctx;
    return call_callback(runtime, "on_tick");
}

static odk_err_t runtime_stop(void *ctx, void *runtime)
{
    (void)ctx;
    return call_callback(runtime, "on_stop");
}

static void runtime_destroy(void *ctx, void *runtime)
{
    (void)ctx;
    app_runtime_instance_t *instance = runtime;
    if (instance == NULL) {
        return;
    }
    odk_sandbox_destroy(instance->sandbox);
    free(instance->pool);
    free(instance);
}

odk_app_runtime_t *odk_app_runtime_create(const odk_app_runtime_config_t *config)
{
    if (config == NULL || config->source == NULL || config->source->read_file == NULL ||
        config->sandbox_limits.pool_size == 0) {
        return NULL;
    }
    odk_app_runtime_t *runtime = calloc(1, sizeof(*runtime));
    if (runtime == NULL) {
        return NULL;
    }
    runtime->source = config->source;
    runtime->source_ctx = config->source_ctx;
    runtime->sandbox_limits = config->sandbox_limits;
    runtime->port = (odk_app_runtime_port_t){
        .start = runtime_start,
        .pause = runtime_pause,
        .resume = runtime_resume,
        .tick = runtime_tick,
        .stop = runtime_stop,
        .destroy = runtime_destroy,
    };
    return runtime;
}

const odk_app_runtime_port_t *odk_app_runtime_port(const odk_app_runtime_t *runtime)
{
    return runtime != NULL ? &runtime->port : NULL;
}

void odk_app_runtime_destroy(odk_app_runtime_t *runtime)
{
    free(runtime);
}
