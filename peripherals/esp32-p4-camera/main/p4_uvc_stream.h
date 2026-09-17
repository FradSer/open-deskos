/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_UVC_STREAM_H
#define P4_UVC_STREAM_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#define P4_UVC_WIDTH 1280
#define P4_UVC_HEIGHT 720
#define P4_UVC_FPS 30

/**
 * @brief Open the SC2336 capture and hardware JPEG devices and negotiate formats.
 *
 * @param width Requested frame width (clamped to the UVC-advertised 1280x720).
 * @param height Requested frame height.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t p4_uvc_stream_init(uint16_t width, uint16_t height);

/**
 * @brief Start the capture-encode-transfer loop in a dedicated task.
 *
 * Frames are pushed through the TinyUSB video class only while the host
 * has the streaming interface open; otherwise they are recycled.
 */
esp_err_t p4_uvc_stream_start(void);

esp_err_t p4_uvc_stream_stop(void);
bool p4_uvc_stream_running(void);

#endif /* P4_UVC_STREAM_H */
