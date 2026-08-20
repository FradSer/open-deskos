#!/usr/bin/env python3
"""Keep LVGL's built-in PPA unit safe on the ESP32-P4 display path.

managed_components/ is gitignored and refreshed by the component manager.
Run from CMake configure (and manually after `idf.py update-dependencies`).
Idempotent: upgrades an earlier 64-byte-size workaround when it is present.

Background
----------
LVGL 9.5.0's ESP-PPA draw unit calls `lv_draw_buf_invalidate_cache` before and
after each PPA fill/image op. The registered handler (`lv_draw_ppa_buf.c`'s
`invalidate_cache`) invokes `esp_cache_msync(draw_buf->data, draw_buf->data_size, …)`
with `ESP_CACHE_MSYNC_FLAG_DIR_C2M | ESP_CACHE_MSYNC_FLAG_TYPE_DATA`, but
without `ESP_CACHE_MSYNC_FLAG_UNALIGNED`.

On ESP32-P4 the draw buffer lives in PSRAM and `data_size` can end mid-cache
line. `esp_cache_msync` then returns `ESP_ERR_INVALID_ARG` and does
nothing, so the CPU writes are never flushed to PSRAM before PPA reads them.
That stale-cache read shows up as garbled frames during big redraws — e.g. the
launcher's hero open/close animation "jumping" to its end state.

The C2M (CPU→memory) direction permits `ESP_CACHE_MSYNC_FLAG_UNALIGNED`
(see esp_cache.h / esp_cache_msync.c); the flag skips the cache-line alignment
check and still performs the writeback. The M2C direction does not allow it,
but this handler only ever runs C2M (it prepares CPU-drawn data for PPA to
read). Writeback of a trailing partial cache line is safe: it rewrites the
whole cache line, preserving neighbouring bytes.

The PPA hardware also rejects an output whose address or *actual allocation*
does not meet the P4's cache-line contract. A prior workaround rounded the
declared size to 64 B and still let PPA claim the task; that is both incorrect
for 128 B L2 lines and can leave a task rendered by neither unit. Instead the
PPA dispatcher now releases an ineligible task to LVGL's software unit before
it calls the hardware. Eligible buffers retain the exact allocated size.

Even an eligible PPA image task can be rejected later by ``ppa_do_blend``
(for example when a source snapshot cannot satisfy an input-side DMA
constraint). By that point LVGL's PPA unit owns the draw task, so merely
logging the error marks an undrawn image as finished. Patch that path to call
LVGL's software image renderer for the same task, preserving a correct frame
rather than turning a transient PPA rejection into a blank pager stripe.

LVGL's upstream PPA image path also uses the source image's full dimensions
and crop offsets for its artificial foreground input. That input is backed by
the target draw buffer, which is a partial display stripe in partial mode and
a full panel frame in full mode. Source geometry can therefore make the PPA
inspect past the target buffer. Keep source geometry on ``in_bg`` and describe
the foreground with the target buffer's own dimensions and local destination
crop.
"""
from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
LVGL_PPA = ROOT / "managed_components" / "lvgl__lvgl" / "src" / "draw" / "espressif" / "ppa"

BUF_FILE = LVGL_PPA / "lv_draw_ppa_buf.c"
IMG_FILE = LVGL_PPA / "lv_draw_ppa_img.c"
FILL_FILE = LVGL_PPA / "lv_draw_ppa_fill.c"
DISPATCH_FILE = LVGL_PPA / "lv_draw_ppa.c"

BUF_OLD = (
    "esp_cache_msync(draw_buf->data, draw_buf->data_size, "
    "ESP_CACHE_MSYNC_FLAG_DIR_C2M | ESP_CACHE_MSYNC_FLAG_TYPE_DATA);"
)
BUF_NEW = (
    "esp_cache_msync(draw_buf->data, draw_buf->data_size, "
    "ESP_CACHE_MSYNC_FLAG_DIR_C2M | ESP_CACHE_MSYNC_FLAG_TYPE_DATA | "
    "ESP_CACHE_MSYNC_FLAG_UNALIGNED);"
)

# Legacy workaround from an earlier firmware revision. It declared a rounded
# output size even when the real allocation was not PPA-eligible.
LEGACY_ALIGN_HELPER = (
    "\nstatic uint32_t lv_draw_ppa_aligned_size(size_t size)\n"
    "{\n"
    "    const size_t line = 64;\n"
    "    return (uint32_t)((size + line - 1) & ~(line - 1));\n"
    "}\n"
)

