#include "remote_radio.h"
#include "remote_radio_frame.h"
#include "remote_state_frame.h"
#include <string.h>
#include "esp_event.h"
#include "esp_netif.h"
#include "esp_now.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs.h"
#include "nvs_flash.h"

typedef struct { uint8_t bytes[250]; size_t length; } received_t;
static QueueHandle_t s_rx, s_tx_done, s_state;
static esp_netif_t *s_netif;
static uint8_t s_peer[6];
static uint32_t s_boot, s_host, s_input_sequence, s_last_host, s_last_hello;
static uint32_t s_committed, s_pending_ack;
static bool s_wifi_init, s_wifi_started, s_now, s_event_loop, s_busy, s_ready;
static radio_assembly_t s_assembly;
static uint32_t now_ms(void) { return (uint32_t)(esp_timer_get_time()/1000); }
static void receive(const esp_now_recv_info_t *info, const uint8_t *data, int length)
{
    if (!s_rx || !info || !info->src_addr || !info->des_addr || !data || length<RADIO_HEADER || length>250 ||
        memcmp(info->src_addr,s_peer,6) || (info->des_addr[0]&1)) return;
    received_t item={.length=(size_t)length}; memcpy(item.bytes,data,(size_t)length);
    (void)xQueueSend(s_rx,&item,0);
}
static void sent(const esp_now_send_info_t *info, esp_now_send_status_t status)
{
    (void)info;
    if (s_tx_done) (void)xQueueOverwrite(s_tx_done,&status);
}
static bool transmit(uint8_t type, uint32_t sequence, const uint8_t *payload, size_t length)
{
    if (!s_now || s_busy) return false;
    uint8_t bytes[250]; size_t count=radio_frame_encode(bytes,type,s_boot,s_host,sequence,payload,length);
    if (!count || esp_now_send(s_peer,bytes,count)!=ESP_OK) return false;
    s_busy=true;
    return true;
}
static void idle(void)
{
    if (s_ready) {
        remote_state_t empty={0}; (void)xQueueOverwrite(s_state,&empty);
    }
    s_ready=false; s_host=0; s_committed=0; s_pending_ack=0; memset(&s_assembly,0,sizeof(s_assembly));
}
void remote_radio_poll(void)
{
    if (!s_now) return;
    uint32_t now=now_ms();
    esp_now_send_status_t status;
    if (xQueueReceive(s_tx_done,&status,0)==pdTRUE) {
        s_busy=false;
        if (status!=ESP_NOW_SEND_SUCCESS) idle();
    }
    if (s_host && now-s_last_host>3500) idle();
    received_t item;
    // Work remains bounded so radio traffic cannot starve touch polling.
    for (int i=0; i<8 && xQueueReceive(s_rx,&item,0)==pdTRUE; ++i) {
        radio_frame_t frame;
        if (!radio_frame_decode(item.bytes,item.length,&frame) || frame.remote!=s_boot) continue;
        if (frame.type==RADIO_HELLO_ACK && frame.host) {
            if (!s_host || s_host==frame.host) { s_host=frame.host; s_last_host=now; }
            continue;
        }
        if (!s_host || frame.host!=s_host || frame.type!=RADIO_STATE || frame.sequence<=s_committed) continue;
        if (radio_state_accept(&s_assembly,&frame,now)) {
            remote_state_t state;
            if (!remote_state_frame_parse((const char *)s_assembly.bytes,&state)) continue;
            if (xQueueOverwrite(s_state,&state)!=pdPASS) continue;
            s_committed=frame.sequence; s_ready=true;
            s_pending_ack=frame.sequence;
        }
    }
    // One pending state ACK survives a busy transmitter. Physical input never waits.
    if (s_pending_ack && transmit(RADIO_STATE_ACK,s_pending_ack,NULL,0)) s_pending_ack=0;
    if (now-s_last_hello>=1000) { s_last_hello=now; transmit(RADIO_HELLO,0,NULL,0); }
}
bool remote_radio_ready(void)
{
    return s_ready && s_host && now_ms()-s_last_host<=3500;
}
void remote_radio_input(const char *json, size_t length)
{
    // Never retain or retry physical input. A failed send consumes this gesture.
    if (!remote_radio_ready() || length>96 || s_input_sequence==UINT32_MAX) return;
    transmit(RADIO_INPUT,++s_input_sequence,(const uint8_t *)json,length);
}
esp_err_t remote_radio_init(QueueHandle_t state_queue)
{
    if (state_queue == NULL) return ESP_ERR_INVALID_ARG;
    s_state=state_queue; s_boot=esp_random(); if (!s_boot) s_boot=1;
    esp_err_t error=nvs_flash_init();
    if (error!=ESP_OK) return error; // Never erase existing NVS on initialization failure.
    nvs_handle_t nvs;
    error=nvs_open("odk_radio",NVS_READONLY,&nvs);
    if (error==ESP_ERR_NVS_NOT_FOUND) return ESP_OK; // Unpaired devices keep an idle surface.
    if (error!=ESP_OK) return error;
    uint8_t pmk[16],lmk[16],channel=0; size_t a=6,b=16,c=16;
    bool valid=nvs_get_blob(nvs,"gateway",s_peer,&a)==ESP_OK && a==6 && !(s_peer[0]&1) &&
        memcmp(s_peer,"\0\0\0\0\0\0",6) && nvs_get_blob(nvs,"pmk",pmk,&b)==ESP_OK && b==16 &&
        nvs_get_blob(nvs,"lmk",lmk,&c)==ESP_OK && c==16 && nvs_get_u8(nvs,"channel",&channel)==ESP_OK && channel>=1 && channel<=11;
    nvs_close(nvs); if (!valid) return ESP_ERR_INVALID_ARG;
    s_rx=xQueueCreate(8,sizeof(received_t)); s_tx_done=xQueueCreate(1,sizeof(esp_now_send_status_t));
    if (!s_rx || !s_tx_done) return ESP_ERR_NO_MEM;
    error=esp_netif_init(); if (error!=ESP_OK) return error;
    error=esp_event_loop_create_default(); if (error!=ESP_OK) return error; s_event_loop=true;
    s_netif=esp_netif_create_default_wifi_sta(); if (!s_netif) return ESP_ERR_NO_MEM;
    wifi_init_config_t wifi=WIFI_INIT_CONFIG_DEFAULT();
    error=esp_wifi_init(&wifi); if (error!=ESP_OK) return error; s_wifi_init=true;
    if ((error=esp_wifi_set_storage(WIFI_STORAGE_RAM))!=ESP_OK || (error=esp_wifi_set_mode(WIFI_MODE_STA))!=ESP_OK ||
        (error=esp_wifi_start())!=ESP_OK) return error;
    s_wifi_started=true;
    if ((error=esp_wifi_set_ps(WIFI_PS_NONE))!=ESP_OK || (error=esp_wifi_set_channel(channel,WIFI_SECOND_CHAN_NONE))!=ESP_OK ||
        (error=esp_now_init())!=ESP_OK) return error;
    s_now=true;
    esp_now_peer_info_t peer={.channel=channel,.ifidx=WIFI_IF_STA,.encrypt=true};
    memcpy(peer.peer_addr,s_peer,6); memcpy(peer.lmk,lmk,16);
    if ((error=esp_now_set_pmk(pmk))!=ESP_OK || (error=esp_now_add_peer(&peer))!=ESP_OK ||
        (error=esp_now_register_recv_cb(receive))!=ESP_OK || (error=esp_now_register_send_cb(sent))!=ESP_OK) return error;
    memset(pmk,0,sizeof(pmk)); memset(lmk,0,sizeof(lmk)); return ESP_OK;
}
esp_err_t remote_radio_stop(void)
{
    // Stop radio callbacks before releasing their queues. Retain ownership on error.
    esp_err_t error;
    if (s_now) { if ((error=esp_now_deinit())!=ESP_OK) return error; s_now=false; }
    if (s_wifi_started) { if ((error=esp_wifi_stop())!=ESP_OK) return error; s_wifi_started=false; }
    if (s_wifi_init) { if ((error=esp_wifi_deinit())!=ESP_OK) return error; s_wifi_init=false; }
    if (s_netif) { esp_netif_destroy_default_wifi(s_netif); s_netif=NULL; }
    if (s_event_loop) { if ((error=esp_event_loop_delete_default())!=ESP_OK) return error; s_event_loop=false; }
    if (s_rx) { vQueueDelete(s_rx); s_rx=NULL; }
    if (s_tx_done) { vQueueDelete(s_tx_done); s_tx_done=NULL; }
    idle(); s_state=NULL; s_busy=false; s_input_sequence=0; s_last_hello=0; return ESP_OK;
}
