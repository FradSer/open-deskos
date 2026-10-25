"""Private revision storage and serialized external service transactions."""
from __future__ import annotations

from contextlib import contextmanager
import copy
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile
import time
from typing import Any, Callable, Iterator

from .manifest import ID, REVISION, bounded_file, canonical_json, read_package, validate_manifest
from .python_backend import PythonBackend
from .docker_backend import DockerBackend


def private_directory(path: Path) -> None:
    """Create an owned private directory without repairing existing permissions."""
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError("A canonical private directory is required")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError("Private service directory is unavailable or unsafe")


def private_bytes(path: Path, limit: int) -> bytes:
    """Read bounded operator files without following aliases or blocking on FIFOs."""
    if not path.is_absolute() or path.resolve() != path:
        raise ValueError("Private service file is unavailable or unsafe")
    private_directory(path.parent)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1 or info.st_size > limit:
            raise ValueError("Private service file is unavailable or unsafe")
        content = bytearray()
        while len(content) <= limit:
            chunk = os.read(fd, min(65536, limit + 1 - len(content)))
            if not chunk: break
            content.extend(chunk)
        after, current = os.fstat(fd), path.lstat()
        if len(content) > limit or (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or (current.st_dev, current.st_ino) != (info.st_dev, info.st_ino):
            raise ValueError("Private service file changed during access")
        return bytes(content)
    finally:
        os.close(fd)


def validate_config(value: Any) -> dict[str, Any]:
    """Validate operator bindings; these never come from service package bytes."""
    if not isinstance(value, dict) or value.keys() - {"envFile", "mounts", "uid", "gid"}:
        raise ValueError("Invalid service configuration bindings")
    result = copy.deepcopy(value)
    result.setdefault("envFile", None)
    result.setdefault("mounts", [])
    result.setdefault("uid", os.getuid())
    result.setdefault("gid", os.getgid())
    if any(isinstance(result[key], bool) or not isinstance(result[key], int) or not 1 <= result[key] <= 2147483647 for key in ("uid", "gid")):
        raise ValueError("Service bindings require non-root identities")
    if result["envFile"] is not None:
        path = Path(result["envFile"])
        private_bytes(path, 65536)
    if not isinstance(result["mounts"], list) or len(result["mounts"]) > 16:
        raise ValueError("Invalid service mounts")
    for mount in result["mounts"]:
        if not isinstance(mount, dict) or set(mount) != {"source", "target", "readOnly"} or not isinstance(mount["readOnly"], bool):
            raise ValueError("Invalid service mount binding")
        for key in ("source", "target"):
            if not isinstance(mount[key], str) or not Path(mount[key]).is_absolute() or re.search(r"[\x00-\x1f\x7f,]", mount[key]):
                raise ValueError("Service mount paths must be explicit")
    return result


def service_environment(config: dict[str, Any], state: Path, revision: str) -> dict[str, str]:
    """Pass declared values, never ambient model credentials or active Python settings."""
    environment = {key: value for key, value in os.environ.items() if key in {"PATH", "LANG", "LC_ALL", "TZ", "SSL_CERT_FILE", "SSL_CERT_DIR"}}
    if config.get("envFile"):
        content = private_bytes(Path(config["envFile"]), 65536).decode("utf-8")
        for line in content.splitlines():
            if not line.strip() or line.lstrip().startswith("#"): continue
            key, separator, value = line.partition("=")
            if not separator or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,99}", key) or "\0" in value:
                raise ValueError("Invalid service environment file")
            if key in environment and key not in {"LANG", "LC_ALL", "TZ"}:
                raise ValueError("Service environment overrides a reserved host setting")
            environment[key] = value
    for key in list(environment):
        if key.startswith(("PYTHON", "UV_")) or key in {"LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "NODE_OPTIONS", "VIRTUAL_ENV"}:
            raise ValueError("Service environment contains a runtime override")
    environment.update({"HOME": str(state), "ODK_SERVICE_STATE_DIR": str(state), "ODK_SERVICE_REVISION": revision, "PYTHONUNBUFFERED": "1"})
    return environment


class ServiceRuntime:
    """Store and activate trusted service revisions through explicit backend ownership."""

    def __init__(self, root: Path, *, python_backend: Any = None, docker_backend: Any = None, controller: Any = None, probe: Callable[..., None] | None = None) -> None:
        self.root = Path(root)
        private_directory(self.root)
        self.python = python_backend or PythonBackend()
        self.docker = docker_backend or DockerBackend(root_directory=self.root)
        if controller is None:
            from .systemd_controller import SystemdController
            controller = SystemdController(self.root)
        self.controller = controller
        self.probe = probe or self._probe
        self.state_file = self.root / "state.json"

    @contextmanager
    def _locked(self) -> Iterator[dict[str, Any]]:
        descriptor = os.open(self.root / "operation.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
                raise ValueError("Unsafe service operation lock")
            try: fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise RuntimeError("Another service operation is in progress") from None
            yield self._load()
        finally:
            os.close(descriptor)

    def _load(self) -> dict[str, Any]:
        if not self.state_file.exists(): return {"schemaVersion": 1, "services": {}}
        value = json.loads(private_bytes(self.state_file, 2 * 1024 * 1024))
        if not isinstance(value, dict) or set(value) != {"schemaVersion", "services"} or value["schemaVersion"] != 1 or not isinstance(value["services"], dict):
            raise ValueError("Invalid external service state")
        for service_id, record in value["services"].items():
            if not isinstance(service_id, str) or len(service_id) > 64 or not ID.fullmatch(service_id) or not isinstance(record, dict) or record.get("id") != service_id:
                raise ValueError("Invalid external service state identity")
            if set(record) - {"id", "selected", "previous", "enabled", "state", "bindings", "handle", "pending"} or not isinstance(record.get("bindings"), dict) or not isinstance(record.get("enabled"), bool) or record.get("state") not in {"disabled", "starting", "running", "stopping", "cleanup_pending", "removed"}:
                raise ValueError("Invalid external service state record")
            for revision, binding in record["bindings"].items():
                if not isinstance(revision, str) or not REVISION.fullmatch(revision) or not isinstance(binding, dict):
                    raise ValueError("Invalid external service state binding")
            for key in ("selected", "previous", "pending"):
                revision = record.get(key)
                if revision is not None and (not isinstance(revision, str) or not REVISION.fullmatch(revision) or revision not in record["bindings"]):
                    raise ValueError("Invalid external service state revision")
            handle = record.get("handle")
            if handle is not None and (not isinstance(handle, dict) or handle.get("id") != service_id or handle.get("revision") not in record["bindings"] or handle.get("backend") not in {"python", "docker"}):
                raise ValueError("Invalid external service state ownership")
            if record["enabled"] and not handle:
                raise ValueError("Invalid external service state activation")
        return value

    def _save(self, state: dict[str, Any]) -> None:
        descriptor, temporary = tempfile.mkstemp(prefix=".state-", dir=self.root)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(canonical_json(state)); stream.flush(); os.fsync(stream.fileno())
            os.replace(temporary, self.state_file)
            directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
            try: os.fsync(directory)
            finally: os.close(directory)
        finally:
            if os.path.exists(temporary): os.unlink(temporary)

    def _record(self, state: dict[str, Any], service_id: str) -> dict[str, Any]:
        if not isinstance(service_id, str) or not ID.fullmatch(service_id) or service_id not in state["services"]:
            raise ValueError("Unknown external service")
        return state["services"][service_id]

    def _directory(self, service_id: str, revision: str) -> Path:
        if not ID.fullmatch(service_id) or not REVISION.fullmatch(revision): raise ValueError("Invalid service revision")
        path = self.root / "revisions" / service_id / revision
        if path.resolve() != path: raise ValueError("Unsafe service revision directory")
        return path

    def _manifest(self, service_id: str, revision: str) -> tuple[Path, dict[str, Any]]:
        path = self._directory(service_id, revision)
        manifest = validate_manifest(json.loads(private_bytes(path / "service.json", 32768)))
        if manifest["id"] != service_id or hashlib.sha256(canonical_json(manifest)).hexdigest() != revision:
            raise ValueError("Service revision metadata failed integrity validation")
        for file in manifest["files"]:
            candidate = path / file["path"]
            if hashlib.sha256(bounded_file(candidate, 4 * 1024 * 1024)).hexdigest() != file["sha256"]:
                raise ValueError("Service revision inputs failed integrity validation")
        return path, manifest

    def _snapshot(self, source: Path) -> tuple[str, dict[str, Any], Path]:
        manifest, files, revision = read_package(source)
        destination = self._directory(manifest["id"], revision)
        if not destination.exists():
            private_directory(destination.parent)
            temporary = Path(tempfile.mkdtemp(prefix=".revision-", dir=destination.parent))
            try:
                for name, content in {**files, "service.json": canonical_json(manifest)}.items():
                    target = temporary / name
                    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    target.write_bytes(content); target.chmod(0o600)
                temporary.rename(destination)
            finally:
                if temporary.exists():
                    import shutil
                    shutil.rmtree(temporary)
        self._manifest(manifest["id"], revision)
        return revision, manifest, destination

    def _backend(self, manifest: dict[str, Any]) -> Any:
        return self.docker if manifest["runtime"]["kind"] == "docker" else self.controller

    def _stop(self, state: dict[str, Any], record: dict[str, Any], *, remove: bool = True) -> None:
        handle = record.get("handle")
        if not handle:
            if record["state"] in {"starting", "stopping", "cleanup_pending"}:
                raise RuntimeError("Service cleanup requires a retained ownership reservation")
            return
        record["state"] = "stopping"; self._save(state)
        try:
            backend = self.docker if handle["backend"] == "docker" else self.controller
            backend.remove(handle) if remove else backend.stop(handle)
        except Exception as error:
            if getattr(error, "handle", None):
                record["handle"] = error.handle
            record["state"] = "cleanup_pending"; self._save(state)
            raise RuntimeError("Service cleanup is unconfirmed; retry disable before another activation") from None
        record.pop("handle", None)
        record.pop("pending", None)
        record["state"] = "disabled"; record["enabled"] = False; self._save(state)

    def _start(self, state: dict[str, Any], record: dict[str, Any], revision: str) -> None:
        path, manifest = self._manifest(record["id"], revision)
        config = validate_config(record["bindings"][revision])
        persistent = self.root / "data" / record["id"]
        private_directory(persistent)
        backend = self._backend(manifest)
        handle = backend.reserve(record["id"], revision, manifest, config, self.root)
        record["handle"] = handle
        record["pending"] = revision; record["state"] = "starting"; self._save(state)
        try:
            record["handle"] = backend.start(record["id"], revision, manifest, config, self.root, handle=handle)
            self._save(state)
            self.probe(path, manifest, config, record["handle"])
        except Exception as error:
            if getattr(error, "handle", None): record["handle"] = error.handle
            self._save(state)
            self._stop(state, record)
            record.pop("pending", None); self._save(state)
            raise RuntimeError("Service startup or readiness failed") from None

    def _commit_running(self, state: dict[str, Any], record: dict[str, Any]) -> None:
        """Commit selection and successful activation in one durable state write."""
        record["enabled"] = True
        record["state"] = "running"
        record.pop("pending", None)
        self._save(state)

    def _probe(self, directory: Path, manifest: dict[str, Any], config: dict[str, Any], handle: dict[str, Any]) -> None:
        deadline = time.monotonic() + manifest["health"].get("timeoutSeconds", 10)
        while True:
            if time.monotonic() >= deadline:
                raise RuntimeError("Service readiness deadline exceeded")
            try:
                if handle["backend"] == "docker":
                    self.docker.health(handle, manifest, config, directory, deadline=deadline)
                else:
                    python = self.python.command(directory, manifest)[0]
                    argv = [part.replace("{python}", python).replace("{revision}", str(directory)) for part in manifest["health"]["argv"]]
                    remaining = deadline - time.monotonic()
                    if remaining <= 0: raise RuntimeError("Service readiness deadline exceeded")
                    subprocess.run(argv, cwd=directory, env=service_environment(config, self.root / "data" / manifest["id"], handle["revision"]), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=remaining, check=True)
                    if self.controller.status(handle).get("state") != "running": raise RuntimeError("Service exited")
                if time.monotonic() >= deadline: raise RuntimeError("Service readiness deadline exceeded")
                return
            except Exception:
                if time.monotonic() >= deadline: raise RuntimeError("Service readiness deadline exceeded") from None
                time.sleep(min(0.2, max(0, deadline-time.monotonic())))

    def install(self, source: Path, config: dict[str, Any], *, trusted: bool = False) -> dict[str, Any]:
        """Prepare a candidate before changing a selected or running revision."""
        if not trusted: raise ValueError("External service installation requires explicit native trust")
        bindings = validate_config(config)
        with self._locked() as state:
            revision, manifest, path = self._snapshot(Path(source))
            old = state["services"].get(manifest["id"])
            if old and old.get("state") in {"cleanup_pending", "starting", "stopping"}: raise RuntimeError("Reconcile the unfinished service operation first")
            if old and revision in old["bindings"] and old["bindings"][revision] != bindings: raise ValueError("Existing revision bindings cannot be replaced")
            if old and old["selected"] == revision:
                return copy.deepcopy(old)
            (self.python if manifest["runtime"]["kind"] == "python" else self.docker).prepare(path, manifest)
            self._manifest(manifest["id"], revision)
            record = old or {"id": manifest["id"], "selected": None, "previous": None, "enabled": False, "state": "disabled", "bindings": {}}
            state["services"][manifest["id"]] = record
            record["bindings"][revision] = bindings
            previous, enabled = record["selected"], record["enabled"]
            self._save(state)
            if previous == revision: return copy.deepcopy(record)
            if enabled:
                self._stop(state, record)
                try: self._start(state, record, revision)
                except RuntimeError:
                    if record["state"] != "cleanup_pending":
                        self._start(state, record, previous)
                        self._commit_running(state, record)
                    raise
            record["previous"], record["selected"] = previous, revision
            if enabled: self._commit_running(state, record)
            else: self._save(state)
            return copy.deepcopy(record)

    def enable(self, service_id: str) -> dict[str, Any]:
        """Start only the selected, verified revision."""
        with self._locked() as state:
            record = self._record(state, service_id)
            if record["state"] in {"cleanup_pending", "starting", "stopping"}: raise RuntimeError("Reconcile the unfinished service operation first")
            if not record["selected"]: raise ValueError("Service is not installed")
            if not record["enabled"]:
                self._start(state, record, record["selected"])
                self._commit_running(state, record)
            return copy.deepcopy(record)

    def disable(self, service_id: str) -> dict[str, Any]:
        """Release owned runtime resources before reporting disabled."""
        with self._locked() as state:
            record = self._record(state, service_id)
            self._stop(state, record)
            record["enabled"], record["state"] = False, "disabled"
            record.pop("pending", None); self._save(state)
            return copy.deepcopy(record)

    def rollback(self, service_id: str) -> dict[str, Any]:
        """Restore retained code, environment, and operator binding references."""
        with self._locked() as state:
            record = self._record(state, service_id)
            target, original, enabled = record["previous"], record["selected"], record["enabled"]
            if not target or record["state"] in {"cleanup_pending", "starting", "stopping"}: raise RuntimeError("No available rollback revision or unfinished cleanup")
            self._manifest(service_id, target)
            if enabled:
                self._stop(state, record)
                try: self._start(state, record, target)
                except RuntimeError:
                    if record["state"] != "cleanup_pending":
                        self._start(state, record, original)
                        self._commit_running(state, record)
                    raise
            record["selected"], record["previous"] = target, original
            if enabled: self._commit_running(state, record)
            else: self._save(state)
            return copy.deepcopy(record)

    def remove(self, service_id: str) -> dict[str, Any]:
        """Deactivate a service while preserving external secrets and revision snapshots."""
        with self._locked() as state:
            record = self._record(state, service_id)
            self._stop(state, record)
            record["previous"], record["selected"] = record["selected"], None
            record["enabled"], record["state"] = False, "removed"
            self._save(state)
            return {"id": service_id, "removed": True}

    def inspect(self, service_id: str) -> dict[str, Any]:
        """Read private lifecycle metadata without contacting a provider."""
        return copy.deepcopy(self._record(self._load(), service_id))

    def list(self) -> list[dict[str, Any]]:
        """List selections without starting environments or services."""
        return [copy.deepcopy(record) for record in self._load()["services"].values() if record.get("selected")]

    def run_foreground(self, service_id: str, revision: str | None = None) -> int:
        """Forward termination to a newly owned process group, with bounded cleanup."""
        if not isinstance(service_id, str) or len(service_id) > 64 or not ID.fullmatch(service_id):
            raise ValueError("Invalid service identity")
        leases = self.root / "leases"
        private_directory(leases)
        lease = os.open(leases / service_id, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        try:
            info = os.fstat(lease)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_nlink != 1:
                raise ValueError("Unsafe foreground service lease")
            try: fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise RuntimeError("A service runner already holds this lease") from None
            return self._run_owned(service_id, revision)
        finally:
            os.close(lease)

    def _run_owned(self, service_id: str, revision: str | None) -> int:
        record = self._record(self._load(), service_id)
        revision = revision or record["selected"]
        if revision not in {record["selected"], record.get("pending")} or not revision: raise ValueError("Service revision is not selected for execution")
        directory, manifest = self._manifest(service_id, revision)
        if manifest["runtime"]["kind"] != "python": raise ValueError("Foreground runner requires a Python revision")
        persistent = self.root / "data" / service_id
        private_directory(persistent)
        child = None
        stopped = False
        stop_deadline = None
        def terminate(_signal: int, _frame: Any) -> None:
            nonlocal stopped, stop_deadline
            stopped = True
            if stop_deadline is None:
                stop_deadline = time.monotonic() + manifest.get("stopTimeoutSeconds", 20)
            if child is not None:
                try: os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError: pass
        previous = {number: signal.signal(number, terminate) for number in (signal.SIGTERM, signal.SIGINT)}
        try:
            if stopped: return 143
            child = subprocess.Popen(self.python.command(directory, manifest), cwd=directory, env=service_environment(validate_config(record["bindings"][revision]), persistent, revision), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
            if stopped: terminate(signal.SIGTERM, None)
            while child.poll() is None:
                try: return child.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    # A signal can arrive during a wait that began before stop.
                    if stop_deadline is not None and time.monotonic() >= stop_deadline:
                        try: os.killpg(child.pid, signal.SIGKILL)
                        except ProcessLookupError: pass
                        return child.wait(timeout=1)
            return child.returncode
        finally:
            if child is not None:
                # The leader can exit while descendants still hold this new group.
                try: os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError: pass
                deadline = stop_deadline if stop_deadline is not None else time.monotonic() + manifest.get("stopTimeoutSeconds", 20)
                while time.monotonic() < deadline:
                    try: os.killpg(child.pid, 0)
                    except ProcessLookupError: break
                    time.sleep(0.02)
                else:
                    try: os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError: pass
                child.wait(timeout=1)
            for number, handler in previous.items(): signal.signal(number, handler)
