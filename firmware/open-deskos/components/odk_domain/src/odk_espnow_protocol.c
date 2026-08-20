#include "odk_espnow_protocol.h"

#include <string.h>
#include <math.h>

_Static_assert(sizeof(odk_espnow_fleet_message_t) <= ODK_ESPNOW_MAX_PAYLOAD,
               "Hydra FleetMessage must fit ESP-NOW v1");

odk_espnow_frame_result_t odk_espnow_validate_frame(const uint8_t *data, size_t len)
{
    if (data == NULL || len < ODK_ESPNOW_KNOWN_FRAME_SIZE) {
        return ODK_ESPNOW_FRAME_SHORT;
    }
    if (data[0] < ODK_ESPNOW_PROTOCOL_VERSION) {
        return ODK_ESPNOW_FRAME_OLD_VERSION;
    }
    if (data[1] != ODK_ESPNOW_TYPE_ENV && data[1] != ODK_ESPNOW_TYPE_STATUS) {
        return ODK_ESPNOW_FRAME_UNKNOWN_TYPE;
    }
    return ODK_ESPNOW_FRAME_OK;
}

int odk_espnow_decode_frame(const uint8_t *data, size_t len,
                             odk_espnow_fleet_message_t *out)
{
    if (out == NULL || odk_espnow_validate_frame(data, len) != ODK_ESPNOW_FRAME_OK) {
        return 0;
    }
    memcpy(out, data, sizeof(*out));
    if (!isfinite(out->temp_c) || !isfinite(out->humidity) ||
        !isfinite(out->pressure_pa) || !isfinite(out->lux) ||
        !isfinite(out->vpd_kpa) || !isfinite(out->soil_percent)) {
        return 0;
    }
    return 1;
}

const char *odk_espnow_type_name(uint8_t type)
{
    switch (type) {
    case ODK_ESPNOW_TYPE_ENV: return "ENV";
    case ODK_ESPNOW_TYPE_STATUS: return "STATUS";
    default: return "UNKNOWN";
    }
}
