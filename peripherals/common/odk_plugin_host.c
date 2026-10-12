/* SPDX-License-Identifier: Apache-2.0 */
#include "odk_plugin_host.h"
#include <string.h>

typedef struct {
    char *output;
    size_t used;
    esp_err_t error;
} report_writer_t;

static void report_append(report_writer_t *writer, const char *text)
{
    if (writer->error != ESP_OK) return;
    while (*text != '\0') {
        if (writer->used == 16384) { writer->error = ESP_ERR_NO_MEM; return; }
        if (writer->output != NULL) writer->output[writer->used] = *text;
        ++writer->used;
        ++text;
    }
}

static esp_err_t write_report(const odk_plugin_host_t *host, const char *host_id,
    const odk_plugin_snapshot_t *rows, report_writer_t *writer)
{
    static const char *states[] = {"registered", "starting", "running", "stopped", "disabled", "blocked", "failed"};
    report_append(writer, "{\"state\":\"available\",\"host\":\"");
    report_append(writer, host_id);
    report_append(writer, "\",\"instance\":\"");
    report_append(writer, host_id);
    report_append(writer, "\",\"plugins\":[");
    for (size_t i = 0; i < host->count; ++i) {
        const odk_plugin_descriptor_t *descriptor = &host->descriptors[i];
        if (descriptor->host == NULL || descriptor->manifest_json == NULL) return ESP_ERR_NOT_FOUND;
        if (strcmp(descriptor->host, host_id) != 0 || (unsigned)rows[i].state >= sizeof(states) / sizeof(states[0]))
            return ESP_ERR_INVALID_ARG;
        if (i != 0) report_append(writer, ",");
        report_append(writer, "{\"manifest\":");
        report_append(writer, descriptor->manifest_json);
        report_append(writer, ",\"state\":\"");
        report_append(writer, states[rows[i].state]);
        report_append(writer, "\",\"enabled\":");
        report_append(writer, rows[i].enabled ? "true" : "false");
        report_append(writer, ",\"health\":{\"state\":\"unknown\",\"reason\":\"not-declared\"}}");
    }
    report_append(writer, "]}");
    return writer->error;
}

esp_err_t odk_plugin_host_report_json(const odk_plugin_host_t *host, const char *host_id,
    char *output, size_t capacity, size_t *size)
{
    if (size == NULL) return ESP_ERR_INVALID_ARG;
    *size = 0;
    if (host_id == NULL || (strcmp(host_id, "esp32-s3") != 0 && strcmp(host_id, "esp32-p4") != 0)
        || (output == NULL && capacity != 0)) return ESP_ERR_INVALID_ARG;
    odk_plugin_snapshot_t rows[ODK_PLUGIN_MAX_COUNT];
    size_t count;
    esp_err_t error = odk_plugin_host_snapshot(host, rows, ODK_PLUGIN_MAX_COUNT, &count);
    if (error != ESP_OK) return error;
    report_writer_t writer = {0};
    error = write_report(host, host_id, rows, &writer);
    if (error != ESP_OK) return error;
    *size = writer.used;
    if (capacity <= writer.used) return ESP_ERR_NO_MEM;
    writer.output = output;
    writer.used = 0;
    error = write_report(host, host_id, rows, &writer);
    if (error != ESP_OK) return error;
    output[writer.used] = '\0';
    return ESP_OK;
}

