/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#include <stdio.h>
#include <string.h>

#include "esp_check.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_vfs_fat.h"
#include "driver/gpio.h"
#include "nvs_flash.h"
#include "wear_levelling.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "tinyusb.h"
#include "tinyusb_cdc_acm.h"
#include "tinyusb_default_config.h"

#include "p4_camera_protocol.h"
#include "p4_face_inference.h"
#include "p4_sc2336.h"
#include "sdkconfig.h"

#ifndef CONFIG_APP_CAMERA_OWNER_NAME
#define CONFIG_APP_CAMERA_OWNER_NAME "Frad"
#endif

#ifndef CONFIG_APP_CAMERA_OWNER_CONFIRM_PIN
#define CONFIG_APP_CAMERA_OWNER_CONFIRM_PIN -1
#endif

#ifndef CONFIG_APP_CAMERA_OWNER_CONFIRM_WINDOW_SECONDS
#define CONFIG_APP_CAMERA_OWNER_CONFIRM_WINDOW_SECONDS 30
#endif

static const char *TAG = "p4_cam_main";

#define USB_META_BUF_SIZE 2048
#define ANALYSIS_QUEUE_DEPTH 2

#if CONFIG_APP_CAMERA_DIAGNOSTIC_SNAPSHOT
#define DIAGNOSTIC_SNAPSHOT_WIDTH 160
#define DIAGNOSTIC_SNAPSHOT_HEIGHT 90
#define DIAGNOSTIC_SNAPSHOT_LINE_BYTES 16
static int64_t s_diagnostic_snapshot_ready_at_us;
static bool s_diagnostic_snapshot_sent;
#endif

typedef struct {
    uint8_t *frame_data;
    size_t frame_size;
    uint16_t width;
    uint16_t height;
} frame_job_t;

static QueueHandle_t s_analysis_queue;
static p4_face_inference_t *s_inference;
static char s_metadata_buffer[USB_META_BUF_SIZE];
static uint32_t s_metadata_sequence;
static wl_handle_t s_face_storage = WL_INVALID_HANDLE;
static volatile int64_t s_owner_confirmed_at_us;
static volatile bool s_owner_enrollment_pending;

static esp_err_t mount_face_storage(void)
{
    const esp_vfs_fat_mount_config_t config = {
        .format_if_mount_failed = true,
        .max_files = 4,
    };
    return esp_vfs_fat_spiflash_mount_rw_wl("/data", "storage", &config, &s_face_storage);
}

static void send_metadata(const p4_camera_metadata_t *metadata)
{
    const size_t len = p4_camera_encode_metadata(metadata, s_metadata_buffer, sizeof(s_metadata_buffer) - 2);
    if (len == 0) {
        ESP_LOGE(TAG, "Failed to encode inference metadata");
        return;
    }

    s_metadata_buffer[len] = '\n';
    s_metadata_buffer[len + 1] = '\0';
    printf("%s", s_metadata_buffer);
    fflush(stdout);

    if (tud_cdc_n_connected(TINYUSB_CDC_ACM_0)) {
        const esp_err_t queued = tinyusb_cdcacm_write_queue(TINYUSB_CDC_ACM_0, (uint8_t *)s_metadata_buffer, len + 1);
        const esp_err_t flushed = queued == ESP_OK
            ? tinyusb_cdcacm_write_flush(TINYUSB_CDC_ACM_0, 0)
            : queued;
        if (flushed != ESP_OK) {
            ESP_LOGW(TAG, "Failed to transmit inference metadata: %s", esp_err_to_name(flushed));
        }
    }
}

static void IRAM_ATTR on_owner_confirm_button(void *arg)
{
    (void)arg;
    s_owner_confirmed_at_us = esp_timer_get_time();
    s_owner_enrollment_pending = true;
}

static void expire_owner_confirmation(void)
{
    if (!s_owner_enrollment_pending || s_owner_confirmed_at_us <= 0) {
        return;
    }
    const int64_t elapsed_us = esp_timer_get_time() - s_owner_confirmed_at_us;
    if (elapsed_us > (int64_t)CONFIG_APP_CAMERA_OWNER_CONFIRM_WINDOW_SECONDS * 1000000) {
        s_owner_enrollment_pending = false;
        s_owner_confirmed_at_us = 0;
        ESP_LOGW(TAG, "Owner enrollment cancelled: physical confirmation window expired");
    }
}

static bool owner_confirmation_active(void)
{
    if (CONFIG_APP_CAMERA_OWNER_CONFIRM_PIN < 0) {
        return false;
    }
    expire_owner_confirmation();
    return s_owner_confirmed_at_us > 0 && s_owner_enrollment_pending;
}

