/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include "esp_err.h"

/* Serialize all UAC init and deinit calls through one lifecycle owner. */
/* Call only after shared TinyUSB callbacks have stopped. Timeout retains state. */
esp_err_t uac_device_deinit_after_usb_stop(void);
