#include "odk_espnow_validator_idf.h"

#if CONFIG_IDF_TARGET_ESP32S3
esp_err_t odk_espnow_validator_init(void)
{
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t odk_espnow_validator_start(void)
{
    return ESP_ERR_NOT_SUPPORTED;
}

esp_err_t odk_espnow_validator_send_channel(uint8_t channel)
{
    (void)channel;
    return ESP_ERR_NOT_SUPPORTED;
}

void odk_espnow_validator_log_stats(void)
{
}
#else

#include "esp_hosted.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "espnow_validator";
static odk_espnow_validator_t *s_validator;

static void custom_data_callback(uint32_t msg_id, const uint8_t *data, size_t len)
{
    if (s_validator == NULL || data == NULL) return;
    if (msg_id == ODK_C6_MSG_ID_ESPNOW_RX) {
        if (len <= ODK_ESPNOW_MAC_LEN || len > ODK_ESPNOW_MAC_LEN + ODK_ESPNOW_MAX_PAYLOAD) return;
        (void)odk_espnow_validator_enqueue(s_validator, data, data + ODK_ESPNOW_MAC_LEN,
                                            len - ODK_ESPNOW_MAC_LEN);
    } else if (msg_id == ODK_C6_MSG_ID_ESPNOW_TX_RESULT) {
        if (len != ODK_ESPNOW_MAC_LEN + 1u) return;
        odk_espnow_validator_note_tx_result(s_validator, data, data[ODK_ESPNOW_MAC_LEN]);
    } else if (msg_id == ODK_C6_MSG_ID_ESPNOW_PEER_RESULT) {
        if (len != ODK_ESPNOW_MAC_LEN + 2u) return;
        ESP_LOGI(TAG, "[espnow] peer op=%u mac=%02x:%02x:%02x:%02x:%02x:%02x status=%u",
                 data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7]);
    }
}

static int send_custom_data(void *ctx, uint32_t msg_id, const uint8_t *data, size_t len)
{
    (void)ctx;
    return esp_hosted_send_custom_data(msg_id, data, len);
}

static void validator_task(void *arg)
{
    (void)arg;
    odk_espnow_frame_event_t event;
    while (true) {
        if (!odk_espnow_validator_process_one(s_validator, &event)) {
            vTaskDelay(pdMS_TO_TICKS(20));
            continue;
        }
        if (event.result != ODK_ESPNOW_FRAME_OK) {
            ESP_LOGW(TAG, "[espnow] rejected frame result=%d len=%u",
                     event.result, (unsigned)event.payload_len);
            continue;
        }
        const odk_espnow_fleet_message_t *frame = &event.message;
        if (frame->type == ODK_ESPNOW_TYPE_ENV) {
            ESP_LOGI(TAG, "[espnow] rx type=ENV node=%u src=%02x:%02x:%02x:%02x:%02x:%02x temp=%.2f humidity=%.2f pressure=%.2f lux=%.2f vpd=%.2f channel=%u",
                     frame->node_id,
                     event.src_mac[0], event.src_mac[1], event.src_mac[2],
                     event.src_mac[3], event.src_mac[4], event.src_mac[5],
                     frame->temp_c, frame->humidity, frame->pressure_pa,
                     frame->lux, frame->vpd_kpa, frame->channel);
        } else {
            ESP_LOGI(TAG, "[espnow] rx type=STATUS node=%u mac=%02x:%02x:%02x:%02x:%02x:%02x soil_raw=%ld soil_pct=%.2f valid=%u status=%u",
                     frame->node_id, frame->mac[0], frame->mac[1], frame->mac[2],
                     frame->mac[3], frame->mac[4], frame->mac[5],
                     (long)frame->soil_raw, frame->soil_percent, frame->soil_valid, frame->status);
        }
    }
}

esp_err_t odk_espnow_validator_init(void)
{
    if (s_validator != NULL) return ESP_ERR_INVALID_STATE;
    const odk_espnow_transport_t transport = {
        .send_custom_data = send_custom_data,
        .ctx = NULL,
    };
    s_validator = odk_espnow_validator_create(&transport);
    if (s_validator == NULL) return ESP_ERR_NO_MEM;
    esp_err_t err = esp_hosted_register_custom_callback(ODK_C6_MSG_ID_ESPNOW_RX,
                                                         custom_data_callback);
    if (err == ESP_OK) {
        err = esp_hosted_register_custom_callback(ODK_C6_MSG_ID_ESPNOW_TX_RESULT,
                                                   custom_data_callback);
    }
    if (err == ESP_OK) {
        err = esp_hosted_register_custom_callback(ODK_C6_MSG_ID_ESPNOW_PEER_RESULT,
                                                   custom_data_callback);
    }
    if (err != ESP_OK) {
        odk_espnow_validator_delete(s_validator);
        s_validator = NULL;
    }
    return err;
}

esp_err_t odk_espnow_validator_start(void)
{
    if (s_validator == NULL) return ESP_ERR_INVALID_STATE;
    if (xTaskCreate(validator_task, "espnow_validator", 4096, NULL, 5, NULL) != pdPASS) {
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "C6 custom-data bridge ready");
    ESP_LOGI(TAG, "ESP-NOW validator ready: channel=%u", ODK_ESPNOW_DEFAULT_CHANNEL);
    return ESP_OK;
}

esp_err_t odk_espnow_validator_send_channel(uint8_t channel)
{
    if (s_validator == NULL) return ESP_ERR_INVALID_STATE;
    return odk_espnow_validator_send_control(s_validator,
                                               ODK_C6_CONTROL_SET_CHANNEL,
                                               channel, 0) == ODK_OK ? ESP_OK : ESP_ERR_INVALID_ARG;
}

void odk_espnow_validator_log_stats(void)
{
    odk_espnow_stats_t stats;
    if (s_validator == NULL) return;
    odk_espnow_validator_get_stats(s_validator, &stats);
    ESP_LOGI(TAG, "[espnow] stats frames=%lu env=%lu status=%lu malformed=%lu dropped=%lu duplicate=%lu",
             (unsigned long)stats.frames, (unsigned long)stats.environment_frames,
             (unsigned long)(stats.node1_frames + stats.node2_frames),
             (unsigned long)stats.malformed, (unsigned long)stats.dropped,
             (unsigned long)stats.duplicates);
}
#endif
