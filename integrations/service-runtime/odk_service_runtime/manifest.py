"""Bounded, declarative service packages; package metadata never authorizes execution."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
from typing import Any

ID = re.compile(r"[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\Z")
REVISION = re.compile(r"[a-f0-9]{64}\Z")


def canonical_json(value: Any) -> bytes:
    """Encode stable revision metadata."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def bounded_file(path: Path, limit: int) -> bytes:
    """Capture one regular input without links, blocking, or unbounded allocation."""
    if path.resolve() != path:
        raise ValueError("Unsafe service package input")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or before.st_size > limit:
            raise ValueError("Unsafe service package input")
        content = bytearray()
        while len(content) <= limit:
            chunk = os.read(descriptor, min(65536, limit + 1 - len(content)))
            if not chunk:
                break
            content.extend(chunk)
        after, current = os.fstat(descriptor), path.lstat()
        fields = lambda info: (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
        if len(content) > limit or fields(before) != fields(after) or fields(before) != fields(current):
            raise ValueError("Service package input changed during capture")
        return bytes(content)
    finally:
        os.close(descriptor)


def relative_file(value: Any) -> bool:
    """Accept portable paths contained within a package."""
    return isinstance(value, str) and 0 < len(value) <= 256 and "\\" not in value and not re.search(r"[\x00-\x1f\x7f]", value) and not PurePosixPath(value).is_absolute() and all(part not in {"", ".", "..", ".venv"} for part in value.split("/"))


def _keys(value: Any, allowed: set[str]) -> bool:
    return isinstance(value, dict) and not (value.keys() - allowed)


def validate_manifest(value: Any) -> dict[str, Any]:
    """Validate the host-owned execution contract without loading package code."""
    if not _keys(value, {"schemaVersion", "id", "name", "version", "files", "runtime", "health", "stopTimeoutSeconds"}) or value.get("schemaVersion") != 1:
        raise ValueError("Invalid external service manifest")
    if not isinstance(value.get("id"), str) or len(value["id"]) > 64 or not ID.fullmatch(value["id"]):
        raise ValueError("Invalid external service identity")
    for key in ("name", "version"):
        if not isinstance(value.get(key), str) or not value[key].strip() or len(value[key]) > 120 or re.search(r"[\x00-\x1f\x7f]", value[key]):
            raise ValueError("Invalid external service metadata")
    files = value.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= 128:
        raise ValueError("Invalid external service file inventory")
    paths = []
    for item in files:
        if not _keys(item, {"path", "sha256"}) or not relative_file(item.get("path")) or not isinstance(item.get("sha256"), str) or not REVISION.fullmatch(item["sha256"]) or item["path"] == "service.json":
            raise ValueError("Invalid external service file record")
        paths.append(item["path"])
    if paths != sorted(set(paths)) or len({path.casefold() for path in paths}) != len(paths):
        raise ValueError("External service inventory must be unique and sorted")
    runtime = value.get("runtime")
    if not isinstance(runtime, dict) or runtime.get("kind") not in {"python", "docker"}:
        raise ValueError("Unsupported external service runtime")
    if runtime["kind"] == "python":
        if not _keys(runtime, {"kind", "python", "entry", "args"}) or not re.fullmatch(r"3\.\d+\.\d+", runtime.get("python", "")) or runtime.get("entry") not in paths or not {"pyproject.toml", "uv.lock", ".python-version"}.issubset(paths):
            raise ValueError("Python services require an exact interpreter and locked project")
    else:
        if not _keys(runtime, {"kind", "image", "platform", "args"}) or not re.fullmatch(r"(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64})", runtime.get("image", "")) or runtime.get("platform") not in {"linux/arm64", "linux/amd64"}:
            raise ValueError("Docker services require an immutable image and platform")
    args = runtime.get("args", [])
    if not isinstance(args, list) or len(args) > 32 or any(not isinstance(arg, str) or len(arg) > 4096 or "\0" in arg for arg in args):
        raise ValueError("Invalid external service arguments")
    health = value.get("health")
    if not _keys(health, {"kind", "argv", "timeoutSeconds"}) or health.get("kind") != "exec" or not isinstance(health.get("argv"), list) or not 1 <= len(health["argv"]) <= 32 or any(not isinstance(arg, str) or not arg or len(arg) > 4096 or "\0" in arg for arg in health["argv"]):
        raise ValueError("A bounded readiness probe is required")
    for number, default, maximum in ((value.get("stopTimeoutSeconds"), 20, 300), (health.get("timeoutSeconds"), 10, 60)):
        number = default if number is None else number
        if isinstance(number, bool) or not isinstance(number, int) or not 1 <= number <= maximum:
            raise ValueError("Invalid external service deadline")
    return json.loads(canonical_json(value))


def read_package(directory: Path) -> tuple[dict[str, Any], dict[str, bytes], str]:
    """Capture a complete immutable input inventory before environment preparation."""
    directory = Path(directory)
    if not directory.is_absolute() or directory.resolve() != directory or not directory.is_dir():
        raise ValueError("Service package requires a canonical absolute directory")
    descriptor = directory / "service.json"
    descriptor_bytes = bounded_file(descriptor, 32768)
    manifest = validate_manifest(json.loads(descriptor_bytes))
    declared = {item["path"]: item["sha256"] for item in manifest["files"]}
    observed = set()
    captured = {}
    total = 0
    allowed_directories = {str(parent) for name in declared for parent in PurePosixPath(name).parents if str(parent) != "."}
    for root, dirs, files in os.walk(directory, followlinks=False):
        for name in dirs:
            child = Path(root) / name
            if child.is_symlink() or child.relative_to(directory).as_posix() not in allowed_directories:
                raise ValueError("Service packages cannot contain undeclared directories or links")
        for name in files:
            path = Path(root) / name
            relative = path.relative_to(directory).as_posix()
            if relative == "service.json":
                if bounded_file(path, 32768) != descriptor_bytes:
                    raise ValueError("Service descriptor changed during capture")
                continue
            if relative not in declared:
                raise ValueError("Undeclared service package input")
            content = bounded_file(path, 4 * 1024 * 1024)
            total += len(content)
            if total > 16 * 1024 * 1024 or hashlib.sha256(content).hexdigest() != declared[relative]:
                raise ValueError("Service package changed or failed integrity validation")
            observed.add(relative)
            captured[relative] = content
    if observed != declared.keys():
        raise ValueError("Incomplete service package inventory")
    return manifest, captured, hashlib.sha256(canonical_json(manifest)).hexdigest()
