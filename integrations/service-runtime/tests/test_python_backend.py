"""Python backend behavior at its subprocess and virtual environment boundaries."""

import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from odk_service_runtime.python_backend import PythonBackend


class PythonBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="odk-python-backend-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.manifest = {"runtime": {"kind": "python", "python": "3.12.11", "entry": "poller.py", "args": ["--probe"]}}

    def test_prepare_validates_lock_then_syncs_without_inherited_overrides(self) -> None:
        calls = []

        def runner(argv: list[str], **options: object) -> subprocess.CompletedProcess[str]:
            calls.append((argv, options))
            return subprocess.CompletedProcess(argv, 0, "3.12.11\n", "")

        with patch.dict(os.environ, {"UV_PROJECT_ENVIRONMENT": "/wrong/environment", "UV_PROJECT": "/wrong/project",
                                     "UV_CONFIG_FILE": "/wrong/config", "PYTHONPATH": "/wrong/imports", "VIRTUAL_ENV": "/wrong/active"}):
            PythonBackend(runner=runner).prepare(self.root, self.manifest)
        self.assertEqual(calls[0][0][1:3], ["lock", "--check"])
        self.assertEqual(calls[1][0][1], "sync")
        self.assertIn("--frozen", calls[1][0])
        self.assertIn("--no-dev", calls[1][0])
        self.assertIn("--no-install-project", calls[1][0])
        for argv, options in calls[:2]:
            self.assertIn("--no-config", argv)
            self.assertEqual(argv[argv.index("--project") + 1], str(self.root))
            self.assertEqual(argv[argv.index("--directory") + 1], str(self.root))
            self.assertEqual(argv[argv.index("--python") + 1], "3.12.11")
            env = options["env"]
            for key in ["UV_PROJECT_ENVIRONMENT", "UV_PROJECT", "UV_CONFIG_FILE", "PYTHONPATH", "VIRTUAL_ENV"]:
                self.assertNotIn(key, env)
        self.assertEqual(calls[2][0][0], str(self.root / ".venv" / "bin" / "python"))

    def test_exact_interpreter_version_is_required(self) -> None:
        def runner(argv: list[str], **options: object) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(argv, 0, "3.12.12\n", "")

        with self.assertRaisesRegex(RuntimeError, "version"):
            PythonBackend(runner=runner).prepare(self.root, self.manifest)

    def test_failed_lock_check_does_not_sync_or_expose_subprocess_output(self) -> None:
        calls = []

        def runner(argv: list[str], **options: object) -> subprocess.CompletedProcess[str]:
            calls.append(argv)
            raise subprocess.CalledProcessError(1, argv, output="private-package-source", stderr="private-package-source")

        with self.assertRaisesRegex(RuntimeError, "lock") as error:
            PythonBackend(runner=runner).prepare(self.root, self.manifest)
        self.assertNotIn("private-package-source", str(error.exception))
        self.assertEqual(len(calls), 1)

    def test_command_selects_revision_python_entry_and_literal_arguments(self) -> None:
        self.assertEqual(PythonBackend().command(self.root, self.manifest), [str(self.root / ".venv" / "bin" / "python"),
                         str(self.root / "poller.py"), "--probe"])
        for entry in ["../poller.py", "/poller.py", "nested/../../poller.py"]:
            with self.subTest(entry=entry), self.assertRaises((ValueError, RuntimeError)):
                PythonBackend().command(self.root, {"runtime": {**self.manifest["runtime"], "entry": entry}})

    def test_linked_environment_is_refused_before_uv_runs(self) -> None:
        outside = self.root / "outside"
        outside.mkdir()
        (self.root / ".venv").symlink_to(outside, target_is_directory=True)
        def runner(*args: object, **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.fail("A linked environment must not reach uv")
        with self.assertRaises((ValueError, RuntimeError)):
            PythonBackend(runner=runner).prepare(self.root, self.manifest)


@unittest.skipUnless(shutil.which("uv"), "uv is required for real environment verification")
class RealPythonBackendTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="odk-python-revisions-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.uv = shutil.which("uv")
        self.version = ".".join(str(part) for part in sys.version_info[:3])

    def project(self, name: str) -> tuple[Path, dict]:
        directory = self.root / name
        directory.mkdir()
        (directory / "pyproject.toml").write_text('[project]\nname = "private-service-fixture"\nversion = "0.1.0"\nrequires-python = "==' + self.version + '"\ndependencies = []\n', encoding="utf-8")
        (directory / "poller.py").write_text('import json, sys\nprint(json.dumps({"prefix": sys.prefix, "revision": ' + repr(name) + '}))\n', encoding="utf-8")
        subprocess.run([self.uv, "lock", "--offline", "--no-config", "--python", self.version, "--project", str(directory), "--directory", str(directory)],
                       check=True, text=True, capture_output=True)
        return directory, {"runtime": {"kind": "python", "python": self.version, "entry": "poller.py", "args": []}}

    def test_real_revisions_have_independent_environments_and_commands(self) -> None:
        import json

        backend = PythonBackend(uv_executable=self.uv)
        first, manifest = self.project("first")
        second, _ = self.project("second")
        first_lock = (first / "uv.lock").read_bytes()
        with patch.dict(os.environ, {"UV_PROJECT_ENVIRONMENT": str(self.root / "unrelated"), "UV_PROJECT": str(self.root / "missing")}):
            backend.prepare(first, manifest)
            backend.prepare(second, manifest)
        for directory in [first, second]:
            result = subprocess.run(backend.command(directory, manifest), check=True, text=True, capture_output=True)
            output = json.loads(result.stdout)
            self.assertEqual(output, {"prefix": str(directory / ".venv"), "revision": directory.name})
        self.assertEqual((first / "uv.lock").read_bytes(), first_lock)
        self.assertFalse((self.root / "unrelated").exists())

    def test_real_stale_lock_is_rejected_without_rewriting_it(self) -> None:
        directory, manifest = self.project("stale")
        original = (directory / "uv.lock").read_bytes()
        project = directory / "pyproject.toml"
        project.write_text(project.read_text(encoding="utf-8").replace('dependencies = []', 'dependencies = ["not-installed-stale-lock-fixture==0.0.0"]'), encoding="utf-8")
        with self.assertRaisesRegex(RuntimeError, "lock"):
            PythonBackend(uv_executable=self.uv).prepare(directory, manifest)
        self.assertEqual((directory / "uv.lock").read_bytes(), original)
        self.assertFalse((directory / ".venv").exists())


if __name__ == "__main__":
    unittest.main()
