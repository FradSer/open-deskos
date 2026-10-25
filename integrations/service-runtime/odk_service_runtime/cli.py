"""Operator entry point for independent external service lifecycle operations."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any, Callable, Mapping, Sequence

from .manager import ServiceRuntime, private_bytes
from .manifest import read_package


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        raise ValueError("Invalid service command arguments")


def _absolute(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValueError("Service paths must be absolute")
    return path


def _parser(default_root: Path) -> argparse.ArgumentParser:
    parser = _Parser(prog="odk plugin service", description="Manage trusted external service revisions.")
    parser.add_argument("--state-dir", type=_absolute, default=default_root)
    commands = parser.add_subparsers(dest="command", required=True, parser_class=_Parser)
    commands.add_parser("list")
    for command in ["inspect", "enable", "disable", "rollback", "remove"]:
        commands.add_parser(command).add_argument("id")
    for command in ["install", "update"]:
        child = commands.add_parser(command)
        child.add_argument("package", type=_absolute)
        child.add_argument("--config", type=_absolute, required=True)
        child.add_argument("--trust", action="store_true")
    foreground = commands.add_parser("run")
    foreground.add_argument("id")
    foreground.add_argument("--revision")
    return parser


def _public(record: dict[str, Any]) -> dict[str, Any]:
    if record.get("removed") is True:
        return {"id": record["id"], "removed": True}
    return {"id": record["id"], "revision": record.get("selected"), "previous": record.get("previous"),
            "enabled": record.get("enabled", False), "state": record.get("state", "unknown")}


def main(argv: Sequence[str] | None = None, *, environment: Mapping[str, str] | None = None,
         runtime_factory: Callable[[Path], Any] = ServiceRuntime, output: Callable[[str], None] = print,
         error: Callable[[str], None] | None = None) -> int:
    """Run an explicit operator command and expose only public lifecycle results."""
    environment = os.environ if environment is None else environment
    emit_error = error or (lambda text: print(text, file=sys.stderr))
    try:
        home = Path(environment.get("HOME") or str(Path.home()))
        base = Path(environment.get("XDG_STATE_HOME") or home / ".local" / "state")
        arguments = _parser(_absolute(str(base / "odk-service-runtime"))).parse_args(argv)
        if arguments.command in {"install", "update"} and not arguments.trust:
            emit_error("Service installation requires explicit --trust.")
            return 1
        runtime = runtime_factory(arguments.state_dir)
        if arguments.command == "run":
            return runtime.run_foreground(arguments.id, arguments.revision)
        if arguments.command == "list":
            result = [_public(record) for record in runtime.list()]
        elif arguments.command in {"install", "update"}:
            if arguments.command == "update":
                manifest, _, _ = read_package(arguments.package)
                installed = runtime.inspect(manifest["id"])
                if not installed.get("selected"):
                    raise ValueError("Service is not installed")
            config = json.loads(private_bytes(arguments.config, 16384))
            if not isinstance(config, dict):
                raise ValueError("Invalid service configuration")
            result = _public(runtime.install(arguments.package, config, trusted=True))
        else:
            result = _public(getattr(runtime, arguments.command)(arguments.id))
        output(json.dumps(result, sort_keys=True))
        return 0
    except SystemExit as exit_status:
        return int(exit_status.code or 0)
    except (Exception, KeyboardInterrupt):
        # Package names, command arguments, provider output, and config errors can
        # contain private values. Never relay their original exception text.
        emit_error("Service command failed. Check arguments, package integrity, private configuration, and runtime availability.")
        return 1
