/* Actual transport callbacks with deterministic mutex and UAC lifecycle mocks. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
typedef int esp_err_t;
typedef void *i2c_master_bus_handle_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_ARG 1
#define ESP_ERR_INVALID_STATE 2
#define ESP_ERR_TIMEOUT 3
#define pdTRUE 1
#define portMAX_DELAY 0xffffffffU
#define pdMS_TO_TICKS(value) (value)
#define P4_USB_MIC_INTERFACE_NUMBER 3
typedef struct { bool busy; } StaticSemaphore_t;
typedef StaticSemaphore_t *SemaphoreHandle_t;
static SemaphoreHandle_t xSemaphoreCreateMutexStatic(StaticSemaphore_t *storage) { return storage; }
static int xSemaphoreTake(SemaphoreHandle_t lock,unsigned ticks) { if(lock->busy) return 0; lock->busy=true; return pdTRUE; }
static int xSemaphoreGive(SemaphoreHandle_t lock) { assert(lock->busy); lock->busy=false; return pdTRUE; }
/* GENERATED_PORTS */
typedef struct { bool skip_tinyusb_init; esp_err_t (*input_cb)(uint8_t *,size_t,size_t *,void *); int mic_itf_num,spk_itf_num; } uac_device_config_t;
static unsigned init_calls,deinit_calls;
static bool allocated,worker_live;
static int fail_init,fail_deinit;
static esp_err_t uac_device_init(uac_device_config_t *config) {
    ++init_calls; assert(config->skip_tinyusb_init && config->mic_itf_num==3 && config->spk_itf_num==-1);
    if(allocated) return ESP_OK;
    allocated=true;
    if(fail_init) return ESP_FAIL;
    worker_live=true;
    return ESP_OK;
}
static esp_err_t uac_device_deinit_after_usb_stop(void) {
    ++deinit_calls; if(fail_deinit) return ESP_ERR_TIMEOUT;
    allocated=worker_live=false; return ESP_OK;
}
static bool tud_mounted(void) { return true; }
static bool tud_video_n_streaming(int a,int b) { assert(a==0 && b==0); return true; }
static bool usbd_edpt_busy(int rh,int endpoint) { assert(rh==0 && endpoint==0x81); return false; }
static bool tud_video_n_frame_xfer(int a,int b,uint8_t *frame,size_t length) { assert(a==0 && b==0 && length==8); return true; }
/* GENERATED_TRANSPORT */
static unsigned read_calls;
static esp_err_t read_source(uint8_t *data,size_t length,size_t *read,void *context) {
    assert(context==(void *)0x66 && s_audio_lock->busy); ++read_calls;
    memset(data,5,length); *read=length; return ESP_OK;
}
int main(void) {
    const p4_usb_port_t *port=p4_usb_default_port();
    const p4_audio_source_t source={.context=(void *)0x66,.read=read_source};
    const p4_audio_source_t other={.read=read_source};
    assert(port->bind_audio(port->context,&source)==ESP_OK && worker_live);
    uint8_t data[8]={0}; size_t read=0;
    assert(input(data,8,&read,NULL)==ESP_OK && read==8 && data[0]==5 && read_calls==1);
    assert(port->bind_audio(port->context,&other)==ESP_ERR_INVALID_STATE);
    s_audio_lock->busy=true;
    assert(port->unbind_audio(port->context,&source)==ESP_ERR_TIMEOUT && s_source==&source);
    s_audio_lock->busy=false;
    assert(port->unbind_audio(port->context,&source)==ESP_OK && s_source==NULL);
    memset(data,7,8); assert(input(data,8,&read,NULL)==ESP_OK && data[0]==0 && read_calls==1);
    assert(p4_usb_audio_deinit_after_usb_stop()==ESP_OK);
    fail_init=1;
    assert(port->bind_audio(port->context,&source)==ESP_FAIL && allocated && !worker_live);
    assert(port->unbind_audio(port->context,&source)==ESP_OK);
    unsigned failed_calls=init_calls;
    fail_init=0;
    assert(port->bind_audio(port->context,&source)==ESP_FAIL && init_calls==failed_calls);
    assert(!worker_live && s_source==NULL);
    fail_deinit=1; assert(p4_usb_audio_deinit_after_usb_stop()==ESP_ERR_TIMEOUT);
    assert(port->bind_audio(port->context,&source)==ESP_FAIL);
    fail_deinit=0; assert(p4_usb_audio_deinit_after_usb_stop()==ESP_OK);
    assert(port->bind_audio(port->context,&source)==ESP_OK && worker_live);
    assert(port->video.mounted(port->video.context) && port->video.streaming(port->video.context));
    assert(!port->video.busy(port->video.context));
    assert(port->video.transfer(port->video.context,data,8));
    assert(port->unbind_audio(port->context,&source)==ESP_OK);
    assert(p4_usb_audio_deinit_after_usb_stop()==ESP_OK);
    return 0;
}
