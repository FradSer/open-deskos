#ifndef FAKE_ESPNOW_CUSTOM_DATA_H
#define FAKE_ESPNOW_CUSTOM_DATA_H

#include <stddef.h>
#include <stdint.h>

#include "odk_espnow_validator.h"

typedef struct {
    int send_calls;
    uint32_t last_msg_id;
    uint8_t last_data[ODK_ESPNOW_MAX_PAYLOAD];
    size_t last_len;
    int send_result;
} fake_espnow_custom_data_t;

void fake_espnow_custom_data_reset(fake_espnow_custom_data_t *fake);
int fake_espnow_custom_data_send(void *ctx, uint32_t msg_id,
                                 const uint8_t *data, size_t len);

#endif
