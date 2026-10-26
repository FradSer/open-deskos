#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include "cJSON.h"
#include "driver/usb_serial_jtag.h"
#include "esp_event.h"
#include "esp_mac.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_random.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "mbedtls/base64.h"
#include "nvs_flash.h"
#include "gateway_line.h"

#define RADIO_LIMIT 250
#define PEER_LIMIT 7

typedef struct {
  uint8_t mac[6];
  uint8_t bytes[RADIO_LIMIT];
  size_t length;
} radio_record_t;

static QueueHandle_t receive_queue;
static QueueHandle_t send_queue;
static atomic_uint dropped;
static char boot_session[9];
static uint8_t own_mac[6];
static bool configured;
static char sending_id[49];

static void mac_string(const uint8_t *mac, char out[18]) {
  snprintf(out, 18, "%02x:%02x:%02x:%02x:%02x:%02x", MAC2STR(mac));
}

static bool hex(const char *text, uint8_t *out, size_t count) {
  if (!text || strlen(text) != count * 2) return false;
  for (size_t i = 0; i < count; i++) {
    unsigned int value;
    for (size_t j = i * 2; j < i * 2 + 2; j++) {
      if (!((text[j] >= '0' && text[j] <= '9') || (text[j] >= 'a' && text[j] <= 'f') || (text[j] >= 'A' && text[j] <= 'F'))) return false;
    }
    if (sscanf(text + i * 2, "%2x", &value) != 1) return false;
    out[i] = (uint8_t)value;
  }
  return true;
}

static bool mac_parse(const char *text, uint8_t out[6]) {
  if (!text || strlen(text) != 17) return false;
  char compact[13];
  for (size_t i = 0; i < 6; i++) {
    if (i < 5 && text[i * 3 + 2] != ':') return false;
    compact[i * 2] = text[i * 3]; compact[i * 2 + 1] = text[i * 3 + 1];
  }
  compact[12] = 0;
  return hex(compact, out, 6) && !(out[0] & 1) && memcmp(out, "\0\0\0\0\0\0", 6) != 0;
}

static const char *string(cJSON *record, const char *name) {
  const cJSON *value = cJSON_GetObjectItemCaseSensitive(record, name);
  return cJSON_IsString(value) ? value->valuestring : NULL;
}

static cJSON *reply(const char *type, const char *id) {
  cJSON *record = cJSON_CreateObject();
  if (!record) return NULL;
  cJSON_AddNumberToObject(record, "v", 1);
  cJSON_AddStringToObject(record, "type", type);
  if (id) cJSON_AddStringToObject(record, "id", id);
  return record;
}

static void output(cJSON *record) {
  if (!record) return;
  char bytes[512];
  if (cJSON_PrintPreallocated(record, bytes, sizeof(bytes), false)) {
    size_t length = strlen(bytes);
    if (length + 1 <= sizeof(bytes)) {
      bytes[length++] = '\n';
      // A short write leaves a broken record, never a valid suffix on its own.
      int written = usb_serial_jtag_write_bytes(bytes, length, pdMS_TO_TICKS(20));
      if (written > 0 && (size_t)written < length) usb_serial_jtag_write_bytes("\n", 1, pdMS_TO_TICKS(20));
    }
  }
  cJSON_Delete(record);
}

static void result(const char *type, const char *id, bool ok) {
  cJSON *record = reply(ok ? type : "error", id);
  if (record) cJSON_AddBoolToObject(record, "ok", ok);
  output(record);
}

static void status(const char *type, const char *id) {
  char mac[18]; mac_string(own_mac, mac);
  uint8_t channel = 0; wifi_second_chan_t second;
  esp_now_peer_num_t peers = {0};
  esp_wifi_get_channel(&channel, &second);
  esp_now_get_peer_num(&peers);
  cJSON *record = reply(type, id);
  if (!record) return;
  cJSON_AddStringToObject(record, "board", "m5stack-nanoc6");
  cJSON_AddStringToObject(record, "firmware", "0.1.0");
  cJSON_AddStringToObject(record, "session", boot_session);
  cJSON_AddStringToObject(record, "mac", mac);
  cJSON_AddNumberToObject(record, "channel", channel);
  cJSON_AddNumberToObject(record, "peers", peers.encrypt_num);
  cJSON_AddBoolToObject(record, "radio", true);
  cJSON_AddNumberToObject(record, "dropped", atomic_load(&dropped));
  output(record);
}

static void received(const esp_now_recv_info_t *info, const uint8_t *data, int length) {
  if (!info || !data || length <= 0 || length > RADIO_LIMIT || memcmp(info->des_addr, own_mac, 6) != 0) return;
  esp_now_peer_info_t peer;
  if (esp_now_get_peer(info->src_addr, &peer) != ESP_OK || !peer.encrypt) return;
  radio_record_t record = {.length = (size_t)length};
  memcpy(record.mac, info->src_addr, 6); memcpy(record.bytes, data, length);
  if (xQueueSend(receive_queue, &record, 0) != pdTRUE) atomic_fetch_add(&dropped, 1);
}

static void sent(const wifi_tx_info_t *info, esp_now_send_status_t send_status) {
  (void)info;
  xQueueOverwrite(send_queue, &send_status);
}

