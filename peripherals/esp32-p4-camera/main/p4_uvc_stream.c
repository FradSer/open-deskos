/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 *
 * SC2336 MIPI CSI capture -> hardware JPEG encode -> TinyUSB UVC MJPEG push.
 * Mirrors the official esp_video UVC example pipeline (capture MMAP, M2M
 * USERPTR encode, JPEG MMAP out), but pushes frames through the app-owned
 * TinyUSB video class so UVC and UAC share one composite device.
 *
 * Ownership is strict: each encoded JPEG is copied into a single USB staging
 * buffer only while the bulk endpoint is idle, and the encoder buffer is
 * requeued immediately. The encoder can therefore never overwrite a frame
 * that USB is still transmitting, and USB never reads a recycled buffer.
 */

#include "p4_uvc_stream.h"

#include <fcntl.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <unistd.h>

#include "device/usbd_pvt.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_video_device.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "linux/videodev2.h"
#include "tusb.h"

#include "sdkconfig.h"

static const char *TAG = "p4_uvc";

#define P4_UVC_CAPTURE_BUFFERS 2
#define P4_UVC_JPEG_BUFFERS 2
#define P4_UVC_JPEG_QUALITY_DEFAULT 80
#define P4_UVC_TASK_STACK 8192
#define P4_UVC_STOP_WAIT_MS 500
#define P4_UVC_VIDEO_ENDPOINT 0x81
#define P4_UVC_STAGE_SIZE (256 * 1024)
#define P4_UVC_RESET_FAILS 30

typedef struct {
    int capture_fd;
    int encoder_fd;
    uint32_t capture_format;
    uint16_t width;
    uint16_t height;
    uint8_t *capture_buffers[P4_UVC_CAPTURE_BUFFERS];
    size_t capture_lengths[P4_UVC_CAPTURE_BUFFERS];
    uint8_t *jpeg_buffers[P4_UVC_JPEG_BUFFERS];
    size_t jpeg_lengths[P4_UVC_JPEG_BUFFERS];
    TaskHandle_t task_handle;
    volatile bool running;
    bool initialized;
    bool streaming;
    unsigned int fail_streak;
} p4_uvc_ctx_t;

static p4_uvc_ctx_t s_ctx;
static uint8_t s_stage[P4_UVC_STAGE_SIZE];

#ifndef CONFIG_APP_UVC_JPEG_QUALITY
#define CONFIG_APP_UVC_JPEG_QUALITY P4_UVC_JPEG_QUALITY_DEFAULT
#endif

static esp_err_t negotiate_capture_format(void)
{
    static const uint32_t jpeg_inputs[] = {
        V4L2_PIX_FMT_RGB565,
        V4L2_PIX_FMT_UYVY,
        V4L2_PIX_FMT_RGB24,
        V4L2_PIX_FMT_GREY,
    };
    uint32_t format = 0;
    for (int index = 0; format == 0; ++index) {
        struct v4l2_fmtdesc desc = {
            .index = (uint32_t)index,
            .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
        };
        if (ioctl(s_ctx.capture_fd, VIDIOC_ENUM_FMT, &desc) != 0) {
            break;
        }
        for (size_t i = 0; i < sizeof(jpeg_inputs) / sizeof(jpeg_inputs[0]); ++i) {
            if (desc.pixelformat == jpeg_inputs[i]) {
                format = jpeg_inputs[i];
                break;
            }
        }
    }
    ESP_RETURN_ON_FALSE(format != 0, ESP_ERR_NOT_SUPPORTED, TAG,
                        "sensor output is not usable by the JPEG encoder");
    s_ctx.capture_format = format;
    return ESP_OK;
}

static esp_err_t start_capture_buffers(void)
{
    struct v4l2_format format = {0};
    format.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    format.fmt.pix.width = s_ctx.width;
    format.fmt.pix.height = s_ctx.height;
    format.fmt.pix.pixelformat = s_ctx.capture_format;
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.capture_fd, VIDIOC_S_FMT, &format) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "negotiate capture format");

    struct v4l2_requestbuffers req = {
        .count = P4_UVC_CAPTURE_BUFFERS,
        .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
        .memory = V4L2_MEMORY_MMAP,
    };
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.capture_fd, VIDIOC_REQBUFS, &req) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "request capture buffers");

    for (int i = 0; i < P4_UVC_CAPTURE_BUFFERS; ++i) {
        struct v4l2_buffer buf = {
            .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
            .memory = V4L2_MEMORY_MMAP,
            .index = (uint32_t)i,
        };
        ESP_RETURN_ON_ERROR(ioctl(s_ctx.capture_fd, VIDIOC_QUERYBUF, &buf) == 0 ? ESP_OK : ESP_FAIL,
                            TAG, "query capture buffer");
        s_ctx.capture_buffers[i] = mmap(NULL, buf.length, PROT_READ | PROT_WRITE,
                                        MAP_SHARED, s_ctx.capture_fd, buf.m.offset);
        ESP_RETURN_ON_FALSE(s_ctx.capture_buffers[i] != NULL, ESP_ERR_NO_MEM, TAG,
                            "map capture buffer");
        s_ctx.capture_lengths[i] = buf.length;
        ESP_LOGI(TAG, "Capture buffer %d length %u", i, (unsigned)buf.length);
        ESP_RETURN_ON_ERROR(ioctl(s_ctx.capture_fd, VIDIOC_QBUF, &buf) == 0 ? ESP_OK : ESP_FAIL,
                            TAG, "queue capture buffer");
    }
    return ESP_OK;
}

