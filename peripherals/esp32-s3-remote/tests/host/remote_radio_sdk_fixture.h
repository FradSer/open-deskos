#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef int esp_err_t;
#define ESP_OK 0
#define ESP_ERR_NVS_NOT_FOUND 1
#define ESP_ERR_INVALID_ARG 2
#define ESP_ERR_NO_MEM 3
#define pdTRUE 1
#define pdPASS 1
#define NVS_READONLY 0
#define WIFI_INIT_CONFIG_DEFAULT() (wifi_init_config_t){0}
#define WIFI_STORAGE_RAM 0
#define WIFI_MODE_STA 0
#define WIFI_PS_NONE 0
#define WIFI_SECOND_CHAN_NONE 0
#define WIFI_IF_STA 0
#define ESP_NOW_SEND_SUCCESS 0
typedef struct queue *QueueHandle_t;
QueueHandle_t xQueueCreate(unsigned count,unsigned size);
int xQueueSend(QueueHandle_t q,const void *item,unsigned wait);
int xQueueReceive(QueueHandle_t q,void *item,unsigned wait);
int xQueueOverwrite(QueueHandle_t q,const void *item);
void vQueueDelete(QueueHandle_t q);
typedef struct { int unused; } esp_netif_t;
typedef struct { int unused; } wifi_init_config_t;
typedef struct { const uint8_t *src_addr,*des_addr; } esp_now_recv_info_t;
typedef struct { int unused; } esp_now_send_info_t;
typedef int esp_now_send_status_t;
typedef struct {uint8_t peer_addr[6],lmk[16],channel; int ifidx; bool encrypt;} esp_now_peer_info_t;
typedef unsigned nvs_handle_t;
esp_err_t esp_event_loop_create_default(void);
esp_err_t esp_event_loop_delete_default(void);
esp_err_t esp_netif_init(void);
esp_netif_t *esp_netif_create_default_wifi_sta(void);
void esp_netif_destroy_default_wifi(esp_netif_t *netif);
uint32_t esp_random(void);
int64_t esp_timer_get_time(void);
esp_err_t esp_wifi_init(const wifi_init_config_t *config);
esp_err_t esp_wifi_set_storage(int value);
esp_err_t esp_wifi_set_mode(int value);
esp_err_t esp_wifi_start(void);
esp_err_t esp_wifi_stop(void);
esp_err_t esp_wifi_deinit(void);
esp_err_t esp_wifi_set_ps(int value);
esp_err_t esp_wifi_set_channel(uint8_t value,int secondary);
esp_err_t esp_now_init(void);
esp_err_t esp_now_deinit(void);
esp_err_t esp_now_set_pmk(const uint8_t *key);
esp_err_t esp_now_add_peer(const esp_now_peer_info_t *peer);
esp_err_t esp_now_register_recv_cb(void (*callback)(const esp_now_recv_info_t *,const uint8_t *,int));
esp_err_t esp_now_register_send_cb(void (*callback)(const esp_now_send_info_t *,esp_now_send_status_t));
esp_err_t esp_now_send(const uint8_t *peer,const uint8_t *data,size_t length);
esp_err_t nvs_flash_init(void);
esp_err_t nvs_open(const char *name,int mode,nvs_handle_t *handle);
esp_err_t nvs_get_blob(nvs_handle_t handle,const char *key,void *bytes,size_t *size);
esp_err_t nvs_get_u8(nvs_handle_t handle,const char *key,uint8_t *value);
void nvs_close(nvs_handle_t handle);