static void command(const char *bytes) {
  const size_t length = strlen(bytes);
  if (!gateway_command_encoding_valid((const uint8_t *)bytes, length)) return;
  cJSON *record = cJSON_ParseWithLengthOpts(bytes, length + 1, NULL, true);
  if (!cJSON_IsObject(record)) { cJSON_Delete(record); return; }
  const char *type = string(record, "type");
  const char *id = string(record, "id");
  const cJSON *version = cJSON_GetObjectItemCaseSensitive(record, "v");
  if (!cJSON_IsNumber(version) || version->valuedouble != 1 || !type || !id || !*id || strlen(id) > 48) goto done;
  // Duplicate keys cannot select a different command in different parsers.
  for (cJSON *a = record->child; a; a = a->next) {
    for (cJSON *b = a->next; b; b = b->next) if (strcmp(a->string, b->string) == 0) goto done;
  }
  if (strcmp(type, "hello") == 0 || strcmp(type, "status") == 0) status(type, id);
  else if (strcmp(type, "ping") == 0) result(type, id, true);
  else if (strcmp(type, "configure") == 0) {
    uint8_t pmk[16];
    cJSON *channel = cJSON_GetObjectItemCaseSensitive(record, "channel");
    bool valid = !*sending_id && hex(string(record, "pmk"), pmk, 16) && cJSON_IsNumber(channel)
      && channel->valuedouble == channel->valueint && channel->valueint >= 1 && channel->valueint <= 11;
    if (valid) {
      configured = false;
      esp_now_peer_info_t peer;
      while (esp_now_fetch_peer(true, &peer) == ESP_OK) esp_now_del_peer(peer.peer_addr);
      xQueueReset(receive_queue);
      valid = esp_wifi_set_channel(channel->valueint, WIFI_SECOND_CHAN_NONE) == ESP_OK && esp_now_set_pmk(pmk) == ESP_OK;
      configured = valid;
    }
    memset(pmk, 0, sizeof(pmk));
    result(type, id, valid);
  } else if (strcmp(type, "peer") == 0) {
    esp_now_peer_num_t count = {0}; esp_now_get_peer_num(&count);
    esp_now_peer_info_t peer = {.ifidx = WIFI_IF_STA, .encrypt = true, .channel = 0};
    bool valid = configured && !*sending_id && count.encrypt_num < PEER_LIMIT
      && mac_parse(string(record, "mac"), peer.peer_addr) && hex(string(record, "lmk"), peer.lmk, 16);
    result(type, id, valid && esp_now_add_peer(&peer) == ESP_OK);
    memset(peer.lmk, 0, sizeof(peer.lmk));
  } else if (strcmp(type, "send") == 0) {
    uint8_t destination[6], payload[RADIO_LIMIT]; size_t size = 0;
    const char *encoded = string(record, "payload");
    bool valid = configured && !*sending_id && mac_parse(string(record, "peer"), destination)
      && esp_now_is_peer_exist(destination) && encoded && strlen(encoded) <= 336
      && mbedtls_base64_decode(payload, sizeof(payload), &size, (const unsigned char *)encoded, strlen(encoded)) == 0 && size > 0;
    if (valid) {
      snprintf(sending_id, sizeof(sending_id), "%s", id);
      if (esp_now_send(destination, payload, size) != ESP_OK) { sending_id[0] = 0; result(type, id, false); }
    } else result(type, id, false);
  } else result(type, id, false);
done:
  cJSON_Delete(record);
}

void app_main(void) {
  ESP_ERROR_CHECK(nvs_flash_init());
  ESP_ERROR_CHECK(esp_netif_init());
  ESP_ERROR_CHECK(esp_event_loop_create_default());
  wifi_init_config_t config = WIFI_INIT_CONFIG_DEFAULT();
  ESP_ERROR_CHECK(esp_wifi_init(&config));
  ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
  ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
  ESP_ERROR_CHECK(esp_wifi_start());
  ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
  ESP_ERROR_CHECK(esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE));
  ESP_ERROR_CHECK(esp_wifi_get_mac(WIFI_IF_STA, own_mac));
  ESP_ERROR_CHECK(esp_now_init());
  receive_queue = xQueueCreate(8, sizeof(radio_record_t));
  send_queue = xQueueCreate(1, sizeof(esp_now_send_status_t));
  if (!receive_queue || !send_queue) abort();
  ESP_ERROR_CHECK(esp_now_register_recv_cb(received));
  ESP_ERROR_CHECK(esp_now_register_send_cb(sent));
  snprintf(boot_session, sizeof(boot_session), "%08lx", (unsigned long)esp_random());
  const usb_serial_jtag_driver_config_t usb = {.tx_buffer_size = 2048, .rx_buffer_size = 2048};
  ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&usb));
  gateway_line_t line = {0}; uint8_t bytes[128];
  while (true) {
    int count = usb_serial_jtag_read_bytes(bytes, sizeof(bytes), pdMS_TO_TICKS(10));
    for (int i = 0; i < count; i++) if (gateway_line_push(&line, bytes[i])) command(line.bytes);
    esp_now_send_status_t send_status;
    if (xQueueReceive(send_queue, &send_status, 0) == pdTRUE && *sending_id) {
      result("send", sending_id, send_status == ESP_NOW_SEND_SUCCESS);
      sending_id[0] = 0;
    }
    radio_record_t received_record;
    for (size_t i = 0; i < 8 && xQueueReceive(receive_queue, &received_record, 0) == pdTRUE; i++) {
      unsigned char encoded[337]; size_t size;
      if (mbedtls_base64_encode(encoded, sizeof(encoded), &size, received_record.bytes, received_record.length) != 0) continue;
      encoded[size] = 0;
      char mac[18]; mac_string(received_record.mac, mac);
      cJSON *event = reply("rx", NULL);
      if (!event) continue;
      cJSON_AddStringToObject(event, "peer", mac);
      cJSON_AddStringToObject(event, "session", boot_session);
      cJSON_AddStringToObject(event, "payload", (const char *)encoded);
      output(event);
    }
  }
}
