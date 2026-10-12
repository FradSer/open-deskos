/* SPDX-License-Identifier: Apache-2.0 */
#pragma once
#include "odk_plugin_host.h"

/* Use the same owner task for all host lifecycle operations. */
odk_plugin_host_t *p4_camera_plugin_host(void);
