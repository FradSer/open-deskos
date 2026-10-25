#!/usr/bin/env python3
"""Prepare an ignored private firmware header for operator review only.

The main-node-private build embeds pairing keys. Keep its build artifacts private.
The ordinary main-node build ignores this header. No build or device action runs.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from prepare_pairing import KEY, PrivateParser, check_path, read_private_config, reject, station_mac, write_review_files

FIRMWARE_ROOT = Path(__file__).resolve().parents[1]


def firmware_header(config: dict[str, Any]) -> bytes:
    """Encode only the agreed private byte-array configuration."""
    reject(set(config) != {"schemaVersion", "gatewayMac", "channel", "pmk", "lmk"}
           or type(config.get("schemaVersion")) is not int or config["schemaVersion"] != 1)
    gateway = station_mac(config["gatewayMac"])
    reject(type(config["channel"]) is not int or not 1 <= config["channel"] <= 11)
    reject(any(not isinstance(config[key], str) or not KEY.fullmatch(config[key]) for key in ("pmk", "lmk")))
    values = {"gateway": bytes.fromhex(gateway.replace(":", "")),
              "pmk": bytes.fromhex(config["pmk"]), "lmk": bytes.fromhex(config["lmk"])}
    lines = ["#pragma once", "#include <cstdint>",
             "// PRIVATE BUILD INPUT. Do not publish this header or private firmware artifacts.",
             "namespace hydra_private_host {"]
    for name, data in values.items():
        lines.append(f"constexpr uint8_t {name}[{len(data)}] = {{" + ", ".join(f"0x{byte:02x}" for byte in data) + "};")
    lines.extend([f"constexpr uint8_t channel = {config['channel']};", "constexpr uint8_t schema = 1;", "}", ""])
    return "\n".join(lines).encode("ascii")


def prepare_firmware_config(desk_config: Path, output: Path) -> dict[str, Any]:
    """Create a new ignored .local directory containing a header and hash receipt."""
    reject(not output.is_absolute() or output != FIRMWARE_ROOT / ".local")
    ignore = FIRMWARE_ROOT / ".gitignore"
    check_path(ignore)
    reject(not ignore.is_file() or ".local/" not in ignore.read_text().splitlines()
           or any(line.lstrip().startswith("!") for line in ignore.read_text().splitlines()))
    header = firmware_header(read_private_config(desk_config))
    receipt = {"prepared": True, "privateBuild": True, "profile": "main-node-private",
               "schemaVersion": 1, "headerSha256": hashlib.sha256(header).hexdigest(),
               "readbackVerified": True, "deploymentExecuted": False}
    write_review_files(output, {"hydra_host_config.h": header, "receipt.json": receipt})
    return receipt


def main(argv: list[str] | None = None) -> int:
    parser = PrivateParser(description=__doc__)
    parser.add_argument("--desk-config", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        receipt = prepare_firmware_config(args.desk_config, args.output)
    except Exception:
        print('{"prepared":false,"error":"preparation-failed"}')
        return 1
    print(json.dumps(receipt))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
