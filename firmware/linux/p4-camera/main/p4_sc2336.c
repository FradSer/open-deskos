/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#include "p4_sc2336.h"

#include <fcntl.h>
#include <unistd.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>

#include "driver/gpio.h"
#include "driver/i2c_master.h"
#include "esp_cache.h"
#include "esp_private/esp_cache_private.h"
#include "esp_check.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_video_device.h"
#include "esp_video_init.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "linux/videodev2.h"

static const char *TAG = "p4_sc2336";

#define P4_SC2336_DEFAULT_ALIGNMENT 64

typedef struct {
    int fd;
    bool capturing;
    uint32_t width;
    uint32_t height;
    uint8_t buffer_count;
    uint8_t *buffers[4];
    size_t buffer_lengths[4];
    TaskHandle_t task_handle;
    p4_sc2336_frame_callback_t frame_cb;
    void *user_data;
} p4_sc2336_ctx_t;

static p4_sc2336_ctx_t s_ctx;

static size_t get_dma_alignment(void)
{
    size_t alignment = 0;
    if (esp_cache_get_alignment(MALLOC_CAP_SPIRAM, &alignment) != ESP_OK || alignment == 0) {
        alignment = P4_SC2336_DEFAULT_ALIGNMENT;
    }
    return alignment;
}

static void camera_task(void *arg)
{
    p4_sc2336_ctx_t *ctx = (p4_sc2336_ctx_t *)arg;
    struct v4l2_buffer buf = {
        .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
        .memory = V4L2_MEMORY_MMAP,
    };

    ESP_LOGI(TAG, "SC2336 capture stream active (%lux%lu)", ctx->width, ctx->height);

    while (ctx->capturing) {
        if (ioctl(ctx->fd, VIDIOC_DQBUF, &buf) != 0) {
            vTaskDelay(pdMS_TO_TICKS(5));
            continue;
        }

        if (buf.index < ctx->buffer_count && ctx->buffers[buf.index] != NULL) {
            size_t alignment = get_dma_alignment();
            size_t bytes_used = buf.bytesused ? buf.bytesused : buf.length;
            size_t sync_size = (bytes_used + alignment - 1) / alignment * alignment;
            if (esp_cache_msync(ctx->buffers[buf.index], sync_size, ESP_CACHE_MSYNC_FLAG_DIR_M2C) != ESP_OK) {
                ESP_LOGW(TAG, "Failed to invalidate camera frame cache");
            }
            if (ctx->frame_cb != NULL) {
                ctx->frame_cb((const uint8_t *)ctx->buffers[buf.index], bytes_used, ctx->width, ctx->height, ctx->user_data);
            }
        }

        if (ioctl(ctx->fd, VIDIOC_QBUF, &buf) != 0) {
            ESP_LOGW(TAG, "Failed to re-queue video buffer");
        }
    }

    vTaskDelete(NULL);
}

esp_err_t p4_sc2336_init_hardware(const p4_sc2336_pin_config_t *pins)
{
    if (pins == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    ESP_LOGI(TAG, "Initializing SC2336 hardware (SCCB SDA=%d, SCL=%d, RST=%d)",
             pins->sda_pin, pins->scl_pin, pins->reset_pin);

    static esp_video_init_csi_config_t csi_config[1];
    memset(csi_config, 0, sizeof(csi_config));
    csi_config[0].sccb_config.init_sccb = true;
    csi_config[0].sccb_config.i2c_config.port = pins->i2c_port;
    csi_config[0].sccb_config.i2c_config.scl_pin = pins->scl_pin;
    csi_config[0].sccb_config.i2c_config.sda_pin = pins->sda_pin;
    csi_config[0].sccb_config.freq = pins->i2c_freq;
    csi_config[0].reset_pin = pins->reset_pin;
    csi_config[0].pwdn_pin = pins->pwdn_pin;

    const esp_video_init_config_t cam_config = {
        .csi = csi_config,
        .dvp = NULL,
        .jpeg = NULL,
    };

    esp_err_t ret = esp_video_init(&cam_config);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "esp_video_init failed: %s", esp_err_to_name(ret));
        return ret;
    }

    ESP_LOGI(TAG, "esp_video_init initialized SC2336 MIPI CSI interface");
    return ESP_OK;
}

