"""Synchronous local Python factories; manifests do not sandbox native code."""
from copy import deepcopy
import asyncio
import json
from concurrent.futures import Future
from dataclasses import dataclass, field
import re
import inspect
from threading import Event, current_thread
from typing import Callable, TypeVar

T = TypeVar("T")

PORT = re.compile(r"odk:[a-z][a-z0-9./-]*/v[1-9][0-9]*\Z")
KINDS = {"surface", "application", "service", "transport", "device-driver", "processor", "protocol", "integration", "system"}


def _consume_future_failure(future: asyncio.Future | Future) -> None:
    if not future.cancelled():
        future.exception()


def require_synchronous(value: T) -> T:
    """Reject asynchronous results at host and component adapter boundaries."""
    if inspect.isawaitable(value) or isinstance(value, Future):
        if isinstance(value, (asyncio.Future, Future)):
            if value.done():
                _consume_future_failure(value)
            else:
                value.add_done_callback(_consume_future_failure)
        if inspect.iscoroutine(value):
            value.close()
        raise TypeError("plugin lifecycle operations must be synchronous")
    return value


@dataclass
class _Record:
    manifest: dict
    create: Callable
    state: str = "registered"
    error: str | None = None
    failure: BaseException | None = None
    instance: dict | None = None
    cleanups: list = field(default_factory=list)
    signal: Event = field(default_factory=Event)
    completed: set[str] = field(default_factory=set)
    provided: dict = field(default_factory=dict)
    releasing: bool = False


class PluginContext:
    def __init__(self, host: "PluginHost", record: _Record) -> None:
        self._host = host
        self._record = record
        self.signal = record.signal

    def get(self, name: str) -> object:
        self._host.require_owner_thread()
        if not any(port["interface"] == name for port in self._record.manifest["requires"]):
            raise ValueError("undeclared port " + name)
        value = self._host.get(name)
        if value is not None:
            return value
        if self._record.releasing and self._record.signal is self.signal:
            provider = next((candidate for candidate in self._host._records.values() if any(port["interface"] == name for port in candidate.manifest["provides"])), None)
            return provider.provided.get(name) if provider is not None else None
        return None

    def capability(self, name: str) -> object:
        self._host.require_owner_thread()
        if name not in self._record.manifest["permissions"]:
            raise ValueError("undeclared capability " + name)
        return self._host._capabilities[name]

    def on_cleanup(self, cleanup: Callable[[], object]) -> Callable[[], object]:
        self._host.require_owner_thread()
        if not callable(cleanup):
            raise TypeError("cleanup must be callable")
        if cleanup not in self._record.cleanups:
            self._record.cleanups.append(cleanup)
        return cleanup


