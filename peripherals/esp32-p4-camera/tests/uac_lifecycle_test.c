/* Staged task notifications exercise generated code without an ESP SDK. */
#include <assert.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <stdatomic.h>
#include <string.h>
typedef int esp_err_t;
typedef int TickType_t;
typedef unsigned EventBits_t;
typedef void *TaskHandle_t;
typedef struct { EventBits_t bits; } StaticEventGroup_t;
typedef StaticEventGroup_t *EventGroupHandle_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_NOT_SUPPORTED 1
#define ESP_ERR_NO_MEM 2
#define ESP_ERR_TIMEOUT 3
#define ESP_ERR_INVALID_STATE 4
#define pdFALSE 0
#define pdTRUE 1
#define pdFAIL 0
#define portMAX_DELAY 100
#define pdMS_TO_TICKS(value) (value)
#define ODK_UAC_MIC_EXIT 1
#define ODK_UAC_SPK_EXIT 2
#define ODK_UAC_NOTIFIED 4
#define MIC_INTERVAL_MS 1
#define UAC_ENTER_CRITICAL() ((void)0)
#define UAC_EXIT_CRITICAL() ((void)0)
#define ESP_LOGE(...) ((void)0)
typedef struct {
    bool skip_tinyusb_init;
    esp_err_t (*input_cb)(uint8_t *, size_t, size_t *, void *);
    esp_err_t (*output_cb)(uint8_t *, size_t, void *);
    void *cb_ctx;
} uac_device_config_t;
typedef struct {
    uac_device_config_t user_cfg;
    TaskHandle_t mic_task_handle, spk_task_handle;
    bool mic_active, spk_active;
    uint8_t mic_buf1[16], mic_buf2[16], spk_buf[16];
    uint8_t *mic_buf_write, *mic_buf_read;
    size_t mic_bytes_per_ms;
    int mic_data_size, spk_data_size;
} uac_device_t;
static uac_device_t *s_uac_device;
static atomic_bool s_odk_uac_stopping;
static StaticEventGroup_t s_odk_uac_exit_storage;
static EventGroupHandle_t s_odk_uac_exits;
static EventBits_t s_odk_uac_expected;
static bool s_odk_uac_stop_started;
static int init_calls, notify_calls, deletes, input_calls, event_creates;
static bool setter_tail_pending;
static EventGroupHandle_t xEventGroupCreateStatic(StaticEventGroup_t *storage) { assert(!setter_tail_pending); ++event_creates; return storage; }
static EventBits_t xEventGroupClearBits(EventGroupHandle_t group, EventBits_t bits) { return group->bits &= ~bits; }
static EventBits_t xEventGroupSetBits(EventGroupHandle_t group, EventBits_t bits) { return group->bits |= bits; }
static EventBits_t xEventGroupWaitBits(EventGroupHandle_t group, EventBits_t bits, int clear, int all, int timeout) { return group->bits; }
static void xTaskNotifyGive(TaskHandle_t task) { assert(task != NULL); ++notify_calls; }
static TickType_t xTaskGetTickCount(void) { return 0; }
static unsigned ulTaskNotifyTake(int clear, int wait) { return 0; }
static void vTaskDelayUntil(TickType_t *ticks, int wait) { atomic_store(&s_odk_uac_stopping, true); }
static void vTaskDelete(TaskHandle_t task) { assert(task == NULL); ++deletes; }
static esp_err_t odk_uac_upstream_init(uac_device_config_t *config) {
    ++init_calls;
    s_uac_device = calloc(1, sizeof(*s_uac_device));
    s_uac_device->user_cfg = *config;
    s_uac_device->mic_buf_write = s_uac_device->mic_buf1;
    s_uac_device->mic_buf_read = s_uac_device->mic_buf2;
    return ESP_OK;
}
/* GENERATED_WORKERS */
/* GENERATED_API */
static esp_err_t input(uint8_t *data, size_t length, size_t *read, void *context) {
    assert(context == &input_calls);
    ++input_calls; memset(data, 7, length); *read=length; return ESP_OK;
}
int main(void) {
    uac_device_config_t config = {.skip_tinyusb_init=true, .input_cb=input, .cb_ctx=&input_calls};
    for (int round=0; round<3; ++round) {
        assert(uac_device_init(&config)==ESP_OK);
        assert(!atomic_load(&s_odk_uac_stopping));
        s_uac_device->mic_task_handle=(void *)1;
        s_uac_device->spk_task_handle=(void *)2;
        uac_device_t *retained=s_uac_device;
        assert(uac_device_deinit_after_usb_stop()==ESP_ERR_TIMEOUT);
        assert(s_uac_device==retained && s_odk_uac_expected==3);
        setter_tail_pending=false;
        assert(uac_device_init(&config)==ESP_ERR_INVALID_STATE);
        usb_mic_task(NULL);
        assert(s_uac_device->mic_task_handle==NULL);
        assert(uac_device_deinit_after_usb_stop()==ESP_ERR_TIMEOUT);
        assert(s_uac_device==retained);
        usb_spk_task(NULL);
        assert(uac_device_deinit_after_usb_stop()==ESP_OK);
        assert(s_uac_device==NULL);
        /* A woken owner can restart before the old setter releases its lock. */
        setter_tail_pending=true;
        assert(uac_device_deinit_after_usb_stop()==ESP_OK);
    }
    assert(init_calls==3 && notify_calls==6 && deletes==6 && event_creates==1);
    assert(uac_device_init(&config)==ESP_OK);
    assert(uac_device_deinit_after_usb_stop()==ESP_OK);
    assert(uac_device_init(&config)==ESP_OK);
    xEventGroupClearBits(s_odk_uac_exits, 7); xEventGroupSetBits(s_odk_uac_exits, ODK_UAC_NOTIFIED); s_odk_uac_expected=ODK_UAC_MIC_EXIT;
    s_uac_device->mic_task_handle=(void *)1;
    s_uac_device->mic_active=true; s_uac_device->mic_bytes_per_ms=8;
    usb_mic_task(NULL);
    assert(input_calls==1 && s_uac_device->mic_data_size==8);
    assert(s_uac_device->mic_buf_read[0]==7);
    assert(uac_device_deinit_after_usb_stop()==ESP_OK);
    config.skip_tinyusb_init=false;
    assert(uac_device_init(&config)==ESP_OK);
    assert(uac_device_deinit_after_usb_stop()==ESP_ERR_NOT_SUPPORTED);
    assert(s_uac_device!=NULL);
    free(s_uac_device); s_uac_device=NULL;
    return 0;
}
