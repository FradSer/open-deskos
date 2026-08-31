/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_FACE_INFERENCE_H
#define P4_FACE_INFERENCE_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "p4_camera_protocol.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef struct p4_face_inference p4_face_inference_t;

typedef struct {
    uint16_t face_id;
    char owner[33];
    float similarity;
    float threshold;
} p4_face_recognition_t;

p4_face_inference_t *p4_face_inference_create(uint16_t frame_width, uint16_t frame_height);
void p4_face_inference_destroy(p4_face_inference_t *inference);
esp_err_t p4_face_inference_run(p4_face_inference_t *inference,
                                const uint8_t *frame_data,
                                size_t frame_size,
                                p4_camera_metadata_t *metadata);
esp_err_t p4_face_inference_enroll_current(p4_face_inference_t *inference,
                                           const char *owner,
                                           p4_face_recognition_t *result);

#ifdef __cplusplus
}
#endif

#endif /* P4_FACE_INFERENCE_H */