esp_err_t p4_sc2336_start_capture(const p4_sc2336_stream_config_t *config,
                                   p4_sc2336_frame_callback_t callback,
                                   void *user_data)
{
    if (config == NULL || callback == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(&s_ctx, 0, sizeof(s_ctx));
    s_ctx.width = config->width;
    s_ctx.height = config->height;
    s_ctx.buffer_count = config->buffer_count > 4 ? 4 : (config->buffer_count < 2 ? 2 : config->buffer_count);
    s_ctx.frame_cb = callback;
    s_ctx.user_data = user_data;

    const char *dev_name = ESP_VIDEO_MIPI_CSI_DEVICE_NAME;
    s_ctx.fd = open(dev_name, O_RDONLY);
    if (s_ctx.fd < 0) {
        ESP_LOGE(TAG, "Failed to open camera device %s", dev_name);
        return ESP_FAIL;
    }

    struct v4l2_format format = {
        .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
    };
    if (ioctl(s_ctx.fd, VIDIOC_G_FMT, &format) != 0) {
        ESP_LOGE(TAG, "Failed to get default camera format");
        close(s_ctx.fd);
        return ESP_FAIL;
    }

    if (config->pixel_format != 0 && config->pixel_format != format.fmt.pix.pixelformat) {
        struct v4l2_format req_fmt = {
            .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
            .fmt.pix.width = config->width ? config->width : format.fmt.pix.width,
            .fmt.pix.height = config->height ? config->height : format.fmt.pix.height,
            .fmt.pix.pixelformat = config->pixel_format,
        };
        if (ioctl(s_ctx.fd, VIDIOC_S_FMT, &req_fmt) == 0) {
            format = req_fmt;
        } else {
            ESP_LOGW(TAG, "Could not set requested format 0x%lx, using sensor default 0x%lx",
                     (unsigned long)config->pixel_format, (unsigned long)format.fmt.pix.pixelformat);
        }
    }

    s_ctx.width = format.fmt.pix.width;
    s_ctx.height = format.fmt.pix.height;
    ESP_LOGI(TAG, "SC2336 stream configured: %lux%lu format=0x%lx size=%lu",
             (unsigned long)s_ctx.width, (unsigned long)s_ctx.height,
             (unsigned long)format.fmt.pix.pixelformat, (unsigned long)format.fmt.pix.sizeimage);

    struct v4l2_requestbuffers req = {
        .count = s_ctx.buffer_count,
        .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
        .memory = V4L2_MEMORY_MMAP,
    };
    if (ioctl(s_ctx.fd, VIDIOC_REQBUFS, &req) != 0) {
        ESP_LOGE(TAG, "Failed to request V4L2 buffers");
        close(s_ctx.fd);
        return ESP_FAIL;
    }

    for (int i = 0; i < s_ctx.buffer_count; i++) {
        struct v4l2_buffer qbuf = {
            .type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
            .memory = V4L2_MEMORY_MMAP,
            .index = i,
        };
        if (ioctl(s_ctx.fd, VIDIOC_QUERYBUF, &qbuf) != 0) {
            ESP_LOGE(TAG, "Failed to query V4L2 buffer %d", i);
            close(s_ctx.fd);
            return ESP_FAIL;
        }

        s_ctx.buffers[i] = (uint8_t *)mmap(NULL, qbuf.length, PROT_READ | PROT_WRITE,
                                           MAP_SHARED, s_ctx.fd, qbuf.m.offset);
        if (!s_ctx.buffers[i]) {
            ESP_LOGE(TAG, "Failed to mmap frame buffer %d (len=%u)", i, (unsigned int)qbuf.length);
            close(s_ctx.fd);
            return ESP_ERR_NO_MEM;
        }
        s_ctx.buffer_lengths[i] = qbuf.length;

        if (ioctl(s_ctx.fd, VIDIOC_QBUF, &qbuf) != 0) {
            ESP_LOGE(TAG, "Failed to queue V4L2 buffer %d", i);
            close(s_ctx.fd);
            return ESP_FAIL;
        }
    }

    int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
    if (ioctl(s_ctx.fd, VIDIOC_STREAMON, &type) != 0) {
        ESP_LOGE(TAG, "Failed to start V4L2 stream");
        close(s_ctx.fd);
        return ESP_FAIL;
    }

    s_ctx.capturing = true;
    xTaskCreatePinnedToCore(camera_task, "sc2336_task", 8192, &s_ctx, 5, &s_ctx.task_handle, 1);
    return ESP_OK;
}

esp_err_t p4_sc2336_stop_capture(void)
{
    if (!s_ctx.capturing) {
        return ESP_OK;
    }

    s_ctx.capturing = false;
    vTaskDelay(pdMS_TO_TICKS(50));

    if (s_ctx.fd >= 0) {
        int type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
        ioctl(s_ctx.fd, VIDIOC_STREAMOFF, &type);
        close(s_ctx.fd);
        s_ctx.fd = -1;
    }

    for (int i = 0; i < s_ctx.buffer_count; i++) {
        if (s_ctx.buffers[i] != NULL) {
            munmap(s_ctx.buffers[i], s_ctx.buffer_lengths[i]);
            s_ctx.buffers[i] = NULL;
        }
    }

    return ESP_OK;
}
