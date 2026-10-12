/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include <stdatomic.h>
#include <sys/ioctl.h>
#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "linux/videodev2.h"

/* Private to this reviewed video build; argument is an atomic_bool **. */
#define VIDIOC_P4_RECEIVER_FLAG _IOW('V', BASE_VIDIOC_PRIVATE + 127, void *)

/* One owner binds before receive and unbinds after all receiver workers exit. */
/* The flag must remain valid until that exit. True permits receive. */
esp_err_t p4_video_bind_receiver(void *device, atomic_bool *running);
atomic_bool *p4_video_receiver_flag(void *device);
BaseType_t p4_video_receive_wait(SemaphoreHandle_t ready, TickType_t ticks, atomic_bool *running);
