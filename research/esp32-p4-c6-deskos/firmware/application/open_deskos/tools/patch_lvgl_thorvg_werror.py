#!/usr/bin/env python3
"""Allow LVGL's built-in ThorVG base64 decoder to compile under -Werror.

managed_components/ is gitignored and refreshed by the component manager.
Run from CMake configure (and manually after `idf.py update-dependencies`).
Idempotent: skips when the signed-char comparison is already present.

Background
----------
LVGL 9.5.0's ThorVG `tvgCompressor.cpp` checks `encoded[i] < 0` on a plain
`char` array while decoding base64. ESP-IDF builds with `-Werror=type-limits`,
and on riscv32 `char` is unsigned (0..255), so the comparison is always false
and the build fails with "comparison is always false due to limited range of
data type". The check is dead weight anyway — the preceding `!encoded[i]`
already handles the NUL terminator, and base64 alphabet chars are never
negative. Casting to `signed char` keeps the intent while silencing the
warning.
"""
from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
COMPRESSOR = ROOT / "managed_components" / "lvgl__lvgl" / "src" / "libs" / "thorvg" / "tvgCompressor.cpp"

PAIRS = [
    (
        "if (!encoded[2] || encoded[3] < 0 || encoded[2] == '=' || encoded[2] == '.') break;",
        "if (!encoded[2] || (signed char)encoded[3] < 0 || encoded[2] == '=' || encoded[2] == '.') break;",
    ),
    (
        "if (!encoded[3] || encoded[3] < 0 || encoded[3] == '=' || encoded[3] == '.') break;",
        "if (!encoded[3] || (signed char)encoded[3] < 0 || encoded[3] == '=' || encoded[3] == '.') break;",
    ),
]


def main() -> int:
    if not COMPRESSOR.is_file():
        print(f"[patch_lvgl_thorvg] skip missing {COMPRESSOR.relative_to(ROOT)}")
        return 1

    text = COMPRESSOR.read_text(encoding="utf-8")
    if all(new in text for _, new in PAIRS):
        print("[patch_lvgl_thorvg] already applied")
        return 0

    changed = False
    for old, new in PAIRS:
        if new in text:
            continue
        if old not in text:
            print(f"[patch_lvgl_thorvg] warn: pattern not found:\n  {old}")
            continue
        text = text.replace(old, new, 1)
        changed = True

    if changed:
        COMPRESSOR.write_text(text, encoding="utf-8")
        print(f"[patch_lvgl_thorvg] applied to {COMPRESSOR.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
