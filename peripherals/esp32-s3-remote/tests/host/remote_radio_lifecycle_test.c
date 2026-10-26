#include "remote_radio_sdk_fixture.h"
#include <assert.h>
#include <stdlib.h>
#include <string.h>
#include "remote_radio.h"
#include "remote_radio_frame.h"
#include "remote_state_frame.h"
struct queue {unsigned count,size,used; unsigned char *bytes;};
QueueHandle_t xQueueCreate(unsigned count,unsigned size) {struct queue *q=calloc(1,sizeof(*q));assert(q);*q=(struct queue){count,size,0,calloc(count,size)};return q;}
void vQueueDelete(QueueHandle_t q){free(q->bytes);free(q);}
int xQueueSend(QueueHandle_t q,const void *item,unsigned wait){(void)wait;if(q->used==q->count)return 0;memcpy(q->bytes+q->size*q->used++,item,q->size);return 1;}
int xQueueOverwrite(QueueHandle_t q,const void *item){assert(q->count==1);memcpy(q->bytes,item,q->size);q->used=1;return 1;}
int xQueueReceive(QueueHandle_t q,void *item,unsigned wait){(void)wait;if(!q->used)return 0;memcpy(item,q->bytes,q->size);q->used--;memmove(q->bytes,q->bytes+q->size,q->used*q->size);return 1;}
static uint32_t clock_ms; static bool paired, delay_tx; static unsigned sent_count; static uint8_t packet[250]; static size_t packet_size;
static void (*rx)(const esp_now_recv_info_t *,const uint8_t *,int);
static void (*tx)(const esp_now_send_info_t *,esp_now_send_status_t);
static const uint8_t gateway[6]={2,1,2,3,4,5},own[6]={2,3,4,5,6,7};
esp_err_t esp_event_loop_create_default(void){return 0;}esp_err_t esp_event_loop_delete_default(void){return 0;}
esp_err_t esp_netif_init(void){return 0;}esp_netif_t *esp_netif_create_default_wifi_sta(void){return (esp_netif_t *)1;}void esp_netif_destroy_default_wifi(esp_netif_t *n){(void)n;}
uint32_t esp_random(void){return 123;}int64_t esp_timer_get_time(void){return (int64_t)clock_ms*1000;}
esp_err_t esp_wifi_init(const wifi_init_config_t *c){(void)c;return 0;}
esp_err_t esp_wifi_set_storage(int n){(void)n;return 0;}esp_err_t esp_wifi_set_mode(int n){(void)n;return 0;}
esp_err_t esp_wifi_start(void){return 0;}esp_err_t esp_wifi_stop(void){return 0;}esp_err_t esp_wifi_deinit(void){return 0;}
esp_err_t esp_wifi_set_ps(int n){(void)n;return 0;}esp_err_t esp_wifi_set_channel(uint8_t n,int s){assert(n==1);(void)s;return 0;}
esp_err_t esp_now_init(void){return 0;}esp_err_t esp_now_deinit(void){rx=NULL;tx=NULL;return 0;}
esp_err_t esp_now_set_pmk(const uint8_t *key){(void)key;return 0;}
esp_err_t esp_now_add_peer(const esp_now_peer_info_t *p){assert(p->encrypt && !memcmp(p->peer_addr,gateway,6));return 0;}
esp_err_t esp_now_register_recv_cb(void (*f)(const esp_now_recv_info_t *,const uint8_t *,int)){rx=f;return 0;}
esp_err_t esp_now_register_send_cb(void (*f)(const esp_now_send_info_t *,esp_now_send_status_t)){tx=f;return 0;}
esp_err_t esp_now_send(const uint8_t *peer,const uint8_t *bytes,size_t size){assert(!memcmp(peer,gateway,6));assert(size<=250);memcpy(packet,bytes,size);packet_size=size;sent_count++;if(!delay_tx)tx(NULL,0);return 0;}
esp_err_t nvs_flash_init(void){return 0;}
esp_err_t nvs_open(const char *name,int mode,nvs_handle_t *h){assert(!strcmp(name,"odk_radio"));(void)mode;*h=1;return paired?0:1;}
esp_err_t nvs_get_blob(nvs_handle_t h,const char *key,void *bytes,size_t *size){(void)h;if(!strcmp(key,"gateway")){assert(*size==6);memcpy(bytes,gateway,6);}else memset(bytes,0x11,*size);return 0;}
esp_err_t nvs_get_u8(nvs_handle_t h,const char *key,uint8_t *value){(void)h;assert(!strcmp(key,"channel"));*value=1;return 0;}
void nvs_close(nvs_handle_t h){(void)h;}
static void deliver(uint8_t type,uint32_t host,uint32_t sequence,const char *payload){uint8_t bytes[250];size_t count=radio_frame_encode(bytes,type,123,host,sequence,(const uint8_t *)payload,payload?strlen(payload):0);esp_now_recv_info_t info={gateway,own};rx(&info,bytes,(int)count);remote_radio_poll();}
int main(void){
 assert(remote_radio_init(NULL)==ESP_ERR_INVALID_ARG);
 QueueHandle_t state=xQueueCreate(1,sizeof(remote_state_t)); remote_state_t current;radio_frame_t frame;
 assert(remote_radio_init(state)==0);remote_radio_input("{}",2);remote_radio_poll();assert(!sent_count);assert(remote_radio_stop()==0);
 paired=true;delay_tx=true;assert(remote_radio_init(state)==0);clock_ms=1000;remote_radio_poll();assert(sent_count==1);assert(radio_frame_decode(packet,packet_size,&frame)&&frame.type==RADIO_HELLO&&frame.host==0);
 remote_radio_poll();deliver(RADIO_HELLO_ACK,55,0,NULL);remote_radio_input("{}",2);assert(sent_count==1);
 const char *json="{\"v\":1,\"type\":\"state\",\"page\":1,\"pages\":2,\"name\":\"Home\",\"canPrev\":false,\"canNext\":true,\"link\":\"wireless\",\"actions\":[{\"id\":\"open\",\"label\":\"Open\"}]}";
 deliver(RADIO_STATE,66,1,json);assert(!xQueueReceive(state,&current,0));
 deliver(RADIO_STATE,55,1,"{}");assert(!xQueueReceive(state,&current,0));
 deliver(RADIO_STATE,55,2,json);assert(xQueueReceive(state,&current,0));assert(current.received&&current.action_count==1);
 // The prior HELLO still owns the transmitter. State ACK must wait, not vanish.
 assert(radio_frame_decode(packet,packet_size,&frame)&&frame.type==RADIO_HELLO);
 delay_tx=false;tx(NULL,0);remote_radio_poll();
 assert(radio_frame_decode(packet,packet_size,&frame)&&frame.type==RADIO_STATE_ACK&&frame.sequence==2);
 remote_radio_poll();remote_radio_input("{}",2);assert(radio_frame_decode(packet,packet_size,&frame)&&frame.type==RADIO_INPUT);
 remote_radio_poll();unsigned before=sent_count;clock_ms=4501;remote_radio_input("{}",2);assert(sent_count==before);remote_radio_poll();assert(xQueueReceive(state,&current,0)&&!current.received&&!current.action_count);
 assert(remote_radio_stop()==0);vQueueDelete(state);return 0;
}
