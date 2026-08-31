/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#include "p4_face_inference.h"

#include <algorithm>
#include <cstring>
#include <list>
#include <memory>
#include <vector>

#include "esp_log.h"
#include "esp_timer.h"
#include "esp_heap_caps.h"
#include "nvs.h"
#include "human_face_detect.hpp"
#include "human_face_recognition.hpp"
#include "dl_image_define.hpp"

struct p4_face_inference {
    uint16_t frame_width;
    uint16_t frame_height;
    std::unique_ptr<HumanFaceDetect> detector;
    std::unique_ptr<HumanFaceRecognizer> recognizer;
    uint8_t *rgb565_frame;
};

namespace {

constexpr char TAG[] = "p4_face_inference";
constexpr char OWNER_NAMESPACE[] = "face_owner";
constexpr char OWNER_KEY_PREFIX[] = "owner_";
constexpr char FACE_DATABASE_PATH[] = "/data/face_features.db";
constexpr float RECOGNITION_THRESHOLD = 0.75F;

bool face_has_valid_box(const dl::detect::result_t &result)
{
    return result.box.size() == 4
        && result.keypoint.size() >= 10
        && result.box[2] > result.box[0]
        && result.box[3] > result.box[1];
}

int16_t clamp_coordinate(int value, uint16_t upper_bound)
{
    return static_cast<int16_t>(std::clamp(value, 0, static_cast<int>(upper_bound) - 1));
}

void copy_landmarks(const dl::detect::result_t &result,
                    uint16_t width,
                    uint16_t height,
                    p4_face_landmarks_t *landmarks)
{
    const p4_point_t points[] = {
        {static_cast<float>(clamp_coordinate(result.keypoint[0], width)), static_cast<float>(clamp_coordinate(result.keypoint[1], height))},
        {static_cast<float>(clamp_coordinate(result.keypoint[2], width)), static_cast<float>(clamp_coordinate(result.keypoint[3], height))},
        {static_cast<float>(clamp_coordinate(result.keypoint[4], width)), static_cast<float>(clamp_coordinate(result.keypoint[5], height))},
        {static_cast<float>(clamp_coordinate(result.keypoint[6], width)), static_cast<float>(clamp_coordinate(result.keypoint[7], height))},
        {static_cast<float>(clamp_coordinate(result.keypoint[8], width)), static_cast<float>(clamp_coordinate(result.keypoint[9], height))},
    };
    landmarks->right_eye = points[0];
    landmarks->left_eye = points[1];
    landmarks->nose_tip = points[2];
    landmarks->right_mouth = points[3];
    landmarks->left_mouth = points[4];
}

void copy_detection(const dl::detect::result_t &result, uint16_t width, uint16_t height, p4_detected_face_t *face)
{
    face->box.x = clamp_coordinate(result.box[0], width);
    face->box.y = clamp_coordinate(result.box[1], height);
    face->box.w = static_cast<int16_t>(std::clamp(result.box[2] - result.box[0], 1, static_cast<int>(width) - face->box.x));
    face->box.h = static_cast<int16_t>(std::clamp(result.box[3] - result.box[1], 1, static_cast<int>(height) - face->box.y));
    face->detect_score = std::clamp(result.score, 0.0F, 1.0F);
    copy_landmarks(result, width, height, &face->landmarks);
}

bool owner_key(uint16_t face_id, char *buffer, size_t buffer_size)
{
    return snprintf(buffer, buffer_size, "%s%u", OWNER_KEY_PREFIX, face_id) > 0;
}

bool load_owner(uint16_t face_id, char *owner, size_t owner_size)
{
    char key[16] = {0};
    nvs_handle_t handle;
    size_t size = owner_size;
    if (!owner_key(face_id, key, sizeof(key)) || nvs_open(OWNER_NAMESPACE, NVS_READONLY, &handle) != ESP_OK) {
        return false;
    }
    const esp_err_t ret = nvs_get_str(handle, key, owner, &size);
    nvs_close(handle);
    return ret == ESP_OK && owner[0] != '\0';
}

esp_err_t save_owner(uint16_t face_id, const char *owner)
{
    char key[16] = {0};
    nvs_handle_t handle;
    if (!owner_key(face_id, key, sizeof(key))) {
        return ESP_ERR_INVALID_ARG;
    }
    ESP_RETURN_ON_ERROR(nvs_open(OWNER_NAMESPACE, NVS_READWRITE, &handle), TAG, "open owner storage failed");
    const esp_err_t ret = nvs_set_str(handle, key, owner);
    if (ret == ESP_OK) {
        ESP_RETURN_ON_ERROR(nvs_commit(handle), TAG, "commit owner storage failed");
    }
    nvs_close(handle);
    return ret;
}

bool valid_owner_name(const char *owner)
{
    const size_t length = owner == nullptr ? 0 : strnlen(owner, P4_CAMERA_NAME_MAX_LEN + 1);
    return length > 0 && length <= P4_CAMERA_NAME_MAX_LEN;
}

} // namespace

