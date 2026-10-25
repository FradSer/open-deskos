"""Restricted Docker lifecycle for immutable, operator-selected service images."""

from __future__ import annotations

import hashlib
import json
import os
import stat
import re
import subprocess
import time
import uuid
from pathlib import Path, PurePosixPath
from typing import Any, Callable

_LABEL_PREFIX = 'io.opendeskos.service-runtime.'
_IMAGE = re.compile(r'(?:sha256:[a-f0-9]{64}|[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64})\Z')
_ID = re.compile(r'[a-z][a-z0-9.-]{0,63}\Z')
_REVISION = re.compile(r'[a-f0-9]{64}\Z')


class DockerBackendError(RuntimeError):
    """A sanitized Docker failure with an optional handle for uncertain cleanup."""

    def __init__(self, message: str, handle: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.handle = handle


def _runtime(manifest: dict[str, Any]) -> dict[str, Any]:
    runtime = manifest.get('runtime', {})
    if not isinstance(runtime, dict):
        raise DockerBackendError('Docker runtime is invalid')
    image = runtime.get('image')
    if runtime.get('kind') != 'docker' or not isinstance(image, str) or not _IMAGE.fullmatch(image):
        raise DockerBackendError('Docker image must use an immutable digest or local content ID')
    if not isinstance(runtime.get('platform'), str) or not re.fullmatch(r'linux/(?:arm64|amd64)(?:/[A-Za-z0-9._-]+)?', runtime['platform']):
        raise DockerBackendError('Docker platform must select a supported Linux architecture')
    args = runtime.get('args', [])
    if not isinstance(args, list) or any(not isinstance(arg, str) or '\x00' in arg for arg in args):
        raise DockerBackendError('Docker arguments are invalid')
    return runtime


def _timeout(value: Any, default: int = 20) -> int:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 300:
        raise DockerBackendError('Docker operation timeout is invalid')
    return value


def _path(value: Any) -> Path:
    if not isinstance(value, str) or not Path(value).is_absolute() or any(c in value for c in ['\x00', '\n', '\r', ',']):
        raise DockerBackendError('Docker host paths must be absolute and unambiguous')
    return Path(value).resolve()


def _validate_environment(path: Path) -> None:
    """Read a bounded private literal environment without allowing runtime overrides."""
    descriptor = None
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        metadata = os.fstat(descriptor)
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077 or metadata.st_nlink != 1 or metadata.st_size > 65536:
            raise ValueError()
        content = os.read(descriptor, 65537)
        after = os.fstat(descriptor)
        current = path.lstat()
        if len(content) > 65536 or (metadata.st_dev, metadata.st_ino, metadata.st_size, metadata.st_mtime_ns, metadata.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or (current.st_dev, current.st_ino) != (after.st_dev, after.st_ino):
            raise ValueError()
        for line in content.decode('utf-8').splitlines():
            if not line.strip() or line.lstrip().startswith('#'):
                continue
            key, separator, value = line.partition('=')
            if not separator or not re.fullmatch(r'[A-Z][A-Z0-9_]{0,99}', key) or '\x00' in value:
                raise ValueError()
            if key.startswith(('PYTHON', 'UV_', 'ODK_SERVICE_')) or key in {'PATH', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'NODE_OPTIONS', 'VIRTUAL_ENV'}:
                raise ValueError()
    except (OSError, ValueError, UnicodeError):
        raise DockerBackendError('Docker environment file is invalid or contains a runtime override') from None
    finally:
        if descriptor is not None:
            os.close(descriptor)


def _config_arguments(config: dict[str, Any]) -> list[str]:
    uid, gid = config.get('uid'), config.get('gid')
    if any(isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2147483647 for value in [uid, gid]):
        raise DockerBackendError('Docker services require a non-root user and group')
    result = ['--user', f'{uid}:{gid}']
    env_file = config.get('envFile')
    if env_file is not None:
        path = _path(env_file)
        _validate_environment(path)
        result.extend(['--env-file', str(path)])
    mounts = config.get('mounts', [])
    if not isinstance(mounts, list):
        raise DockerBackendError('Docker mounts are invalid')
    targets = set()
    for mount in mounts:
        if not isinstance(mount, dict) or not isinstance(mount.get('readOnly'), bool):
            raise DockerBackendError('Docker mounts require an explicit read-only policy')
        source = _path(mount.get('source'))
        target_value = mount.get('target')
        if not isinstance(target_value, str) or not target_value.startswith('/') or any(c in target_value for c in ['\x00', '\n', '\r', ',']) or '..' in target_value.split('/'):
            raise DockerBackendError('Docker mount target must be an absolute container path')
        target = PurePosixPath('/' + target_value.lstrip('/'))
        forbidden = [Path('/'), Path('/run'), Path('/var/run'), Path('/private/var/run'), Path('/dev'), Path('/proc'), Path('/sys')]
        private_runtime = _private_runtime_mount(source)
        if (any(source == path or source in path.parents or path in source.parents for path in forbidden[1:]) and not private_runtime) or source == Path('/'):
            raise DockerBackendError('Docker system and daemon mounts are forbidden')
        if source.suffix == '.sock' or any(part in ['docker.sock', 'podman.sock', '.docker'] for part in source.parts):
            raise DockerBackendError('Docker daemon socket mounts are forbidden')
        if not source.exists() or not (source.is_file() or source.is_dir()):
            raise DockerBackendError('Docker mount source is unavailable')
        if source.is_file() and not mount['readOnly']:
            raise DockerBackendError('Docker file mounts must be read-only')
        if source.is_dir():
            try:
                if any(path.name in ['docker.sock', 'podman.sock'] for path in source.rglob('*')):
                    raise DockerBackendError('Docker daemon socket parent mounts are forbidden')
            except OSError:
                raise DockerBackendError('Docker mount contents could not be checked') from None
        if target == Path('/') or any(target == path or path in target.parents for path in [Path('/proc'), Path('/sys'), Path('/dev')]):
            raise DockerBackendError('Docker mount target is forbidden')
        if str(target) in targets:
            raise DockerBackendError('Docker mount targets must be unique')
        targets.add(str(target))
        result.extend(['--mount', f'type=bind,src={source},dst={target}' + (',readonly' if mount['readOnly'] else '')])
    return result


def _private_runtime_mount(source: Path) -> bool:
    for runtime_root in [Path('/run/user'), Path('/var/run/user'), Path('/private/var/run/user')]:
        user_root = runtime_root / str(os.getuid())
        if user_root not in source.parents:
            continue
        try:
            private = source if source.is_dir() else source.parent
            metadata = private.stat()
            return private != user_root and metadata.st_uid == os.getuid() and stat.S_IMODE(metadata.st_mode) == 0o700
        except OSError:
            return False
    return False


class DockerBackend:
    """Run only owned containers, without exposing Docker output as service logs."""

    def __init__(self, docker_executable: str = 'docker', runner: Callable[..., Any] = subprocess.run, root_directory: Path | None = None) -> None:
        self.root_directory = root_directory.resolve() if root_directory is not None else None
        self.docker_executable = docker_executable
        self.runner = runner

    def _run(self, args: list[str], timeout: int = 30, handle: dict[str, Any] | None = None) -> Any:
        try:
            return self.runner([self.docker_executable, *args], capture_output=True, text=True, check=False, timeout=timeout)
        except (OSError, subprocess.SubprocessError):
            raise DockerBackendError('Docker operation is unavailable or its outcome is unknown', handle) from None

    def _checked(self, args: list[str], timeout: int = 30, handle: dict[str, Any] | None = None) -> Any:
        result = self._run(args, timeout, handle)
        if result.returncode != 0:
            raise DockerBackendError('Docker operation failed; retain the service handle for recovery', handle)
        return result

    def _image(self, manifest: dict[str, Any], pull: bool = False) -> None:
        runtime = _runtime(manifest)
        result = self._run(['image', 'inspect', runtime['image']])
        if result.returncode != 0 and pull and '@sha256:' in runtime['image'] and 'no such image' in result.stderr.lower():
            self._checked(['pull', '--platform', runtime['platform'], runtime['image']], timeout=120)
            result = self._run(['image', 'inspect', runtime['image']])
        if result.returncode != 0:
            raise DockerBackendError('The immutable Docker image is unavailable')
        try:
            item = json.loads(result.stdout)[0]
            expected = runtime['platform'].split('/')
            if item['Os'] != expected[0] or item['Architecture'] != expected[1]:
                raise ValueError()
            if len(expected) == 3 and item.get('Variant') != expected[2]:
                raise ValueError()
            if runtime['image'].startswith('sha256:') and item['Id'] != runtime['image']:
                raise ValueError()
            if '@sha256:' in runtime['image'] and runtime['image'] not in item.get('RepoDigests', []):
                raise ValueError()
        except (ValueError, KeyError, TypeError, IndexError):
            raise DockerBackendError('Docker image identity or platform does not match the manifest') from None

    def prepare(self, revision_dir: Path, manifest: dict[str, Any]) -> None:
        """Check an immutable image and pull only a missing registry digest."""
        if not revision_dir.is_dir():
            raise DockerBackendError('Docker service revision directory is unavailable')
        self._image(manifest, pull=True)

    def _labels(self, handle: dict[str, Any]) -> dict[str, str]:
        service, revision, fingerprint = handle.get('id'), handle.get('revision'), handle.get('rootFingerprint')
        if not isinstance(handle.get('creationPending'), bool):
            raise DockerBackendError('Invalid Docker creation reservation', handle)
        if handle.get('backend') != 'docker' or not isinstance(service, str) or not _ID.fullmatch(service):
            raise DockerBackendError('Invalid Docker service handle', handle)
        if not isinstance(revision, str) or not _REVISION.fullmatch(revision) or not isinstance(fingerprint, str) or not _REVISION.fullmatch(fingerprint):
            raise DockerBackendError('Invalid Docker ownership handle', handle)
        if self.root_directory is not None and fingerprint != hashlib.sha256(str(self.root_directory).encode()).hexdigest():
            raise DockerBackendError('Docker handle belongs to another runtime root', handle)
        return {_LABEL_PREFIX + 'root': fingerprint, _LABEL_PREFIX + 'service': service, _LABEL_PREFIX + 'revision': revision}

    def _owned(self, handle: dict[str, Any], *, allow_absent: bool = False, creation_probe: bool = False, timeout: float = 30) -> dict[str, Any] | None:
        labels = self._labels(handle)
        identity = handle.get('containerId')
        if not isinstance(identity, str) or not re.fullmatch(r'(?:[a-f0-9]{64}|odk-service-[a-f0-9]{32})', identity):
            raise DockerBackendError('Invalid Docker container identity', handle)
        result = self._run(['container', 'inspect', identity], timeout=timeout, handle=handle)
        if result.returncode != 0:
            message = result.stderr.strip()
            if allow_absent and message in {f'Error: No such container: {identity}', f'Error response from daemon: No such container: {identity}'}:
                if handle['creationPending'] and not creation_probe:
                    raise DockerBackendError('Docker creation remains pending; retain the recovery handle', handle)
                return None
            raise DockerBackendError('Docker container state is unavailable; retain the recovery handle', handle)
        try:
            item = json.loads(result.stdout)[0]
            if not re.fullmatch(r'[a-f0-9]{64}', item['Id']) or any(item['Config']['Labels'].get(key) != value for key, value in labels.items()):
                raise ValueError()
            if re.fullmatch(r'[a-f0-9]{64}', identity) and item['Id'] != identity:
                raise ValueError()
            if identity.startswith('odk-service-') and item.get('Name') != '/' + identity:
                raise ValueError()
            return item
        except (ValueError, KeyError, TypeError, IndexError):
            raise DockerBackendError('Docker container ownership could not be verified', handle) from None

    def reserve(self, service_id: str, revision: str, manifest: dict[str, Any], config: dict[str, Any], state_directory: Path) -> dict[str, Any]:
        """Allocate recovery identity without creating an external resource."""
        _runtime(manifest)
        _config_arguments(config)
        if not state_directory.is_absolute():
            raise DockerBackendError('Docker state directory must be absolute')
        handle = {'id': service_id, 'revision': revision, 'backend': 'docker', 'containerId': 'odk-service-' + uuid.uuid4().hex,
                  'rootFingerprint': hashlib.sha256(str(self.root_directory or state_directory.resolve()).encode()).hexdigest(),
                  'stopTimeoutSeconds': _timeout(manifest.get('stopTimeoutSeconds')), 'creationPending': True}
        self._labels(handle)
        return handle

    def start(self, service_id: str, revision: str, manifest: dict[str, Any], config: dict[str, Any], state_directory: Path,
              *, handle: dict[str, Any] | None = None) -> dict[str, Any]:
        """Create a restricted container using the caller's durable reservation."""
        runtime = _runtime(manifest)
        config_args = _config_arguments(config)
        expected = self.reserve(service_id, revision, manifest, config, state_directory)
        if handle is None:
            handle = expected
        if any(handle.get(key) != value for key, value in expected.items() if key not in {'containerId', 'creationPending'}) or not re.fullmatch(r'odk-service-[a-f0-9]{32}', handle.get('containerId', '')):
            raise DockerBackendError('Docker reservation changed before startup', handle)
        labels = self._labels(handle)
        self._image(manifest)
        item = self._owned(handle, allow_absent=True, creation_probe=True)
        if item is None:
            args = ['create', '--name', handle['containerId'], '--platform', runtime['platform'], '--read-only', '--cap-drop', 'ALL',
                    '--security-opt', 'no-new-privileges', '--pids-limit', '128', '--memory', '512m', '--cpus', '1',
                    '--tmpfs', '/tmp:rw,noexec,nosuid,nodev,size=64m', '--init', '--log-driver', 'none', '--restart', 'unless-stopped', *config_args]
            for key, value in labels.items():
                args.extend(['--label', f'{key}={value}'])
            args.extend([runtime['image'], *runtime.get('args', [])])
            result = self._checked(args, handle=handle)
            if not re.fullmatch(r'[a-f0-9]{64}', result.stdout.strip()):
                raise DockerBackendError('Docker created a container with an uncertain identity', handle)
            item = self._owned(handle)
        handle = {**handle, 'creationPending': False}
        self._checked(['start', item['Id']], handle=handle)
        if self._owned(handle).get('State', {}).get('Running') is not True:
            raise DockerBackendError('Docker service did not remain running', handle)
        return handle

    def stop(self, handle: dict[str, Any]) -> None:
        """Stop an exactly owned container and retain the handle on failure."""
        item = self._owned(handle, allow_absent=True)
        if item is None:
            return
        handle = {**handle, 'creationPending': False}
        timeout = _timeout(handle.get('stopTimeoutSeconds'))
        self._checked(['stop', '--time', str(timeout), item['Id']], timeout=timeout + 10, handle=handle)

    def remove(self, handle: dict[str, Any]) -> None:
        """Stop and remove an exactly owned container, without deleting data volumes."""
        item = self._owned(handle, allow_absent=True)
        if item is None:
            return
        handle = {**handle, 'creationPending': False}
        self.stop(handle)
        item = self._owned(handle, allow_absent=True)
        if item is not None:
            self._checked(['rm', item['Id']], handle=handle)

    def status(self, handle: dict[str, Any]) -> dict[str, str]:
        """Return only a bounded state after verifying container ownership."""
        try:
            item = self._owned(handle, allow_absent=True)
            if item is None:
                return {'state': 'absent'}
            state = item.get('State', {})
            if state.get('Running') is True:
                return {'state': 'running'}
            if state.get('Status') in ['exited', 'dead', 'created']:
                return {'state': 'exited'}
        except DockerBackendError:
            pass
        return {'state': 'unknown'}

    def health(self, handle: dict[str, Any], manifest: dict[str, Any], config: dict[str, Any], revision_dir: Path | None = None, *, deadline: float | None = None) -> bool:
        """Execute the selected health command only inside the verified container."""
        health = manifest.get('health', {})
        argv = health.get('argv')
        if not isinstance(argv, list) or not argv or any(not isinstance(arg, str) or '\x00' in arg for arg in argv):
            raise DockerBackendError('Docker health command is invalid', handle)
        local_deadline = time.monotonic() + _timeout(health.get('timeoutSeconds'), 10)
        if deadline is not None:
            local_deadline = min(local_deadline, deadline)
        def remaining() -> float:
            budget = local_deadline - time.monotonic()
            if budget <= 0:
                raise DockerBackendError('Docker health deadline exceeded', handle)
            return budget
        item = self._owned(handle, timeout=remaining())
        self._checked(['exec', item['Id'], *argv], timeout=remaining(), handle=handle)
        remaining()
        return True
