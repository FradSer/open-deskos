#ifndef ODK_ESPNOW_PROTOCOL_H
#define ODK_ESPNOW_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

#define ODK_ESPNOW_PROTOCOL_VERSION 4u
#define ODK_ESPNOW_MAX_PAYLOAD 250u
#define ODK_ESPNOW_MAC_LEN 6u
#define ODK_ESPNOW_DEFAULT_CHANNEL 1u

typedef enum {
    ODK_ESPNOW_TYPE_ENV = 1,
    ODK_ESPNOW_TYPE_STATUS = 2,
} odk_espnow_type_t;

typedef struct __attribute__((packed)) {
    uint8_t version;
    uint8_t type;
    uint8_t node_id;
    uint8_t mac[ODK_ESPNOW_MAC_LEN];
    float temp_c;
    float humidity;
    float pressure_pa;
    float lux;
    float vpd_kpa;
    uint8_t hour;
    uint8_t minute;
    uint8_t month;
    int32_t soil_raw;
    float soil_percent;
    uint8_t soil_valid;
    uint8_t status;
    uint8_t pulse_count;
    uint8_t effective_dry_percent;
    uint8_t season;
    uint32_t firmware_version;
    uint8_t pump_on;
    uint8_t view_on;
    uint8_t channel;
    uint32_t ota_version;
    uint32_t ota_bin_size;
    uint8_t ota_sha256[32];
    uint8_t ota_ip[4];
    uint16_t ota_port;
    uint32_t ota_seq;
    char ssid[33];
    char psk[64];
} odk_espnow_fleet_message_t;

#define ODK_ESPNOW_KNOWN_FRAME_SIZE ((size_t)sizeof(odk_espnow_fleet_message_t))

typedef enum {
    ODK_ESPNOW_FRAME_OK = 0,
    ODK_ESPNOW_FRAME_SHORT,
    ODK_ESPNOW_FRAME_OLD_VERSION,
    ODK_ESPNOW_FRAME_UNKNOWN_TYPE,
    ODK_ESPNOW_FRAME_INVALID,
} odk_espnow_frame_result_t;

odk_espnow_frame_result_t odk_espnow_validate_frame(const uint8_t *data, size_t len);
int odk_espnow_decode_frame(const uint8_t *data, size_t len,
                             odk_espnow_fleet_message_t *out);
const char *odk_espnow_type_name(uint8_t type);

#endif
