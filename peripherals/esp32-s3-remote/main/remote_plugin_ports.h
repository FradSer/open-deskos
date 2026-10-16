/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include "odk_plugin_host.h"
#include "remote_state_frame.h"
#include "touchpad_gesture.h"

typedef struct {
    void (*render)(uint16_t *framebuffer, const remote_state_t *state);
    esp_err_t (*drain)(void);
} remote_display_port_t;
typedef struct { bool (*read_point)(int16_t *, int16_t *); } remote_touch_port_t;
typedef struct {
    void (*receive)(void);
    bool (*send)(void *, remote_input_t, const char *);
} remote_serial_port_t;
typedef struct { uint16_t *framebuffer; void *state_queue; } remote_buffers_port_t;
typedef struct { void (*run)(void); } remote_surface_port_t;

static inline remote_buffers_port_t *remote_buffers_from_context(void *context)
{
    remote_buffers_port_t *buffers = odk_plugin_get(context, "odk:s3/buffers/v1");
    return buffers && buffers->framebuffer && buffers->state_queue ? buffers : NULL;
}
