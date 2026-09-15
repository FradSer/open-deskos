/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_USB_MICROPHONE_H
#define P4_USB_MICROPHONE_H

#include "driver/i2c_master.h"
#include "esp_err.h"
#include "tinyusb.h"

const tinyusb_desc_config_t *p4_usb_composite_descriptors(void);
esp_err_t p4_usb_microphone_init(i2c_master_bus_handle_t i2c_bus);

#endif /* P4_USB_MICROPHONE_H */