static esp_err_t start_encoder_buffers(void)
{
    struct v4l2_format format = {0};
    format.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
    format.fmt.pix.width = s_ctx.width;
    format.fmt.pix.height = s_ctx.height;
    format.fmt.pix.pixelformat = s_ctx.capture_format;
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, VIDIOC_S_FMT, &format) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "negotiate encoder input");

    memset(&format, 0, sizeof(format));
    format.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    format.fmt.pix.width = s_ctx.width;
    format.fmt.pix.height = s_ctx.height;
    format.fmt.pix.pixelformat = V4L2_PIX_FMT_JPEG;
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, VIDIOC_S_FMT, &format) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "negotiate JPEG output");

    struct v4l2_requestbuffers req = {
        .count = 1,
        .type = V4L2_BUF_TYPE_VIDEO_OUTPUT,
        .memory = V4L2_MEMORY_USERPTR,
    };
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, VIDIOC_REQBUFS, &req) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "request encoder input");

    memset(&req, 0, sizeof(req));
    req.count = P4_UVC_JPEG_BUFFERS;
    req.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    req.memory = V4L2_MEMORY_MMAP;
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, VIDIOC_REQBUFS, &req) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "request JPEG outputs");

    for (int i = 0; i < P4_UVC_JPEG_BUFFERS; ++i) {
        struct v4l2_buffer out = {
            .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
            .memory = V4L2_MEMORY_MMAP,
            .index = (uint32_t)i,
        };
        ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, VIDIOC_QUERYBUF, &out) == 0 ? ESP_OK : ESP_FAIL,
                            TAG, "query JPEG buffer");
        s_ctx.jpeg_buffers[i] = mmap(NULL, out.length, PROT_READ | PROT_WRITE,
                                     MAP_SHARED, s_ctx.encoder_fd, out.m.offset);
        ESP_RETURN_ON_FALSE(s_ctx.jpeg_buffers[i] != NULL, ESP_ERR_NO_MEM, TAG,
                            "map JPEG buffer");
        s_ctx.jpeg_lengths[i] = out.length;
        ESP_LOGI(TAG, "JPEG buffer %d length %u", i, (unsigned)out.length);
        ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, VIDIOC_QBUF, &out) == 0 ? ESP_OK : ESP_FAIL,
                            TAG, "queue JPEG buffer");
    }
    return ESP_OK;
}

static esp_err_t set_streams(bool on)
{
    const unsigned long request = on ? (unsigned long)VIDIOC_STREAMON : (unsigned long)VIDIOC_STREAMOFF;
    int cap_type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    int out_type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
    int jpeg_type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.capture_fd, request, &cap_type) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "switch capture stream");
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, request, &out_type) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "switch encoder input");
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, request, &jpeg_type) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "switch JPEG output");
    s_ctx.streaming = on;
    return ESP_OK;
}

static void release_resources(void)
{
    if (s_ctx.streaming) {
        set_streams(false);
    }
    for (int i = 0; i < P4_UVC_CAPTURE_BUFFERS; ++i) {
        if (s_ctx.capture_buffers[i] != NULL) {
            munmap(s_ctx.capture_buffers[i], s_ctx.capture_lengths[i]);
            s_ctx.capture_buffers[i] = NULL;
        }
    }
    for (int i = 0; i < P4_UVC_JPEG_BUFFERS; ++i) {
        if (s_ctx.jpeg_buffers[i] != NULL) {
            munmap(s_ctx.jpeg_buffers[i], s_ctx.jpeg_lengths[i]);
            s_ctx.jpeg_buffers[i] = NULL;
        }
    }
    if (s_ctx.capture_fd >= 0) {
        close(s_ctx.capture_fd);
        s_ctx.capture_fd = -1;
    }
    if (s_ctx.encoder_fd >= 0) {
        close(s_ctx.encoder_fd);
        s_ctx.encoder_fd = -1;
    }
    s_ctx.initialized = false;
}

