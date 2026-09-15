/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_COMPOSITE_TUSB_CONFIG_H
#define P4_COMPOSITE_TUSB_CONFIG_H

#include_next "tusb_config.h"

#define CFG_TUSB_RHPORT1_MODE (OPT_MODE_DEVICE | OPT_MODE_HIGH_SPEED)

#include "uac_config.h"
#include "uac_descriptors.h"
#include "tusb_config_uac.h"

#endif /* P4_COMPOSITE_TUSB_CONFIG_H */
