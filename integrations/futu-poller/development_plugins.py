"""Explicit trusted development entries; native Python code is not sandboxed."""
from collections.abc import Iterable
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import stat
import sys
from types import ModuleType
import uuid
from typing import Callable

from plugin_config import _unique_object
from plugin_host import PluginHost, PluginContext


def validate_contract(raw: dict, original: dict) -> dict:
    """Validate a replacement without executing a factory or entry."""
    manifest = deepcopy(raw)
    host = PluginHost()
    try:
        host.register({"manifest": manifest, "create": lambda context: {}})
    except (TypeError, KeyError, ValueError):
        raise ValueError("invalid development plugin manifest") from None
    manifest = host.catalog()[0]["manifest"]
    if (any(manifest[key] != original[key] for key in ("id", "host", "kind"))
            or manifest["provides"] != original["provides"]
            or not set(manifest["permissions"]).issubset(original["permissions"])):
        raise ValueError("development replacement changes component contract")
    return manifest


def _contained(root: Path, relative: str) -> Path:
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise ValueError("invalid development plugin entry")
    candidate = Path(relative)
    if candidate.is_absolute() or ".." in candidate.parts:
        raise ValueError("development entry must remain inside its package")
    resolved = (root / candidate).resolve()
    if not resolved.is_relative_to(root):
        raise ValueError("development entry must remain inside its package")
    return resolved


def _windows_file_name(name: str) -> str:
    name = os.path.normcase(name)
    if name.startswith("\\\\?\\unc\\"):
        return "\\\\" + name[8:]
    if name.startswith("\\\\?\\"):
        return name[4:]
    return name


def _open_selected(file: Path) -> int:
    """Verify the selected path before reading mutable development bytes."""
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0)
    if os.name == "posix":
        directory_flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
        parent = os.open(file.anchor, directory_flags)
        try:
            for part in file.parts[1:-1]:
                child = os.open(part, directory_flags, dir_fd=parent)
                os.close(parent)
                parent = child
            return os.open(file.name, flags | os.O_NOFOLLOW, dir_fd=parent)
        finally:
            os.close(parent)
    if os.name == "nt":
        # Verify the opened handle instead of repeating a mutable path lookup.
        import ctypes
        from ctypes import wintypes
        import msvcrt
        descriptor = os.open(file, flags)
        try:
            get_path = ctypes.WinDLL("kernel32", use_last_error=True).GetFinalPathNameByHandleW
            get_path.argtypes = [wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD]
            get_path.restype = wintypes.DWORD
            buffer = ctypes.create_unicode_buffer(32768)
            count = get_path(msvcrt.get_osfhandle(descriptor), buffer, len(buffer), 0)
            if not count or count >= len(buffer):
                raise OSError("cannot verify development file handle")
            if _windows_file_name(buffer.value) != _windows_file_name(str(file)):
                raise OSError("development file path changed")
            return descriptor
        except BaseException:
            os.close(descriptor)
            raise
    raise OSError("development file verification is unavailable")


def _read(file: Path, limit: int) -> bytes:
    try:
        descriptor = _open_selected(file)
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("development plugin file must be regular")
            content = stream.read(limit + 1)
    except OSError:
        raise ValueError("development plugin file is unavailable") from None
    if len(content) > limit:
        raise ValueError("development plugin file exceeds its byte limit")
    return content


def _factory(entry: Path, content: bytes) -> Callable[[PluginContext], object]:
    create = None

    def instantiate(context: PluginContext) -> object:
        nonlocal create
        if create is None:
            name = "_odk_futu_" + hashlib.sha256(str(entry).encode() + content).hexdigest() + "_" + uuid.uuid4().hex
            module = ModuleType(name)
            module.__file__ = str(entry)
            module.__package__ = ""
            sys.modules[name] = module
            try:
                exec(compile(content, str(entry), "exec"), module.__dict__)
                candidate = getattr(module, "create", None)
                if not callable(candidate):
                    raise ValueError("development entry requires callable create")
                create = candidate
            except BaseException:
                if sys.modules.get(name) is module:
                    del sys.modules[name]
                raise
        return create(context)

    return instantiate


def load_replacements(directories: Iterable[str | Path], contracts: Iterable[dict], *,
                      trusted: bool = False, grants: Iterable[str] = ()) -> dict[str, dict]:
    """Read bounded declarations and capture entry bytes without executing code."""
    directories = list(directories)
    if directories and trusted is not True:
        raise ValueError("development plugins require explicit trust")
    originals = {item["id"]: item for item in contracts}
    grants = set(grants)
    allowed = {identity + ":" + name for identity, manifest in originals.items() for name in manifest["permissions"]}
    if grants - allowed:
        raise ValueError("unknown development capability grant")
    result = {}
    for directory in directories:
        root = Path(directory).resolve()
        if not root.is_dir():
            raise ValueError("development package directory is unavailable")
        try:
            raw = json.loads(_read(_contained(root, "manifest.json"), 16384), object_pairs_hook=_unique_object)
        except (ValueError, UnicodeError):
            raise ValueError("invalid development package manifest") from None
        if not isinstance(raw, dict) or set(raw) - {"schemaVersion", "id", "name", "version", "kind", "host", "provides", "requires", "permissions", "entry"}:
            raise ValueError("invalid development package manifest")
        identity = raw.get("id")
        if not isinstance(identity, str) or identity not in originals or identity in result:
            raise ValueError("unknown or duplicate development replacement")
        entry = _contained(root, raw.get("entry"))
        if entry.suffix != ".py":
            raise ValueError("development entry must be a Python file")
        manifest = validate_contract({key: value for key, value in raw.items() if key != "entry"}, originals[identity])
        if any(identity + ":" + name not in grants for name in manifest["permissions"]):
            raise ValueError("development plugin requires explicit capability grants")
        content = _read(entry, 256 * 1024)
        result[identity] = {"manifest": manifest, "create": _factory(entry, content)}
    return result
