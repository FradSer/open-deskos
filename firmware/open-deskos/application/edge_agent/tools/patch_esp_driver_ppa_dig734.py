#!/usr/bin/env python3
"""Apply Espressif's temporary PPA-hang fix (DIG-734) to the IDF's ppa_srm.c.

Background
----------
ESP32-P4's PPA SRM (scale/rotate/mirror) unit has a hardware bug where a
non-trivial DMA2D output block can hang the transaction — the DMA2D engine
waits forever on a channel that never completes. Espressif ships a temporary
workaround in `0001-bugfix-ppa-Temporary-fix-for-the-PPA-hang-issue.patch`
(managed_components/espressif__esp_lvgl_adapter/): it replaces the complex
`bypass_mb_order` computation with `ppa_ll_srm_bypass_mb_order(dev, true)` so
SRM always bypasses the macroblock-order path that triggers the hang.

When `CONFIG_LV_USE_PPA` is enabled the LVGL ESP-PPA draw unit drives SRM for
hero cover / rounded-corner fills. Without this patch the first SRM op on a
hanging geometry blocks the DMA2D channel; the LVGL render task stalls (not a
crash — the task stays alive, no Guru) and the launcher never reaches
"voice UI running". The patch file sits in managed_components/ but nothing
applies it; this script does, targeting the IDF component itself.

Run from CMake configure (and manually after `idf.py update-dependencies` or
an IDF upgrade). Idempotent: skips when `bypass_mb_order(platform->hal.dev,
true)` is already present.
"""
from __future__ import annotations

import os
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]

# Locate the IDF esp_driver_ppa component. Prefer $IDF_PATH when set (active
# IDF export), fall back to the v6.0.1 toolchain path we know this board uses.
idf_path = os.environ.get("IDF_PATH")
candidates: list[pathlib.Path] = []
if idf_path:
    candidates.append(pathlib.Path(idf_path) / "components" / "esp_driver_ppa" / "src" / "ppa_srm.c")
candidates.append(
    pathlib.Path.home() / ".espressif" / "v6.0.1" / "esp-idf" / "components" / "esp_driver_ppa" / "src" / "ppa_srm.c"
)

SRM_FILE = next((c for c in candidates if c.is_file()), None)

# The original DIG-734 workaround block, exactly as it appears before the fix.
OLD_WORKAROUND = """\
    // Hardware bug workaround (DIG-734)
    uint32_t w_out = srm_trans_desc->in.block_w * srm_trans_desc->scale_x_int + srm_trans_desc->in.block_w * srm_trans_desc->scale_x_frag / PPA_LL_SRM_SCALING_FRAG_MAX;
    uint32_t w_divisor = (ppa_out_color_mode == PPA_SRM_COLOR_MODE_ARGB8888 || ppa_out_color_mode == PPA_SRM_COLOR_MODE_RGB888) ? 32 : 64;
    uint32_t w_left = w_out % w_divisor;
    w_left = (w_left == 0) ? w_divisor : w_left;
    uint32_t h_mb = (ppa_ll_srm_get_mb_size(platform->hal.dev) == PPA_LL_SRM_MB_SIZE_16_16) ? 16 : 32;
    uint32_t h_in_left = srm_trans_desc->in.block_h % h_mb;
    h_in_left = (h_in_left == 0) ? h_mb : h_in_left;
    uint32_t h_left = h_in_left * srm_trans_desc->scale_y_int + h_in_left * srm_trans_desc->scale_y_frag / PPA_LL_SRM_SCALING_FRAG_MAX;
    const uint32_t dma2d_fifo_depth_bits = 12 * 128;
    uint32_t out_pixel_depth = color_hal_pixel_format_fourcc_get_bit_depth((esp_color_fourcc_t)ppa_out_color_mode);
    bool bypass_mb_order = false;
    if (((w_out > w_divisor) || (srm_trans_desc->in.block_h > h_mb)) && // will be cut into more than one trans unit
            ((w_left * h_left * out_pixel_depth) < dma2d_fifo_depth_bits)
       ) {
        bypass_mb_order = true;
    }
    ppa_ll_srm_bypass_mb_order(platform->hal.dev, bypass_mb_order);
"""

NEW_FIX = """\
    ppa_ll_srm_bypass_mb_order(platform->hal.dev, true);
"""


def main() -> int:
    if SRM_FILE is None:
        print("[patch_dig734] error: ppa_srm.c not found (set IDF_PATH or check v6.0.1 path)")
        return 1

    text = SRM_FILE.read_text(encoding="utf-8")

    if NEW_FIX in text:
        print(f"[patch_dig734] {SRM_FILE}: already applied")
        return 0

    if OLD_WORKAROUND not in text:
        print(f"[patch_dig734] {SRM_FILE}: DIG-734 workaround block not found (unexpected source)")
        return 1

    text = text.replace(OLD_WORKAROUND, NEW_FIX, 1)
    SRM_FILE.write_text(text, encoding="utf-8")
    print(f"[patch_dig734] {SRM_FILE}: DIG-734 workaround -> bypass_mb_order(true)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
