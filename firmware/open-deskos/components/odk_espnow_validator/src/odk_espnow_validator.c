#include "odk_espnow_validator.h"

#include <stdlib.h>
#include <string.h>

struct odk_espnow_validator {
    struct {
        uint8_t data[ODK_ESPNOW_MAX_PAYLOAD];
        size_t len;
    } queue[ODK_ESPNOW_VALIDATOR_QUEUE_CAPACITY];
    size_t head;
    size_t tail;
    uint32_t last_digest[3];
    bool has_last_digest[3];
    odk_espnow_stats_t stats;
    odk_espnow_transport_t transport;
};

static uint32_t payload_digest(const uint8_t *data, size_t len)
{
    uint32_t hash = 2166136261u;
    for (size_t i = 0; i < len; ++i) {
        hash ^= data[i];
        hash *= 16777619u;
    }
    return hash;
}

odk_espnow_validator_t *odk_espnow_validator_create(const odk_espnow_transport_t *transport)
{
    odk_espnow_validator_t *validator = calloc(1, sizeof(*validator));
    if (validator != NULL && transport != NULL) {
        validator->transport = *transport;
    }
    return validator;
}

void odk_espnow_validator_delete(odk_espnow_validator_t *validator)
{
    free(validator);
}

bool odk_espnow_validator_enqueue(odk_espnow_validator_t *validator,
                                   const uint8_t *data, size_t len)
{
    if (validator == NULL || data == NULL || len > ODK_ESPNOW_MAX_PAYLOAD) {
        return false;
    }
    size_t next = (validator->head + 1u) % ODK_ESPNOW_VALIDATOR_QUEUE_CAPACITY;
    if (next == validator->tail) {
        validator->stats.dropped++;
        return false;
    }
    memcpy(validator->queue[validator->head].data, data, len);
    validator->queue[validator->head].len = len;
    validator->head = next;
    return true;
}

bool odk_espnow_validator_process_one(odk_espnow_validator_t *validator,
                                       odk_espnow_frame_event_t *event)
{
    if (validator == NULL || validator->tail == validator->head) {
        return false;
    }
    const size_t index = validator->tail;
    validator->tail = (validator->tail + 1u) % ODK_ESPNOW_VALIDATOR_QUEUE_CAPACITY;
    const uint8_t *data = validator->queue[index].data;
    const size_t len = validator->queue[index].len;
    const odk_espnow_frame_result_t result = odk_espnow_validate_frame(data, len);

    if (event != NULL) {
        memset(event, 0, sizeof(*event));
        event->result = result;
        event->payload_len = len;
    }
    if (result != ODK_ESPNOW_FRAME_OK) {
        if (result == ODK_ESPNOW_FRAME_UNKNOWN_TYPE) {
            validator->stats.unknown_types++;
        } else {
            validator->stats.malformed++;
        }
        return true;
    }

    odk_espnow_fleet_message_t frame;
    if (!odk_espnow_decode_frame(data, len, &frame)) {
        validator->stats.malformed++;
        if (event != NULL) event->result = ODK_ESPNOW_FRAME_INVALID;
        return true;
    }
    if (event != NULL) event->message = frame;

    validator->stats.frames++;
    const unsigned slot = frame.node_id < 3u ? frame.node_id : 0u;
    const uint32_t digest = payload_digest(data, len);
    const uint32_t timestamp =
        ((uint32_t)frame.hour << 16) | ((uint32_t)frame.minute << 8) | frame.month;
    if (validator->has_last_digest[slot] && validator->last_digest[slot] == digest &&
        validator->stats.last_timestamp[slot] == timestamp) {
        validator->stats.duplicates++;
    }
    validator->has_last_digest[slot] = true;
    validator->last_digest[slot] = digest;

    if (frame.type == ODK_ESPNOW_TYPE_ENV) {
        validator->stats.environment_frames++;
    } else if (frame.node_id == 1u) {
        validator->stats.node1_frames++;
    } else if (frame.node_id == 2u) {
        validator->stats.node2_frames++;
    } else {
        validator->stats.unknown_nodes++;
    }
    memcpy(validator->stats.last_payload[slot], data, sizeof(frame));
    validator->stats.last_payload_len[slot] = sizeof(frame);
    validator->stats.last_timestamp[slot] = timestamp;
    return true;
}

odk_err_t odk_espnow_validator_send_control(odk_espnow_validator_t *validator,
                                              odk_c6_control_command_t command,
                                              uint8_t channel, uint16_t dwell_ms)
{
    if (validator == NULL || validator->transport.send_custom_data == NULL) {
        return ODK_ERR_INVALID_ARG;
    }
    if (command == ODK_C6_CONTROL_SET_CHANNEL && (channel < 1u || channel > 13u)) {
        return ODK_ERR_INVALID_ARG;
    }
    if (command == ODK_C6_CONTROL_SCAN && dwell_ms == 0u) {
        return ODK_ERR_INVALID_ARG;
    }
    const odk_c6_control_t control = {
        .command = (uint8_t)command,
        .channel = channel,
        .dwell_ms = dwell_ms,
    };
    if (validator->transport.send_custom_data(validator->transport.ctx,
                                               ODK_C6_MSG_ID_ESPNOW_CONTROL,
                                               (const uint8_t *)&control,
                                               sizeof(control)) != 0) {
        return ODK_ERR_STATE;
    }
    return ODK_OK;
}

void odk_espnow_validator_reset_stats(odk_espnow_validator_t *validator)
{
    if (validator == NULL) return;
    memset(&validator->stats, 0, sizeof(validator->stats));
    memset(validator->last_digest, 0, sizeof(validator->last_digest));
    memset(validator->has_last_digest, 0, sizeof(validator->has_last_digest));
}

void odk_espnow_validator_get_stats(const odk_espnow_validator_t *validator,
                                     odk_espnow_stats_t *out)
{
    if (validator != NULL && out != NULL) *out = validator->stats;
}
