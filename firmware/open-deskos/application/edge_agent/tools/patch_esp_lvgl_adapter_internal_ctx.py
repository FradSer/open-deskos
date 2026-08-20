#!/usr/bin/env python3
"""Force esp_lvgl_adapter bridge ctx into internal RAM.

With CONFIG_SPIRAM_USE_MALLOC + ALWAYSINTERNAL=0, plain calloc() lands in
PSRAM. MIPI DPI ISR callbacks reject non-internal user_ctx, so a triple-buffer
route never gets on_refresh_done → wait_free_buf hangs forever (white screen,
FPS 0).

Idempotent. Run from CMake configure / after component manager refresh.
"""
from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "managed_components" / "espressif__esp_lvgl_adapter"

TARGETS = [
    ADAPTER / "src" / "display" / "bridge" / "v9" / "lvgl_bridge_v9.c",
    ADAPTER / "src" / "display" / "bridge" / "v8" / "lvgl_bridge_v8.c",
]

OLD = "esp_lv_adapter_display_bridge_{ver}_t *impl = calloc(1, sizeof(*impl));"
NEW = (
    "esp_lv_adapter_display_bridge_{ver}_t *impl = "
    "heap_caps_calloc(1, sizeof(*impl), MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT);"
)

HEAP_INCLUDE = '#include "esp_heap_caps.h"\n'


def patch_file(path: pathlib.Path, ver: str) -> bool:
    if not path.is_file():
        print(f"[patch_adapter] skip missing {path.relative_to(ROOT)}")
        return False

    text = path.read_text(encoding="utf-8")
    old = OLD.format(ver=ver)
    new = NEW.format(ver=ver)
    changed = False

    if old in text:
        text = text.replace(old, new, 1)
        changed = True
    elif new in text:
        pass
    else:
        print(f"[patch_adapter] warn: calloc pattern not found in {path.name}")
        return False

    if 'esp_heap_caps.h' not in text:
        # Insert after the first block of includes.
        lines = text.splitlines(keepends=True)
        insert_at = 0
        for i, line in enumerate(lines):
            if line.startswith("#include"):
                insert_at = i + 1
        lines.insert(insert_at, HEAP_INCLUDE)
        text = "".join(lines)
        changed = True

    if changed:
        path.write_text(text, encoding="utf-8")
        print(f"[patch_adapter] patched {path.relative_to(ROOT)}")
    else:
        print(f"[patch_adapter] already ok {path.relative_to(ROOT)}")
    return changed


def main() -> int:
    if not ADAPTER.is_dir():
        print("[patch_adapter] skip: adapter component missing")
        return 0
    changed = 0
    for path, ver in ((TARGETS[0], "v9"), (TARGETS[1], "v8")):
        if patch_file(path, ver):
            changed += 1
    print(f"[patch_adapter] done (files changed={changed})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
