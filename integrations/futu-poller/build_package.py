"""Build a credential-free source snapshot for the external service runtime."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile

RUNTIME_FILES = tuple(sorted(("poller.py", "plugin_host.py", "plugin_config.py", "plugin_control.py",
                             "management_channel.py", "development_plugins.py", "healthcheck.py",
                             "pyproject.toml", "uv.lock", ".python-version", "Dockerfile")))


def build_package(destination: Path, *, backend: str = "python", image: str | None = None,
                  platform: str = "linux/arm64", source: Path | None = None) -> dict:
    """Publish exactly the fixed runtime allowlist and its hashed manifest."""
    source = Path(__file__).resolve().parent if source is None else Path(source).absolute()
    destination = Path(destination).absolute()
    if source.resolve() != source or destination.resolve() != destination:
        raise ValueError("Source and destination must use canonical paths without symlink aliases.")
    if backend not in ("python", "docker") or destination.exists():
        raise ValueError("Use a new package destination and a supported backend.")
    if backend == "docker" and (not isinstance(image, str) or not re.fullmatch(r"(?:[A-Za-z0-9][A-Za-z0-9._/:\-]*@)?sha256:[0-9a-f]{64}", image)):
        raise ValueError("Docker packages require an immutable image digest or local image id.")
    if platform not in ("linux/arm64", "linux/amd64"):
        raise ValueError("Unsupported Docker platform.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=".futu-package-", dir=destination.parent))
    try:
        files = []
        for name in RUNTIME_FILES:
            file = source / name
            if file.is_symlink() or not file.is_file() or file.stat().st_size > 1048576:
                raise ValueError("A required runtime source is unavailable or unsafe.")
            data = file.read_bytes()
            (temporary / name).write_bytes(data)
            files.append({"path": name, "sha256": hashlib.sha256(data).hexdigest()})
        runtime = {"kind": "python", "python": "3.12.11", "entry": "poller.py", "args": []} if backend == "python" else {
            "kind": "docker", "image": image, "platform": platform, "args": []}
        manifest = {"schemaVersion": 1, "id": "odk.futu.poller", "name": "Futu holdings", "version": "1.0.0",
                    "files": files, "runtime": runtime, "health": {"kind": "exec", "argv": ["{python}", "healthcheck.py"] if backend == "python" else ["python", "/app/healthcheck.py"], "timeoutSeconds": 60},
                    "stopTimeoutSeconds": 20}
        (temporary / "service.json").write_text(json.dumps(manifest, indent=2) + "\n")
        temporary.rename(destination)
        return manifest
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def main() -> None:
    """Create a new reviewed package directory without credentials or local state."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("destination", type=Path)
    parser.add_argument("--backend", choices=("python", "docker"), default="python")
    parser.add_argument("--image")
    parser.add_argument("--platform", default="linux/arm64")
    args = parser.parse_args()
    build_package(args.destination, backend=args.backend, image=args.image, platform=args.platform)


if __name__ == "__main__":
    main()
