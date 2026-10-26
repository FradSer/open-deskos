#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define RADIO_HEADER 24
#define RADIO_CHUNK 226
#define RADIO_STATE_MAX 512
#define RADIO_HELLO 1
#define RADIO_HELLO_ACK 2
#define RADIO_INPUT 3
#define RADIO_STATE 4
#define RADIO_STATE_ACK 5

typedef struct {
    uint8_t type, part, count;
    uint32_t remote, host, sequence;
    uint16_t total;
    const uint8_t *payload;
    size_t length;
} radio_frame_t;
typedef struct {
    uint32_t sequence, started_ms;
    uint16_t total;
    uint8_t mask;
    uint8_t bytes[RADIO_STATE_MAX + 1];
} radio_assembly_t;
bool radio_frame_decode(const uint8_t *data, size_t length, radio_frame_t *frame);
size_t radio_frame_encode(uint8_t *data, uint8_t type, uint32_t remote, uint32_t host,
                          uint32_t sequence, const uint8_t *payload, size_t length);
// Returns a complete, terminated state only once. Caller validates its JSON before commit.
bool radio_state_accept(radio_assembly_t *assembly, const radio_frame_t *frame, uint32_t now_ms);
