"""Owner-thread command dispatch; transport authentication belongs to the caller."""
import json
import re
from collections.abc import Collection

from plugin_host import PluginHost


def dispatch_plugin_control(host: PluginHost, request: object, *,
                            protected_ids: Collection[str] = (), stopped: bool = False) -> dict:
    """Apply the common control contract without opening channels or saving preferences."""
    host.require_owner_thread()
    if not isinstance(request, dict):
        return {"ok": False, "error": "invalid-command"}
    try:
        if len(json.dumps(request, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode("utf-8")) > 4096:
            return {"ok": False, "error": "invalid-command"}
    except (TypeError, ValueError, UnicodeError, RecursionError):
        return {"ok": False, "error": "invalid-command"}
    command = request.get("command")
    if command == "inventory":
        if set(request) - {"v", "id", "command"}:
            return {"ok": False, "error": "invalid-command"}
        if stopped:
            return {"ok": False, "error": "runtime-stopped"}
        try:
            plugins = [{"pluginId": entry["manifest"]["id"], "host": entry["manifest"]["host"]}
                       for entry in host.catalog()]
            if not 1 <= len(plugins) <= 128 or len(json.dumps(plugins, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 16384:
                raise ValueError("invalid inventory")
            return {"ok": True, "scope": "python-agent", "plugins": plugins}
        except Exception:
            return {"ok": False, "error": "inventory-unavailable"}
    if command not in ("enable", "disable") or set(request) - {"v", "id", "command", "pluginId"}:
        return {"ok": False, "error": "invalid-command"}
    identity = request.get("pluginId")
    if not isinstance(identity, str) or not re.fullmatch(r"odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*", identity):
        return {"ok": False, "error": "unknown-plugin"}
    if identity in protected_ids:
        return {"ok": False, "error": "protected-plugin"}
    if stopped:
        return {"ok": False, "error": "runtime-stopped"}
    if not any(entry["manifest"]["id"] == identity for entry in host.catalog()):
        return {"ok": False, "error": "unknown-plugin"}
    enabled = command == "enable"
    try:
        host.set_enabled(identity, enabled)
        plugin = next((entry for entry in host.catalog() if entry["manifest"]["id"] == identity), None)
        if plugin is None or plugin["state"] != ("running" if enabled else "disabled"):
            return {"ok": False, "error": "lifecycle-failed"}
        return {"ok": True, "scope": "python-agent", "pluginId": identity, "enabled": enabled, "state": plugin["state"]}
    except Exception:
        return {"ok": False, "error": "lifecycle-failed"}
