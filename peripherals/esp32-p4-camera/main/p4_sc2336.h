/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_SC2336_H
#define P4_SC2336_H

#include "driver/i2c_master.h"
#include "esp_err.h"

typedef struct {
    int sda_pin;
    int scl_pin;
    int reset_pin;
    int pwdn_pin;
    int i2c_port;
    uint32_t i2c_freq;
} p4_sc2336_pin_config_t;

/**
 * @brief Initialize SC2336 sensor hardware interface (SCCB, Reset lines, MIPI CSI-2).
 *
 * @param pins Pin configuration.
 * @return esp_err_t ESP_OK on success.
 */
esp_err_t p4_peripheral_i2c_init(i2c_master_bus_handle_t *bus_handle);
esp_err_t p4_sc2336_init_hardware(const p4_sc2336_pin_config_t *pins,
                                  i2c_master_bus_handle_t bus_handle);

#endif /* P4_SC2336_H */
