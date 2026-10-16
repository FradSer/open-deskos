/* Deterministic driver and task fixture for the actual UVC lifecycle functions. */
#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdatomic.h>
#include <string.h>
typedef int esp_err_t;
typedef void *TaskHandle_t;
typedef unsigned EventBits_t;
typedef struct { EventBits_t bits; } StaticEventGroup_t;
typedef StaticEventGroup_t *EventGroupHandle_t;
#define ESP_OK 0
#define ESP_FAIL -1
#define ESP_ERR_INVALID_STATE 1
#define ESP_ERR_INVALID_ARG 4
#define ESP_ERR_NO_MEM 2
#define ESP_ERR_TIMEOUT 3
#define ESP_RETURN_ON_FALSE(condition, error, ...) do { if (!(condition)) return (error); } while (0)
#define ESP_RETURN_ON_ERROR(expression, ...) do { esp_err_t result=(expression); if (result != ESP_OK) return result; } while (0)
#define ESP_LOGI(...) ((void)0)
#define ESP_LOGE(...) ((void)0)
#define ESP_LOGW(...) ((void)0)
#define pdFALSE 0
#define pdTRUE 1
#define pdPASS 1
#define pdMS_TO_TICKS(value) (value)
#define P4_UVC_EXIT 1
#define P4_UVC_CAPTURE_BUFFERS 2
#define P4_UVC_JPEG_BUFFERS 2
#define P4_UVC_RESET_FAILS 30
#define P4_UVC_STOP_WAIT_MS 500
#define P4_UVC_TASK_STACK 8192
#define P4_UVC_WIDTH 1280
#define P4_UVC_HEIGHT 720
#define CONFIG_APP_UVC_JPEG_QUALITY 80
#define ESP_VIDEO_MIPI_CSI_DEVICE_NAME "capture"
#define ESP_VIDEO_JPEG_DEVICE_NAME "encoder"
#define O_RDONLY 0
#define V4L2_BUF_TYPE_VIDEO_CAPTURE 1
#define V4L2_BUF_TYPE_VIDEO_OUTPUT 2
#define V4L2_MEMORY_MMAP 1
#define VIDIOC_STREAMON 1
#define VIDIOC_STREAMOFF 2
#define VIDIOC_DQBUF 3
#define VIDIOC_QBUF 4
#define VIDIOC_S_EXT_CTRLS 5
#define VIDIOC_P4_RECEIVER_FLAG 8
#define V4L2_CID_JPEG_CLASS 6
#define V4L2_CID_JPEG_COMPRESSION_QUALITY 7
struct v4l2_buffer { int type, memory; unsigned index; };
struct v4l2_ext_control { int id, value; };
struct v4l2_ext_controls { int ctrl_class, count; struct v4l2_ext_control *controls; };
typedef void *i2c_master_bus_handle_t;
/* GENERATED_PORTS */
static bool sink_ok(void *context) { return true; }
static bool sink_busy(void *context) { return false; }
static void *expected_sink_context;
static unsigned transfers;
static bool sink_transfer(void *context, uint8_t *frame, size_t length) {
    assert(context==expected_sink_context && length==8 && frame[0]==0x42); ++transfers; return true;
}
static const p4_usb_port_t default_usb = {.video={.mounted=sink_ok,.streaming=sink_ok,.busy=sink_busy,.transfer=sink_transfer}};
const p4_usb_port_t *p4_usb_default_port(void) { return &default_usb; }
/* GENERATED_CONTEXT */
static uint8_t s_stage[256*1024];
static uint8_t jpeg_data[2][16]={{0x42},{0x42}};
static void recycle_jpeg_buffer(int index) { assert(index>=0 && index<2); }
static p4_uvc_ctx_t s_ctx = {.capture_fd=-1, .encoder_fd=-1};
static StaticEventGroup_t s_exit_storage;
static EventGroupHandle_t s_exit;
static unsigned events_created, deletes, closes, unmaps, streams_on, streams_off, open_calls;
static unsigned capture_queue, jpeg_queue, queues;
static atomic_bool *capture_flag, *encoder_flag;
static int capture_open_fd, encoder_open_fd;
static const char *expected_capture_name="capture", *expected_encoder_name="encoder";
static int fail_ioctl_call, ioctl_calls, fail_unmap_call, fail_close_call;
static bool fail_task_create, fail_encoder_open, fail_buffer_setup, setter_tail_pending;
static void (*created_worker)(void *);
static EventGroupHandle_t xEventGroupCreateStatic(StaticEventGroup_t *storage) {
    assert(!setter_tail_pending); ++events_created; return storage;
}
static EventBits_t xEventGroupClearBits(EventGroupHandle_t group, EventBits_t bits) { return group->bits &= ~bits; }
static EventBits_t xEventGroupSetBits(EventGroupHandle_t group, EventBits_t bits) { return group->bits |= bits; }
static EventBits_t xEventGroupWaitBits(EventGroupHandle_t group, EventBits_t bits, int clear, int all, int wait) { return group->bits; }
static int xTaskCreatePinnedToCore(void (*worker)(void *), const char *name, int stack, void *args, int priority, TaskHandle_t *handle, int core) {
    if (fail_task_create) return 0;
    created_worker=worker; *handle=(void *)1; return pdPASS;
}
static void vTaskDelete(TaskHandle_t task) { assert(task==NULL); ++deletes; setter_tail_pending=true; }
static void vTaskDelay(int ticks) { atomic_store(&s_ctx.running, false); }
static int ioctl(int fd, unsigned long command, void *arg) {
    assert(fd>=0);
    if (++ioctl_calls==fail_ioctl_call) return -1;
    if (command==VIDIOC_P4_RECEIVER_FLAG) {
        if (fd==s_ctx.capture_fd) capture_flag=*(atomic_bool **)arg;
        else encoder_flag=*(atomic_bool **)arg;
    }
    if (command==VIDIOC_STREAMON) {
        ++streams_on;
        if (*(int *)arg==V4L2_BUF_TYPE_VIDEO_CAPTURE)
            assert((fd==s_ctx.capture_fd ? capture_queue : jpeg_queue)==3);
    }
    if (command==VIDIOC_STREAMOFF) {
        ++streams_off;
        if (fd==s_ctx.encoder_fd) jpeg_queue=0;
        if (*(int *)arg==V4L2_BUF_TYPE_VIDEO_CAPTURE) {
            if (fd==s_ctx.capture_fd) capture_queue=0;
            else jpeg_queue=0;
        }
    }
    if (command==VIDIOC_QBUF) {
        ++queues;
        unsigned *queue=fd==s_ctx.capture_fd ? &capture_queue : &jpeg_queue;
        unsigned bit=1U << ((struct v4l2_buffer *)arg)->index;
        assert(!(*queue & bit)); *queue |= bit;
    }
    if (command==VIDIOC_DQBUF) {
        ((struct v4l2_buffer *)arg)->index=0; capture_queue &= ~1U;
    }
    return 0;
}
static int munmap(void *buffer, size_t length) { ++unmaps; return (int)unmaps==fail_unmap_call ? -1 : 0; }
static int close(int fd) { assert(fd>=0); assert(fd==capture_open_fd ? capture_flag==NULL : encoder_flag==NULL); ++closes; return (int)closes==fail_close_call ? -1 : 0; }
static int open(const char *name, int flags) {
    ++open_calls;
    assert(!strcmp(name,expected_capture_name) || !strcmp(name,expected_encoder_name));
    if (fail_encoder_open && !strcmp(name,expected_encoder_name)) return -1;
    const int fd=(int)open_calls+10;
    if (!strcmp(name,expected_capture_name)) capture_open_fd=fd;
    else encoder_open_fd=fd;
    return fd;
}
static esp_err_t negotiate_capture_format(void) { return ESP_OK; }
static esp_err_t start_capture_buffers(void) { s_ctx.capture_buffers[0]=(uint8_t *)2; s_ctx.capture_buffers[1]=(uint8_t *)4; capture_queue=s_ctx.capture_queued=3; return ESP_OK; }
static esp_err_t start_encoder_buffers(void) { s_ctx.jpeg_buffers[0]=jpeg_data[0]; s_ctx.jpeg_buffers[1]=jpeg_data[1]; jpeg_queue=s_ctx.jpeg_queued=3; return fail_buffer_setup ? ESP_FAIL : ESP_OK; }
static esp_err_t encode_frame(const struct v4l2_buffer *captured, int *index, size_t *bytes) { *index=0; *bytes=8; return ESP_OK; }
static void reset_pipeline(void) { assert(false); }
/* GENERATED_FUNCTIONS */
static void reset(void) {
    assert(!owns_resources());
    memset(&s_ctx, 0, sizeof(s_ctx)); atomic_init(&s_ctx.running, false);
    s_ctx.capture_fd=s_ctx.encoder_fd=-1;
    fail_ioctl_call=fail_unmap_call=fail_close_call=0; ioctl_calls=0;
    fail_task_create=fail_encoder_open=fail_buffer_setup=false;
    expected_sink_context=NULL; expected_capture_name="capture"; expected_encoder_name="encoder";
}
int main(void) {
    for (int cycle=0; cycle<3; ++cycle) {
        reset(); assert(p4_uvc_stream_init(0,0)==ESP_OK);
        assert(s_ctx.width==1280 && s_ctx.height==720);
        assert(p4_uvc_stream_start()==ESP_OK);
        assert(p4_uvc_stream_running()); assert(s_ctx.stream_mask==7);
        assert(p4_uvc_stream_stop()==ESP_ERR_TIMEOUT);
        assert(!p4_uvc_stream_running()); assert(s_ctx.task_handle!=NULL);
        unsigned retained_closes=closes, retained_unmaps=unmaps;
        assert(p4_uvc_stream_deinit()==ESP_ERR_TIMEOUT);
        assert(closes==retained_closes && unmaps==retained_unmaps);
        unsigned retained_opens=open_calls;
        assert(p4_uvc_stream_init(0,0)==ESP_ERR_INVALID_STATE);
        assert(open_calls==retained_opens);
        assert(p4_uvc_stream_start()==ESP_ERR_INVALID_STATE);
        created_worker(NULL); assert(s_ctx.task_handle!=NULL);
        assert(p4_uvc_stream_deinit()==ESP_OK); assert(!owns_resources());
        assert(p4_uvc_stream_deinit()==ESP_OK);
        /* The next generation must not reset the signaller's live lock. */
        assert(setter_tail_pending);
    }
    assert(events_created==1 && deletes==3);
    reset(); assert(p4_uvc_stream_init(800,600)==ESP_OK);
    assert(p4_uvc_stream_start()==ESP_OK);
    created_worker(NULL); /* Preserve the capture, encode, requeue loop before exit. */
    assert(p4_uvc_stream_stop()==ESP_OK); assert(p4_uvc_stream_start()==ESP_OK);
    assert(!(s_exit->bits & P4_UVC_EXIT));
    assert(p4_uvc_stream_stop()==ESP_ERR_TIMEOUT);
    created_worker(NULL); assert(p4_uvc_stream_deinit()==ESP_OK);
    reset(); assert(p4_uvc_stream_init(0,0)==ESP_OK);
    unsigned initial_queues=queues;
    assert(p4_uvc_stream_start()==ESP_OK && queues==initial_queues);
    atomic_store(&s_ctx.running, false); created_worker(NULL);
    assert(p4_uvc_stream_stop()==ESP_OK);
    fail_ioctl_call=ioctl_calls+2; /* Queue one capture buffer, then fail. */
    assert(p4_uvc_stream_start()==ESP_FAIL);
    assert(s_ctx.capture_queued==1 && capture_queue==1);
    fail_ioctl_call=0; unsigned queued_once=queues;
    assert(p4_uvc_stream_start()==ESP_OK);
    assert(queues==queued_once+3); /* Remaining capture plus both JPEG buffers. */
    atomic_store(&s_ctx.running, false); created_worker(NULL);
    assert(p4_uvc_stream_deinit()==ESP_OK);
    reset(); assert(p4_uvc_stream_init(0,0)==ESP_OK);
    fail_ioctl_call=ioctl_calls+2; /* Partial stream startup. */
    assert(p4_uvc_stream_start()==ESP_FAIL); assert(s_ctx.stream_mask==1);
    fail_ioctl_call=0; assert(p4_uvc_stream_deinit()==ESP_OK);
    reset(); assert(p4_uvc_stream_init(0,0)==ESP_OK);
    fail_task_create=true; assert(p4_uvc_stream_start()==ESP_ERR_NO_MEM);
    assert(s_ctx.task_handle==NULL && s_ctx.stream_mask==7);
    fail_ioctl_call=ioctl_calls+2; /* Keep the failed stream and later streams owned. */
    assert(p4_uvc_stream_deinit()==ESP_FAIL); assert(s_ctx.stream_mask==6);
    assert(s_ctx.capture_buffers[0]!=NULL && s_ctx.jpeg_buffers[0]!=NULL);
    assert(p4_uvc_stream_start()==ESP_ERR_INVALID_STATE);
    fail_ioctl_call=0; assert(p4_uvc_stream_deinit()==ESP_OK);
    reset(); assert(p4_uvc_stream_init(0,0)==ESP_OK);
    fail_unmap_call=(int)unmaps+3;
    assert(p4_uvc_stream_deinit()==ESP_FAIL);
    assert(s_ctx.capture_buffers[0]==NULL && s_ctx.jpeg_buffers[0]!=NULL);
    assert(p4_uvc_stream_start()==ESP_ERR_INVALID_STATE);
    assert(p4_uvc_stream_init(0,0)==ESP_ERR_INVALID_STATE);
    unsigned previous_unmaps=unmaps;
    fail_unmap_call=0; assert(p4_uvc_stream_deinit()==ESP_OK);
    assert(unmaps==previous_unmaps+2);
    reset(); fail_encoder_open=true;
    assert(p4_uvc_stream_init(0,0)==ESP_FAIL); assert(!owns_resources());
    reset(); fail_buffer_setup=true;
    assert(p4_uvc_stream_init(0,0)==ESP_FAIL); assert(!owns_resources());
    reset(); expected_capture_name="replacement-capture"; expected_encoder_name="replacement-encoder";
    expected_sink_context=(void *)0x88;
    const p4_camera_port_t replacement_camera={.capture_name=expected_capture_name,.encoder_name=expected_encoder_name};
    const p4_video_sink_t replacement_sink={.context=(void *)0x88,.mounted=sink_ok,.streaming=sink_ok,.busy=sink_busy,.transfer=sink_transfer};
    assert(p4_uvc_stream_init_with_ports(0,0,&replacement_camera,&replacement_sink)==ESP_OK);
    unsigned before_transfer=transfers;
    assert(p4_uvc_stream_start()==ESP_OK); created_worker(NULL);
    assert(transfers==before_transfer+1);
    assert(p4_uvc_stream_deinit()==ESP_OK);
    reset(); assert(p4_uvc_stream_init(0,0)==ESP_OK);
    fail_close_call=(int)closes+1;
    assert(p4_uvc_stream_deinit()==ESP_FAIL);
    assert(s_ctx.capture_fd==-1 && s_ctx.encoder_fd>=0 && s_ctx.release_failed);
    unsigned previous_closes=closes;
    fail_close_call=0; assert(p4_uvc_stream_deinit()==ESP_FAIL);
    assert(closes==previous_closes); /* The failed FD may already belong to another user. */
    assert(p4_uvc_stream_init(0,0)==ESP_ERR_INVALID_STATE);
    assert(p4_uvc_stream_start()==ESP_ERR_INVALID_STATE);
    return 0;
}