static void enroll_confirmed_owner(const p4_camera_metadata_t *metadata)
{
    if (!s_owner_enrollment_pending || !owner_confirmation_active()) {
        return;
    }
    if (metadata->faces_count != 1 || metadata->current_face_index != 0) {
        s_owner_enrollment_pending = false;
        s_owner_confirmed_at_us = 0;
        ESP_LOGW(TAG, "Owner enrollment cancelled: exactly one face was not visible at confirmation");
        return;
    }

    p4_face_recognition_t result = {0};
    const esp_err_t status = p4_face_inference_enroll_current(s_inference, CONFIG_APP_CAMERA_OWNER_NAME, &result);
    s_owner_enrollment_pending = false;
    s_owner_confirmed_at_us = 0;
    if (status == ESP_OK) {
        ESP_LOGI(TAG, "Owner enrollment completed for %s", result.owner);
    } else {
        ESP_LOGW(TAG, "Owner enrollment failed: %s", esp_err_to_name(status));
    }
}

static esp_err_t configure_owner_confirm_button(void)
{
    if (CONFIG_APP_CAMERA_OWNER_CONFIRM_PIN < 0) {
        ESP_LOGW(TAG, "Owner enrollment is disabled: no physical confirmation GPIO configured");
        return ESP_OK;
    }

    const gpio_config_t button_config = {
        .pin_bit_mask = 1ULL << CONFIG_APP_CAMERA_OWNER_CONFIRM_PIN,
        .mode = GPIO_MODE_INPUT,
        .pull_up_en = GPIO_PULLUP_ENABLE,
        .pull_down_en = GPIO_PULLDOWN_DISABLE,
        .intr_type = GPIO_INTR_NEGEDGE,
    };
    ESP_RETURN_ON_ERROR(gpio_config(&button_config), TAG, "configure owner confirmation GPIO failed");
    ESP_RETURN_ON_ERROR(gpio_install_isr_service(0), TAG, "install owner confirmation ISR failed");
    ESP_RETURN_ON_ERROR(gpio_isr_handler_add(CONFIG_APP_CAMERA_OWNER_CONFIRM_PIN, on_owner_confirm_button, NULL), TAG, "add owner confirmation ISR failed");
    return ESP_OK;
}

