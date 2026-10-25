"""Opt-in real Futu package acceptance; local controller is not a systemd test."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import pytest

from odk_service_runtime.manager import ServiceRuntime, service_environment
from odk_service_runtime.docker_backend import DockerBackendError

SERVICE = "odk.futu.poller"
RUNTIME_SOURCE = Path(__file__).resolve().parents[1]


class ForegroundTestController:
    """Emulate only systemd admission while using the actual foreground runner."""

    def __init__(self) -> None:
        self.processes: dict[str, subprocess.Popen] = {}
        self.exit_codes: list[int] = []
        self.exit_errors: list[str] = []

    def reserve(self, service_id, revision, manifest, config, root):
        return {"id": service_id, "revision": revision, "backend": "python"}

    def start(self, service_id, revision, manifest, config, root, *, handle=None):
        command = "from pathlib import Path; import sys; from odk_service_runtime.manager import ServiceRuntime; raise SystemExit(ServiceRuntime(Path(sys.argv[1])).run_foreground(sys.argv[2],sys.argv[3]))"
        self.processes[revision] = subprocess.Popen(
            [sys.executable, "-c", command, str(root), service_id, revision],
            env={**os.environ, "PYTHONPATH": str(RUNTIME_SOURCE)},
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        return handle

    def remove(self, handle):
        process = self.processes[handle["revision"]]
        if process.poll() is None:
            process.terminate()
        _, error = process.communicate(timeout=25)
        result = process.returncode
        self.exit_codes.append(result)
        self.exit_errors.append(error.decode("utf-8", errors="replace"))
        assert result == 0

    def status(self, handle):
        process = self.processes.get(handle["revision"])
        return {"state": "running" if process is not None and process.poll() is None else "exited"}


def _package(variable: str) -> Path:
    source = os.environ.get(variable)
    if not source:
        pytest.skip(f"Set {variable} to an explicitly selected real Futu package")
    path = Path(source).resolve(strict=True)
    manifest = json.loads((path / "service.json").read_text())
    assert manifest["id"] == SERVICE
    return path


def _private_env(directory: Path, *, docker: bool = False) -> tuple[dict, Path]:
    directory.chmod(0o700)
    env = directory / "worker.env"
    control = "/state/control.sock" if docker else str(directory / "control.sock")
    # No password: the worker never imports or opens the SDK gateway.
    env.write_text(f"FUTU_HOST=127.0.0.1\nFUTU_PORT=1\nFUTU_TRADE_PWD=\nODK_FUTU_CONTROL={control}\nODK_FUTU_SOCKET=/tmp/odk-futu-unbound-desk.sock\nODK_FUTU_TARGETS_FILE=/nonexistent/odk-futu-test-targets.json\n")
    env.chmod(0o600)
    mounts = []
    if docker:
        state = directory / "container-state"
        state.mkdir(mode=0o700)
        env.write_text(env.read_text() + "HOME=/state\n")
        mounts = [{"source": str(state), "target": "/state", "readOnly": False}]
    return {"envFile": str(env), "mounts": mounts, "uid": os.getuid(), "gid": os.getgid()}, Path(control)


def test_real_futu_python_package_uses_manager_and_foreground_supervisor():
    package = _package("ODK_FUTU_ACCEPTANCE_PYTHON_PACKAGE")
    controller = ForegroundTestController()
    # A short canonical root keeps Unix management paths within native limits.
    with tempfile.TemporaryDirectory(prefix="odk-fa-", dir="/tmp") as temporary:
        directory = Path(temporary).resolve()
        config, control = _private_env(directory)
        runtime = ServiceRuntime(directory / "runtime", controller=controller)
        first = runtime.install(package, config, trusted=True)
        revision = runtime.root / "revisions" / SERVICE / first["selected"]
        assert (revision / ".venv/bin/python").is_file()
        installed = subprocess.run([str(revision / ".venv/bin/python"), "-I", "-c",
                                    "import platform; from importlib.metadata import version; print(platform.python_version()); print(version('futu-api'))"],
                                   check=True, capture_output=True, text=True, timeout=5)
        assert installed.stdout.splitlines() == ["3.12.11", "10.2.6208"]
        assert not control.exists()
        try:
            active = runtime.enable(SERVICE)
            assert active["state"] == "running" and control.is_socket()
            assert controller.status(active["handle"])["state"] == "running"
            try:
                runtime.disable(SERVICE)
            except RuntimeError:
                assert controller.exit_codes == [0], str(controller.exit_errors)
                raise
            assert not control.exists()
            health = subprocess.run([str(revision / ".venv/bin/python"), "healthcheck.py"], cwd=revision,
                                    env=service_environment(config, runtime.root / "data" / SERVICE, first["selected"]),
                                    capture_output=True, text=True, timeout=5)
            assert health.returncode == 1
            assert health.stdout.strip() == "Futu worker control unavailable."
            assert (revision / ".venv/bin/python").is_file()
            assert Path(config["envFile"]).read_text().startswith("FUTU_HOST=127.0.0.1")
            second_source = directory / "second-package"
            shutil.copytree(package, second_source)
            manifest_path = second_source / "service.json"
            manifest = json.loads(manifest_path.read_text())
            manifest["version"] = "1.0.1"
            manifest_path.write_text(json.dumps(manifest))
            second = runtime.install(second_source, config, trusted=True)
            assert second["previous"] == first["selected"]
            restored = runtime.rollback(SERVICE)
            assert restored["selected"] == first["selected"]
            runtime.remove(SERVICE)
            assert revision.is_dir() and Path(config["envFile"]).is_file()
        finally:
            for process in controller.processes.values():
                if process.poll() is None:
                    process.terminate()
                    process.wait(timeout=25)


def test_real_futu_docker_package_uses_manager_lifecycle():
    package = _package("ODK_FUTU_ACCEPTANCE_DOCKER_PACKAGE")
    manifest = json.loads((package / "service.json").read_text())
    assert manifest["runtime"]["kind"] == "docker"
    image = manifest["runtime"]["image"]
    assert image.startswith("sha256:"), "Acceptance uses a cached local image and cannot pull"
    subprocess.run(["docker", "image", "inspect", image], check=True, capture_output=True, timeout=10)
    with tempfile.TemporaryDirectory(prefix="odk-fd-", dir="/tmp") as temporary:
        directory = Path(temporary).resolve()
        config, _ = _private_env(directory, docker=True)
        runtime = ServiceRuntime(directory / "runtime")
        first = runtime.install(package, config, trusted=True)
        handle = None
        try:
            active = runtime.enable(SERVICE)
            handle = active["handle"]
            assert runtime.docker.status(handle) == {"state": "running"}
            assert runtime.docker.health(handle, manifest, config)
            runtime.disable(SERVICE)
            assert runtime.docker.status(handle) == {"state": "absent"}
            with pytest.raises(DockerBackendError):
                runtime.docker.health(handle, manifest, config)
            assert runtime.inspect(SERVICE)["state"] == "disabled"
            assert (runtime.root / "revisions" / SERVICE / first["selected"]).is_dir()
            assert Path(config["envFile"]).is_file()
            runtime.remove(SERVICE)
        finally:
            record = runtime.inspect(SERVICE)
            if record.get("handle"):
                runtime.disable(SERVICE)