DISPATCH_MARKER = "CERB_LVGL_PPA_OUTPUT_ELIGIBILITY"
DISPATCH_HELPER = (
    "\n/* " + DISPATCH_MARKER + ": only claim PPA-safe output buffers. */\n"
    "static bool lv_draw_ppa_output_buffer_ready(const lv_draw_buf_t * draw_buf)\n"
    "{\n"
    "    const size_t alignment = CONFIG_CACHE_L2_CACHE_LINE_SIZE;\n"
    "    return draw_buf != NULL && draw_buf->data != NULL && alignment != 0 &&\n"
    "           (((uintptr_t)draw_buf->data & (alignment - 1U)) == 0U) &&\n"
    "           ((draw_buf->data_size & (alignment - 1U)) == 0U);\n"
    "}\n"
)
DISPATCH_ANCHOR = "    if(lv_draw_layer_alloc_buf(layer) == NULL) return LV_DRAW_UNIT_IDLE;\n"
DISPATCH_FALLBACK = (
    DISPATCH_ANCHOR +
    "    if(!lv_draw_ppa_output_buffer_ready(layer->draw_buf)) {\n"
    "        t->preferred_draw_unit_id = LV_DRAW_UNIT_NONE;\n"
    "        t->preference_score = 100;\n"
    "        return LV_DRAW_UNIT_IDLE;\n"
    "    }\n"
)

IMG_FALLBACK_MARKER = "CERB_LVGL_PPA_IMAGE_FALLBACK"
IMG_INCLUDE_ANCHOR = '#include "../../lv_image_decoder_private.h"\n'
IMG_INCLUDE_FALLBACK = (
    IMG_INCLUDE_ANCHOR +
    '#include "../../sw/lv_draw_sw.h"\n'
)
IMG_FAILURE_ANCHOR = (
    "    esp_err_t ret = ppa_do_blend(u->blend_client, &cfg);\n"
    "    if(ret != ESP_OK) {\n"
    "        LV_LOG_WARN(\"PPA draw_img blend failed: %d\", ret);\n"
    "    }\n"
)
IMG_FAILURE_FALLBACK = (
    "    esp_err_t ret = ppa_do_blend(u->blend_client, &cfg);\n"
    "    if(ret != ESP_OK) {\n"
    "        LV_LOG_WARN(\"PPA draw_img blend failed: %d\", ret);\n"
    "        /* " + IMG_FALLBACK_MARKER + ": this task is already owned by PPA,\n"
    "         * so render the same clipped image in software rather than mark an\n"
    "         * empty operation finished. */\n"
    "        lv_draw_sw_image(t, draw_dsc, img_coords);\n"
    "    }\n"
)

IMG_PARTIAL_TARGET_MARKER = "CERB_LVGL_PPA_IMAGE_PARTIAL_TARGET"
IMG_PARTIAL_TARGET_OLD = (
    "        .in_fg = {\n"
    "            .buffer          = (void *)dest_buf,\n"
    "            .pic_w           = draw_dsc->header.w,\n"
    "            .pic_h           = draw_dsc->header.h,\n"
    "            .block_w         = lv_area_get_width(clipped_img_area),\n"
    "            .block_h         = lv_area_get_height(clipped_img_area),\n"
    "            .block_offset_x  = src_area.x1,\n"
    "            .block_offset_y  = src_area.y1,\n"
    "            .blend_cm        = PPA_BLEND_COLOR_MODE_A8,\n"
    "        },\n"
)
IMG_PARTIAL_TARGET_NEW = (
    "        /* " + IMG_PARTIAL_TARGET_MARKER + ": dest_buf is the target\n"
    "         * layer buffer, not necessarily the full source image. */\n"
    "        .in_fg = {\n"
    "            .buffer          = (void *)dest_buf,\n"
    "            .pic_w           = draw_buf->header.w,\n"
    "            .pic_h           = draw_buf->header.h,\n"
    "            .block_w         = lv_area_get_width(clipped_img_area),\n"
    "            .block_h         = lv_area_get_height(clipped_img_area),\n"
    "            .block_offset_x  = dest_area.x1,\n"
    "            .block_offset_y  = dest_area.y1,\n"
    "            .blend_cm        = PPA_BLEND_COLOR_MODE_A8,\n"
    "        },\n"
)


def patch_file(path: pathlib.Path, pairs: list[tuple[str, str]]) -> tuple[bool, str]:
    if not path.is_file():
        return False, f"skip missing {path.relative_to(ROOT)}"

    text = path.read_text(encoding="utf-8")
    if all(new in text for _, new in pairs):
        return False, f"already applied to {path.name}"

    changed = False
    for old, new in pairs:
        if new in text:
            continue
        if old not in text:
            return changed, f"warn: pattern not found in {path.name}"
        text = text.replace(old, new, 1)
        changed = True

    if changed:
        path.write_text(text, encoding="utf-8")
    return changed, f"applied to {path.name}"


