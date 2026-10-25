"""Operator command routing and public result boundaries."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from odk_service_runtime.cli import main


class FakeRuntime:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.calls = []
        self.record = {"id": "poller", "selected": "a" * 64, "previous": None, "enabled": False, "state": "disabled",
                       "bindings": {"private": {"envFile": "/private/secret"}}, "handle": {"containerId": "private-container"}}

    def install(self, source: Path, config: dict, *, trusted: bool = False) -> dict:
        self.calls.append(("install", source, config, trusted))
        return self.record

    def list(self) -> list:
        return [self.record]

    def inspect(self, identity: str) -> dict:
        self.calls.append(("inspect", identity))
        if identity == "missing":
            raise ValueError("private missing service detail")
        return self.record

    def enable(self, identity: str) -> dict:
        self.calls.append(("enable", identity))
        return self.record

    disable = enable
    rollback = enable

    def remove(self, identity: str) -> dict:
        self.calls.append(("remove", identity))
        return {"id": identity, "removed": True}

    def run_foreground(self, identity: str, revision: str | None = None) -> int:
        self.calls.append(("run", identity, revision))
        return 7


class CliTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="odk-service-cli-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        os.chmod(self.root, 0o700)
        self.runtime = FakeRuntime(self.root)
        self.output = []
        self.errors = []
        self.config = self.root / "bindings.json"
        self.config.write_text('{"envFile": null}', encoding="utf-8")
        self.config.chmod(0o600)

    def call(self, args: list[str], **kwargs: object) -> int:
        return main(["--state-dir", str(self.root), *args], runtime_factory=lambda root: self.runtime,
                    output=self.output.append, error=self.errors.append, **kwargs)

    def test_inspect_and_list_only_emit_public_selection_fields(self) -> None:
        for args in [["inspect", "poller"], ["list"]]:
            with self.subTest(args=args):
                self.assertEqual(self.call(args), 0)
                self.assertNotIn("private", self.output[-1])
                value = json.loads(self.output[-1])
                record = value[0] if isinstance(value, list) else value
                self.assertEqual(record["revision"], "a" * 64)
                self.assertEqual(set(record), {"id", "revision", "previous", "enabled", "state"})

    def test_install_requires_explicit_trust_and_reads_private_operator_config(self) -> None:
        args = ["install", str(self.root), "--config", str(self.config)]
        self.assertEqual(self.call(args), 1)
        self.assertFalse(any(call[0] == "install" for call in self.runtime.calls))
        self.assertEqual(self.call([*args, "--trust"]), 0)
        self.assertEqual(self.runtime.calls[-1], ("install", self.root, {"envFile": None}, True))
        self.config.chmod(0o644)
        self.assertEqual(self.call([*args, "--trust"]), 1)

    def test_update_requires_an_existing_package_identity_before_installation(self) -> None:
        with patch("odk_service_runtime.cli.read_package", return_value=({"id": "missing"}, {}, "a" * 64)):
            self.assertEqual(self.call(["update", str(self.root), "--config", str(self.config), "--trust"]), 1)
        self.assertFalse(any(call[0] == "install" for call in self.runtime.calls))
        with patch("odk_service_runtime.cli.read_package", return_value=({"id": "poller"}, {}, "a" * 64)):
            self.assertEqual(self.call(["update", str(self.root), "--config", str(self.config), "--trust"]), 0)

    def test_run_returns_actual_child_exit_without_json_output(self) -> None:
        self.assertEqual(self.call(["run", "poller", "--revision", "a" * 64]), 7)
        self.assertEqual(self.runtime.calls[-1], ("run", "poller", "a" * 64))
        self.assertEqual(self.output, [])

    def test_argument_and_runtime_failures_never_print_private_values(self) -> None:
        for args in [["install", "relative", "--config", str(self.config), "--trust"], ["private-token-command"], ["inspect", "missing"]]:
            with self.subTest(args=args):
                self.assertEqual(self.call(args), 1)
                self.assertNotIn("private-token", self.errors[-1])
                self.assertNotIn("private missing service detail", self.errors[-1])

    def test_default_root_uses_xdg_state_home(self) -> None:
        roots = []
        self.assertEqual(main(["list"], environment={"XDG_STATE_HOME": str(self.root)}, runtime_factory=lambda root: roots.append(root) or self.runtime,
                              output=self.output.append, error=self.errors.append), 0)
        self.assertEqual(roots, [self.root / "odk-service-runtime"])

    def test_real_launcher_returns_sanitized_failure_and_can_list_empty_state(self) -> None:
        launcher = Path(__file__).resolve().parents[1] / "service_runtime.py"
        result = subprocess.run([sys.executable, str(launcher), "--state-dir", str(self.root / "actual-state"), "list"],
                                check=False, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [])
        result = subprocess.run([sys.executable, str(launcher), "--state-dir", str(self.root / "actual-state"), "inspect", "private-token"],
                                check=False, text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertNotIn("private-token", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
