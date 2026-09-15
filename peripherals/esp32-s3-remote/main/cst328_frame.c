#include "cst328_frame.h"

bool cst328_decode_first_point(const uint8_t *frame, size_t length, cst328_point_t *point)
{
    if (frame == NULL || point == NULL || length != CST328_FRAME_BYTES) {
        return false;
    }
    const uint8_t points = frame[5] & 0x0F;
    const uint8_t status = frame[0] & 0x0F;
    if (frame[6] != CST328_FRAME_SIGNATURE || points == 0 || points > 5 || status == 0) {
        return false;
    }
    point->x = ((uint16_t)frame[1] << 4) | (frame[3] >> 4);
    point->y = ((uint16_t)frame[2] << 4) | (frame[3] & 0x0F);
    point->strength = frame[4];
    return true;
}