esp_err_t odk_plugin_host_snapshot(const odk_plugin_host_t *host,
    odk_plugin_snapshot_t *rows, size_t capacity, size_t *count)
{
    if (count == NULL) return ESP_ERR_INVALID_ARG;
    *count = 0;
    if (host == NULL || host->descriptors == NULL || host->count == 0
        || host->count > ODK_PLUGIN_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    if (host->transition) return ESP_ERR_INVALID_STATE;
    if (capacity < host->count) {
        *count = host->count;
        return ESP_ERR_NO_MEM;
    }
    if (rows == NULL) return ESP_ERR_INVALID_ARG;
    for (size_t i = 0; i < host->count; ++i) {
        const odk_plugin_descriptor_t *descriptor = &host->descriptors[i];
        const odk_plugin_record_t *record = &host->records[i];
        rows[i] = (odk_plugin_snapshot_t){
            .id = descriptor->id, .name = descriptor->name,
            .version = descriptor->version, .kind = descriptor->kind,
            .state = record->state, .enabled = record->enabled,
            .owns_resources = record->owned, .stop_completed = record->stop_done,
            .destroy_completed = record->destroy_done,
        };
    }
    *count = host->count;
    return ESP_OK;
}

static int provider(const odk_plugin_host_t *host, const char *name)
{
    for (size_t i = 0; i < host->count; ++i) {
        const odk_plugin_descriptor_t *descriptor = &host->descriptors[i];
        for (size_t p = 0; p < descriptor->provides_count; ++p) {
            if (strcmp(descriptor->provides[p].interface_uri, name) == 0) return (int)i;
        }
    }
    return -1;
}

static esp_err_t visit(odk_plugin_host_t *host, size_t index, uint8_t *marks, size_t *length)
{
    if (marks[index] == 2) return ESP_OK;
    if (marks[index] == 1) return ESP_ERR_INVALID_ARG;
    marks[index] = 1;
    const odk_plugin_descriptor_t *descriptor = &host->descriptors[index];
    for (size_t p = 0; p < descriptor->requires_count; ++p) {
        int dependency = provider(host, descriptor->requires[p].interface_uri);
        if (dependency < 0 && !descriptor->requires[p].optional) return ESP_ERR_NOT_FOUND;
        if (dependency >= 0) {
            esp_err_t error = visit(host, (size_t)dependency, marks, length);
            if (error != ESP_OK) return error;
        }
    }
    marks[index] = 2;
    host->order[(*length)++] = index;
    return ESP_OK;
}

static esp_err_t compile(odk_plugin_host_t *host)
{
    for (size_t i = 0; i < host->count; ++i) {
        const odk_plugin_descriptor_t *descriptor = &host->descriptors[i];
        for (size_t j = 0; j < i; ++j) {
            if (strcmp(host->descriptors[j].id, descriptor->id) == 0) return ESP_ERR_INVALID_ARG;
        }
        for (size_t p = 0; p < descriptor->provides_count; ++p) {
            if (provider(host, descriptor->provides[p].interface_uri) != (int)i) return ESP_ERR_INVALID_ARG;
            for (size_t q = 0; q < p; ++q) {
                if (strcmp(descriptor->provides[q].interface_uri, descriptor->provides[p].interface_uri) == 0) return ESP_ERR_INVALID_ARG;
            }
        }
    }
    uint8_t marks[ODK_PLUGIN_MAX_COUNT] = {0};
    size_t length = 0;
    for (size_t i = 0; i < host->count; ++i) {
        esp_err_t error = visit(host, i, marks, &length);
        if (error != ESP_OK) return error;
    }
    return ESP_OK;
}

esp_err_t odk_plugin_host_init(odk_plugin_host_t *host,
    const odk_plugin_descriptor_t *descriptors, size_t count, const void *const *configs)
{
    if (host == NULL || descriptors == NULL || count == 0 || count > ODK_PLUGIN_MAX_COUNT) return ESP_ERR_INVALID_ARG;
    for (size_t i = 0; i < count; ++i) {
        const odk_plugin_descriptor_t *descriptor = &descriptors[i];
        if (descriptor->id == NULL || descriptor->name == NULL || descriptor->lifecycle == NULL
            || descriptor->provides_count > ODK_PLUGIN_MAX_PORTS
            || (descriptor->provides_count && descriptor->provides == NULL)
            || (descriptor->requires_count && descriptor->requires == NULL)) return ESP_ERR_INVALID_ARG;
        for (size_t p = 0; p < descriptor->provides_count; ++p) {
            if (descriptor->provides[p].interface_uri == NULL || !descriptor->provides[p].interface_uri[0]) return ESP_ERR_INVALID_ARG;
        }
        for (size_t p = 0; p < descriptor->requires_count; ++p) {
            if (descriptor->requires[p].interface_uri == NULL || !descriptor->requires[p].interface_uri[0]) return ESP_ERR_INVALID_ARG;
        }
    }
    memset(host, 0, sizeof(*host));
    host->descriptors = descriptors;
    host->count = count;
    host->configs = configs;
    for (size_t i = 0; i < count; ++i) {
        host->records[i].enabled = true;
        host->records[i].context = (odk_plugin_context_t){host, i};
    }
    return ESP_OK;
}

void *odk_plugin_get(void *opaque, const char *name)
{
    odk_plugin_context_t *context = opaque;
    if (context == NULL || name == NULL) return NULL;
    const odk_plugin_descriptor_t *consumer = &context->host->descriptors[context->index];
    bool declared = false;
    for (size_t p = 0; p < consumer->requires_count; ++p) {
        if (strcmp(consumer->requires[p].interface_uri, name) == 0) declared = true;
    }
    if (!declared) return NULL;
    int index = provider(context->host, name);
    if (context->host->records[context->index].releasing && index >= 0 && context->host->records[index].owned) {
        const odk_plugin_descriptor_t *descriptor = &context->host->descriptors[index];
        for (size_t p = 0; p < descriptor->provides_count; ++p) {
            if (strcmp(descriptor->provides[p].interface_uri, name) == 0) return context->host->records[index].ports[p];
        }
    }
    return odk_plugin_host_port(context->host, name);
}

void *odk_plugin_host_port(odk_plugin_host_t *host, const char *name)
{
    if (host == NULL || name == NULL) return NULL;
    int index = provider(host, name);
    if (index < 0 || host->records[index].state != ODK_PLUGIN_RUNNING || host->records[index].releasing) return NULL;
    const odk_plugin_descriptor_t *descriptor = &host->descriptors[index];
    for (size_t p = 0; p < descriptor->provides_count; ++p) {
        if (strcmp(descriptor->provides[p].interface_uri, name) == 0) return host->records[index].ports[p];
    }
    return NULL;
}

esp_err_t odk_plugin_publish(void *opaque, const char *name, void *value)
{
    odk_plugin_context_t *context = opaque;
    if (context == NULL || name == NULL || value == NULL) return ESP_ERR_INVALID_ARG;
    odk_plugin_record_t *record = &context->host->records[context->index];
    if (record->state != ODK_PLUGIN_STARTING) return ESP_ERR_INVALID_STATE;
    const odk_plugin_descriptor_t *descriptor = &context->host->descriptors[context->index];
    for (size_t p = 0; p < descriptor->provides_count; ++p) {
        if (strcmp(descriptor->provides[p].interface_uri, name) == 0) {
            record->ports[p] = value;
            return ESP_OK;
        }
    }
    return ESP_ERR_NOT_FOUND;
}

static esp_err_t release(odk_plugin_host_t *host, size_t index)
{
    odk_plugin_record_t *record = &host->records[index];
    const odk_plugin_lifecycle_t *lifecycle = host->descriptors[index].lifecycle;
    if (!record->owned) return ESP_OK;
    record->releasing = true;
    esp_err_t first = ESP_OK;
    if (!record->stop_done) {
        first = lifecycle->stop ? lifecycle->stop() : ESP_OK;
        if (first == ESP_OK) record->stop_done = true;
    }
    if (record->stop_done && !record->destroy_done) {
        esp_err_t error = lifecycle->destroy ? lifecycle->destroy() : ESP_OK;
        if (error == ESP_OK) record->destroy_done = true;
        if (first == ESP_OK) first = error;
    }
    record->owned = !(record->stop_done && record->destroy_done);
    record->releasing = false;
    if (!record->owned) memset(record->ports, 0, sizeof(record->ports));
    if (record->owned) {
        record->state = ODK_PLUGIN_FAILED;
        record->error = first;
    } else if (record->state != ODK_PLUGIN_FAILED) record->state = ODK_PLUGIN_STOPPED;
    return first;
}

static esp_err_t activate(odk_plugin_host_t *host, size_t index)
{
    odk_plugin_record_t *record = &host->records[index];
    const odk_plugin_descriptor_t *descriptor = &host->descriptors[index];
    if (record->state == ODK_PLUGIN_RUNNING) return ESP_OK;
    if (record->owned) return ESP_ERR_INVALID_STATE;
    record->error = ESP_OK;
    if (!record->enabled) { record->state = ODK_PLUGIN_DISABLED; return ESP_OK; }
    for (size_t p = 0; p < descriptor->requires_count; ++p) {
        int dependency = provider(host, descriptor->requires[p].interface_uri);
        if (!descriptor->requires[p].optional && (dependency < 0 || host->records[dependency].state != ODK_PLUGIN_RUNNING)) {
            record->state = ODK_PLUGIN_BLOCKED;
            return ESP_OK;
        }
    }
    record->state = ODK_PLUGIN_STARTING;
    record->owned = true;
    record->stop_done = false;
    record->destroy_done = false;
    esp_err_t error = descriptor->lifecycle->init ? descriptor->lifecycle->init(&record->context, host->configs ? host->configs[index] : NULL) : ESP_OK;
    for (size_t p = 0; error == ESP_OK && p < descriptor->provides_count; ++p) {
        if (record->ports[p] == NULL) error = ESP_ERR_INVALID_STATE;
    }
    if (error == ESP_OK && descriptor->lifecycle->start != NULL) error = descriptor->lifecycle->start();
    if (error == ESP_OK) record->state = ODK_PLUGIN_RUNNING;
    else {
        record->state = ODK_PLUGIN_FAILED;
        record->error = error;
        release(host, index);
    }
    return error;
}

static esp_err_t release_safe(odk_plugin_host_t *host, size_t index)
{
    for (size_t consumer = 0; consumer < host->count; ++consumer) {
        if (!host->records[consumer].owned || consumer == index) continue;
        for (size_t p = 0; p < host->descriptors[consumer].requires_count; ++p) {
            int dependency = provider(host, host->descriptors[consumer].requires[p].interface_uri);
            if (dependency == (int)index) {
                host->records[index].state = ODK_PLUGIN_FAILED;
                host->records[index].error = ESP_ERR_INVALID_STATE;
                return ESP_ERR_INVALID_STATE;
            }
        }
    }
    return release(host, index);
}

esp_err_t odk_plugin_host_start(odk_plugin_host_t *host)
{
    if (host->transition) return ESP_ERR_INVALID_STATE;
    if (host->running) {
        for (size_t i = 0; i < host->count; ++i) if (host->records[i].state == ODK_PLUGIN_FAILED) return host->records[i].error;
        return ESP_OK;
    }
    for (size_t i = 0; i < host->count; ++i) if (host->records[i].owned) return ESP_ERR_INVALID_STATE;
    esp_err_t first = compile(host);
    if (first != ESP_OK) return first;
    host->transition = true;
    for (size_t i = 0; i < host->count; ++i) {
        esp_err_t error = activate(host, host->order[i]);
        if (first == ESP_OK) first = error;
    }
    host->running = true;
    host->transition = false;
    return first;
}

esp_err_t odk_plugin_host_stop(odk_plugin_host_t *host)
{
    if (host->transition) return ESP_ERR_INVALID_STATE;
    bool owned = false;
    for (size_t i = 0; i < host->count; ++i) owned |= host->records[i].owned;
    if (!owned) { host->running = false; return ESP_OK; }
    host->transition = true;
    esp_err_t first = ESP_OK;
    for (size_t i = host->count; i > 0; --i) {
        esp_err_t error = release_safe(host, host->order[i - 1]);
        if (first == ESP_OK) first = error;
    }
    host->running = false;
    host->transition = false;
    return first;
}

esp_err_t odk_plugin_host_set_enabled(odk_plugin_host_t *host, const char *id, bool enabled)
{
    if (host->transition) return ESP_ERR_INVALID_STATE;
    int index = -1;
    for (size_t i = 0; i < host->count; ++i) if (strcmp(host->descriptors[i].id, id) == 0) index = (int)i;
    if (index < 0) return ESP_ERR_NOT_FOUND;
    if (host->records[index].enabled == enabled && host->records[index].state != ODK_PLUGIN_FAILED) return ESP_OK;
    host->records[index].enabled = enabled;
    if (!host->running) return ESP_OK;
    bool affected[ODK_PLUGIN_MAX_COUNT] = {false};
    affected[index] = true;
    bool changed;
    do {
        changed = false;
        for (size_t i = 0; i < host->count; ++i) {
            for (size_t p = 0; p < host->descriptors[i].requires_count; ++p) {
                int dependency = provider(host, host->descriptors[i].requires[p].interface_uri);
                if (dependency >= 0 && affected[dependency] && !affected[i]) { affected[i] = true; changed = true; }
            }
        }
    } while (changed);
    host->transition = true;
    esp_err_t first = ESP_OK;
    for (size_t i = host->count; i > 0; --i) {
        size_t current = host->order[i - 1];
        if (affected[current]) {
            esp_err_t error = release_safe(host, current);
            if (first == ESP_OK) first = error;
        }
    }
    for (size_t i = 0; i < host->count; ++i) {
        size_t current = host->order[i];
        if (affected[current]) {
            esp_err_t error = activate(host, current);
            if (first == ESP_OK) first = error;
        }
    }
    host->transition = false;
    return first;
}