def upgrade_legacy_size_workaround(path: pathlib.Path) -> tuple[bool, str]:
    if not path.is_file():
        return False, f"skip missing {path.relative_to(ROOT)}"

    text = path.read_text(encoding="utf-8")
    changed = False
    if LEGACY_ALIGN_HELPER in text:
        text = text.replace(LEGACY_ALIGN_HELPER, "", 1)
        changed = True
    if "lv_draw_ppa_aligned_size(draw_buf->data_size)" in text:
        text = text.replace("lv_draw_ppa_aligned_size(draw_buf->data_size)", "draw_buf->data_size")
        changed = True
    if changed:
        path.write_text(text, encoding="utf-8")
        return True, f"upgraded {path.name} to exact output size"
    return False, f"already exact in {path.name}"


def patch_dispatch() -> tuple[bool, str]:
    if not DISPATCH_FILE.is_file():
        return False, f"skip missing {DISPATCH_FILE.relative_to(ROOT)}"

    text = DISPATCH_FILE.read_text(encoding="utf-8")
    if DISPATCH_MARKER in text:
        return False, "already applied to lv_draw_ppa.c"
    if "#if LV_USE_PPA\n" not in text or DISPATCH_ANCHOR not in text:
        return False, "warn: native PPA dispatch pattern not found"

    text = text.replace("#if LV_USE_PPA\n", "#if LV_USE_PPA\n" + DISPATCH_HELPER, 1)
    text = text.replace(DISPATCH_ANCHOR, DISPATCH_FALLBACK, 1)
    DISPATCH_FILE.write_text(text, encoding="utf-8")
    return True, "applied to lv_draw_ppa.c"


def patch_image_fallback() -> tuple[bool, str]:
    if not IMG_FILE.is_file():
        return False, f"skip missing {IMG_FILE.relative_to(ROOT)}"

    text = IMG_FILE.read_text(encoding="utf-8")
    if IMG_FALLBACK_MARKER in text:
        return False, "already applied to lv_draw_ppa_img.c"
    if IMG_INCLUDE_ANCHOR not in text or IMG_FAILURE_ANCHOR not in text:
        return False, "warn: native PPA image fallback pattern not found"

    text = text.replace(IMG_INCLUDE_ANCHOR, IMG_INCLUDE_FALLBACK, 1)
    text = text.replace(IMG_FAILURE_ANCHOR, IMG_FAILURE_FALLBACK, 1)
    IMG_FILE.write_text(text, encoding="utf-8")
    return True, "applied to lv_draw_ppa_img.c"


def patch_image_partial_target() -> tuple[bool, str]:
    if not IMG_FILE.is_file():
        return False, f"skip missing {IMG_FILE.relative_to(ROOT)}"

    text = IMG_FILE.read_text(encoding="utf-8")
    if IMG_PARTIAL_TARGET_MARKER in text:
        return False, "already applied to lv_draw_ppa_img.c"
    if IMG_PARTIAL_TARGET_OLD not in text:
        return False, "warn: native PPA image partial-target pattern not found"

    IMG_FILE.write_text(
        text.replace(IMG_PARTIAL_TARGET_OLD, IMG_PARTIAL_TARGET_NEW, 1),
        encoding="utf-8",
    )
    return True, "applied partial-target geometry to lv_draw_ppa_img.c"


def main() -> int:
    ok = True
    msgs = []

    # 1. invalidate_cache: let esp_cache_msync accept unaligned ranges (C2M).
    changed, msg = patch_file(BUF_FILE, [(BUF_OLD, BUF_NEW)])
    msgs.append(f"[patch_lvgl_ppa] buf: {msg}")
    ok &= changed or "already" in msg or "skip" in msg

    # 2. Undo the unsafe legacy size rounding. The dispatch guard below only
    # calls PPA with an output allocation that actually satisfies the driver.
    for path in (IMG_FILE, FILL_FILE):
        changed, msg = upgrade_legacy_size_workaround(path)
        msgs.append(f"[patch_lvgl_ppa] {msg}")
        ok &= changed or "already" in msg or "skip" in msg

    # 3. Let the software unit render a layer whose output allocation cannot
    # meet PPA's configured cache-line contract.
    changed, msg = patch_dispatch()
    msgs.append(f"[patch_lvgl_ppa] dispatch: {msg}")
    ok &= changed or "already" in msg or "skip" in msg

    # 4. The PPA unit has already claimed an eligible image task before
    # ppa_do_blend can reject it. Render that exact task in software on an
    # operation failure so a transient hardware rejection cannot leave a
    # blank strip in a bitmap pager frame.
    changed, msg = patch_image_fallback()
    msgs.append(f"[patch_lvgl_ppa] image fallback: {msg}")
    ok &= changed or "already" in msg or "skip" in msg

    # 5. In partial mode, the target layer is one stripe; in full mode it is a
    # panel frame. The PPA artificial foreground always reads that target, so
    # it must use destination geometry rather than source-snapshot coordinates.
    changed, msg = patch_image_partial_target()
    msgs.append(f"[patch_lvgl_ppa] image partial target: {msg}")
    ok &= changed or "already" in msg or "skip" in msg

    for m in msgs:
        print(m)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
