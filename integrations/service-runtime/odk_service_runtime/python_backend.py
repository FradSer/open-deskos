"""Prepare one locked virtual environment for each trusted Python service revision."""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath
import re
import subprocess
from typing import Any, Callable


_VERSION = re.compile(r"3\.\d+\.\d+")
_BUILD_ENVIRONMENT = {
    "HOME", "USER", "LOGNAME", "PATH", "SYSTEMROOT", "WINDIR", "TMP", "TEMP", "TMPDIR",
    "LANG", "LC_ALL", "SSL_CERT_FILE", "SSL_CERT_DIR", "HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY",
    "https_proxy", "http_proxy", "all_proxy", "no_proxy",
}


class PythonBackend:
    """Use uv for dependency isolation; trusted package hooks retain user authority."""

    def __init__(self, uv_executable: str = "uv", runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run) -> None:
        if not isinstance(uv_executable, str) or not uv_executable or "\0" in uv_executable:
            raise ValueError("Invalid uv executable")
        self.uv_executable = uv_executable
        self.runner = runner

    @staticmethod
    def _revision(revision_dir: Path) -> Path:
        revision = Path(revision_dir)
        if not revision.is_absolute() or revision.resolve() != revision or not revision.is_dir():
            raise ValueError("Python revision requires an existing absolute directory without links")
        environment = revision / ".venv"
        if environment.is_symlink() or (environment.exists() and not environment.is_dir()):
            raise ValueError("Python revision environment must be a local directory")
        return revision

    @staticmethod
    def _runtime(manifest: dict[str, Any]) -> dict[str, Any]:
        runtime = manifest.get("runtime", {})
        if not isinstance(runtime, dict) or runtime.get("kind") != "python" or not isinstance(runtime.get("python"), str) or not _VERSION.fullmatch(runtime["python"]):
            raise ValueError("Python runtime requires an exact interpreter version")
        entry = runtime.get("entry")
        if not isinstance(entry, str) or not entry or "\\" in entry or "\0" in entry or PurePosixPath(entry).is_absolute() or any(part in {"", ".", ".."} for part in entry.split("/")):
            raise ValueError("Python runtime entry must remain inside the revision")
        args = runtime.get("args", [])
        if not isinstance(args, list) or any(not isinstance(arg, str) or "\0" in arg for arg in args):
            raise ValueError("Invalid Python runtime arguments")
        return runtime

    @staticmethod
    def _python(revision: Path) -> Path:
        return revision / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")

    def _run(self, argv: list[str], revision: Path, phase: str) -> subprocess.CompletedProcess[str]:
        # Resolve only explicit package inputs. Host UV_*, PYTHON*, active-env,
        # provider credentials, and build-tool overrides do not reach uv/hooks.
        environment = {key: value for key, value in os.environ.items() if key in _BUILD_ENVIRONMENT}
        try:
            return self.runner(argv, cwd=str(revision), env=environment, check=True,
                               capture_output=True, text=True, timeout=600,
                               **({"umask": 0o077} if os.name != "nt" else {}))
        except (OSError, subprocess.SubprocessError):
            # Resolver diagnostics can contain private index URLs or package data.
            raise RuntimeError(f"Python service {phase} failed") from None

    def prepare(self, revision_dir: Path, manifest: dict[str, Any]) -> None:
        """Refuse a stale lock, synchronize the revision, and verify its interpreter."""
        revision = self._revision(revision_dir)
        runtime = self._runtime(manifest)
        common = ["--no-config", "--python", runtime["python"], "--project", str(revision), "--directory", str(revision)]
        self._run([self.uv_executable, "lock", "--check", *common], revision, "lock validation")
        self._run([self.uv_executable, "sync", "--frozen", "--no-dev", "--no-default-groups", "--no-install-project", *common], revision, "dependency installation")
        self._revision(revision)
        python = self._python(revision)
        result = self._run([str(python), "-I", "-c", "import platform; print(platform.python_version())"], revision, "interpreter verification")
        if result.stdout.strip() != runtime["python"]:
            raise RuntimeError("Python service interpreter version does not match the declared version")

    def command(self, revision_dir: Path, manifest: dict[str, Any]) -> list[str]:
        """Return a direct revision command without shell interpretation."""
        revision = self._revision(revision_dir)
        runtime = self._runtime(manifest)
        return [str(self._python(revision)), str(revision / runtime["entry"]), *runtime.get("args", [])]
