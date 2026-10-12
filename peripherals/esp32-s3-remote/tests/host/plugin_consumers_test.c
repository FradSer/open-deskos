/* Execute production consumer lifecycle functions with isolated driver providers. */
#include <assert.h>
#include <string.h>
#include "remote_plugin_ports.h"
#include "s3_plugins.h"

#define ESP_RETURN_ON_FALSE(value, error, ...) do { if (!(value)) return error; } while (0)
#define ESP_RETURN_ON_ERROR(value, ...) do { esp_err_t status=(value); if (status!=ESP_OK) return status; } while (0)
#define ESP_LOGI(...) ((void)0)

static uint16_t default_frame[DISPLAY_WIDTH * DISPLAY_HEIGHT];
static uint16_t selected_frame[DISPLAY_WIDTH * DISPLAY_HEIGHT];
static int default_queue, selected_queue;
static remote_buffers_port_t default_buffers={default_frame, &default_queue};
static remote_buffers_port_t selected_buffers={selected_frame, &selected_queue};
static remote_buffers_port_t *expected_buffers;
static remote_buffers_port_t *s_serial_buffers, *s_surface_buffers;
static const remote_display_port_t *s_surface_display;
static const remote_touch_port_t *s_surface_touch;
static const remote_serial_port_t *s_surface_serial;
static touchpad_gesture_t gesture, *s_surface_gesture;
static uint16_t *s_framebuffer;
static void *s_state_queue;
static remote_state_t s_state;
static bool s_has_rendered, s_serial_owned, s_cdc_line_overflow, fail_drain;
static size_t s_cdc_line_length;
static int renders, drains, serial_closes;

static void render(uint16_t *frame, const remote_state_t *state) {
    assert(frame==expected_buffers->framebuffer && state==&s_state);
    ++renders;
}
static esp_err_t drain(void) { ++drains; return fail_drain ? ESP_FAIL : ESP_OK; }
static bool read_point(int16_t *x, int16_t *y) { (void)x; (void)y; return false; }
static void receive(void) {}
static bool send_input(void *context, remote_input_t input, const char *action) {
    (void)context; (void)input; (void)action; return true;
}
static void surface_run(void) { assert(!"The hardware loop is outside this lifecycle check"); }
static remote_display_port_t display={render, drain};
static remote_touch_port_t touch={read_point};
static remote_serial_port_t s_serial_port={receive, send_input};
static remote_surface_port_t s_surface_port={surface_run};
static esp_err_t usb_init(void) { s_serial_owned=true; return ESP_OK; }
static esp_err_t usb_serial_jtag_driver_uninstall(void) { ++serial_closes; return ESP_OK; }

/* PRODUCTION_CONSUMERS */

static esp_err_t display_init(void *context, const void *config) {
    (void)config; return odk_plugin_publish(context,"odk:s3/display/v1",&display);
}
static esp_err_t touch_init(void *context, const void *config) {
    (void)config; return odk_plugin_publish(context,"odk:s3/touch/v1",&touch);
}
static esp_err_t gesture_init(void *context, const void *config) {
    (void)config; return odk_plugin_publish(context,"odk:s3/gesture/v1",&gesture);
}
static esp_err_t buffers_init(void *context, const void *config) {
    (void)config; return odk_plugin_publish(context,"odk:s3/buffers/v1",&default_buffers);
}
static esp_err_t selected_buffers_init(void *context, const void *config) {
    (void)config; return odk_plugin_publish(context,"odk:s3/buffers/v1",&selected_buffers);
}
const odk_plugin_lifecycle_t s3_display_lifecycle={.init=display_init};
const odk_plugin_lifecycle_t s3_touch_lifecycle={.init=touch_init};
const odk_plugin_lifecycle_t s3_gesture_lifecycle={.init=gesture_init};
const odk_plugin_lifecycle_t s3_buffers_lifecycle={.init=buffers_init};
const odk_plugin_lifecycle_t s3_serial_lifecycle={.init=serial_plugin_init,.destroy=serial_plugin_destroy};
const odk_plugin_lifecycle_t s3_surface_lifecycle={.init=surface_plugin_init,.stop=surface_plugin_stop,.destroy=surface_plugin_destroy};
static const odk_plugin_lifecycle_t selected_buffers_lifecycle={.init=selected_buffers_init};

int main(void) {
    assert(g_odk_plugins_count==6);
    for (int selected=0; selected<2; ++selected) {
        odk_plugin_descriptor_t descriptors[6];
        memcpy(descriptors,g_odk_plugins,sizeof(descriptors));
        expected_buffers=selected ? &selected_buffers : &default_buffers;
        for (size_t i=0; i<6; ++i) {
            if (selected && !strcmp(descriptors[i].id,"odk.s3.buffers")) descriptors[i].lifecycle=&selected_buffers_lifecycle;
        }
        odk_plugin_host_t host;
        renders=drains=serial_closes=0;
        assert(odk_plugin_host_init(&host,descriptors,6,NULL)==ESP_OK);
        assert(odk_plugin_host_start(&host)==ESP_OK);
        assert(s_serial_buffers==expected_buffers && s_surface_buffers==expected_buffers);
        assert(s_framebuffer==expected_buffers->framebuffer && s_state_queue==expected_buffers->state_queue);
        assert(s_surface_display==&display && s_surface_touch==&touch);
        assert(s_surface_serial==&s_serial_port && s_surface_gesture==&gesture);
        assert(renders==1 && s_has_rendered);
        assert(odk_plugin_host_port(&host,"odk:s3/surface/v1")==&s_surface_port);
        fail_drain=true;
        assert(odk_plugin_host_stop(&host)==ESP_FAIL);
        assert(serial_closes==0 && s_serial_buffers==expected_buffers && s_surface_buffers==expected_buffers);
        for (size_t i=0; i<6; ++i) assert(host.records[i].owned);
        fail_drain=false;
        assert(odk_plugin_host_stop(&host)==ESP_OK);
        assert(drains==2 && serial_closes==1);
        assert(!s_serial_buffers && !s_surface_buffers && !s_framebuffer && !s_state_queue);
        assert(!s_surface_display && !s_surface_touch && !s_surface_serial && !s_surface_gesture);
        assert(!s_serial_owned);
        assert(odk_plugin_host_stop(&host)==ESP_OK);
        assert(serial_closes==1);
    }
    return 0;
}
