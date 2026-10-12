/* SPDX-License-Identifier: Apache-2.0 */
#include "p4_plugin_ports.h"
#include "p4_usb_microphone.h"
#include "p4_uac_lifecycle.h"
#include <string.h>
#include "device/usbd_pvt.h"
#include "tusb.h"
#include "usb_device_uac.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static StaticSemaphore_t s_audio_storage;
static SemaphoreHandle_t s_audio_lock;
static const p4_audio_source_t *s_source;
static esp_err_t s_uac_failure;

static esp_err_t input(uint8_t *buffer, size_t length, size_t *bytes_read, void *context)
{
    (void)context;
    xSemaphoreTake(s_audio_lock, portMAX_DELAY);
    esp_err_t result = ESP_OK;
    if (s_source != NULL) result = s_source->read(buffer, length, bytes_read, s_source->context);
    else { memset(buffer, 0, length); *bytes_read = length; }
    xSemaphoreGive(s_audio_lock);
    return result;
}

static esp_err_t bind_audio(void *context, const p4_audio_source_t *source)
{
    (void)context;
    if (source == NULL || source->read == NULL) return ESP_ERR_INVALID_ARG;
    if (s_uac_failure != ESP_OK) return s_uac_failure;
    if (s_audio_lock == NULL) s_audio_lock = xSemaphoreCreateMutexStatic(&s_audio_storage);
    if (xSemaphoreTake(s_audio_lock, pdMS_TO_TICKS(1000)) != pdTRUE) return ESP_ERR_TIMEOUT;
    if (s_source != NULL && s_source != source) {
        xSemaphoreGive(s_audio_lock);
        return ESP_ERR_INVALID_STATE;
    }
    s_source = source;
    xSemaphoreGive(s_audio_lock);
    uac_device_config_t config = {
        .skip_tinyusb_init = true,
        .input_cb = input,
        .mic_itf_num = P4_USB_MIC_INTERFACE_NUMBER,
        .spk_itf_num = -1,
    };
    const esp_err_t result = uac_device_init(&config);
    if (result != ESP_OK) s_uac_failure = result;
    return result;
}

static esp_err_t unbind_audio(void *context, const p4_audio_source_t *source)
{
    (void)context;
    if (s_audio_lock == NULL) return ESP_OK;
    if (xSemaphoreTake(s_audio_lock, pdMS_TO_TICKS(1000)) != pdTRUE) return ESP_ERR_TIMEOUT;
    if (s_source == source) s_source = NULL;
    xSemaphoreGive(s_audio_lock);
    return ESP_OK;
}

static bool mounted(void *context) { (void)context; return tud_mounted(); }
static bool streaming(void *context) { (void)context; return tud_video_n_streaming(0, 0); }
static bool busy(void *context) { (void)context; return usbd_edpt_busy(0, 0x81); }
static bool transfer(void *context, uint8_t *frame, size_t length)
{ (void)context; return tud_video_n_frame_xfer(0, 0, frame, length); }
static const p4_usb_port_t s_port = {
    .video = {.mounted=mounted, .streaming=streaming, .busy=busy, .transfer=transfer},
    .bind_audio=bind_audio, .unbind_audio=unbind_audio,
};
const p4_usb_port_t *p4_usb_default_port(void) { return &s_port; }

esp_err_t p4_usb_audio_deinit_after_usb_stop(void)
{
    const esp_err_t result = uac_device_deinit_after_usb_stop();
    if (result != ESP_OK) return result;
    s_uac_failure = ESP_OK;
    if (s_audio_lock != NULL) {
        xSemaphoreTake(s_audio_lock, portMAX_DELAY);
        s_source = NULL;
        xSemaphoreGive(s_audio_lock);
    }
    return ESP_OK;
}
