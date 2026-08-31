/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_CAMERA_PROTOCOL_H
#define P4_CAMERA_PROTOCOL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define P4_CAMERA_PROTOCOL_VERSION 1
#define P4_CAMERA_MAX_FACES 4
#define P4_CAMERA_NAME_MAX_LEN 32
#define P4_CAMERA_EMOTION_MAX_LEN 16

typedef struct {
    int16_t x;
    int16_t y;
    int16_t w;
    int16_t h;
} p4_face_box_t;

typedef struct {
    float x;
    float y;
} p4_point_t;

typedef struct {
    p4_point_t right_eye;
    p4_point_t left_eye;
    p4_point_t nose_tip;
    p4_point_t right_mouth;
    p4_point_t left_mouth;
} p4_face_landmarks_t;

typedef struct {
    bool unlocked;
    char user[P4_CAMERA_NAME_MAX_LEN + 1];
    float similarity;
    float threshold;
} p4_face_id_t;

typedef struct {
    char primary[P4_CAMERA_EMOTION_MAX_LEN + 1];
    float confidence;
} p4_face_emotion_t;

typedef struct {
    p4_face_box_t box;
    p4_face_landmarks_t landmarks;
    float detect_score;
    p4_face_id_t face_id;
    p4_face_emotion_t emotion;
} p4_detected_face_t;

typedef struct {
    uint8_t version;
    bool camera_online;
    uint16_t frame_width;
    uint16_t frame_height;
    uint32_t sequence;
    int8_t current_face_index;
    uint8_t faces_count;
    bool any_unlocked;
    float processing_time_ms;
    p4_detected_face_t faces[P4_CAMERA_MAX_FACES];
} p4_camera_metadata_t;

/**
 * @brief Encode a metadata struct into a versioned JSON string.
 *
 * @param meta Pointer to metadata struct.
 * @param buffer Output buffer for the null-terminated JSON string.
 * @param buffer_size Size of the output buffer.
 * @return size_t Length of the encoded JSON string (excluding null terminator), or 0 on failure.
 */
size_t p4_camera_encode_metadata(const p4_camera_metadata_t *meta, char *buffer, size_t buffer_size);

/**
 * @brief Parse a versioned JSON string into a metadata struct.
 *
 * @param json_str Null-terminated JSON string.
 * @param meta Output pointer for the parsed metadata.
 * @return bool True if parsing and validation succeeded, false otherwise.
 */
bool p4_camera_parse_metadata(const char *json_str, p4_camera_metadata_t *meta);

#endif /* P4_CAMERA_PROTOCOL_H */
