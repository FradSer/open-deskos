/*
 * SPDX-FileCopyrightText: 2026 Open DeskOS
 *
 * SPDX-License-Identifier: Apache-2.0
 */
#include "esp_log.h"

/*
 * Headless board entry: no LCD factory entry by design (HG-1 unresolved). The
 * AMOLED variant lands as open-deskos_p4_amoled; see
 * docs/plans/2026-07-04-open-deskos-app-center-redesign-design/architecture.md §3.1.
 *
 * board_devices.yaml declares neither display_lcd nor lcd_touch, so the board
 * manager never invokes a DSI panel factory. This file therefore deliberately
 * provides no DSI panel factory override and no touch factory override.
 */

static const char *TAG = "Open DeskOS_P4_HEADLESS_SETUP_DEVICE";

/*
 * Board early init runs before the board manager via a constructor, matching
 * the pattern the other P4 board entries in this tree use.
 */
static void __attribute__((constructor)) open_deskos_p4_headless_early_init(void)
{
    ESP_LOGI(TAG, "Open DeskOS P4 headless board early init (no display)");
}