extern "C" p4_face_inference_t *p4_face_inference_create(uint16_t frame_width, uint16_t frame_height)
{
    auto *inference = new p4_face_inference{
        .frame_width = frame_width,
        .frame_height = frame_height,
        .detector = std::make_unique<HumanFaceDetect>(HumanFaceDetect::MSRMNP_S8_V1, false),
        .recognizer = std::make_unique<HumanFaceRecognizer>(FACE_DATABASE_PATH, HumanFaceFeat::MFN_S8_V1, false),
        .rgb565_frame = static_cast<uint8_t *>(heap_caps_malloc(
            static_cast<size_t>(frame_width) * frame_height * 2,
            MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)),
    };
    if (inference->rgb565_frame == nullptr) {
        delete inference;
        return nullptr;
    }
    return inference;
}

extern "C" void p4_face_inference_destroy(p4_face_inference_t *inference)
{
    if (inference != nullptr) {
        heap_caps_free(inference->rgb565_frame);
    }
    delete inference;
}

extern "C" esp_err_t p4_face_inference_run(p4_face_inference_t *inference,
                                             const uint8_t *frame_data,
                                             size_t frame_size,
                                             p4_camera_metadata_t *metadata)
{
    if (inference == nullptr || frame_data == nullptr || metadata == nullptr) {
        return ESP_ERR_INVALID_ARG;
    }

    const dl::image::img_t raw8_image = {
        .data = const_cast<uint8_t *>(frame_data),
        .width = inference->frame_width,
        .height = inference->frame_height,
        .pix_type = dl::image::DL_IMAGE_PIX_TYPE_GRAY,
    };
    if (frame_size < raw8_image.bytes()) {
        ESP_LOGE(TAG, "Frame is smaller than RAW8 image requirement");
        return ESP_ERR_INVALID_SIZE;
    }

    const dl::image::img_t image = {
        .data = inference->rgb565_frame,
        .width = inference->frame_width,
        .height = inference->frame_height,
        .pix_type = dl::image::DL_IMAGE_PIX_TYPE_RGB565LE,
    };
    const int64_t started_us = esp_timer_get_time();
    auto *rgb565 = reinterpret_cast<uint16_t *>(inference->rgb565_frame);
    const auto *raw8 = static_cast<const uint8_t *>(raw8_image.data);
    /* SC2336's V4L2 BA81 stream is BGGR RAW8. ESP32-P4 v1.3 cannot use
     * CSI bridge color conversion, so create a bounded 2x2 BGGR demosaic
     * image before presenting RGB565LE to ESP-DL. */
    for (uint16_t y = 0; y < inference->frame_height; y += 2) {
        for (uint16_t x = 0; x < inference->frame_width; x += 2) {
            const size_t top_left = static_cast<size_t>(y) * inference->frame_width + x;
            const uint16_t blue = raw8[top_left];
            const uint16_t green = static_cast<uint16_t>(raw8[top_left + 1] + raw8[top_left + inference->frame_width]) / 2U;
            const uint16_t red = raw8[top_left + inference->frame_width + 1];
            const uint16_t pixel = static_cast<uint16_t>(((red & 0xF8U) << 8U) | ((green & 0xFCU) << 3U) | (blue >> 3U));
            rgb565[top_left] = pixel;
            rgb565[top_left + 1] = pixel;
            rgb565[top_left + inference->frame_width] = pixel;
            rgb565[top_left + inference->frame_width + 1] = pixel;
        }
    }
    const std::list<dl::detect::result_t> &detections = inference->detector->run(image);

    metadata->faces_count = 0;
    metadata->any_unlocked = false;
    std::memset(metadata->faces, 0, sizeof(metadata->faces));

    std::vector<dl::detect::result_t> usable_detections;
    for (const auto &detection : detections) {
        if (face_has_valid_box(detection)) {
            usable_detections.push_back(detection);
        }
    }
    std::sort(usable_detections.begin(), usable_detections.end(), [](const auto &left, const auto &right) {
        return left.score > right.score;
    });

    const size_t count = std::min(usable_detections.size(), static_cast<size_t>(P4_CAMERA_MAX_FACES));
    for (size_t index = 0; index < count; ++index) {
        copy_detection(usable_detections[index], inference->frame_width, inference->frame_height, &metadata->faces[index]);
    }
    metadata->faces_count = static_cast<uint8_t>(count);
    metadata->current_face_index = count == 0 ? -1 : 0;

    if (count > 0 && inference->recognizer->get_num_feats() > 0) {
        std::list<dl::detect::result_t> recognition_input;
        recognition_input.push_back(usable_detections.front());
        const auto results = inference->recognizer->recognize(image, recognition_input);
        if (!results.empty() && results.front().similarity >= RECOGNITION_THRESHOLD) {
            char owner[P4_CAMERA_NAME_MAX_LEN + 1] = {0};
            if (load_owner(results.front().id, owner, sizeof(owner))) {
                auto &identity = metadata->faces[0].face_id;
                identity.unlocked = true;
                identity.similarity = results.front().similarity;
                identity.threshold = RECOGNITION_THRESHOLD;
                snprintf(identity.user, sizeof(identity.user), "%s", owner);
                metadata->any_unlocked = true;
            }
        }
    }

    metadata->processing_time_ms = static_cast<float>(esp_timer_get_time() - started_us) / 1000.0F;
    return ESP_OK;
}

