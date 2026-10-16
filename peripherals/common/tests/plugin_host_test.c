#include "odk_plugin_host.h"
#include "remote_plugin_ports.h"
#include <assert.h>
#include <stdio.h>
#include <string.h>

static char events[128];
static size_t used;
static int value;
static bool fail_provider;
static bool fail_stop;
static bool fail_destroy;
static void *retry_context;
static int retry_calls;
static esp_err_t retry_consumer_init(void *context, const void *config) {
    (void)config; retry_context = context;
    return odk_plugin_publish(context, "odk:test/consumer/v1", &value);
}
static esp_err_t retry_consumer_stop(void) {
    if (++retry_calls == 1) return ESP_FAIL;
    return odk_plugin_get(retry_context, "odk:test/provider/v1") == &value ? ESP_OK : ESP_ERR_INVALID_STATE;
}
static const odk_plugin_lifecycle_t retry_consumer_lifecycle = {.init=retry_consumer_init, .stop=retry_consumer_stop};
static int live_resources;
static esp_err_t resource_init(void *context, const void *config) {
    (void)config; ++live_resources;
    return odk_plugin_publish(context, "odk:test/provider/v1", &value);
}
static esp_err_t resource_destroy(void) {
    if (fail_destroy) return ESP_FAIL;
    --live_resources; return ESP_OK;
}
static uint16_t replacement_frame[4];
static int replacement_queue;
static remote_buffers_port_t replacement_buffers = {replacement_frame, &replacement_queue};
static esp_err_t replacement_buffers_init(void *context, const void *config) {
    (void)config;
    return odk_plugin_publish(context, "odk:s3/buffers/v1", &replacement_buffers);
}
static esp_err_t replacement_consumer_init(void *context, const void *config) {
    (void)config;
    remote_buffers_port_t *buffers = remote_buffers_from_context(context);
    assert(buffers != NULL);
    assert(buffers->framebuffer == replacement_frame);
    assert(buffers->state_queue == &replacement_queue);
    return ESP_OK;
}
static const odk_plugin_lifecycle_t replacement_buffers_lifecycle = {.init=replacement_buffers_init};
static const odk_plugin_lifecycle_t replacement_consumer_lifecycle = {.init=replacement_consumer_init};
static const odk_port_desc_t replacement_ports[] = {{"odk:s3/buffers/v1", false}};
static const odk_plugin_lifecycle_t resource_lifecycle = {.init=resource_init, .destroy=resource_destroy};
static void event(char name) { events[used++] = name; events[used] = 0; }
static esp_err_t provider_init(void *context, const void *config) {
    (void)config; event('P');
    assert(odk_plugin_publish(context, "odk:test/provider/v1", &value) == ESP_OK);
    return fail_provider ? ESP_FAIL : ESP_OK;
}
static esp_err_t consumer_init(void *context, const void *config) {
    (void)config; event('C');
    assert(odk_plugin_get(context, "odk:test/provider/v1") == &value);
    assert(odk_plugin_get(context, "odk:test/undeclared/v1") == NULL);
    return odk_plugin_publish(context, "odk:test/consumer/v1", &value);
}
static esp_err_t provider_stop(void) { event('p'); return ESP_OK; }
static esp_err_t provider_destroy(void) { event('d'); return ESP_OK; }
static esp_err_t consumer_stop(void) { event('c'); return fail_stop ? ESP_FAIL : ESP_OK; }
static esp_err_t consumer_destroy(void) { event('x'); return ESP_OK; }
static const odk_plugin_lifecycle_t provider_lifecycle = { .init=provider_init, .stop=provider_stop, .destroy=provider_destroy };
static const odk_plugin_lifecycle_t consumer_lifecycle = { .init=consumer_init, .stop=consumer_stop, .destroy=consumer_destroy };
static const odk_port_desc_t provider_ports[] = {{ "odk:test/provider/v1", false }};
static const odk_port_desc_t consumer_ports[] = {{ "odk:test/consumer/v1", false }};
static const odk_plugin_descriptor_t descriptors[] = {
    {.id="odk.test.consumer", .name="Consumer", .version=1, .lifecycle=&consumer_lifecycle, .provides_count=1, .provides=consumer_ports, .requires_count=1, .requires=provider_ports},
    {.id="odk.test.provider", .name="Provider", .version=1, .lifecycle=&provider_lifecycle, .provides_count=1, .provides=provider_ports},
};
static void reset(void) { used=0; events[0]=0; fail_provider=false; fail_stop=false; }
int main(void) {
    odk_plugin_host_t host;
    reset();
    assert(odk_plugin_host_init(&host, descriptors, 2, NULL) == ESP_OK);
    assert(odk_plugin_host_start(&host) == ESP_OK);
    assert(odk_plugin_host_start(&host) == ESP_OK);
    assert(strcmp(events,"PC")==0);
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    assert(strcmp(events,"PCcxpd")==0);
    reset();
    assert(odk_plugin_host_start(&host)==ESP_OK);
    fail_stop=true;
    assert(odk_plugin_host_stop(&host)==ESP_FAIL);
    assert(strcmp(events,"PCc")==0);
    assert(host.records[0].owned && host.records[1].owned);
    assert(odk_plugin_host_start(&host)==ESP_ERR_INVALID_STATE);
    fail_stop=false;
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    assert(strcmp(events,"PCccxpd")==0);
    reset(); fail_provider=true;
    assert(odk_plugin_host_start(&host)==ESP_FAIL);
    assert(strcmp(events,"Ppd")==0);
    assert(host.records[0].state==ODK_PLUGIN_BLOCKED);
    assert(host.records[1].state==ODK_PLUGIN_FAILED);
    assert(odk_plugin_host_start(&host)==ESP_FAIL);
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    reset();
    assert(odk_plugin_host_start(&host)==ESP_OK);
    assert(odk_plugin_host_set_enabled(&host,"odk.test.provider",false)==ESP_OK);
    assert(host.records[0].state==ODK_PLUGIN_BLOCKED);
    assert(host.records[1].state==ODK_PLUGIN_DISABLED);
    assert(strcmp(events,"PCcxpd")==0);
    assert(odk_plugin_host_set_enabled(&host,"odk.test.provider",true)==ESP_OK);
    assert(strcmp(events,"PCcxpdPC")==0);
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    reset();
    odk_plugin_descriptor_t invalid[2];
    memcpy(invalid, descriptors, sizeof(invalid));
    invalid[0].provides=provider_ports;
    assert(odk_plugin_host_init(&host,invalid,2,NULL)==ESP_OK);
    assert(odk_plugin_host_start(&host)==ESP_ERR_INVALID_ARG);
    assert(used==0);
    memcpy(invalid,descriptors,sizeof(invalid));
    invalid[1].requires=consumer_ports; invalid[1].requires_count=1;
    assert(odk_plugin_host_init(&host,invalid,2,NULL)==ESP_OK);
    assert(odk_plugin_host_start(&host)==ESP_ERR_INVALID_ARG);
    assert(used==0);
    assert(odk_plugin_host_init(&host,descriptors,1,NULL)==ESP_OK);
    assert(odk_plugin_host_start(&host)==ESP_ERR_NOT_FOUND);
    assert(used==0);
    odk_plugin_descriptor_t resource_descriptor = descriptors[1];
    resource_descriptor.lifecycle = &resource_lifecycle;
    live_resources = 0; fail_destroy = false;
    assert(odk_plugin_host_init(&host,&resource_descriptor,1,NULL)==ESP_OK);
    assert(odk_plugin_host_start(&host)==ESP_OK);
    fail_destroy = true;
    assert(odk_plugin_host_set_enabled(&host,"odk.test.provider",false)==ESP_FAIL);
    assert(host.records[0].owned);
    assert(odk_plugin_host_set_enabled(&host,"odk.test.provider",true)!=ESP_OK);
    assert(live_resources==1);
    fail_destroy = false;
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    assert(live_resources==0);
    const odk_plugin_descriptor_t replacement_descriptors[] = {
        {.id="odk.test.buffer", .name="Buffer", .version=1, .lifecycle=&replacement_buffers_lifecycle, .provides=replacement_ports, .provides_count=1},
        {.id="odk.test.buffer-consumer", .name="Consumer", .version=1, .lifecycle=&replacement_consumer_lifecycle, .requires=replacement_ports, .requires_count=1},
    };
    assert(odk_plugin_host_init(&host,replacement_descriptors,2,NULL)==ESP_OK);
    assert(odk_plugin_host_start(&host)==ESP_OK);
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    memcpy(invalid,descriptors,sizeof(invalid));
    invalid[0].lifecycle = &retry_consumer_lifecycle;
    retry_calls = 0;
    reset();
    assert(odk_plugin_host_init(&host,invalid,2,NULL)==ESP_OK);
    assert(odk_plugin_host_start(&host)==ESP_OK);
    assert(odk_plugin_host_stop(&host)==ESP_FAIL);
    assert(odk_plugin_host_port(&host,"odk:test/provider/v1")==NULL);
    assert(odk_plugin_host_stop(&host)==ESP_OK);
    assert(!host.records[0].owned && !host.records[1].owned);
    puts("native lifecycle checks passed");
    return 0;
}