static void recycle_jpeg_buffer(int jpeg_index)
{
    struct v4l2_buffer jpeg = {
        .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
        .memory = V4L2_MEMORY_MMAP,
        .index = (uint32_t)jpeg_index,
    };
    if (ioctl(s_ctx.encoder_fd, VIDIOC_QBUF, &jpeg) != 0) {
        ESP_LOGW(TAG, "Failed to recycle JPEG buffer");
    }
}

static esp_err_t encode_frame(const struct v4l2_buffer *captured, int *jpeg_index, size_t *jpeg_bytes)
{
    struct v4l2_buffer enc_in = {
        .type = V4L2_BUF_TYPE_VIDEO_OUTPUT,
        .memory = V4L2_MEMORY_USERPTR,
        .index = 0,
        .m.userptr = (unsigned long)s_ctx.capture_buffers[captured->index],
        .length = captured->bytesused ? captured->bytesused : captured->length,
    };
    ESP_RETURN_ON_ERROR(ioctl(s_ctx.encoder_fd, VIDIOC_QBUF, &enc_in) == 0 ? ESP_OK : ESP_FAIL,
                        TAG, "submit frame to encoder");

    struct v4l2_buffer jpeg = {
        .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
        .memory = V4L2_MEMORY_MMAP,
    };
    if (ioctl(s_ctx.encoder_fd, VIDIOC_DQBUF, &jpeg) != 0) {
        ESP_LOGE(TAG, "Collect JPEG frame failed, draining encoder input");
        memset(&enc_in, 0, sizeof(enc_in));
        enc_in.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
        enc_in.memory = V4L2_MEMORY_USERPTR;
        ioctl(s_ctx.encoder_fd, VIDIOC_DQBUF, &enc_in);
        return ESP_FAIL;
    }
    *jpeg_index = (int)jpeg.index;
    *jpeg_bytes = jpeg.bytesused;

    memset(&enc_in, 0, sizeof(enc_in));
    enc_in.type = V4L2_BUF_TYPE_VIDEO_OUTPUT;
    enc_in.memory = V4L2_MEMORY_USERPTR;
    if (ioctl(s_ctx.encoder_fd, VIDIOC_DQBUF, &enc_in) != 0) {
        ESP_LOGE(TAG, "Recycle encoder input failed, returning JPEG buffer %d", *jpeg_index);
        recycle_jpeg_buffer(*jpeg_index);
        return ESP_FAIL;
    }
    return ESP_OK;
}

static void deliver_frame(int jpeg_index, size_t jpeg_bytes)
{
    if (jpeg_bytes == 0 || jpeg_bytes > sizeof(s_stage)) {
        if (jpeg_bytes > sizeof(s_stage)) {
            ESP_LOGW(TAG, "Dropping oversized JPEG frame (%u bytes)", (unsigned)jpeg_bytes);
        }
        recycle_jpeg_buffer(jpeg_index);
        return;
    }
    memcpy(s_stage, s_ctx.jpeg_buffers[jpeg_index], jpeg_bytes);
    recycle_jpeg_buffer(jpeg_index);

    const bool mounted = tud_mounted();
    const bool streaming = tud_video_n_streaming(0, 0);
    if (!mounted || !streaming) {
        return;
    }
    if (usbd_edpt_busy(0, P4_UVC_VIDEO_ENDPOINT)) {
        return;
    }
    tud_video_n_frame_xfer(0, 0, s_stage, jpeg_bytes);
}

static void reset_pipeline(void)
{
    if (s_ctx.capture_fd < 0 || s_ctx.encoder_fd < 0) {
        return;
    }
    set_streams(false);
    for (int i = 0; i < P4_UVC_CAPTURE_BUFFERS; ++i) {
        if (s_ctx.capture_buffers[i] != NULL) {
            munmap(s_ctx.capture_buffers[i], s_ctx.capture_lengths[i]);
            s_ctx.capture_buffers[i] = NULL;
        }
    }
    for (int i = 0; i < P4_UVC_JPEG_BUFFERS; ++i) {
        if (s_ctx.jpeg_buffers[i] != NULL) {
            munmap(s_ctx.jpeg_buffers[i], s_ctx.jpeg_lengths[i]);
            s_ctx.jpeg_buffers[i] = NULL;
        }
    }
    if (start_capture_buffers() != ESP_OK || start_encoder_buffers() != ESP_OK) {
        ESP_LOGE(TAG, "Pipeline reset failed");
        return;
    }
    set_streams(true);
}

