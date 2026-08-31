#include "sdkconfig.h"

#ifdef CONFIG_ESP_HOSTED_COPROCESSOR_APP_MAIN
#include "esp_err.h"
#include "esp_hosted_peer_data.h"
#include "esp_now.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include <string.h>

#define ODK_C6_MSG_ID_ESPNOW_RX 0x43455201u
#define ODK_C6_MSG_ID_ESPNOW_CONTROL 0x43455202u
#define ODK_C6_MSG_ID_ESPNOW_STATUS 0x43455203u
#define ODK_C6_DEFAULT_CHANNEL 1u
#define ODK_C6_QUEUE_DEPTH 16u
#define ODK_C6_MAX_FRAME 250u

typedef struct __attribute__((packed)) { uint8_t command; uint8_t channel; uint16_t dwell_ms; } odk_c6_control_t;
typedef struct { size_t len; uint8_t data[ODK_C6_MAX_FRAME]; } odk_c6_frame_t;
static QueueHandle_t s_queue;
static uint8_t s_channel = ODK_C6_DEFAULT_CHANNEL;
static uint32_t s_rx_count;
static uint32_t s_dropped;

static void on_receive(const esp_now_recv_info_t *info, const uint8_t *data, int len)
{
    (void)info;
    if (data == NULL || len < 2 || len > ODK_C6_MAX_FRAME || s_queue == NULL) return;
    odk_c6_frame_t frame = {.len = (size_t)len};
    memcpy(frame.data, data, frame.len);
    if (xQueueSend(s_queue, &frame, 0) != pdTRUE) s_dropped++;
}

static void bridge_task(void *arg)
{
    (void)arg;
    odk_c6_frame_t frame;
    while (xQueueReceive(s_queue, &frame, portMAX_DELAY) == pdTRUE) {
        if (esp_hosted_send_custom_data(ODK_C6_MSG_ID_ESPNOW_RX, frame.data, frame.len) == ESP_OK) s_rx_count++;
    }
}

static void control_callback(uint32_t msg_id, const uint8_t *data, size_t len)
{
    if (msg_id != ODK_C6_MSG_ID_ESPNOW_CONTROL || data == NULL || len < sizeof(odk_c6_control_t)) return;
    const odk_c6_control_t *control = (const odk_c6_control_t *)data;
    if (control->command == 1 && control->channel >= 1 && control->channel <= 13) {
        s_channel = control->channel;
        esp_wifi_set_channel(s_channel, WIFI_SECOND_CHAN_NONE);
    } else if (control->command == 3) { s_rx_count = 0; s_dropped = 0; }
    uint8_t status[9] = {s_channel};
    memcpy(&status[1], &s_rx_count, sizeof(s_rx_count));
    memcpy(&status[5], &s_dropped, sizeof(s_dropped));
    (void)esp_hosted_send_custom_data(ODK_C6_MSG_ID_ESPNOW_STATUS, status, sizeof(status));
}

esp_err_t odk_c6_espnow_bridge_init(void)
{
    s_queue = xQueueCreate(ODK_C6_QUEUE_DEPTH, sizeof(odk_c6_frame_t));
    if (s_queue == NULL) return ESP_ERR_NO_MEM;
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
    ESP_ERROR_CHECK(esp_wifi_set_channel(s_channel, WIFI_SECOND_CHAN_NONE));
    ESP_ERROR_CHECK(esp_now_init());
    ESP_ERROR_CHECK(esp_now_register_recv_cb(on_receive));
    ESP_ERROR_CHECK(esp_hosted_register_custom_callback(ODK_C6_MSG_ID_ESPNOW_CONTROL, control_callback));
    if (xTaskCreate(bridge_task, "c6_espnow_bridge", 4096, NULL, 5, NULL) != pdPASS) return ESP_ERR_NO_MEM;
    return ESP_OK;
}
#endif
