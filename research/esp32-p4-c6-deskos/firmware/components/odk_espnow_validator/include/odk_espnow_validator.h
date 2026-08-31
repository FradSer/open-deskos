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
#define ODK_C6_MSG_ID_ESPNOW_TX 0x43455204u
#define ODK_C6_MSG_ID_ESPNOW_TX_RESULT 0x43455205u
#define ODK_C6_MSG_ID_ESPNOW_PEER 0x43455206u
#define ODK_C6_MSG_ID_ESPNOW_PEER_RESULT 0x43455207u

#define ODK_ESPNOW_LMK_LEN 16u
#define ODK_ESPNOW_TX_STATUS_OK 0u
#define ODK_C6_PEER_FLAG_ENCRYPT 0x01u

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

typedef enum {
    ODK_C6_PEER_OP_ADD = 1,
    ODK_C6_PEER_OP_DEL = 2,
    ODK_C6_PEER_OP_SET_PMK = 3,
} odk_c6_peer_op_t;

typedef struct __attribute__((packed)) {
    uint8_t op;
    uint8_t mac[ODK_ESPNOW_MAC_LEN];
    uint8_t flags;
    uint8_t lmk[ODK_ESPNOW_LMK_LEN];
} odk_c6_peer_frame_t;

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
    uint32_t tx_ok;
    uint32_t tx_failed;
    uint32_t last_timestamp[3];
    uint8_t last_payload[3][ODK_ESPNOW_KNOWN_FRAME_SIZE];
    size_t last_payload_len[3];
} odk_espnow_stats_t;

typedef struct {
    odk_espnow_frame_result_t result;
    odk_espnow_fleet_message_t message;
    size_t payload_len;
    uint8_t src_mac[ODK_ESPNOW_MAC_LEN];
} odk_espnow_frame_event_t;

typedef struct odk_espnow_validator odk_espnow_validator_t;

odk_espnow_validator_t *odk_espnow_validator_create(const odk_espnow_transport_t *transport);
void odk_espnow_validator_delete(odk_espnow_validator_t *validator);

/* Models the ESP-Hosted callback boundary: it only copies into the queue.
   src_mac comes from the C6 transport header, never from the payload. */
bool odk_espnow_validator_enqueue(odk_espnow_validator_t *validator,
                                   const uint8_t src_mac[ODK_ESPNOW_MAC_LEN],
                                   const uint8_t *data, size_t len);
/* Consume one queued frame. The caller owns logging and scheduling. */
bool odk_espnow_validator_process_one(odk_espnow_validator_t *validator,
                                       odk_espnow_frame_event_t *event);

/* Queue one ESP-NOW payload for transmission to dst_mac through the C6. */
odk_err_t odk_espnow_validator_send(odk_espnow_validator_t *validator,
                                      const uint8_t dst_mac[ODK_ESPNOW_MAC_LEN],
                                      const uint8_t *payload, size_t len);
/* Record one TX result frame reported by the C6 send callback. */
void odk_espnow_validator_note_tx_result(odk_espnow_validator_t *validator,
                                           const uint8_t mac[ODK_ESPNOW_MAC_LEN],
                                           uint8_t status);
/* Mirror a peer entry on the C6 radio; lmk is required when encrypt is true. */
odk_err_t odk_espnow_validator_add_peer(odk_espnow_validator_t *validator,
                                          const uint8_t mac[ODK_ESPNOW_MAC_LEN],
                                          const uint8_t lmk[ODK_ESPNOW_LMK_LEN],
                                          bool encrypt);
odk_err_t odk_espnow_validator_del_peer(odk_espnow_validator_t *validator,
                                          const uint8_t mac[ODK_ESPNOW_MAC_LEN]);

odk_err_t odk_espnow_validator_send_control(odk_espnow_validator_t *validator,
                                              odk_c6_control_command_t command,
                                              uint8_t channel, uint16_t dwell_ms);
void odk_espnow_validator_reset_stats(odk_espnow_validator_t *validator);
void odk_espnow_validator_get_stats(const odk_espnow_validator_t *validator,
                                     odk_espnow_stats_t *out);

#endif
