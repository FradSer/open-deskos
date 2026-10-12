/* Actual microphone lifecycle with replaceable transport and codec resource mocks. */
#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
typedef int esp_err_t;
typedef void *i2c_master_bus_handle_t;
typedef void *esp_codec_dev_handle_t;
typedef void *i2s_chan_handle_t;
typedef struct { int id; } audio_codec_data_if_t;
typedef struct { int id; } audio_codec_ctrl_if_t;
typedef struct { int id; } audio_codec_gpio_if_t;
typedef struct { int id; } audio_codec_if_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG 1
#define ESP_ERR_INVALID_STATE 2
#define ESP_ERR_TIMEOUT 3
#define ESP_CODEC_DEV_OK 0
#define ESP_RETURN_ON_ERROR(value,...) do { int result=(value); if(result!=ESP_OK) return result; } while(0)
#define ESP_RETURN_ON_FALSE(value,error,...) do { if(!(value)) return error; } while(0)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define pdTRUE 1
#define portMAX_DELAY 0xffffffffU
#define pdMS_TO_TICKS(value) (value)
typedef struct { bool busy; } StaticSemaphore_t;
typedef StaticSemaphore_t *SemaphoreHandle_t;
static SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t *storage) { return storage; }
static int xSemaphoreTake(SemaphoreHandle_t lock,unsigned ticks) { if(lock->busy) return 0; lock->busy=true; return pdTRUE; }
static void xSemaphoreGive(SemaphoreHandle_t lock) { assert(lock->busy); lock->busy=false; }
/* GENERATED_PORTS */
/* GENERATED_GLOBALS */
static const p4_audio_source_t *bound;
static int fail_codec_status, fail_read, fail_unbind, fail_disable, fail_delete, fail_interface;
static unsigned reads, closes, device_deletes, interface_deletes, channel_deletes, binds;
static audio_codec_data_if_t data_if={1};
static audio_codec_ctrl_if_t ctrl_if={2};
static audio_codec_gpio_if_t gpio_if={3};
static audio_codec_if_t codec_if={4};
static esp_err_t init_codec(i2c_master_bus_handle_t bus) {
    assert(bus==(void *)0x77);
    s_microphone=(void *)1; s_i2s_rx=(void *)2; s_i2s_enabled=true;
    s_data_if=&data_if; s_control_if=&ctrl_if; s_gpio_if=&gpio_if; s_codec_if=&codec_if;
    return fail_codec_status ? ESP_FAIL : ESP_OK;
}
static int esp_codec_dev_read(void *codec,uint8_t *buffer,int length) {
    assert(codec==(void *)1 && s_capture_lock->busy); ++reads; memset(buffer,6,(size_t)length); return fail_read ? -1 : 0;
}
static int esp_codec_dev_close(void *codec) { assert(bound==NULL && !s_active); ++closes; return 0; }
static void esp_codec_dev_delete(void *codec) { assert(bound==NULL && !s_active); ++device_deletes; }
static int delete_interface(const void *iface) { assert(!s_active && bound==NULL); ++interface_deletes; return fail_interface ? -1 : 0; }
#define audio_codec_delete_codec_if delete_interface
#define audio_codec_delete_ctrl_if delete_interface
#define audio_codec_delete_gpio_if delete_interface
#define audio_codec_delete_data_if delete_interface
static esp_err_t i2s_channel_disable(void *channel) { return fail_disable ? ESP_FAIL : ESP_OK; }
static esp_err_t i2s_del_channel(void *channel) { ++channel_deletes; return fail_delete ? ESP_FAIL : ESP_OK; }
static esp_err_t bind_source(void *context,const p4_audio_source_t *source) { assert(context==(void *)0x88); bound=source; ++binds; return ESP_OK; }
static esp_err_t unbind_source(void *context,const p4_audio_source_t *source) { assert(context==(void *)0x88 && source==&s_source); if(fail_unbind) return ESP_ERR_TIMEOUT; bound=NULL; return ESP_OK; }
static const p4_usb_port_t transport={.context=(void *)0x88,.bind_audio=bind_source,.unbind_audio=unbind_source};
const p4_usb_port_t *p4_usb_default_port(void) { assert(false); return NULL; }
/* GENERATED_FUNCTIONS */
int main(void) {
    for(int cycle=0;cycle<3;++cycle) {
        fail_codec_status=cycle==1;
        assert(p4_usb_microphone_init_with_transport((void *)0x77,&transport)==ESP_OK);
        assert(bound==p4_microphone_source());
        assert(p4_usb_microphone_init_with_transport((void *)0x77,&transport)==ESP_ERR_INVALID_STATE);
        uint8_t buffer[8]={0}; size_t read=0;
        assert(bound->read(buffer,8,&read,bound->context)==ESP_OK && read==8 && buffer[0]==6);
        /* A failed self-test preserves HEAD's handle-based read behavior. */
        fail_read=1; assert(bound->read(buffer,8,&read,bound->context)==ESP_OK && buffer[0]==0); fail_read=0;
        fail_unbind=1; unsigned retained_deletes=device_deletes;
        assert(p4_usb_microphone_deinit()==ESP_ERR_TIMEOUT && s_microphone!=NULL && s_active);
        assert(device_deletes==retained_deletes);
        fail_unbind=0; s_capture_lock->busy=true;
        assert(p4_usb_microphone_stop()==ESP_ERR_TIMEOUT && !bound && s_active);
        s_capture_lock->busy=false;
        assert(p4_usb_microphone_stop()==ESP_OK && !s_active);
        assert(p4_microphone_source()->read(buffer,8,&read,NULL)==ESP_OK && buffer[0]==0);
        fail_disable=1; assert(p4_usb_microphone_deinit()==ESP_FAIL && s_i2s_rx!=NULL);
        assert(s_microphone==NULL && s_codec_if==NULL && s_data_if==NULL);
        unsigned interfaces_done=interface_deletes;
        fail_disable=0; fail_delete=1;
        assert(p4_usb_microphone_deinit()==ESP_FAIL && s_i2s_rx!=NULL && !s_i2s_enabled);
        fail_delete=0; assert(p4_usb_microphone_deinit()==ESP_OK && s_transport==NULL && s_i2s_rx==NULL);
        assert(interface_deletes==interfaces_done);
        assert(p4_usb_microphone_deinit()==ESP_OK);
    }
    assert(binds==3 && device_deletes==3 && interface_deletes==12 && reads==6);
    assert(p4_usb_microphone_init_with_transport((void *)0x77,&transport)==ESP_OK);
    fail_interface=1; assert(p4_usb_microphone_deinit()==ESP_FAIL);
    assert(s_release_failed && s_codec_if==NULL && s_control_if!=NULL);
    unsigned deleted=interface_deletes;
    fail_interface=0; assert(p4_usb_microphone_deinit()==ESP_FAIL && interface_deletes==deleted);
    assert(p4_usb_microphone_init_with_transport((void *)0x77,&transport)==ESP_ERR_INVALID_STATE);
    return 0;
}
