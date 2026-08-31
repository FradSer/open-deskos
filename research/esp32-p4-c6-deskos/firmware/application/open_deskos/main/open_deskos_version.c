/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include "open_deskos_version.h"

#include "esp_app_desc.h"

const char *open_deskos_get_version(void)
{
    return esp_app_get_description()->version;
}
