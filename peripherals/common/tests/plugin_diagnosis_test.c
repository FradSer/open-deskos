#include "odk_plugin_host.h"
#include <assert.h>
#include <string.h>

static int value;
static int operations;
static bool fail_stop;
static bool fail_destroy;
static esp_err_t provider_init(void *context, const void *config)
{
    assert(config == &value);
    ++operations;
    return odk_plugin_publish(context, "odk:test/provider/v1", &value);
}
static esp_err_t consumer_init(void *context, const void *config)
{
    (void)config;
    ++operations;
    assert(odk_plugin_get(context, "odk:test/provider/v1") == &value);
    return ESP_OK;
}
static esp_err_t stop(void) { ++operations; return ESP_OK; }
static esp_err_t consumer_stop(void) { ++operations; return fail_stop ? ESP_FAIL : ESP_OK; }
static esp_err_t destroy(void) { ++operations; return ESP_OK; }
static esp_err_t provider_destroy(void) { ++operations; return fail_destroy ? ESP_FAIL : ESP_OK; }
static const odk_plugin_lifecycle_t provider_lifecycle = {.init=provider_init, .stop=stop, .destroy=provider_destroy};
static const odk_plugin_lifecycle_t consumer_lifecycle = {.init=consumer_init, .stop=consumer_stop, .destroy=destroy};
static const odk_port_desc_t ports[] = {{"odk:test/provider/v1", false}};
static const odk_plugin_descriptor_t descriptors[] = {
    {.id="odk.test.consumer", .name="Consumer", .version=1, .kind=ODK_KIND_PROCESSOR,
     .lifecycle=&consumer_lifecycle, .requires=ports, .requires_count=1},
    {.id="odk.test.provider", .name="Provider", .version=2, .kind=ODK_KIND_DEVICE_DRIVER,
     .lifecycle=&provider_lifecycle, .provides=ports, .provides_count=1},
};

int main(void)
{
    odk_plugin_host_t host;
    const void *configs[] = {NULL, &value};
    odk_plugin_snapshot_t rows[2];
    size_t count = 99;
    assert(odk_plugin_host_init(&host, descriptors, 2, configs) == ESP_OK);
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_OK);
    assert(count == 2 && operations == 0);
    assert(strcmp(rows[0].id, "odk.test.consumer") == 0);
    assert(strcmp(rows[1].name, "Provider") == 0);
    assert(rows[1].version == 2 && rows[1].kind == ODK_KIND_DEVICE_DRIVER);
    assert(rows[0].state == ODK_PLUGIN_REGISTERED && rows[0].enabled && !rows[0].owns_resources);
    odk_plugin_snapshot_t before[2];
    memcpy(before, rows, sizeof(rows));
    assert(odk_plugin_host_snapshot(&host, rows, 1, &count) == ESP_ERR_NO_MEM);
    assert(count == 2 && memcmp(before, rows, sizeof(rows)) == 0);
    assert(odk_plugin_host_snapshot(&host, NULL, 0, &count) == ESP_ERR_NO_MEM && count == 2);
    assert(odk_plugin_host_snapshot(&host, NULL, 2, &count) == ESP_ERR_INVALID_ARG && count == 0);
    assert(odk_plugin_host_snapshot(NULL, rows, 2, &count) == ESP_ERR_INVALID_ARG && count == 0);
    assert(odk_plugin_host_snapshot(&host, rows, 2, NULL) == ESP_ERR_INVALID_ARG);
    host.transition = true;
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_ERR_INVALID_STATE && count == 0);
    assert(memcmp(before, rows, sizeof(rows)) == 0);
    host.transition = false;
    assert(odk_plugin_host_start(&host) == ESP_OK);
    int before_operations = operations;
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_OK);
    assert(operations == before_operations);
    assert(rows[0].state == ODK_PLUGIN_RUNNING && rows[0].owns_resources);
    assert(!rows[0].stop_completed && !rows[0].destroy_completed);
    rows[0].state = ODK_PLUGIN_DISABLED;
    rows[0].enabled = false;
    assert(host.records[0].state == ODK_PLUGIN_RUNNING && host.records[0].enabled);
    assert(odk_plugin_host_set_enabled(&host, "odk.test.provider", false) == ESP_OK);
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_OK);
    assert(rows[0].state == ODK_PLUGIN_BLOCKED && !rows[0].owns_resources);
    assert(rows[1].state == ODK_PLUGIN_DISABLED && !rows[1].enabled);
    assert(odk_plugin_host_set_enabled(&host, "odk.test.provider", true) == ESP_OK);
    fail_stop = true;
    assert(odk_plugin_host_stop(&host) == ESP_FAIL);
    before_operations = operations;
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_OK);
    assert(operations == before_operations);
    assert(rows[0].state == ODK_PLUGIN_FAILED && rows[0].owns_resources);
    assert(rows[1].state == ODK_PLUGIN_FAILED && rows[1].owns_resources);
    assert(!rows[0].stop_completed && !rows[0].destroy_completed);
    fail_stop = false;
    assert(odk_plugin_host_stop(&host) == ESP_OK);
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_OK);
    assert(rows[0].state == ODK_PLUGIN_FAILED && !rows[0].owns_resources);
    assert(rows[0].stop_completed && rows[0].destroy_completed);
    assert(odk_plugin_host_start(&host) == ESP_OK);
    fail_destroy = true;
    assert(odk_plugin_host_stop(&host) == ESP_FAIL);
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_OK);
    assert(rows[1].state == ODK_PLUGIN_FAILED && rows[1].owns_resources);
    assert(rows[1].stop_completed && !rows[1].destroy_completed);
    fail_destroy = false;
    before_operations = operations;
    assert(odk_plugin_host_stop(&host) == ESP_OK);
    assert(operations == before_operations + 1);
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_OK);
    assert(!rows[1].owns_resources && rows[1].stop_completed && rows[1].destroy_completed);
    odk_plugin_host_t empty = {0};
    assert(odk_plugin_host_snapshot(&empty, rows, 2, &count) == ESP_ERR_INVALID_ARG && count == 0);
    odk_plugin_descriptor_t maximum_descriptors[ODK_PLUGIN_MAX_COUNT];
    odk_plugin_snapshot_t maximum_rows[ODK_PLUGIN_MAX_COUNT];
    for (size_t i = 0; i < ODK_PLUGIN_MAX_COUNT; ++i) maximum_descriptors[i] = descriptors[0];
    assert(odk_plugin_host_init(&host, maximum_descriptors, ODK_PLUGIN_MAX_COUNT, NULL) == ESP_OK);
    assert(odk_plugin_host_snapshot(&host, maximum_rows, ODK_PLUGIN_MAX_COUNT, &count) == ESP_OK);
    assert(count == ODK_PLUGIN_MAX_COUNT);
    for (size_t i = 0; i < count; ++i) assert(maximum_rows[i].state == ODK_PLUGIN_REGISTERED);
    memcpy(before, rows, sizeof(rows));
    host.count = ODK_PLUGIN_MAX_COUNT + 1;
    assert(odk_plugin_host_snapshot(&host, rows, 2, &count) == ESP_ERR_INVALID_ARG && count == 0);
    assert(memcmp(before, rows, sizeof(rows)) == 0);
    return 0;
}
