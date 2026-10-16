/* The actual composition and native host run against isolated SDK mocks. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include "odk_plugin_host.h"
#include "p4_plugins.h"
typedef void *i2c_master_bus_handle_t;
/* GENERATED_PORTS */
#define ESP_RETURN_ON_ERROR(value, ...) do { int result=(value); if(result!=ESP_OK) return result; } while(0)
#define ESP_RETURN_ON_FALSE(value, error, ...) do { if(!(value)) return error; } while(0)
#define ESP_ERROR_CHECK(value) assert((value)==ESP_OK)
#define ESP_LOGI(...) ((void)0)
#define ESP_VIDEO_MIPI_CSI_DEVICE_NAME "default-capture"
#define ESP_VIDEO_JPEG_DEVICE_NAME "default-encoder"
#define CONFIG_APP_CAMERA_MIPI_SCCB_SDA_PIN 7
#define CONFIG_APP_CAMERA_MIPI_SCCB_SCL_PIN 8
#define CONFIG_APP_CAMERA_SC2336_MIPI_RESET_PIN 26
#define CONFIG_APP_CAMERA_SC2336_MIPI_PWDN_PIN -1
#define CONFIG_APP_CAMERA_SCCB_I2C_PORT 0
#define CONFIG_APP_CAMERA_SCCB_I2C_FREQ 100000
#define CONFIG_APP_CAMERA_FRAME_WIDTH 1280
#define CONFIG_APP_CAMERA_FRAME_HEIGHT 720
#define TINYUSB_PORT_HIGH_SPEED_0 1
typedef struct { int sda_pin,scl_pin,reset_pin,pwdn_pin,i2c_port; uint32_t i2c_freq; } p4_sc2336_pin_config_t;
typedef int tinyusb_desc_config_t;
typedef struct { int port; tinyusb_desc_config_t descriptor; } tinyusb_config_t;
#define TINYUSB_DEFAULT_CONFIG() ((tinyusb_config_t){0})
static char events[256];
static void event(char value) { size_t length=strlen(events); events[length]=value; events[length+1]=0; }
static void *expected_bus=(void *)1;
static const p4_usb_port_t *expected_usb;
static const char *expected_capture="default-capture", *expected_encoder="default-encoder";
static int fail_stream_cleanup, fail_audio_cleanup;
static esp_err_t nvs_flash_init(void) { event('N'); return ESP_OK; }
static esp_err_t nvs_flash_deinit(void) { event('n'); return ESP_OK; }
static esp_err_t p4_peripheral_i2c_init(i2c_master_bus_handle_t *bus) { event('I'); *bus=(void *)1; return ESP_OK; }
static esp_err_t i2c_del_master_bus(i2c_master_bus_handle_t bus) { assert(bus==(void *)1); event('i'); return ESP_OK; }
static esp_err_t p4_sc2336_init_hardware(const p4_sc2336_pin_config_t *pins, i2c_master_bus_handle_t bus) {
    assert(bus==expected_bus && pins->sda_pin==7 && pins->scl_pin==8 && pins->reset_pin==26); event('S'); return ESP_OK;
}
static esp_err_t esp_video_deinit(void) { event('s'); return ESP_OK; }
static tinyusb_desc_config_t descriptors=42;
static const tinyusb_desc_config_t *p4_usb_composite_descriptors(void) { return &descriptors; }
static esp_err_t tinyusb_driver_install(const tinyusb_config_t *config) { assert(config->port==1 && config->descriptor==42); event('U'); return ESP_OK; }
static esp_err_t tinyusb_driver_uninstall(void) { event('u'); return ESP_OK; }
esp_err_t p4_usb_audio_deinit_after_usb_stop(void) { event('r'); return fail_audio_cleanup ? ESP_FAIL : ESP_OK; }
static esp_err_t source_read(uint8_t *buffer,size_t length,size_t *read,void *context) { *read=length; return ESP_OK; }
static const p4_audio_source_t source={.read=source_read};
static bool yes(void *context) { return true; }
static bool no(void *context) { return false; }
static bool transfer(void *context,uint8_t *data,size_t length) { assert(context==(void *)0x99 && length==8); return true; }
static esp_err_t bind_audio(void *context,const p4_audio_source_t *value) { assert(context==(void *)0x99 && value==&source); event('A'); return ESP_OK; }
static esp_err_t unbind_audio(void *context,const p4_audio_source_t *value) { return ESP_OK; }
static const p4_usb_port_t default_usb={.context=(void *)0x99,.video={.context=(void *)0x99,.mounted=yes,.streaming=yes,.busy=no,.transfer=transfer},.bind_audio=bind_audio,.unbind_audio=unbind_audio};
const p4_usb_port_t *p4_usb_default_port(void) { return &default_usb; }
static esp_err_t p4_usb_microphone_init_with_transport(i2c_master_bus_handle_t bus,const p4_usb_port_t *usb) {
    assert(bus==expected_bus && usb==expected_usb); event('M'); return usb->bind_audio(usb->context,&source);
}
static const p4_audio_source_t *p4_microphone_source(void) { return &source; }
static esp_err_t p4_usb_microphone_stop(void) { event('a'); return ESP_OK; }
static esp_err_t p4_usb_microphone_deinit(void) { event('m'); return ESP_OK; }
static esp_err_t p4_uvc_stream_init_with_ports(uint16_t width,uint16_t height,const p4_camera_port_t *camera,const p4_video_sink_t *sink) {
    assert(width==1280 && height==720); assert(!strcmp(camera->capture_name,expected_capture) && !strcmp(camera->encoder_name,expected_encoder));
    assert(sink==&expected_usb->video); uint8_t frame[8]={0}; assert(sink->transfer(sink->context,frame,8)); event('V'); return ESP_OK;
}
static esp_err_t p4_uvc_stream_start(void) { event('T'); return ESP_OK; }
static esp_err_t p4_uvc_stream_stop(void) { event('t'); return ESP_OK; }
static esp_err_t p4_uvc_stream_deinit(void) { event('v'); return fail_stream_cleanup ? ESP_FAIL : ESP_OK; }
/* GENERATED_COMPOSITION */
static p4_i2c_port_t replacement_i2c={.bus=(void *)0x77};
static const p4_camera_port_t replacement_camera={.capture_name="replacement-capture",.encoder_name="replacement-encoder"};
static const p4_usb_port_t replacement_usb={.context=(void *)0x99,.video={.context=(void *)0x99,.mounted=yes,.streaming=yes,.busy=no,.transfer=transfer},.bind_audio=bind_audio,.unbind_audio=unbind_audio};
static esp_err_t replace_i2c(void *context,const void *config) { return odk_plugin_publish(context,P4_PORT_I2C,&replacement_i2c); }
static esp_err_t replace_camera(void *context,const void *config) {
    const p4_i2c_port_t *bus=odk_plugin_get(context,P4_PORT_I2C); assert(bus->bus==(void *)0x77);
    return odk_plugin_publish(context,P4_PORT_CAMERA,(void *)&replacement_camera);
}
static esp_err_t replace_usb(void *context,const void *config) { return odk_plugin_publish(context,P4_PORT_USB,(void *)&replacement_usb); }
static const odk_plugin_lifecycle_t replacement_lifecycles[]={{.init=replace_i2c},{.init=replace_camera},{.init=replace_usb}};
int main(void) {
    expected_usb=&default_usb;
    app_main(); assert(!strcmp(events,"NISUMAVT"));
    assert(odk_plugin_host_port(&s_host,P4_PORT_STREAM)==&s_stream_ready);
    events[0]=0; assert(odk_plugin_host_stop(&s_host)==ESP_OK); assert(!strcmp(events,"tvamursin"));
    events[0]=0; assert(odk_plugin_host_start(&s_host)==ESP_OK); assert(!strcmp(events,"NISUMAVT"));
    fail_stream_cleanup=1; events[0]=0; assert(odk_plugin_host_stop(&s_host)!=ESP_OK);
    assert(!strcmp(events,"tv"));
    for(size_t i=0;i<6;++i) assert(s_host.records[i].owned);
    fail_stream_cleanup=0; events[0]=0; assert(odk_plugin_host_stop(&s_host)==ESP_OK);
    assert(!strcmp(events,"vamursin"));
    events[0]=0; assert(odk_plugin_host_start(&s_host)==ESP_OK);
    fail_audio_cleanup=1; events[0]=0; assert(odk_plugin_host_stop(&s_host)!=ESP_OK); assert(!strcmp(events,"tvamur"));
    assert(s_host.records[0].owned && s_host.records[1].owned && s_host.records[2].owned && s_host.records[3].owned);
    fail_audio_cleanup=0; events[0]=0; assert(odk_plugin_host_stop(&s_host)==ESP_OK); assert(!strcmp(events,"rsin"));
    odk_plugin_descriptor_t descriptors_copy[6]; memcpy(descriptors_copy,g_odk_plugins,sizeof(descriptors_copy));
    descriptors_copy[1].lifecycle=&replacement_lifecycles[0]; descriptors_copy[2].lifecycle=&replacement_lifecycles[1]; descriptors_copy[3].lifecycle=&replacement_lifecycles[2];
    expected_bus=(void *)0x77; expected_usb=&replacement_usb; expected_capture="replacement-capture"; expected_encoder="replacement-encoder";
    events[0]=0; assert(odk_plugin_host_init(&s_host,descriptors_copy,6,NULL)==ESP_OK);
    assert(odk_plugin_host_start(&s_host)==ESP_OK); assert(!strcmp(events,"NMAVT"));
    assert(odk_plugin_host_set_enabled(&s_host,"odk.p4.microphone",false)==ESP_OK);
    assert(s_host.records[4].state==ODK_PLUGIN_DISABLED && s_host.records[5].state==ODK_PLUGIN_RUNNING);
    assert(odk_plugin_host_stop(&s_host)==ESP_OK);
    return 0;
}
