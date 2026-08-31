#include "fake_espnow_custom_data.h"

#include <string.h>

void fake_espnow_custom_data_reset(fake_espnow_custom_data_t *fake)
{
    memset(fake, 0, sizeof(*fake));
}

int fake_espnow_custom_data_send(void *ctx, uint32_t msg_id,
                                 const uint8_t *data, size_t len)
{
    fake_espnow_custom_data_t *fake = ctx;
    fake->send_calls++;
    fake->last_msg_id = msg_id;
    fake->last_len = len;
    if (len <= sizeof(fake->last_data)) memcpy(fake->last_data, data, len);
    return fake->send_result;
}