class PluginHost:
    """Single-thread composition with dependency-aware replacement and cleanup."""
    def __init__(self, capabilities: dict | None = None, disabled: tuple = (), on_error: Callable | None = None) -> None:
        self._owner_thread = current_thread()
        self._capabilities = dict(capabilities or {})
        self._disabled = set(disabled)
        self._on_error = on_error or (lambda identity, error: None)
        self._records = {}
        self._ports = {}
        self._order = []
        self._running = False
        self._transition = False

    def require_owner_thread(self) -> None:
        """Keep owned state and resource lifecycle on the constructing thread."""
        if current_thread() is not self._owner_thread:
            raise RuntimeError("plugin operation requires its owner thread")

    def register(self, definition: dict) -> None:
        self.require_owner_thread()
        if self._running or self._transition or any(self._owns(record) for record in self._records.values()):
            raise RuntimeError("cannot register a plugin while the host is running")
        manifest = deepcopy(definition["manifest"])
        if isinstance(manifest.get("schemaVersion"), bool) or manifest.get("schemaVersion") != 1 or manifest.get("host") != "python-agent":
            raise ValueError("plugin requires schema version 1 and python-agent host")
        if not re.fullmatch(r"odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*", manifest.get("id", "")):
            raise ValueError("plugin requires an Open DeskOS identity")
        if manifest.get("kind") not in KINDS or not isinstance(manifest.get("name"), str) or not manifest["name"].strip() or not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", manifest.get("version", "")):
            raise ValueError("plugin requires a kind, name and version")
        if not callable(definition.get("create")):
            raise ValueError("plugin requires a factory")
        for field_name in ("provides", "requires"):
            values = manifest.setdefault(field_name, [])
            if not isinstance(values, list):
                raise ValueError("invalid plugin " + field_name)
            seen = set()
            for port in values:
                if not isinstance(port, dict) or not isinstance(port.get("interface"), str) or not PORT.fullmatch(port["interface"]) or port["interface"] in seen or set(port) - {"interface", "optional"} or ("optional" in port and (field_name == "provides" or not isinstance(port["optional"], bool))):
                    raise ValueError("invalid plugin " + field_name)
                seen.add(port["interface"])
        permissions = manifest.setdefault("permissions", [])
        if not isinstance(permissions, list) or any(not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9.-]*", name) for name in permissions) or len(set(permissions)) != len(permissions):
            raise ValueError("invalid plugin permissions")
        if manifest["id"] in self._records:
            raise ValueError("plugin already registered")
        self._records[manifest["id"]] = _Record(manifest, definition["create"])

    def validate(self) -> list[str]:
        self.require_owner_thread()
        providers = {}
        for record in self._records.values():
            for port in record.manifest["provides"]:
                name = port["interface"]
                if name in providers:
                    raise ValueError("duplicate port " + name)
                providers[name] = record
        order, visiting, visited = [], set(), set()
        def visit(record):
            identity = record.manifest["id"]
            if identity in visited:
                return
            if identity in visiting:
                raise ValueError("dependency cycle at " + identity)
            visiting.add(identity)
            for port in record.manifest["requires"]:
                provider = providers.get(port["interface"])
                if provider is None and not port.get("optional", False):
                    raise ValueError("missing required port " + port["interface"])
                if provider is not None:
                    visit(provider)
            visiting.remove(identity)
            visited.add(identity)
            order.append(record)
        for record in self._records.values():
            visit(record)
        return [record.manifest["id"] for record in order]

    def catalog(self) -> list[dict]:
        self.require_owner_thread()
        return [{"manifest": deepcopy(record.manifest), "state": record.state, "enabled": record.manifest["id"] not in self._disabled, **({"error": record.error} if record.error else {})} for record in self._records.values()]

    def diagnose(self) -> dict:
        """Read bounded public lifecycle metadata without invoking providers."""
        self.require_owner_thread()
        unavailable = {"state": "unavailable", "reason": "report-invalid", "plugins": []}
        if not self._records or len(self._records) > 128:
            return unavailable
        fields = ("schemaVersion", "id", "name", "version", "host", "kind", "provides", "requires", "permissions")
        states = {"registered", "starting", "running", "disabled", "blocked", "failed", "stopped", "cleanup-failed", "cleanup-blocked"}
        try:
            chunks = [b"["]
            size = 2
            encoder = json.JSONEncoder(ensure_ascii=False, separators=(",", ":"))
            for index, record in enumerate(self._records.values()):
                if record.state not in states:
                    return unavailable
                # Bound scalar tokens and collection traversal before JSON creates any copies.
                manifest = {field: record.manifest[field] for field in fields}
                if any(not isinstance(manifest[field], str) or len(manifest[field]) > 16384
                       for field in ("id", "name", "version", "host", "kind")):
                    return unavailable
                for field in ("provides", "requires", "permissions"):
                    values = manifest[field]
                    if not isinstance(values, list) or len(values) > 16384:
                        return unavailable
                    for value in values:
                        token = value if field == "permissions" else value["interface"]
                        if not isinstance(token, str) or len(token) > 16384:
                            return unavailable
                plugin = {"manifest": manifest, "state": record.state,
                          "enabled": manifest["id"] not in self._disabled,
                          "health": {"state": "unknown", "reason": "not-declared"}}
                if index:
                    chunks.append(b",")
                    size += 1
                for text in encoder.iterencode(plugin):
                    encoded = text.encode("utf-8")
                    size += len(encoded)
                    if size > 16384:
                        return unavailable
                    chunks.append(encoded)
            chunks.append(b"]")
            # Decode the bounded representation to isolate callers from owned state.
            return {"state": "available", "plugins": json.loads(b"".join(chunks))}
        except (KeyError, TypeError, ValueError):
            return unavailable

    def get(self, name: str) -> object:
        self.require_owner_thread()
        return self._ports.get(name)

    def failure(self, identity: str) -> BaseException | None:
        self.require_owner_thread()
        return self._records[identity].failure

    def generation(self, identity: str) -> object | None:
        """Return an opaque current activation token, independent of port identity."""
        self.require_owner_thread()
        record = self._records[identity]
        return record.signal if record.state == "running" else None

    def _report(self, record, error):
        record.error = str(error)
        if record.failure is None:
            record.failure = error
        try:
            self._on_error(record.manifest["id"], error)
        except Exception:
            pass

    @staticmethod
    def _owns(record: _Record) -> bool:
        return record.instance is not None or bool(record.cleanups)

    def _release(self, record: _Record) -> None:
        record.signal.set()
        for port in record.manifest["provides"]:
            self._ports.pop(port["interface"], None)
        if not self._owns(record):
            return
        provided = {port["interface"] for port in record.manifest["provides"]}
        consumer = next((candidate for candidate in self._records.values() if candidate is not record and self._owns(candidate) and any(port["interface"] in provided for port in candidate.manifest["requires"])), None)
        if consumer is not None:
            record.state = "cleanup-blocked"
            self._report(record, RuntimeError("resources retained by " + consumer.manifest["id"]))
            return
        record.releasing = True
        try:
            for phase in ("stop", "destroy"):
                if phase in record.completed:
                    continue
                try:
                    operation = record.instance.get(phase) if isinstance(record.instance, dict) else None
                    if operation is not None:
                        require_synchronous(operation())
                    record.completed.add(phase)
                except Exception as error:
                    record.state = "cleanup-failed"
                    self._report(record, error)
                    return
            for cleanup in list(reversed(record.cleanups)):
                try:
                    require_synchronous(cleanup())
                    record.cleanups.remove(cleanup)
                except Exception as error:
                    record.state = "cleanup-failed"
                    self._report(record, error)
            if record.cleanups:
                return
            record.instance = None
            record.provided.clear()
            if record.state != "failed":
                record.state = "stopped"
        finally:
            record.releasing = False

    def _activate(self, record):
        if record.state == "running":
            return
        if self._owns(record):
            return
        record.error = None
        record.failure = None
        if record.manifest["id"] in self._disabled:
            record.state = "disabled"
            return
        missing = next((port for port in record.manifest["requires"] if not port.get("optional", False) and port["interface"] not in self._ports), None)
        if missing:
            record.state, record.error = "blocked", "unavailable required port " + missing["interface"]
            return
        record.state = "starting"
        record.signal = Event()
        record.completed.clear()
        try:
            for name in record.manifest["permissions"]:
                if name not in self._capabilities:
                    raise ValueError("missing capability " + name)
            instance = require_synchronous(record.create(PluginContext(self, record)))
            record.instance = instance
            if not isinstance(instance, dict):
                raise ValueError("invalid plugin instance")
            ports = instance.get("ports", {})
            declared = {port["interface"] for port in record.manifest["provides"]}
            if not isinstance(ports, dict) or set(ports) != declared or any(value is None for value in ports.values()):
                raise ValueError("invalid provided ports")
            record.provided = ports.copy()
            if instance.get("start") is not None:
                require_synchronous(instance["start"]())
            self._ports.update(ports)
            record.state = "running"
        except BaseException as error:
            record.state = "failed"
            self._report(record, error)
            self._release(record)
            if not isinstance(error, Exception):
                raise

    def start(self) -> list[dict]:
        self.require_owner_thread()
        if self._transition:
            raise RuntimeError("plugin transition already active")
        if self._running:
            return self.catalog()
        if any(self._owns(record) for record in self._records.values()):
            raise RuntimeError("plugin host still owns resources; retry shutdown before startup")
        self._order = [self._records[identity] for identity in self.validate()]
        self._transition = True
        try:
            for record in self._order:
                self._activate(record)
            self._running = True
        finally:
            self._transition = False
        return self.catalog()

    def stop(self) -> list[dict]:
        self.require_owner_thread()
        if self._transition:
            raise RuntimeError("plugin transition already active")
        self._transition = True
        try:
            for record in reversed(self._order):
                self._release(record)
            self._running = False
        finally:
            self._transition = False
        return self.catalog()

    def _affected(self, identity: str) -> set[str]:
        affected = {identity}
        while True:
            ports = {port["interface"] for name in affected for port in self._records[name].manifest["provides"]}
            consumers = {name for name, record in self._records.items() if any(port["interface"] in ports for port in record.manifest["requires"])}
            expanded = affected | consumers
            if expanded == affected:
                return affected
            affected = expanded

    def fail(self, identity: str, error: Exception) -> list[dict]:
        """Retire a failed running generation without restarting it or its providers."""
        self.require_owner_thread()
        record = self._records[identity]
        if not isinstance(error, Exception):
            raise TypeError("plugin execution failure must be an exception")
        if self._transition:
            raise RuntimeError("plugin transition already active")
        if record.state != "running":
            raise RuntimeError("plugin execution failure requires a running instance")
        affected = self._affected(identity)
        self._transition = True
        try:
            record.state = "failed"
            self._report(record, error)
            for candidate in reversed(self._order):
                if candidate.manifest["id"] in affected:
                    self._release(candidate)
            for candidate in self._order:
                if candidate.manifest["id"] in affected and candidate is not record:
                    self._activate(candidate)
        finally:
            self._transition = False
        return self.catalog()

    def set_enabled(self, identity: str, enabled: bool) -> list[dict]:
        self.require_owner_thread()
        if identity not in self._records:
            raise KeyError(identity)
        if not isinstance(enabled, bool):
            raise TypeError("plugin enabled value must be a boolean")
        if self._transition:
            raise RuntimeError("plugin transition already active")
        affected = self._affected(identity)
        if (identity not in self._disabled) == enabled and not any(record.state == "failed" or (self._owns(record) and record.state != "running") for name, record in self._records.items() if name in affected):
            return self.catalog()
        if enabled:
            self._disabled.discard(identity)
        else:
            self._disabled.add(identity)
        if not self._running:
            return self.catalog()
        self._transition = True
        try:
            for record in reversed(self._order):
                if record.manifest["id"] in affected:
                    self._release(record)
            for record in self._order:
                if record.manifest["id"] in affected:
                    self._activate(record)
        finally:
            self._transition = False
        return self.catalog()
