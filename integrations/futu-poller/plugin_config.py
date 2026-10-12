"""Local component preferences; inspection never starts providers."""
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from typing import AbstractSet, Callable, Mapping, NoReturn

LIMIT = 16384


def _reject_json_constant(_value: str) -> NoReturn:
    raise ValueError("invalid shared JSON constant")


def resolve_shared_config_path(env: Mapping[str, str]) -> Path:
    """Use the Shell's configuration directory precedence without provider settings."""
    directory = env.get("ODK_CONFIG_DIR")
    if not directory:
        home = env.get("HOME") or env.get("USERPROFILE") or str(Path.home())
        directory = str(Path(home) / ".config" / "odk")
    return Path(directory) / "plugins.json"


def resolve_shared_disabled(env: Mapping[str, str], known: AbstractSet[str],
                            report: Callable[[str], None]) -> tuple[str, ...]:
    """Read common enable preferences; native development metadata has no authority here."""
    disabled = {identity for identity in re.split(r"[\s,]+", env.get("ODK_DISABLED_PLUGINS", "")) if identity in known}
    try:
        file = resolve_shared_config_path(env)
        try:
            descriptor = os.open(file, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
        except FileNotFoundError:
            if file.is_symlink():
                raise ValueError("shared configuration target is unavailable") from None
            return tuple(sorted(disabled))
        with os.fdopen(descriptor, "rb") as stream:
            if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                raise ValueError("shared configuration requires a regular file")
            # The common Shell file has no standalone component-file size limit.
            # Match JSON.parse's last-key behavior and project only enable values.
            config = json.loads(stream.read().decode("utf-8", errors="replace"),
                                parse_constant=_reject_json_constant, parse_int=float)
        if not isinstance(config, dict) or type(config.get("version")) not in (int, float) or config["version"] != 1 or not isinstance(config.get("plugins"), dict):
            raise ValueError("invalid shared configuration")
        selected = set()
        for identity, preference in config["plugins"].items():
            if not re.fullmatch(r"odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*", identity) or not isinstance(preference, dict) or ("enabled" in preference and type(preference["enabled"]) is not bool):
                raise ValueError("invalid shared preference")
            if identity in known and preference.get("enabled") is False:
                selected.add(identity)
        disabled.update(selected)
    except (ValueError, OSError, UnicodeError, RecursionError):
        report("plugin configuration unavailable")
    return tuple(sorted(disabled))


def _unique_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate plugin configuration key")
        result[key] = value
    return result


def _validate(config: object, known: AbstractSet[str]) -> dict:
    if not isinstance(config, dict) or set(config) != {"version", "plugins"} or type(config["version"]) is not int or config["version"] != 1 or not isinstance(config["plugins"], dict):
        raise ValueError("invalid plugin configuration")
    for identity, preference in config["plugins"].items():
        if identity not in known or not isinstance(preference, dict) or set(preference) != {"enabled"} or type(preference["enabled"]) is not bool:
            raise ValueError("invalid plugin configuration entry")
    return config


def read_config(path: str | Path, known: AbstractSet[str]) -> dict:
    file = Path(path)
    try:
        descriptor = os.open(file, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0))
    except FileNotFoundError:
        if file.is_symlink():
            raise ValueError("plugin configuration symlink target is unavailable") from None
        return {"version": 1, "plugins": {}}
    with os.fdopen(descriptor, "rb") as stream:
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise ValueError("plugin configuration must be a regular file")
        content = stream.read(LIMIT + 1)
    if len(content) > LIMIT:
        raise ValueError("plugin configuration exceeds 16 KiB")
    try:
        config = json.loads(content, object_pairs_hook=_unique_object)
    except (ValueError, UnicodeError):
        raise ValueError("invalid plugin configuration JSON") from None
    return _validate(config, known)


def update_enabled(path: str | Path, identity: str, enabled: bool, known: AbstractSet[str]) -> dict:
    if identity not in known or type(enabled) is not bool:
        raise ValueError("invalid plugin preference selection")
    requested = Path(path).absolute()
    if requested.is_symlink() and not requested.exists():
        raise ValueError("plugin configuration symlink target is unavailable")
    file = requested.resolve()
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = Path(str(file) + ".lock")
    try:
        lock.mkdir(mode=0o700)
    except FileExistsError:
        raise ValueError("plugin configuration is busy; retry after its writer finishes") from None
    committed = False
    try:
        config = read_config(file, known)
        config["plugins"][identity] = {"enabled": enabled}
        content = json.dumps(_validate(config, known), indent=2).encode("utf-8")
        if len(content) > LIMIT:
            raise ValueError("plugin configuration exceeds 16 KiB")
        with tempfile.TemporaryDirectory(prefix=".futu-plugins-write-", dir=file.parent) as staging:
            candidate = Path(staging) / "plugins.json"
            descriptor = os.open(candidate, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(content)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(candidate, file)
            committed = True
        return config
    finally:
        try:
            lock.rmdir()
        except OSError:
            state = "saved" if committed else "not saved"
            raise ValueError("plugin configuration " + state + "; lock cleanup failed") from None
