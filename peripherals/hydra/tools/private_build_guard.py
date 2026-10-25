"""Confine main-node-private artifacts before any firmware source compiles.

PlatformIO initializes its build cache before PRE extra_scripts. Reject a cache
rather than attempting to disable an already selected cache. No key is loaded.
"""
from __future__ import annotations

import os
from pathlib import Path
import stat
from typing import Any


def require(condition: bool) -> None:
    if not condition:
        raise RuntimeError("private-build-guard: protected build directory and empty build cache required")


def protected_path(path: Path, *, directory: bool) -> None:
    require(path.is_absolute() and ".." not in path.parts)
    for parent in [*reversed(path.parents), path]:
        require(not parent.is_symlink())
    info = path.lstat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == (0o700 if directory else 0o600))


def validate_private_build(project: Path, project_build: Path, build: Path,
                           cache: str, explicit_build: str | None) -> None:
    """Check effective paths and permissions without reading private contents."""
    require(project.is_absolute() and project_build == project / ".local/build"
            and build == project_build / "main-node-private" and explicit_build == str(project_build)
            and not cache)
    protected_path(project / ".local", directory=True)
    protected_path(project / ".local/hydra_host_config.h", directory=False)
    protected_path(project_build, directory=True)
    protected_path(build, directory=True)
    for path in project_build.rglob("*"):
        info = path.lstat()
        require(not path.is_symlink() and info.st_uid == os.getuid()
                and (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode))
                and not (info.st_mode & 0o077))


def enforce_private_build(environment: Any) -> None:
    """Apply the checks to PlatformIO's SCons environment before compilation."""
    require(environment.subst("$PIOENV") == "main-node-private")
    project = Path(environment.subst("$PROJECT_DIR"))
    validate_private_build(project, Path(environment.subst("$PROJECT_BUILD_DIR")),
                           Path(environment.subst("$BUILD_DIR")), environment.subst("$BUILD_CACHE_DIR"),
                           os.environ.get("PLATFORMIO_BUILD_DIR"))
    os.umask(0o077)
    # A compiler wrapper must not export private objects to its own shared cache.
    os.environ["CCACHE_DISABLE"] = "1"
    environment["ENV"]["CCACHE_DISABLE"] = "1"


try:
    Import  # type: ignore[name-defined]  # SCons can provide this through its execution namespace.
except NameError:
    pass
else:
    Import("env")  # type: ignore[name-defined]  # Supplied by PlatformIO/SCons.
    enforce_private_build(env)  # type: ignore[name-defined]
