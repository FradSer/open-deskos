/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_USB_MICROPHONE_H
#define P4_USB_MICROPHONE_H

#include "driver/i2c_master.h"
#include "esp_err.h"
#include "tinyusb.h"
#include "p4_plugin_ports.h"

/* UVC camera owns interfaces 0-1; the microphone function owns 2-3. */
#define P4_USB_MIC_INTERFACE_NUMBER 3

const tinyusb_desc_config_t *p4_usb_composite_descriptors(void);
/* One lifecycle owner serializes init, stop, and cleanup. */
esp_err_t p4_usb_microphone_init(i2c_master_bus_handle_t i2c_bus);
esp_err_t p4_usb_microphone_init_with_transport(i2c_master_bus_handle_t i2c_bus,
    const p4_usb_port_t *transport);
const p4_audio_source_t *p4_microphone_source(void);
esp_err_t p4_usb_microphone_stop(void);
esp_err_t p4_usb_microphone_deinit(void);

#endif /* P4_USB_MICROPHONE_H */
