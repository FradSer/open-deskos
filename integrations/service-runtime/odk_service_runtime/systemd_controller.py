"""Control only user units whose file and revision belong to this runtime root."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import stat
import sys
import tempfile
from typing import Any, Callable

_ID = re.compile(r"[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*\Z")
_REVISION = re.compile(r"[a-f0-9]{64}\Z")
_HEADER = "# odk-service-runtime "


class SystemdControllerError(RuntimeError):
    """A sanitized failure with ownership information for later recovery."""

    def __init__(self, message: str, handle: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.handle = handle


def _safe_path(path: Path) -> Path:
    value = Path(path)
    if not value.is_absolute() or any(ord(character) < 32 or ord(character) == 127 for character in str(value)):
        raise SystemdControllerError("Service manager paths must be absolute without control characters")
    if value.resolve() != value:
        raise SystemdControllerError("Service manager paths must not contain filesystem aliases")
    return value


def _quote(value: str, environment_expansion: bool = True) -> str:
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise SystemdControllerError("Invalid service manager argument")
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%")
    return '"' + (escaped.replace("$", "$$") if environment_expansion else escaped) + '"'


class SystemdController:
    """Manage a Python service through a revision-bound runtime-manager command."""

    def __init__(self, root: Path, executable: str = "systemctl", runner: Callable[..., Any] = subprocess.run,
                 launcher: Path | None = None, platform: str = sys.platform) -> None:
        self.root = _safe_path(root)
        self.launcher = _safe_path(launcher or Path(__file__).resolve().parent.parent / "service_runtime.py")
        self.executable = executable
        self.runner = runner
        self.platform = platform
        self.fingerprint = hashlib.sha256(str(self.root).encode()).hexdigest()

    def _linux(self) -> None:
        if self.platform != "linux":
            raise SystemdControllerError("Unsupported platform: Python user services require Linux systemd")

    def _unit(self, service_id: str) -> str:
        if not isinstance(service_id, str) or len(service_id) > 64 or not _ID.fullmatch(service_id):
            raise SystemdControllerError("Invalid service identity")
        return f"odk-service-{self.fingerprint[:12]}-{service_id}.service"

    def _validate(self, handle: dict[str, Any]) -> Path:
        if not isinstance(handle, dict) or handle.get("backend") != "python" or handle.get("rootFingerprint") != self.fingerprint:
            raise SystemdControllerError("Invalid service ownership handle", handle)
        if not isinstance(handle.get("revision"), str) or not _REVISION.fullmatch(handle["revision"]) or handle.get("unit") != self._unit(handle.get("id")):
            raise SystemdControllerError("Invalid service revision handle", handle)
        return self.root / "units" / handle["unit"]

    def _run(self, args: list[str], handle: dict[str, Any], timeout: int = 30) -> Any:
        environment = {key: value for key, value in os.environ.items() if key in {
            "HOME", "USER", "LOGNAME", "PATH", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "LANG", "LC_ALL",
        }}
        try:
            return self.runner([self.executable, "--user", *args], check=False, capture_output=True,
                               text=True, timeout=timeout, env=environment)
        except (OSError, subprocess.SubprocessError):
            raise SystemdControllerError("User service operation is unavailable or its outcome is unknown", handle) from None

    def _checked(self, args: list[str], handle: dict[str, Any], timeout: int = 30) -> Any:
        result = self._run(args, handle, timeout)
        if result.returncode != 0:
            raise SystemdControllerError("User service operation failed; retain its handle for recovery", handle)
        return result

    def _show(self, handle: dict[str, Any]) -> dict[str, str]:
        self._validate(handle)
        result = self._run(["show", handle["unit"], "--property=FragmentPath", "--property=LoadState", "--property=ActiveState", "--property=MainPID"], handle)
        try:
            properties = dict(line.split("=", 1) for line in result.stdout.splitlines() if line)
        except (ValueError, AttributeError):
            raise SystemdControllerError("User service ownership could not be verified", handle) from None
        if set(properties) != {"FragmentPath", "LoadState", "ActiveState", "MainPID"} or not re.fullmatch(r"[0-9]+", properties.get("MainPID", "")) or (result.returncode != 0 and properties.get("LoadState") != "not-found"):
            raise SystemdControllerError("User service ownership could not be verified", handle)
        return properties

    def _file_owned(self, handle: dict[str, Any]) -> Path:
        file = self._validate(handle)
        try:
            if file.is_symlink() or not file.is_file() or file.stat().st_size > 32768 or file.parent.resolve() != file.parent:
                raise ValueError()
            if os.name != "nt" and (file.stat().st_uid != os.getuid() or file.stat().st_mode & 0o077):
                raise ValueError()
            first_line = file.read_text(encoding="utf-8").splitlines()[0]
            owner = json.loads(first_line.removeprefix(_HEADER)) if first_line.startswith(_HEADER) else {}
            if owner != {key: handle[key] for key in ["id", "revision", "rootFingerprint"]}:
                raise ValueError()
        except (OSError, ValueError, IndexError):
            raise SystemdControllerError("Managed service unit ownership could not be verified", handle) from None
        return file

    def _fragment_matches(self, fragment: str, file: Path, handle: dict[str, Any], *, missing_link: bool = False) -> bool:
        """Accept the source or an owned installed symlink to that exact source."""
        if fragment == str(file):
            return True
        alias = Path(fragment)
        if not alias.is_absolute() or alias.name != handle["unit"] or alias.parent.resolve() != alias.parent:
            return False
        try:
            parent = alias.parent.stat()
            if parent.st_uid != os.getuid() or parent.st_mode & 0o022:
                return False
            try:
                info = alias.lstat()
            except FileNotFoundError:
                return missing_link
            return stat.S_ISLNK(info.st_mode) and info.st_uid == os.getuid() and alias.resolve() == file
        except (OSError, RuntimeError):
            return False

    @staticmethod
    def _inactive(properties: dict[str, str]) -> bool:
        return properties["ActiveState"] in ["inactive", "failed"] and properties["MainPID"] == "0"

    def _owned(self, handle: dict[str, Any]) -> dict[str, str]:
        file = self._file_owned(handle)
        properties = self._show(handle)
        if not self._fragment_matches(properties["FragmentPath"], file, handle) or properties["LoadState"] != "loaded":
            raise SystemdControllerError("User service unit belongs to another installation or is unavailable", handle)
        return properties

    def reserve(self, service_id: str, revision: str, manifest: dict[str, Any], config: dict[str, Any], state_directory: Path) -> dict[str, Any]:
        """Build recovery ownership before the caller durably admits startup."""
        _safe_path(state_directory)
        timeout = manifest.get("stopTimeoutSeconds", 20)
        if isinstance(timeout, bool) or not isinstance(timeout, int) or not 1 <= timeout <= 300:
            raise SystemdControllerError("Invalid service shutdown timeout")
        handle = {"backend": "python", "id": service_id, "revision": revision, "unit": self._unit(service_id),
                  "rootFingerprint": self.fingerprint, "stopTimeoutSeconds": timeout}
        self._validate(handle)
        return handle

    def start(self, service_id: str, revision: str, manifest: dict[str, Any], config: dict[str, Any], state_directory: Path,
              *, handle: dict[str, Any] | None = None) -> dict[str, Any]:
        """Link and enable a private unit after proving its identity is unused or owned."""
        self._linux()
        expected = self.reserve(service_id, revision, manifest, config, state_directory)
        if handle is not None and handle != expected:
            raise SystemdControllerError("User service reservation changed before startup", handle)
        handle = expected
        timeout = handle["stopTimeoutSeconds"]
        file = self._validate(handle)
        properties = self._show(handle)
        if properties["LoadState"] == "not-found" and not properties["FragmentPath"]:
            if file.exists() or file.is_symlink():
                self._file_owned(handle)
        elif self._fragment_matches(properties["FragmentPath"], file, handle):
            owned = self._owned(handle)
            if owned["ActiveState"] == "active":
                return handle
        else:
            raise SystemdControllerError("User service unit belongs to another installation", handle)
        arguments = [str(Path(sys.executable).resolve()), str(self.launcher), "--state-dir", str(self.root), "run", service_id, "--revision", revision]
        identity = {key: handle[key] for key in ["id", "revision", "rootFingerprint"]}
        text = "\n".join([
            _HEADER + json.dumps(identity, sort_keys=True), "[Unit]", "Description=Open DeskOS managed Python service",
            "StartLimitIntervalSec=60", "StartLimitBurst=3", "", "[Service]", "Type=simple",
            "ExecStart=" + " ".join(_quote(value) for value in arguments),
            "UMask=0077", "NoNewPrivileges=true", "KillMode=control-group", f"TimeoutStopSec={timeout + 5}",
            "Restart=on-failure", "RestartSec=5", "StandardOutput=null", "StandardError=null", "", "[Install]", "WantedBy=default.target", "",
        ])
        temporary = None
        try:
            file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if file.parent.resolve() != file.parent:
                raise OSError()
            descriptor, temporary = tempfile.mkstemp(prefix=".unit-", dir=file.parent)
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(text)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, file)
            temporary = None
        except OSError:
            raise SystemdControllerError("Could not prepare the managed user service unit", handle) from None
        finally:
            if temporary is not None:
                Path(temporary).unlink(missing_ok=True)
        # Recheck immediately before linking; no unrelated named unit is replaced.
        current = self._show(handle)
        if (current["FragmentPath"] and not self._fragment_matches(current["FragmentPath"], file, handle)) or (not current["FragmentPath"] and current["LoadState"] != "not-found"):
            raise SystemdControllerError("User service identity changed before linking", handle)
        self._checked(["link", str(file)], handle)
        self._checked(["daemon-reload"], handle)
        self._owned(handle)
        self._checked(["enable", "--now", handle["unit"]], handle)
        if self._owned(handle)["ActiveState"] != "active":
            raise SystemdControllerError("Managed user service did not become active", handle)
        return handle

    def status(self, handle: dict[str, Any]) -> dict[str, str]:
        """Report a bounded state without disclosing service-manager diagnostics."""
        self._linux()
        try:
            state = self._owned(handle)["ActiveState"]
            if state == "active":
                return {"state": "running"}
            if state in ["inactive", "failed"]:
                return {"state": "exited"}
        except SystemdControllerError:
            pass
        return {"state": "unknown"}

    def stop(self, handle: dict[str, Any]) -> None:
        """Stop only the exactly owned revision and confirm its inactive state."""
        self._linux()
        self._owned(handle)
        self._checked(["stop", handle["unit"]], handle, timeout=handle.get("stopTimeoutSeconds", 20) + 10)
        if not self._inactive(self._owned(handle)):
            raise SystemdControllerError("Managed user service shutdown is incomplete", handle)

    def remove(self, handle: dict[str, Any]) -> None:
        """Disable and delete only the verified managed unit after shutdown."""
        self._linux()
        file = self._validate(handle)
        properties = self._show(handle)
        absent = properties["LoadState"] == "not-found" and not properties["FragmentPath"] and self._inactive(properties)
        if absent:
            if file.exists() or file.is_symlink():
                self._file_owned(handle).unlink()
                self._checked(["daemon-reload"], handle)
            return
        if not file.exists() and not file.is_symlink():
            # Recover a completed unlink followed by a failed reload. Never infer
            # absence from an unavailable manager or an unrelated fragment.
            if not self._fragment_matches(properties["FragmentPath"], file, handle, missing_link=True) or properties["LoadState"] not in ["loaded", "bad-setting"] or not self._inactive(properties):
                raise SystemdControllerError("Managed unit cleanup ownership is unknown", handle)
            self._checked(["daemon-reload"], handle)
            confirmed = self._show(handle)
            if confirmed["LoadState"] != "not-found" or confirmed["FragmentPath"] or not self._inactive(confirmed):
                raise SystemdControllerError("Managed unit cleanup is incomplete", handle)
            return
        self._file_owned(handle)
        if properties["LoadState"] == "bad-setting":
            if not self._fragment_matches(properties["FragmentPath"], file, handle) or not self._inactive(properties):
                raise SystemdControllerError("Malformed unit shutdown ownership is unknown", handle)
        else:
            self.stop(handle)
            properties = self._owned(handle)
        self._checked(["disable", "--no-reload", handle["unit"]], handle)
        file = self._file_owned(handle)
        current = self._show(handle)
        absent = current["LoadState"] == "not-found" and not current["FragmentPath"] and self._inactive(current)
        retained = current["LoadState"] == properties["LoadState"] and current["FragmentPath"] == properties["FragmentPath"] and self._inactive(current) and self._fragment_matches(current["FragmentPath"], file, handle, missing_link=True)
        if not absent and not retained:
            raise SystemdControllerError("Managed unit ownership changed during cleanup", handle)
        try:
            file.unlink()
        except OSError:
            raise SystemdControllerError("Could not remove the managed service unit", handle) from None
        self._checked(["daemon-reload"], handle)
