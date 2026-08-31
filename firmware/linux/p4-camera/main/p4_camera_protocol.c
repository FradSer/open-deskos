/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#include "p4_camera_protocol.h"

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "cJSON.h"

size_t p4_camera_encode_metadata(const p4_camera_metadata_t *meta, char *buffer, size_t buffer_size)
{
    if (meta == NULL || buffer == NULL || buffer_size == 0) {
        return 0;
    }

    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return 0;
    }

    cJSON_AddNumberToObject(root, "v", P4_CAMERA_PROTOCOL_VERSION);
    cJSON_AddBoolToObject(root, "online", meta->camera_online);
    cJSON_AddNumberToObject(root, "width", meta->frame_width);
    cJSON_AddNumberToObject(root, "height", meta->frame_height);
    cJSON_AddNumberToObject(root, "sequence", meta->sequence);
    cJSON_AddNumberToObject(root, "current_face_index", meta->current_face_index);
    cJSON_AddNumberToObject(root, "faces_count", meta->faces_count);
    cJSON_AddBoolToObject(root, "any_unlocked", meta->any_unlocked);
    cJSON_AddNumberToObject(root, "processing_time_ms", meta->processing_time_ms);

    cJSON *faces_arr = cJSON_AddArrayToObject(root, "faces");
    if (faces_arr != NULL) {
        uint8_t count = meta->faces_count > P4_CAMERA_MAX_FACES ? P4_CAMERA_MAX_FACES : meta->faces_count;
        for (uint8_t i = 0; i < count; i++) {
            const p4_detected_face_t *src_face = &meta->faces[i];
            cJSON *face_obj = cJSON_CreateObject();
            if (face_obj == NULL) continue;

            cJSON *box_arr = cJSON_AddArrayToObject(face_obj, "box");
            if (box_arr != NULL) {
                cJSON_AddItemToArray(box_arr, cJSON_CreateNumber(src_face->box.x));
                cJSON_AddItemToArray(box_arr, cJSON_CreateNumber(src_face->box.y));
                cJSON_AddItemToArray(box_arr, cJSON_CreateNumber(src_face->box.w));
                cJSON_AddItemToArray(box_arr, cJSON_CreateNumber(src_face->box.h));
            }

            cJSON_AddNumberToObject(face_obj, "detect_score", src_face->detect_score);

            cJSON *landmarks_obj = cJSON_AddArrayToObject(face_obj, "landmarks");
            if (landmarks_obj != NULL) {
                const p4_point_t points[] = {
                    src_face->landmarks.right_eye, src_face->landmarks.left_eye,
                    src_face->landmarks.nose_tip, src_face->landmarks.right_mouth,
                    src_face->landmarks.left_mouth,
                };
                for (size_t point_index = 0; point_index < sizeof(points) / sizeof(points[0]); ++point_index) {
                    cJSON *point = cJSON_CreateArray();
                    if (point != NULL) {
                        cJSON_AddItemToArray(point, cJSON_CreateNumber(points[point_index].x));
                        cJSON_AddItemToArray(point, cJSON_CreateNumber(points[point_index].y));
                        cJSON_AddItemToArray(landmarks_obj, point);
                    }
                }
            }

            cJSON *face_id_obj = cJSON_AddObjectToObject(face_obj, "face_id");
            if (face_id_obj != NULL) {
                cJSON_AddBoolToObject(face_id_obj, "unlocked", src_face->face_id.unlocked);
                cJSON_AddStringToObject(face_id_obj, "user", src_face->face_id.user);
                cJSON_AddNumberToObject(face_id_obj, "similarity", src_face->face_id.similarity);
                cJSON_AddNumberToObject(face_id_obj, "threshold", src_face->face_id.threshold);
            }

            cJSON *emotion_obj = cJSON_AddObjectToObject(face_obj, "emotion");
            if (emotion_obj != NULL) {
                cJSON_AddStringToObject(emotion_obj, "primary", src_face->emotion.primary);
                cJSON_AddNumberToObject(emotion_obj, "confidence", src_face->emotion.confidence);
            }

            cJSON_AddItemToArray(faces_arr, face_obj);
        }
    }

    char *rendered = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);

    if (rendered == NULL) {
        return 0;
    }

    size_t len = strlen(rendered);
    if (len >= buffer_size) {
        free(rendered);
        return 0;
    }

    memcpy(buffer, rendered, len + 1);
    free(rendered);
    return len;
}

