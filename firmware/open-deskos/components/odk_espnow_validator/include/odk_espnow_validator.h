#ifndef ODK_ESPNOW_VALIDATOR_H
#define ODK_ESPNOW_VALIDATOR_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "odk_err.h"
#include "odk_espnow_protocol.h"

#define ODK_ESPNOW_VALIDATOR_QUEUE_CAPACITY 16u
#define ODK_C6_MSG_ID_ESPNOW_RX 0x43455201u
#define ODK_C6_MSG_ID_ESPNOW_CONTROL 0x43455202u
#define ODK_C6_MSG_ID_ESPNOW_STATUS 0x43455203u

typedef enum {
    ODK_C6_CONTROL_SET_CHANNEL = 1,
    ODK_C6_CONTROL_GET_STATUS = 2,
    ODK_C6_CONTROL_RESET_STATS = 3,
    ODK_C6_CONTROL_SCAN = 4,
    ODK_C6_CONTROL_STOP_SCAN = 5,
} odk_c6_control_command_t;

typedef struct __attribute__((packed)) {
    uint8_t command;
    uint8_t channel;
    uint16_t dwell_ms;
} odk_c6_control_t;

typedef int (*odk_espnow_send_custom_data_fn)(void *ctx, uint32_t msg_id,
                                                const uint8_t *data, size_t len);

typedef struct {
    odk_espnow_send_custom_data_fn send_custom_data;
    void *ctx;
} odk_espnow_transport_t;

typedef struct {
    uint32_t frames;
    uint32_t environment_frames;
    uint32_t node1_frames;
    uint32_t node2_frames;
    uint32_t unknown_nodes;
    uint32_t unknown_types;
    uint32_t malformed;
    uint32_t dropped;
    uint32_t duplicates;
    uint32_t last_timestamp[3];
    uint8_t last_payload[3][ODK_ESPNOW_KNOWN_FRAME_SIZE];
    size_t last_payload_len[3];
} odk_espnow_stats_t;

typedef struct {
    odk_espnow_frame_result_t result;
    odk_espnow_fleet_message_t message;
    size_t payload_len;
} odk_espnow_frame_event_t;

typedef struct odk_espnow_validator odk_espnow_validator_t;

odk_espnow_validator_t *odk_espnow_validator_create(const odk_espnow_transport_t *transport);
void odk_espnow_validator_delete(odk_espnow_validator_t *validator);

/* Models the ESP-Hosted callback boundary: it only copies into the queue. */
bool odk_espnow_validator_enqueue(odk_espnow_validator_t *validator,
                                   const uint8_t *data, size_t len);
/* Consume one queued frame. The caller owns logging and scheduling. */
bool odk_espnow_validator_process_one(odk_espnow_validator_t *validator,
                                       odk_espnow_frame_event_t *event);

odk_err_t odk_espnow_validator_send_control(odk_espnow_validator_t *validator,
                                              odk_c6_control_command_t command,
                                              uint8_t channel, uint16_t dwell_ms);
void odk_espnow_validator_reset_stats(odk_espnow_validator_t *validator);
void odk_espnow_validator_get_stats(const odk_espnow_validator_t *validator,
                                     odk_espnow_stats_t *out);

#endif
