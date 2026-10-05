#include "remote_state_frame.h"

#include <string.h>

#include "cJSON.h"

static bool copy_json_string(const cJSON *item, char *output, size_t output_size)
{
    if (!cJSON_IsString(item) || item->valuestring == NULL) {
        return false;
    }
    const size_t length = strlen(item->valuestring);
    if (length == 0 || length >= output_size) {
        return false;
    }
    memcpy(output, item->valuestring, length + 1);
    return true;
}

static bool json_is_positive_u16(const cJSON *item, uint16_t *value)
{
    if (!cJSON_IsNumber(item) || item->valuedouble != (double)item->valueint ||
        item->valueint < 1 || item->valueint > UINT16_MAX) {
        return false;
    }
    *value = (uint16_t)item->valueint;
    return true;
}

static bool json_is_string(const cJSON *item, const char *expected)
{
    return cJSON_IsString(item) && item->valuestring != NULL && strcmp(item->valuestring, expected) == 0;
}

static bool json_is_supported_link(const cJSON *item)
{
    return json_is_string(item, "wired") || json_is_string(item, "wireless");
}

bool remote_state_frame_parse(const char *line, remote_state_t *state)
{
    cJSON *json = cJSON_ParseWithLengthOpts(line, strlen(line) + 1, NULL, true);
    if (!cJSON_IsObject(json)) {
        cJSON_Delete(json);
        return false;
    }
    remote_state_t candidate = {0};
    const cJSON *version = cJSON_GetObjectItemCaseSensitive(json, "v");
    const cJSON *can_prev = cJSON_GetObjectItemCaseSensitive(json, "canPrev");
    const cJSON *can_next = cJSON_GetObjectItemCaseSensitive(json, "canNext");
    const cJSON *mode = cJSON_GetObjectItemCaseSensitive(json, "mode");
    const cJSON *actions = cJSON_GetObjectItemCaseSensitive(json, "actions");
    const bool valid_mode = mode == NULL || json_is_string(mode, "browse") || json_is_string(mode, "focus");
    bool valid_actions = true;
    if (actions != NULL) {
        if (!cJSON_IsArray(actions)) {
            valid_actions = false;
        } else {
            const int count = cJSON_GetArraySize(actions);
            for (int i = 0; i < count && i < MAX_TOUCHBAR_ACTIONS; ++i) {
                const cJSON *item = cJSON_GetArrayItem(actions, i);
                if (!cJSON_IsObject(item)) {
                    valid_actions = false;
                    break;
                }
                const cJSON *id = cJSON_GetObjectItemCaseSensitive(item, "id");
                if (id == NULL) id = cJSON_GetObjectItemCaseSensitive(item, "action");
                const cJSON *label = cJSON_GetObjectItemCaseSensitive(item, "label");
                if (label == NULL) label = cJSON_GetObjectItemCaseSensitive(item, "name");
                if (!copy_json_string(id, candidate.actions[candidate.action_count].id,
                                      sizeof(candidate.actions[0].id)) ||
                    !copy_json_string(label, candidate.actions[candidate.action_count].label,
                                      sizeof(candidate.actions[0].label))) {
                    valid_actions = false;
                    break;
                }
                candidate.action_count++;
            }
        }
    }
    const bool valid = cJSON_IsNumber(version) && version->valuedouble == 1 &&
                       json_is_string(cJSON_GetObjectItemCaseSensitive(json, "type"), "state") &&
                       json_is_supported_link(cJSON_GetObjectItemCaseSensitive(json, "link")) &&
                       valid_mode && valid_actions && cJSON_IsBool(can_prev) && cJSON_IsBool(can_next) &&
                       json_is_positive_u16(cJSON_GetObjectItemCaseSensitive(json, "page"), &candidate.page) &&
                       json_is_positive_u16(cJSON_GetObjectItemCaseSensitive(json, "pages"), &candidate.pages) &&
                       copy_json_string(cJSON_GetObjectItemCaseSensitive(json, "name"),
                                        candidate.name, sizeof(candidate.name));
    candidate.can_prev = cJSON_IsTrue(can_prev);
    candidate.can_next = cJSON_IsTrue(can_next);
    const bool consistent_boundaries = candidate.page <= candidate.pages &&
                                       candidate.can_prev == (candidate.page > 1) &&
                                       candidate.can_next == (candidate.page < candidate.pages);
    cJSON_Delete(json);
    if (!valid || !consistent_boundaries) {
        return false;
    }
    candidate.received = true;
    *state = candidate;
    return true;
}