bool p4_camera_parse_metadata(const char *json_str, p4_camera_metadata_t *meta)
{
    if (json_str == NULL || meta == NULL) {
        return false;
    }

    memset(meta, 0, sizeof(*meta));

    cJSON *root = cJSON_Parse(json_str);
    if (root == NULL || !cJSON_IsObject(root)) {
        cJSON_Delete(root);
        return false;
    }

    const cJSON *v_item = cJSON_GetObjectItemCaseSensitive(root, "v");
    if (!cJSON_IsNumber(v_item) || v_item->valueint != P4_CAMERA_PROTOCOL_VERSION) {
        cJSON_Delete(root);
        return false;
    }
    meta->version = (uint8_t)v_item->valueint;

    const cJSON *online_item = cJSON_GetObjectItemCaseSensitive(root, "online");
    const cJSON *w_item = cJSON_GetObjectItemCaseSensitive(root, "width");
    const cJSON *h_item = cJSON_GetObjectItemCaseSensitive(root, "height");
    const cJSON *sequence_item = cJSON_GetObjectItemCaseSensitive(root, "sequence");
    const cJSON *current_face_index_item = cJSON_GetObjectItemCaseSensitive(root, "current_face_index");
    const cJSON *fc_item = cJSON_GetObjectItemCaseSensitive(root, "faces_count");
    const cJSON *unl_item = cJSON_GetObjectItemCaseSensitive(root, "any_unlocked");
    const cJSON *pt_item = cJSON_GetObjectItemCaseSensitive(root, "processing_time_ms");
    const cJSON *faces_arr = cJSON_GetObjectItemCaseSensitive(root, "faces");

    if (!cJSON_IsBool(online_item)
        || !cJSON_IsNumber(w_item) || w_item->valueint <= 0 || w_item->valueint > UINT16_MAX
        || !cJSON_IsNumber(h_item) || h_item->valueint <= 0 || h_item->valueint > UINT16_MAX
        || !cJSON_IsNumber(sequence_item) || sequence_item->valuedouble < 0 || sequence_item->valuedouble > UINT32_MAX
        || !cJSON_IsNumber(current_face_index_item)
        || !cJSON_IsNumber(fc_item) || fc_item->valueint < 0 || fc_item->valueint > P4_CAMERA_MAX_FACES
        || (fc_item->valueint == 0 && current_face_index_item->valueint != -1)
        || (fc_item->valueint > 0 && (current_face_index_item->valueint < 0 || current_face_index_item->valueint >= fc_item->valueint))
        || !cJSON_IsBool(unl_item)
        || !cJSON_IsNumber(pt_item) || pt_item->valuedouble < 0
        || !cJSON_IsArray(faces_arr)
        || cJSON_GetArraySize(faces_arr) != fc_item->valueint) {
        cJSON_Delete(root);
        return false;
    }

    meta->camera_online = cJSON_IsTrue(online_item);
    meta->frame_width = (uint16_t)w_item->valueint;
    meta->frame_height = (uint16_t)h_item->valueint;
    meta->sequence = (uint32_t)sequence_item->valuedouble;
    meta->current_face_index = (int8_t)current_face_index_item->valueint;
    meta->faces_count = (uint8_t)fc_item->valueint;
    meta->any_unlocked = cJSON_IsTrue(unl_item);
    meta->processing_time_ms = (float)pt_item->valuedouble;

    {
        int arr_size = cJSON_GetArraySize(faces_arr);
        int parsed_count = 0;
        for (int i = 0; i < arr_size && parsed_count < P4_CAMERA_MAX_FACES; i++) {
            const cJSON *face_obj = cJSON_GetArrayItem(faces_arr, i);
            if (!cJSON_IsObject(face_obj)) continue;

            p4_detected_face_t *dst = &meta->faces[parsed_count];

            const cJSON *box_arr = cJSON_GetObjectItemCaseSensitive(face_obj, "box");
            const cJSON *score = cJSON_GetObjectItemCaseSensitive(face_obj, "detect_score");
            if (!cJSON_IsArray(box_arr) || cJSON_GetArraySize(box_arr) != 4 || !cJSON_IsNumber(score)
                || score->valuedouble < 0 || score->valuedouble > 1) {
                cJSON_Delete(root);
                return false;
            }
            const cJSON *x = cJSON_GetArrayItem(box_arr, 0);
            const cJSON *y = cJSON_GetArrayItem(box_arr, 1);
            const cJSON *w = cJSON_GetArrayItem(box_arr, 2);
            const cJSON *h = cJSON_GetArrayItem(box_arr, 3);
            if (!cJSON_IsNumber(x) || !cJSON_IsNumber(y) || !cJSON_IsNumber(w) || !cJSON_IsNumber(h)
                || x->valueint < 0 || y->valueint < 0 || w->valueint <= 0 || h->valueint <= 0
                || x->valueint + w->valueint > meta->frame_width || y->valueint + h->valueint > meta->frame_height) {
                cJSON_Delete(root);
                return false;
            }
            dst->box.x = (int16_t)x->valueint;
            dst->box.y = (int16_t)y->valueint;
            dst->box.w = (int16_t)w->valueint;
            dst->box.h = (int16_t)h->valueint;
            dst->detect_score = (float)score->valuedouble;

            const cJSON *landmarks_arr = cJSON_GetObjectItemCaseSensitive(face_obj, "landmarks");
            if (cJSON_IsArray(landmarks_arr) && cJSON_GetArraySize(landmarks_arr) == 5) {
                p4_point_t *points[] = {
                    &dst->landmarks.right_eye, &dst->landmarks.left_eye,
                    &dst->landmarks.nose_tip, &dst->landmarks.right_mouth,
                    &dst->landmarks.left_mouth,
                };
                for (size_t point_index = 0; point_index < sizeof(points) / sizeof(points[0]); ++point_index) {
                    const cJSON *point = cJSON_GetArrayItem(landmarks_arr, point_index);
                    const cJSON *point_x = cJSON_IsArray(point) ? cJSON_GetArrayItem(point, 0) : NULL;
                    const cJSON *point_y = cJSON_IsArray(point) ? cJSON_GetArrayItem(point, 1) : NULL;
                    if (!cJSON_IsNumber(point_x) || !cJSON_IsNumber(point_y)
                        || point_x->valuedouble < 0 || point_x->valuedouble >= meta->frame_width
                        || point_y->valuedouble < 0 || point_y->valuedouble >= meta->frame_height) {
                        cJSON_Delete(root);
                        return false;
                    }
                    points[point_index]->x = (float)point_x->valuedouble;
                    points[point_index]->y = (float)point_y->valuedouble;
                }
            }

            const cJSON *fid_obj = cJSON_GetObjectItemCaseSensitive(face_obj, "face_id");
            if (cJSON_IsObject(fid_obj)) {
                const cJSON *unlocked = cJSON_GetObjectItemCaseSensitive(fid_obj, "unlocked");
                const cJSON *user = cJSON_GetObjectItemCaseSensitive(fid_obj, "user");
                const cJSON *sim = cJSON_GetObjectItemCaseSensitive(fid_obj, "similarity");
                const cJSON *thresh = cJSON_GetObjectItemCaseSensitive(fid_obj, "threshold");
                if (!cJSON_IsBool(unlocked) || !cJSON_IsString(user) || user->valuestring == NULL
                    || strlen(user->valuestring) > P4_CAMERA_NAME_MAX_LEN
                    || !cJSON_IsNumber(sim) || sim->valuedouble < 0 || sim->valuedouble > 1
                    || !cJSON_IsNumber(thresh) || thresh->valuedouble < 0 || thresh->valuedouble > 1) {
                    cJSON_Delete(root);
                    return false;
                }
                dst->face_id.unlocked = cJSON_IsTrue(unlocked);
                strncpy(dst->face_id.user, user->valuestring, P4_CAMERA_NAME_MAX_LEN);
                dst->face_id.similarity = (float)sim->valuedouble;
                dst->face_id.threshold = (float)thresh->valuedouble;
            }

            const cJSON *emo_obj = cJSON_GetObjectItemCaseSensitive(face_obj, "emotion");
            if (cJSON_IsObject(emo_obj)) {
                const cJSON *prim = cJSON_GetObjectItemCaseSensitive(emo_obj, "primary");
                const cJSON *conf = cJSON_GetObjectItemCaseSensitive(emo_obj, "confidence");
                if (!cJSON_IsString(prim) || prim->valuestring == NULL || strlen(prim->valuestring) > P4_CAMERA_EMOTION_MAX_LEN
                    || !cJSON_IsNumber(conf) || conf->valuedouble < 0 || conf->valuedouble > 1) {
                    cJSON_Delete(root);
                    return false;
                }
                strncpy(dst->emotion.primary, prim->valuestring, P4_CAMERA_EMOTION_MAX_LEN);
                dst->emotion.confidence = (float)conf->valuedouble;
            }

            parsed_count++;
        }
        if (parsed_count != meta->faces_count) {
            cJSON_Delete(root);
            return false;
        }
    }

    cJSON_Delete(root);
    return true;
}
