/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"
#include "driver/i2c_master.h"

#define P4_PORT_NVS "odk:p4/storage/v1"
#define P4_PORT_I2C "odk:p4/i2c/v1"
#define P4_PORT_CAMERA "odk:p4/camera/v1"
#define P4_PORT_USB "odk:p4/usb/v1"
#define P4_PORT_AUDIO "odk:p4/audio/v1"
#define P4_PORT_STREAM "odk:p4/stream/v1"

typedef struct { i2c_master_bus_handle_t bus; } p4_i2c_port_t;
typedef struct { const char *capture_name; const char *encoder_name; } p4_camera_port_t;
typedef struct {
    void *context;
    esp_err_t (*read)(uint8_t *buffer, size_t length, size_t *bytes_read, void *context);
} p4_audio_source_t;
typedef struct {
    void *context;
    bool (*mounted)(void *context);
    bool (*streaming)(void *context);
    bool (*busy)(void *context);
    bool (*transfer)(void *context, uint8_t *frame, size_t length);
} p4_video_sink_t;
typedef struct {
    void *context;
    p4_video_sink_t video;
    esp_err_t (*bind_audio)(void *context, const p4_audio_source_t *source);
    esp_err_t (*unbind_audio)(void *context, const p4_audio_source_t *source);
} p4_usb_port_t;

const p4_usb_port_t *p4_usb_default_port(void);
esp_err_t p4_usb_audio_deinit_after_usb_stop(void);
