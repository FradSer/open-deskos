/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_USB_MICROPHONE_H
#define P4_USB_MICROPHONE_H

#include "driver/i2c_master.h"
#include "esp_err.h"
#include "tinyusb.h"

/* UVC camera owns interfaces 0-1; the microphone function owns 2-3. */
#define P4_USB_MIC_INTERFACE_NUMBER 3

const tinyusb_desc_config_t *p4_usb_composite_descriptors(void);
esp_err_t p4_usb_microphone_init(i2c_master_bus_handle_t i2c_bus);

#endif /* P4_USB_MICROPHONE_H */
