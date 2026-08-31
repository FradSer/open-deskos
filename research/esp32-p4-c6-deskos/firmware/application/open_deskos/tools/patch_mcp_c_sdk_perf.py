#!/usr/bin/env python3
"""Re-apply PERF (-O2) strncpy→snprintf fixes to managed espressif__mcp-c-sdk.

managed_components/ is gitignored and refreshed by the component manager.
Run from CMake configure (and manually after `idf.py update-dependencies`).
Idempotent: skips files that already use the snprintf form.
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MCP = ROOT / "managed_components" / "espressif__mcp-c-sdk"

REPLACEMENTS: list[tuple[pathlib.Path, list[tuple[str, str]]]] = [
    (
        MCP / "src" / "transports" / "esp_mcp_http_server.c",
        [
            (
                "strncpy(client->protocol_version, proto_hdr, sizeof(client->protocol_version) - 1);",
                'snprintf(client->protocol_version, sizeof(client->protocol_version), "%s", proto_hdr);',
            ),
            (
                "strncpy(client->session_id, session_id, sizeof(client->session_id) - 1);\n"
                "        client->session_id[sizeof(client->session_id) - 1] = '\\0';\n"
                "        strncpy(client->protocol_version, proto_hdr, sizeof(client->protocol_version) - 1);\n"
                "        client->protocol_version[sizeof(client->protocol_version) - 1] = '\\0';",
                'snprintf(client->session_id, sizeof(client->session_id), "%s", session_id);\n'
                '        snprintf(client->protocol_version, sizeof(client->protocol_version), "%s", proto_hdr);',
            ),
            (
                "strncpy(buf, session->protocol_version, sizeof(buf) - 1);\n"
                "                buf[sizeof(buf) - 1] = '\\0';",
                'snprintf(buf, sizeof(buf), "%s", session->protocol_version);',
            ),
            (
                "strncpy(out_proto, proto_to_use, out_proto_len - 1);\n"
                "    out_proto[out_proto_len - 1] = '\\0';",
                'snprintf(out_proto, out_proto_len, "%s", proto_to_use ? proto_to_use : "");',
            ),
        ],
    ),
    (
        MCP / "src" / "esp_mcp_engine.c",
        [
            (
                "strncpy(saved_related_task_id, mcp->related_task_id, sizeof(saved_related_task_id) - 1);",
                'snprintf(saved_related_task_id, sizeof(saved_related_task_id), "%s", mcp->related_task_id);',
            ),
            (
                "strncpy(mcp->related_task_id, task_id, sizeof(mcp->related_task_id) - 1);\n"
                "        mcp->related_task_id[sizeof(mcp->related_task_id) - 1] = '\\0';",
                'snprintf(mcp->related_task_id, sizeof(mcp->related_task_id), "%s", task_id);',
            ),
            (
                "strncpy(mcp->related_task_id, saved_related_task_id, sizeof(mcp->related_task_id) - 1);\n"
                "        mcp->related_task_id[sizeof(mcp->related_task_id) - 1] = '\\0';",
                'snprintf(mcp->related_task_id, sizeof(mcp->related_task_id), "%s", saved_related_task_id);',
            ),
            (
                "strncpy(ctx->next_cursor, task_id, 255);\n"
                "        ctx->next_cursor[255] = '\\0';",
                'snprintf(ctx->next_cursor, 256, "%s", task_id);',
            ),
            (
                "strncpy(cursor_str, cursor_value, sizeof(cursor_str) - 1);\n"
                "        cursor_str[sizeof(cursor_str) - 1] = '\\0';",
                'snprintf(cursor_str, sizeof(cursor_str), "%s", cursor_value);',
            ),
        ],
    ),
    (
        MCP / "src" / "transports" / "esp_mcp_http_client.c",
        [
            (
                "strncpy(item->protocol_version, DEFAULT_PROTOCOL_VERSION, sizeof(item->protocol_version) - 1);\n"
                "    item->protocol_version[sizeof(item->protocol_version) - 1] = '\\0';",
                'snprintf(item->protocol_version, sizeof(item->protocol_version), "%s", DEFAULT_PROTOCOL_VERSION);',
            ),
        ],
    ),
    (
        MCP / "src" / "esp_mcp_tool.c",
        [
            (
                "strncpy(tool->task_support, task_support, sizeof(tool->task_support) - 1);\n"
                "    tool->task_support[sizeof(tool->task_support) - 1] = '\\0';",
                'snprintf(tool->task_support, sizeof(tool->task_support), "%s", task_support);',
            ),
        ],
    ),
]


def main() -> int:
    if not MCP.is_dir():
        print(f"[patch_mcp] skip: {MCP} missing")
        return 0

    changed = 0
    for path, pairs in REPLACEMENTS:
        if not path.is_file():
            print(f"[patch_mcp] skip missing {path.relative_to(ROOT)}")
            continue
        text = path.read_text(encoding="utf-8")
        orig = text
        for old, new in pairs:
            if old in text:
                text = text.replace(old, new)
            elif new in text or new.replace("\n        ", "\n") in text:
                continue
            else:
                # Already patched or upstream changed — warn only for leftover strncpy
                pass
        if text != orig:
            path.write_text(text, encoding="utf-8")
            changed += 1
            print(f"[patch_mcp] patched {path.relative_to(ROOT)}")
        leftover = len(re.findall(r"\bstrncpy\s*\(", text))
        if leftover:
            print(f"[patch_mcp] warn: {leftover} strncpy left in {path.relative_to(ROOT)}")

    print(f"[patch_mcp] done (files changed={changed})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
