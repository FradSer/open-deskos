"""Fixed, read-only host observation. No caller paths, arguments, or environment settings."""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

TOOL = Path('/usr/local/libexec/odk-xorg-bgra-verify')
PYTHON_TOOL = Path('/usr/local/libexec/odk-xorg-bgra-verify.py')
MODULE = Path('/usr/local/lib/odk-xorg-bgra-21.1.7/modules/libglamoregl.so')
XORG = Path('/usr/lib/xorg/Xorg')
PROC = Path('/proc')


class Unavailable(Exception):
    pass


def trusted(path: Path) -> None:
    for parent in [path, *path.parents]:
        info = parent.lstat()
        if (info.st_uid != 0 or info.st_gid != 0 or info.st_mode & 0o022
                or not (stat.S_ISREG(info.st_mode) if parent == path else stat.S_ISDIR(info.st_mode))):
            raise Unavailable()


def identity(info: os.stat_result) -> tuple:
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def bounded(path: Path, limit: int) -> bytes:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise Unavailable()
    return data


def module_snapshot() -> tuple:
    trusted(MODULE)
    before = MODULE.stat()
    fd = os.open(MODULE, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as stream:
        if identity(os.fstat(stream.fileno())) != identity(before):
            raise Unavailable()
        data = stream.read(16 * 1024 * 1024 + 1)
        if len(data) > 16 * 1024 * 1024 or identity(os.fstat(stream.fileno())) != identity(before):
            raise Unavailable()
    if identity(before) != identity(MODULE.stat()):
        raise Unavailable()
    return identity(before), hashlib.sha256(data).hexdigest(), before


def boot() -> str:
    value = bounded(PROC / 'sys/kernel/random/boot_id', 64).decode().strip()
    if not re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', value):
        raise Unavailable()
    return value


def processes(executable: os.stat_result) -> dict:
    found = {}
    for directory in PROC.iterdir():
        if not directory.name.isdecimal():
            continue
        try:
            actual = (directory / 'exe').stat()
        except (FileNotFoundError, ProcessLookupError):
            continue
        except PermissionError:
            # Kernel threads can lack exe; a protected process cannot establish a positive observation.
            raise Unavailable() from None
        if (actual.st_dev, actual.st_ino) != (executable.st_dev, executable.st_ino):
            continue
        fields = bounded(directory / 'stat', 16384).rsplit(b') ', 1)[1].split()
        found[int(directory.name)] = fields[19].decode('ascii')
        if len(found) > 16:
            raise Unavailable()
    return dict(sorted(found.items()))


def mapped(pid: int, module: os.stat_result) -> bool:
    data = bounded(PROC / str(pid) / 'maps', 4 * 1024 * 1024)
    for line in data.decode('utf-8', 'strict').splitlines():
        fields = line.split()
        if len(fields) != 6 or fields[5] != str(MODULE):
            continue
        major, minor = (int(part, 16) for part in fields[3].split(':'))
        if int(fields[4]) == module.st_ino and (major, minor) == (os.major(module.st_dev), os.minor(module.st_dev)):
            return True
    return False


def observe() -> tuple:
    for path in [TOOL, PYTHON_TOOL, XORG]:
        trusted(path)
    executable = XORG.stat()
    installed, digest, module = module_snapshot()
    boot_id = boot()
    current = processes(executable)
    if not current:
        raise Unavailable()
    mappings = {pid: mapped(pid, module) for pid in current}
    # Same-PID exec or module unloading can preserve a process start counter.
    if mappings != {pid: mapped(pid, module) for pid in current}:
        raise Unavailable()
    after, after_digest, _info = module_snapshot()
    if (installed != after or digest != after_digest or boot_id != boot()
            or identity(executable) != identity(XORG.stat()) or current != processes(executable)):
        raise Unavailable()
    missing = not all(mappings.values())
    return ({'version': 1, 'status': 'failed' if missing else 'verified',
             'reason': 'module-not-mapped' if missing else 'current-mappings',
             'boot': boot_id, 'moduleSha256': digest,
             'processes': [{'pid': pid, 'start': start} for pid, start in current.items()]}, 1 if missing else 0)


def main() -> int:
    try:
        if len(sys.argv) != 1 or os.geteuid() != 0:
            raise Unavailable()
        result, code = observe()
    except Exception:
        result, code = {'version': 1, 'status': 'unknown', 'reason': 'observation-unavailable'}, 2
    text = json.dumps(result, separators=(',', ':'))
    if len(text.encode()) > 8192:
        text, code = '{"version":1,"status":"unknown","reason":"receipt-limit"}', 2
    print(text)
    return code


if __name__ == '__main__':
    sys.exit(main())
