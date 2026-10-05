#pragma once

#include "touchpad_gesture.h"

#define STATE_NAME_MAX_BYTES 47

typedef struct {
    bool received;
    uint16_t page;
    uint16_t pages;
    bool can_prev;
    bool can_next;
    char name[STATE_NAME_MAX_BYTES + 1];
    uint8_t action_count;
    touchbar_action_t actions[MAX_TOUCHBAR_ACTIONS];
} remote_state_t;

// Invalid frames leave the last authoritative state unchanged.
bool remote_state_frame_parse(const char *line, remote_state_t *state);
