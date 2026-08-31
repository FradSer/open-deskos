/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_SC2336_H
#define P4_SC2336_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    int sda_pin;
    int scl_pin;
    int reset_pin;
    int pwdn_pin;
    int i2c_port;
    uint32_t i2c_freq;
} p4_sc2336_pin_config_t;

typedef struct {
    uint32_t width;
    uint32_t height;
    uint32_t pixel_format; /* V4L2_PIX_FMT_* */
    uint8_t buffer_count;
} p4_sc2336_stream_config_t;

typedef void (*p4_sc2336_frame_callback_t)(const uint8_t *frame_data, size_t frame_size, uint32_t width, uint32_t height, void *user_data);

/**
 * @brief Initialize SC2336 sensor hardware interface (SCCB, Reset lines, MIPI CSI-2).
 *
 * @param pins Pin configuration.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t p4_sc2336_init_hardware(const p4_sc2336_pin_config_t *pins);

/**
 * @brief Start SC2336 video capture pipeline.
 *
 * @param config Stream configuration (resolution, pixel format, buffer count).
 * @param callback Frame callback invoked on every captured frame.
 * @param user_data User data passed to callback.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t p4_sc2336_start_capture(const p4_sc2336_stream_config_t *config,
                                   p4_sc2336_frame_callback_t callback,
                                   void *user_data);

/**
 * @brief Stop SC2336 video capture.
 *
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t p4_sc2336_stop_capture(void);

#endif /* P4_SC2336_H */