static void stream_task(void *arg)
{
    (void)arg;
    ESP_LOGI(TAG, "UVC MJPEG stream active (%ux%u)", s_ctx.width, s_ctx.height);
    while (s_ctx.running) {
        struct v4l2_buffer captured = {
            .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
            .memory = V4L2_MEMORY_MMAP,
        };
        if (ioctl(s_ctx.capture_fd, VIDIOC_DQBUF, &captured) != 0) {
            vTaskDelay(pdMS_TO_TICKS(5));
            continue;
        }
        if (captured.index >= P4_UVC_CAPTURE_BUFFERS) {
            ESP_LOGW(TAG, "Dropping frame with unexpected buffer index");
            continue;
        }

        int jpeg_index = -1;
        size_t jpeg_bytes = 0;
        if (encode_frame(&captured, &jpeg_index, &jpeg_bytes) == ESP_OK && jpeg_index >= 0) {
            deliver_frame(jpeg_index, jpeg_bytes);
            s_ctx.fail_streak = 0;
        } else if (++s_ctx.fail_streak >= P4_UVC_RESET_FAILS) {
            ESP_LOGE(TAG, "Encoder stalled, resetting pipeline");
            s_ctx.fail_streak = 0;
            reset_pipeline();
        }

        if (ioctl(s_ctx.capture_fd, VIDIOC_QBUF, &captured) != 0) {
            ESP_LOGW(TAG, "Failed to re-queue capture buffer");
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
    s_ctx.task_handle = NULL;
    vTaskDelete(NULL);
}

esp_err_t p4_uvc_stream_init(uint16_t width, uint16_t height)
{
    memset(&s_ctx, 0, sizeof(s_ctx));
    s_ctx.capture_fd = -1;
    s_ctx.encoder_fd = -1;
    s_ctx.width = width == 0 ? P4_UVC_WIDTH : width;
    s_ctx.height = height == 0 ? P4_UVC_HEIGHT : height;

    s_ctx.capture_fd = open(ESP_VIDEO_MIPI_CSI_DEVICE_NAME, O_RDONLY);
    if (s_ctx.capture_fd < 0) {
        ESP_LOGE(TAG, "Open CSI capture device failed");
        release_resources();
        return ESP_FAIL;
    }

    s_ctx.encoder_fd = open(ESP_VIDEO_JPEG_DEVICE_NAME, O_RDONLY);
    if (s_ctx.encoder_fd < 0) {
        ESP_LOGE(TAG, "Open hardware JPEG device failed");
        release_resources();
        return ESP_FAIL;
    }

    struct v4l2_ext_controls controls = {0};
    struct v4l2_ext_control control = {0};
    controls.ctrl_class = V4L2_CID_JPEG_CLASS;
    controls.count = 1;
    controls.controls = &control;
    control.id = V4L2_CID_JPEG_COMPRESSION_QUALITY;
    control.value = CONFIG_APP_UVC_JPEG_QUALITY;
    if (ioctl(s_ctx.encoder_fd, VIDIOC_S_EXT_CTRLS, &controls) != 0) {
        ESP_LOGW(TAG, "Failed to set JPEG quality, using encoder default");
    }

    if (negotiate_capture_format() != ESP_OK
        || start_capture_buffers() != ESP_OK
        || start_encoder_buffers() != ESP_OK) {
        ESP_LOGE(TAG, "UVC pipeline setup failed");
        release_resources();
        return ESP_FAIL;
    }
    s_ctx.initialized = true;
    return ESP_OK;
}

esp_err_t p4_uvc_stream_start(void)
{
    ESP_RETURN_ON_FALSE(s_ctx.initialized, ESP_ERR_INVALID_STATE, TAG,
                        "stream is not initialized");
    ESP_RETURN_ON_FALSE(!s_ctx.running, ESP_ERR_INVALID_STATE, TAG, "stream already running");
    if (!s_ctx.streaming) {
        ESP_RETURN_ON_ERROR(set_streams(true), TAG, "start pipeline streams");
    }
    s_ctx.running = true;
    if (xTaskCreatePinnedToCore(stream_task, "uvc_stream", P4_UVC_TASK_STACK,
                                NULL, 5, &s_ctx.task_handle, 1) != pdPASS) {
        s_ctx.running = false;
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}

esp_err_t p4_uvc_stream_stop(void)
{
    if (!s_ctx.running) {
        return ESP_OK;
    }
    s_ctx.running = false;
    for (int waited = 0; s_ctx.task_handle != NULL && waited < P4_UVC_STOP_WAIT_MS; waited += 10) {
        vTaskDelay(pdMS_TO_TICKS(10));
    }
    if (s_ctx.task_handle != NULL) {
        ESP_LOGW(TAG, "Stream task did not exit, deleting it");
        vTaskDelete(s_ctx.task_handle);
        s_ctx.task_handle = NULL;
    }
    if (s_ctx.streaming) {
        set_streams(false);
    }
    return ESP_OK;
}

bool p4_uvc_stream_running(void)
{
    return s_ctx.running;
}
