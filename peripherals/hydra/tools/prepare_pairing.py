#!/usr/bin/env python3
"""Prepare private pairing files for operator review. This does not deploy them.

The Hydra firmware reads namespace hydra-host: schema(u8), gateway(blob6),
channel(u8), pmk(blob16), and lmk(blob16). This tool creates JSON only.
It never replaces an NVS partition, installs files, or accesses hardware.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import stat
from typing import Any

MAX_BYTES = 16384
MAC = re.compile(r"(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\Z")
KEY = re.compile(r"[0-9a-fA-F]{32}\Z")


def reject(condition: bool) -> None:
    if condition:
        raise ValueError("invalid-preparation")


def station_mac(value: Any) -> str:
    reject(not isinstance(value, str) or not MAC.fullmatch(value))
    result = value.lower()
    reject(bool(int(result[:2], 16) & 1) or result == "00:00:00:00:00:00")
    return result


def check_path(path: Path, *, exists: bool = True) -> None:
    reject(not path.is_absolute() or ".." in path.parts)
    for item in [*reversed(path.parents), path] if exists else reversed(path.parents):
        reject(item.is_symlink())


def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, value in pairs:
        reject(name in result)
        result[name] = value
    return result


def read_private_config(path: Path) -> dict[str, Any]:
    check_path(path)
    selected = path.lstat()
    reject(not stat.S_ISREG(selected.st_mode))
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        reject(not stat.S_ISREG(info.st_mode) or (info.st_dev, info.st_ino) != (selected.st_dev, selected.st_ino)
               or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600 or info.st_size > MAX_BYTES)
        raw = os.read(fd, MAX_BYTES + 1)
        reject(len(raw) > MAX_BYTES)
        value = json.loads(raw, object_pairs_hook=unique_object,
                           parse_constant=lambda _: reject(True))
        reject(not isinstance(value, dict))
        return value
    finally:
        os.close(fd)


def validate_gateway(config: dict[str, Any]) -> str:
    reject(set(config) - {"python", "serialNumber", "channel", "pmk", "peers", "remoteMac"} != set())
    python = config.get("python")
    reject(not isinstance(python, str) or not Path(python).is_absolute() or "\0" in python)
    serial = config.get("serialNumber")
    reject(not isinstance(serial, str) or not re.fullmatch(r"[a-zA-Z0-9:_-]{1,64}", serial))
    channel = config.get("channel", 1)
    reject(type(channel) is not int or not 1 <= channel <= 11)
    reject(not isinstance(config.get("pmk"), str) or not KEY.fullmatch(config["pmk"]))
    peers = config.get("peers")
    reject(not isinstance(peers, list) or not 1 <= len(peers) < 7)
    seen: set[str] = set()
    for peer in peers:
        reject(not isinstance(peer, dict) or set(peer) != {"mac", "lmk"})
        mac = station_mac(peer["mac"])
        reject(mac in seen or not isinstance(peer["lmk"], str) or not KEY.fullmatch(peer["lmk"]))
        seen.add(mac)
    reject("remoteMac" not in config and len(peers) != 1)
    remote = station_mac(config.get("remoteMac", peers[0]["mac"]))
    reject(remote not in seen)
    return remote


def write_private(directory_fd: int, name: str, value: dict[str, Any] | bytes,
                  created: dict[str, tuple[int, int]]) -> None:
    data = value if isinstance(value, bytes) else (json.dumps(value, indent=2) + "\n").encode("ascii")
    fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory_fd)
    identity = os.fstat(fd)
    created[name] = (identity.st_dev, identity.st_ino)
    with os.fdopen(fd, "wb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
        selected = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
        reject((selected.st_dev, selected.st_ino) != created[name] or os.pread(stream.fileno(), len(data) + 1, 0) != data)


def write_review_files(output: Path, contents: dict[str, dict[str, Any] | bytes]) -> None:
    """Create a private directory and remove only this operation's incomplete files."""
    reject(not contents or any(not re.fullmatch(r"[a-zA-Z0-9_.-]{1,80}", name) or name in (".", "..") for name in contents))
    check_path(output, exists=False)
    reject(output.exists() or output.is_symlink())
    parent = output.parent.stat()
    reject(not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.getuid() or bool(parent.st_mode & 0o022))
    os.mkdir(output, 0o700)
    identity = output.lstat()
    directory_fd = None
    owned_directory = False
    created: dict[str, tuple[int, int]] = {}
    try:
        directory_fd = os.open(output, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        opened = os.fstat(directory_fd)
        reject((opened.st_dev, opened.st_ino) != (identity.st_dev, identity.st_ino))
        owned_directory = True
        os.fchmod(directory_fd, 0o700)
        for name, value in contents.items():
            write_private(directory_fd, name, value, created)
        os.fsync(directory_fd)
    except BaseException:
        for name, file_identity in created.items() if owned_directory else ():
            try:
                selected = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                if stat.S_ISREG(selected.st_mode) and (selected.st_dev, selected.st_ino) == file_identity:
                    os.unlink(name, dir_fd=directory_fd)
            except OSError:
                pass
        try:
            current = output.lstat()
            if (current.st_dev, current.st_ino) == (identity.st_dev, identity.st_ino):
                output.rmdir()
        except OSError:
            # A concurrent writer's remaining files must survive this failure.
            pass
        raise
    finally:
        if directory_fd is not None:
            os.close(directory_fd)


def prepare_pairing(gateway_config: Path, gateway_mac: str, hydra_mac: str, output: Path) -> None:
    """Create two private review files without modifying the input or devices."""
    gateway = station_mac(gateway_mac)
    hydra = station_mac(hydra_mac)
    config = read_private_config(gateway_config)
    remote = validate_gateway(config)
    peer_macs = {station_mac(peer["mac"]) for peer in config["peers"]}
    reject(gateway == hydra or gateway in peer_macs or hydra in peer_macs)
    lmk = secrets.token_hex(16)
    next_config = {**config, "remoteMac": config.get("remoteMac", remote),
                   "peers": [*config["peers"], {"mac": hydra, "lmk": lmk}]}
    desk = {"schemaVersion": 1, "gatewayMac": gateway, "channel": config.get("channel", 1),
            "pmk": config["pmk"], "lmk": lmk}
    write_review_files(output, {"gateway.next.json": next_config, "hydra-desk.json": desk})


class PrivateParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        self.exit(2, "pairing-preparation: invalid arguments\n")


def main(argv: list[str] | None = None) -> int:
    parser = PrivateParser(description=__doc__)
    parser.add_argument("--gateway-config", required=True, type=Path)
    parser.add_argument("--gateway-mac", required=True)
    parser.add_argument("--hydra-mac", required=True)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        prepare_pairing(args.gateway_config, args.gateway_mac, args.hydra_mac, args.output)
    except Exception:
        print('{"prepared":false,"error":"preparation-failed"}')
        return 1
    print('{"prepared":true,"deploymentExecuted":false}')
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