static void analysis_task(void *arg)
{
    (void)arg;
    frame_job_t job = {0};

    while (true) {
        expire_owner_confirmation();
        if (xQueueReceive(s_analysis_queue, &job, pdMS_TO_TICKS(100)) != pdTRUE) {
            continue;
        }
        if (s_inference == NULL) {
            s_inference = p4_face_inference_create(job.width, job.height);
        }

        p4_camera_metadata_t metadata = {0};
        metadata.version = P4_CAMERA_PROTOCOL_VERSION;
        metadata.camera_online = true;
        metadata.frame_width = job.width;
        metadata.frame_height = job.height;
        metadata.sequence = ++s_metadata_sequence;
        metadata.current_face_index = -1;

        const esp_err_t ret = s_inference == NULL
            ? ESP_ERR_NO_MEM
            : p4_face_inference_run(s_inference, job.frame_data, job.frame_size, &metadata);
        heap_caps_free(job.frame_data);

        if (ret == ESP_OK) {
            enroll_confirmed_owner(&metadata);
            send_metadata(&metadata);
        } else {
            ESP_LOGE(TAG, "On-device face inference failed: %s", esp_err_to_name(ret));
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

#if CONFIG_APP_CAMERA_DIAGNOSTIC_SNAPSHOT
static void emit_diagnostic_snapshot(const uint8_t *frame_data, size_t frame_size, uint32_t width, uint32_t height)
{
    if (s_diagnostic_snapshot_sent || esp_timer_get_time() < s_diagnostic_snapshot_ready_at_us
        || width < DIAGNOSTIC_SNAPSHOT_WIDTH || height < DIAGNOSTIC_SNAPSHOT_HEIGHT
        || frame_size < (size_t)width * height) {
        return;
    }

    const uint32_t step_x = width / DIAGNOSTIC_SNAPSHOT_WIDTH;
    const uint32_t step_y = height / DIAGNOSTIC_SNAPSHOT_HEIGHT;
    printf("P4_SNAPSHOT_BEGIN %u %u\n", DIAGNOSTIC_SNAPSHOT_WIDTH, DIAGNOSTIC_SNAPSHOT_HEIGHT);
    for (uint32_t y = 0; y < DIAGNOSTIC_SNAPSHOT_HEIGHT; ++y) {
        for (uint32_t x = 0; x < DIAGNOSTIC_SNAPSHOT_WIDTH; x += DIAGNOSTIC_SNAPSHOT_LINE_BYTES) {
            printf("P4_SNAPSHOT_DATA ");
            for (uint32_t column = x; column < x + DIAGNOSTIC_SNAPSHOT_LINE_BYTES; ++column) {
                printf("%02x", frame_data[(size_t)(y * step_y) * width + column * step_x]);
            }
            printf("\n");
        }
    }
    printf("P4_SNAPSHOT_END\n");
    fflush(stdout);
    s_diagnostic_snapshot_sent = true;
}
#endif

static void on_camera_frame(const uint8_t *frame_data,
                            size_t frame_size,
                            uint32_t width,
                            uint32_t height,
                            void *user_data)
{
    (void)user_data;
#if CONFIG_APP_CAMERA_DIAGNOSTIC_SNAPSHOT
    emit_diagnostic_snapshot(frame_data, frame_size, width, height);
    return;
#endif
    if (uxQueueSpacesAvailable(s_analysis_queue) == 0) {
        ESP_LOGW(TAG, "Dropping camera frame while face inference is busy");
        return;
    }

    uint8_t *frame_copy = heap_caps_malloc(frame_size, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    if (frame_copy == NULL) {
        ESP_LOGW(TAG, "Dropping camera frame because no inference buffer is available");
        return;
    }
    memcpy(frame_copy, frame_data, frame_size);

    const frame_job_t job = {
        .frame_data = frame_copy,
        .frame_size = frame_size,
        .width = (uint16_t)width,
        .height = (uint16_t)height,
    };
    if (xQueueSend(s_analysis_queue, &job, 0) != pdTRUE) {
        heap_caps_free(frame_copy);
        ESP_LOGW(TAG, "Dropping camera frame while face inference is busy");
    }
}

static void usb_init(void)
{
    const tinyusb_config_t usb_config = TINYUSB_DEFAULT_CONFIG();
    ESP_ERROR_CHECK(tinyusb_driver_install(&usb_config));

    tinyusb_config_cdcacm_t cdc_config = {0};
    cdc_config.cdc_port = TINYUSB_CDC_ACM_0;
    ESP_ERROR_CHECK(tinyusb_cdcacm_init(&cdc_config));
    ESP_LOGI(TAG, "TinyUSB initialized for CM5 metadata link");
}

void app_main(void)
{
    ESP_LOGI(TAG, "Open DeskOS ESP32-P4 SC2336 on-device face inference booting");
#if CONFIG_APP_CAMERA_DIAGNOSTIC_SNAPSHOT
    s_diagnostic_snapshot_ready_at_us = esp_timer_get_time()
        + (int64_t)CONFIG_APP_CAMERA_DIAGNOSTIC_SNAPSHOT_DELAY_SECONDS * 1000000;
#endif
    ESP_ERROR_CHECK(nvs_flash_init());
    ESP_ERROR_CHECK(mount_face_storage());
    ESP_ERROR_CHECK(configure_owner_confirm_button());
    usb_init();

    const p4_sc2336_pin_config_t pins = {
        .sda_pin = CONFIG_APP_CAMERA_MIPI_SCCB_SDA_PIN,
        .scl_pin = CONFIG_APP_CAMERA_MIPI_SCCB_SCL_PIN,
        .reset_pin = CONFIG_APP_CAMERA_SC2336_MIPI_RESET_PIN,
        .pwdn_pin = CONFIG_APP_CAMERA_SC2336_MIPI_PWDN_PIN,
        .i2c_port = CONFIG_APP_CAMERA_SCCB_I2C_PORT,
        .i2c_freq = CONFIG_APP_CAMERA_SCCB_I2C_FREQ,
    };
    ESP_ERROR_CHECK(p4_sc2336_init_hardware(&pins));

    s_analysis_queue = xQueueCreate(ANALYSIS_QUEUE_DEPTH, sizeof(frame_job_t));
    if (s_analysis_queue == NULL) {
        ESP_LOGE(TAG, "Could not create face inference queue");
        return;
    }
#if !CONFIG_APP_CAMERA_DIAGNOSTIC_SNAPSHOT
    xTaskCreatePinnedToCore(analysis_task, "face_inference", 16384, NULL, 5, NULL, 1);
#endif

    const p4_sc2336_stream_config_t stream = {
        .width = CONFIG_APP_CAMERA_FRAME_WIDTH,
        .height = CONFIG_APP_CAMERA_FRAME_HEIGHT,
        .pixel_format = 0,
        .buffer_count = CONFIG_APP_CAMERA_BUFFER_COUNT,
    };
    const esp_err_t ret = p4_sc2336_start_capture(&stream, on_camera_frame, NULL);
    if (ret != ESP_OK) {
        ESP_LOGE(TAG, "Failed to start SC2336 capture: %s", esp_err_to_name(ret));
        return;
    }

    ESP_LOGI(TAG, "SC2336 capture and on-device face inference ready");
}
