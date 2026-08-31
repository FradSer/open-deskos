/*
 * SPDX-FileCopyrightText: 2026 Espressif Systems (Shanghai) CO LTD
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#pragma once

#ifdef __cplusplus
extern "C" {
#endif

/** Return the stable Open DeskOS firmware semantic version from CMake project(VERSION), such as "0.1.0". */
const char *open_deskos_get_version(void);

#ifdef __cplusplus
}
#endif
