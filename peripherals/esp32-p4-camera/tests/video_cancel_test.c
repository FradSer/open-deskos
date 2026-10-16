/* Deterministic receive fixture; no device or live media is used. */
#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdatomic.h>
typedef int esp_err_t;
typedef uint32_t TickType_t;
typedef int BaseType_t;
typedef void *SemaphoreHandle_t;
typedef int portMUX_TYPE;
#define portMUX_INITIALIZER_UNLOCKED 0
static int lock_depth;
#define portENTER_CRITICAL_SAFE(lock) ((void)(lock), ++lock_depth)
#define portEXIT_CRITICAL_SAFE(lock) ((void)(lock), --lock_depth)
#define pdFALSE 0
#define pdTRUE 1
#define portMAX_DELAY UINT32_MAX
#define pdMS_TO_TICKS(value) (value)
#define ESP_OK 0
#define ESP_ERR_NO_MEM 1
#define ESP_ERR_INVALID_ARG 2
#define V4L2_CAP_VIDEO_M2M 1
#define ESP_VIDEO_M2M_TRIGGER 2
static atomic_bool live;
static unsigned takes, done_reads, notify_calls, cancel_after;
static TickType_t now, total_wait, last_wait;
static bool signal_ready, cancel_on_signal;
static TickType_t xTaskGetTickCount(void) { return now; }
static BaseType_t xSemaphoreTake(SemaphoreHandle_t ready, TickType_t ticks) {
    assert(ready==(void *)1 && lock_depth==0);
    ++takes; last_wait=ticks;
    if (cancel_after && takes==cancel_after) atomic_store(&live, false);
    if (signal_ready) {
        if (cancel_on_signal) atomic_store(&live, false);
        return pdTRUE;
    }
    assert(ticks!=portMAX_DELAY); now+=ticks; total_wait+=ticks;
    return pdFALSE;
}
/* GENERATED_HELPER */
struct esp_video_buffer_element { unsigned index; };
struct esp_video_stream { SemaphoreHandle_t ready_sem; };
struct esp_video;
struct operations { esp_err_t (*notify)(struct esp_video *, int, void *); };
struct esp_video { unsigned device_caps; struct operations *ops; struct esp_video_stream stream; };
static struct esp_video_buffer_element element={7};
static struct esp_video_stream *esp_video_get_stream(struct esp_video *video, uint32_t type) { return &video->stream; }
static struct esp_video_buffer_element *esp_video_get_done_element(struct esp_video *video, uint32_t type) { ++done_reads; return &element; }
static esp_err_t notify(struct esp_video *video, int event, void *value) { assert(event==ESP_VIDEO_M2M_TRIGGER); ++notify_calls; return ESP_OK; }
/* GENERATED_RECEIVE */
static void reset(void) {
    atomic_store(&live, true); takes=done_reads=notify_calls=cancel_after=0;
    now=total_wait=last_wait=0; signal_ready=cancel_on_signal=false;
}
int main(void) {
    struct operations ops={notify};
    struct esp_video video={.device_caps=V4L2_CAP_VIDEO_M2M, .ops=&ops, .stream={(void *)1}};
    reset(); signal_ready=true;
    assert(esp_video_recv_element(&video,1,portMAX_DELAY)==&element);
    assert(takes==1 && last_wait==portMAX_DELAY && done_reads==1 && notify_calls==1);
    assert(p4_video_bind_receiver(&video,&live)==ESP_OK);
    reset(); cancel_after=1;
    assert(esp_video_recv_element(&video,1,portMAX_DELAY)==NULL);
    assert(total_wait==100 && done_reads==0 && notify_calls==1);
    reset(); cancel_after=3;
    assert(esp_video_recv_element(&video,1,portMAX_DELAY)==NULL);
    assert(takes==3 && total_wait==300 && notify_calls==1);
    reset(); signal_ready=true;
    assert(esp_video_recv_element(&video,1,portMAX_DELAY)==&element);
    assert(takes==1 && last_wait==100 && done_reads==1);
    reset(); signal_ready=true; cancel_on_signal=true;
    assert(esp_video_recv_element(&video,1,portMAX_DELAY)==NULL && done_reads==0);
    reset(); atomic_store(&live,false);
    assert(esp_video_recv_element(&video,1,portMAX_DELAY)==NULL && takes==0 && notify_calls==0);
    reset(); assert(esp_video_recv_element(&video,1,250)==NULL);
    assert(takes==3 && total_wait==250 && last_wait==50 && notify_calls==1);
    reset(); now=UINT32_MAX-149;
    assert(esp_video_recv_element(&video,1,250)==NULL && total_wait==250);
    reset(); assert(esp_video_recv_element(&video,1,0)==NULL && takes==1 && last_wait==0);
    reset(); assert(p4_video_bind_receiver(&video,NULL)==ESP_OK);
    assert(p4_video_receiver_flag(&video)==NULL);
    signal_ready=true;
    assert(esp_video_recv_element(&video,1,portMAX_DELAY)==&element && last_wait==portMAX_DELAY);
    assert(p4_video_bind_receiver(NULL,&live)==ESP_ERR_INVALID_ARG);
    int devices[17];
    for (int i=0; i<16; ++i) assert(p4_video_bind_receiver(&devices[i],&live)==ESP_OK);
    assert(p4_video_bind_receiver(&devices[16],&live)==ESP_ERR_NO_MEM);
    for (int i=0; i<16; ++i) assert(p4_video_bind_receiver(&devices[i],NULL)==ESP_OK);
    assert(p4_video_bind_receiver(&devices[16],&live)==ESP_OK);
    assert(p4_video_bind_receiver(&devices[16],NULL)==ESP_OK);
    assert(lock_depth==0);
    return 0;
}
