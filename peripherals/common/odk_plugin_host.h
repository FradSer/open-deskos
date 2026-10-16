/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

#define ODK_PLUGIN_MAX_COUNT 16
#define ODK_PLUGIN_MAX_PORTS 8

typedef enum {
    ODK_KIND_DEVICE_DRIVER, ODK_KIND_TRANSPORT, ODK_KIND_PROCESSOR,
    ODK_KIND_SERVICE, ODK_KIND_SURFACE, ODK_KIND_PROTOCOL,
} odk_plugin_kind_t;

typedef struct { const char *interface_uri; bool optional; } odk_port_desc_t;
typedef struct {
    esp_err_t (*init)(void *context, const void *config);
    esp_err_t (*start)(void);
    esp_err_t (*stop)(void);
    esp_err_t (*destroy)(void);
} odk_plugin_lifecycle_t;
typedef struct {
    const char *id;
    const char *name;
    uint32_t version;
    odk_plugin_kind_t kind;
    const odk_plugin_lifecycle_t *lifecycle;
    size_t provides_count;
    const odk_port_desc_t *provides;
    size_t requires_count;
    const odk_port_desc_t *requires;
    const char *host;
    const char *manifest_json;
} odk_plugin_descriptor_t;
typedef enum {
    ODK_PLUGIN_REGISTERED, ODK_PLUGIN_STARTING, ODK_PLUGIN_RUNNING,
    ODK_PLUGIN_STOPPED, ODK_PLUGIN_DISABLED, ODK_PLUGIN_BLOCKED, ODK_PLUGIN_FAILED,
} odk_plugin_state_t;
struct odk_plugin_host;
typedef struct { struct odk_plugin_host *host; size_t index; } odk_plugin_context_t;
typedef struct {
    odk_plugin_context_t context;
    odk_plugin_state_t state;
    esp_err_t error;
    bool enabled;
    bool owned;
    bool stop_done;
    bool destroy_done;
    bool releasing;
    void *ports[ODK_PLUGIN_MAX_PORTS];
} odk_plugin_record_t;
typedef struct odk_plugin_host {
    const odk_plugin_descriptor_t *descriptors;
    const void *const *configs;
    size_t count;
    size_t order[ODK_PLUGIN_MAX_COUNT];
    odk_plugin_record_t records[ODK_PLUGIN_MAX_COUNT];
    bool running;
    bool transition;
} odk_plugin_host_t;

typedef struct {
    const char *id;
    const char *name;
    uint32_t version;
    odk_plugin_kind_t kind;
    odk_plugin_state_t state;
    bool enabled;
    bool owns_resources;
    bool stop_completed;
    bool destroy_completed;
} odk_plugin_snapshot_t;

/* Call lifecycle operations from one owner task. Factories are trusted C code. */
esp_err_t odk_plugin_host_init(odk_plugin_host_t *host,
    const odk_plugin_descriptor_t *descriptors, size_t count, const void *const *configs);
esp_err_t odk_plugin_host_start(odk_plugin_host_t *host);
esp_err_t odk_plugin_host_stop(odk_plugin_host_t *host);
esp_err_t odk_plugin_host_set_enabled(odk_plugin_host_t *host, const char *id, bool enabled);
void *odk_plugin_get(void *context, const char *interface_uri);
esp_err_t odk_plugin_publish(void *context, const char *interface_uri, void *value);

void *odk_plugin_host_port(odk_plugin_host_t *host, const char *interface_uri);
/* Owner task only, between lifecycle operations. Strings borrow immutable descriptors.
 * Insufficient capacity sets count to the required size without writing rows.
 * Other failures set count to zero. NULL rows with zero capacity queries size. */
esp_err_t odk_plugin_host_snapshot(const odk_plugin_host_t *host,
    odk_plugin_snapshot_t *rows, size_t capacity, size_t *count);

/* Serialize generated public manifests only, from the owner task between operations.
 * Size excludes the terminating NUL. Capacity must include it. Failures leave output unchanged.
 * NULL output with zero capacity queries size. Reports are limited to 16 KiB. */
esp_err_t odk_plugin_host_report_json(const odk_plugin_host_t *host, const char *host_id,
    char *output, size_t capacity, size_t *size);
