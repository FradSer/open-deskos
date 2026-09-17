/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef P4_COMPOSITE_TUSB_CONFIG_H
#define P4_COMPOSITE_TUSB_CONFIG_H

#include_next "tusb_config.h"

#define CFG_TUSB_RHPORT1_MODE (OPT_MODE_DEVICE | OPT_MODE_HIGH_SPEED)

// One UVC MJPEG camera function over isochronous transfer, matching the
// official esp_video UVC example. Isochronous alt 1 carries the endpoint
// while alt 0 carries none, so tud_video_n_streaming() truly reflects host
// streaming state and every host session starts on a fresh frame boundary.
// (Bulk has no zero-bandwidth alt: once committed the device streams
// forever and new sessions join mid-frame, yielding torn first frames.)
#define CFG_TUD_VIDEO 1
#define CFG_TUD_VIDEO_STREAMING 1
#define CFG_TUD_VIDEO_STREAMING_BULK 0
#define CFG_TUD_VIDEO_STREAMING_EP_BUFSIZE 1024

#include "uac_config.h"
#include "uac_descriptors.h"
#include "tusb_config_uac.h"

#endif /* P4_COMPOSITE_TUSB_CONFIG_H */
