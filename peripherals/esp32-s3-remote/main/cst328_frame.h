#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define CST328_FRAME_BYTES 27
#define CST328_FRAME_SIGNATURE 0xAB

typedef struct {
    uint16_t x;
    uint16_t y;
    uint8_t strength;
} cst328_point_t;

bool cst328_decode_first_point(const uint8_t *frame, size_t length, cst328_point_t *point);