extern "C" esp_err_t p4_face_inference_enroll_current(p4_face_inference_t *inference,
                                                        const char *owner,
                                                        p4_face_recognition_t *result)
{
    if (inference == nullptr || result == nullptr || !valid_owner_name(owner)) {
        return ESP_ERR_INVALID_ARG;
    }

    const dl::image::img_t image = {
        .data = inference->rgb565_frame,
        .width = inference->frame_width,
        .height = inference->frame_height,
        .pix_type = dl::image::DL_IMAGE_PIX_TYPE_RGB565LE,
    };
    const std::list<dl::detect::result_t> &detections = inference->detector->run(image);
    std::list<dl::detect::result_t> enrollment_input;
    for (const auto &detection : detections) {
        if (face_has_valid_box(detection)) {
            enrollment_input.push_back(detection);
        }
    }
    if (enrollment_input.size() != 1) {
        return ESP_ERR_INVALID_STATE;
    }

    ESP_RETURN_ON_ERROR(inference->recognizer->enroll(image, enrollment_input), TAG, "face enrollment failed");
    const int face_count = inference->recognizer->get_num_feats();
    if (face_count <= 0 || face_count > UINT16_MAX) {
        return ESP_FAIL;
    }

    const uint16_t face_id = static_cast<uint16_t>(face_count);
    ESP_RETURN_ON_ERROR(save_owner(face_id, owner), TAG, "owner label storage failed");
    result->face_id = face_id;
    result->similarity = 1.0F;
    result->threshold = RECOGNITION_THRESHOLD;
    snprintf(result->owner, sizeof(result->owner), "%s", owner);
    return ESP_OK;
}
