#!/usr/bin/env python3
"""Prepare and supervise one disposable CM5 guest without host package changes."""

from __future__ import annotations

import argparse
import base64
import contextlib
import fcntl
import hashlib
import json
import os
import pwd
from pathlib import Path
import resource
import shutil
import socket
import stat
import subprocess
import sys
import time
from typing import Any, Iterator
from urllib.request import Request, urlopen
import uuid

DEFAULT_DIRECTORY = "/mnt/ssd/open-deskos/vm-lab"
IMAGE_NAME = "debian-13-generic-arm64.qcow2"
IMAGE_URL = "https://cloud.debian.org/images/cloud/trixie/latest/"
MARKER = "odk-xfce-disposable-lab-v1"
BUDGET = 18 * 1024**3
GUEST = Path(__file__).resolve().parent


def digest(path: Path, algorithm: str = "sha256") -> str:
    """Hash a regular file without loading the image into memory."""
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("A regular owned file is required")
    result = hashlib.new(algorithm)
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def write_json(path: Path, value: Any) -> None:
    """Replace only a known lab metadata file."""
    if path.is_symlink():
        raise RuntimeError("Linked lab metadata is refused")
    temporary = path.with_name(path.name + ".new")
    if temporary.exists() or temporary.is_symlink():
        raise RuntimeError("Incomplete metadata requires operator inspection")
    with temporary.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temporary.replace(path)


def command(arguments: list[str], *, cwd: Path | None = None) -> None:
    """Execute a fixed host command without a shell."""
    subprocess.run(arguments, cwd=cwd, check=True, env={**os.environ, "TMPDIR": str(cwd or "/tmp")})


class Lab:
    """Own the SSD image directory and private native runtime endpoints."""

    def __init__(self, directory: str, runtime_directory: str | None = None) -> None:
        self.directory = Path(directory).absolute()
        if not self.directory.is_relative_to(Path("/mnt/ssd/open-deskos")) or self.directory == Path("/mnt/ssd/open-deskos"):
            raise RuntimeError("The lab must use a dedicated directory under /mnt/ssd/open-deskos")
        if "," in str(self.directory) or "\n" in str(self.directory):
            raise RuntimeError("Unsupported lab path")
        self.runtime = Path(runtime_directory or f"/run/user/{os.getuid()}/odk-xfce-lab").absolute()
        if not self.runtime.is_relative_to(Path(f"/run/user/{os.getuid()}")):
            raise RuntimeError("Runtime sockets and keys require the user runtime directory")
        for path in (self.directory, self.runtime):
            for parent in (path, *path.parents):
                if parent.is_symlink():
                    raise RuntimeError("Linked lab paths are refused")
        self.runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        info = self.runtime.stat()
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
            raise RuntimeError("The runtime directory must be private and user-owned")
        if len(str(self.runtime / "qmp.sock")) > 100:
            raise RuntimeError("The runtime socket path is too long")
        self.manifest_file = self.directory / "lab.json"
        self.key = self.runtime / "bootstrap-key"
        self.qmp = self.runtime / "qmp.sock"
        self.vnc = self.runtime / "vnc.sock"

    def storage(self) -> dict[str, Any]:
        """Require the separately authorized native container mount."""
        output = subprocess.check_output(["findmnt", "--json", "--target", str(self.directory), "--output", "TARGET,FSTYPE,OPTIONS,SOURCE"], text=True)
        mounted = json.loads(output)["filesystems"][0]
        options = set(mounted["options"].split(","))
        if mounted["target"] != str(self.directory) or mounted["fstype"] != "ext4" or not {"nosuid", "nodev", "noexec", "noatime"}.issubset(options):
            raise RuntimeError("The dedicated ext4 lab container is not mounted with the required isolation flags")
        return mounted

    @contextlib.contextmanager
    def lock(self) -> Iterator[None]:
        """Hold one native-filesystem lock throughout every QEMU process."""
        path = self.runtime / "vm.lock"
        if path.is_symlink():
            raise RuntimeError("Linked VM lock is refused")
        with path.open("a+", encoding="utf-8") as stream:
            os.chmod(path, 0o600)
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError("A VM or preparation already owns the lab") from error
            yield

    def manifest(self) -> dict[str, Any]:
        """Read the explicit ownership marker before using existing images."""
        if self.manifest_file.is_symlink():
            raise RuntimeError("Linked lab ownership is refused")
        value = json.loads(self.manifest_file.read_text())
        if value.get("owner") != MARKER or value.get("directory") != str(self.directory):
            raise RuntimeError("Unknown existing VM directory")
        return value

    def budget(self, required: int = 0) -> None:
        """Check the lab budget and SSD reserve without claiming hard quotas."""
        used = 0
        for root, directories, files in os.walk(self.directory):
            for name in directories + files:
                path = Path(root) / name
                if path.is_symlink():
                    raise RuntimeError("Linked lab contents are refused")
                if path.is_file():
                    used += path.stat().st_size
        if used > BUDGET or shutil.disk_usage(self.directory).free < required + 2 * 1024**3:
            raise RuntimeError("The lab storage budget or SSD reserve is unavailable")


def download(url: str, path: Path, expected: str | None = None) -> None:
    """Resume an owned partial image and verify its published SHA-512."""
    if path.exists() or path.is_symlink():
        if expected and digest(path, "sha512") == expected:
            return
        raise RuntimeError("An existing download requires operator inspection")
    partial = path.with_name(path.name + ".part")
    if partial.is_symlink():
        raise RuntimeError("Linked partial download is refused")
    size = partial.stat().st_size if partial.exists() else 0
    headers = {"Range": f"bytes={size}-"} if size else {}
    with urlopen(Request(url, headers=headers), timeout=90) as response:
        append = size > 0 and response.status == 206
        if append and not response.headers.get("Content-Range", "").startswith(f"bytes {size}-"):
            raise RuntimeError("The download range does not match the partial file")
        with partial.open("ab" if append else "wb") as output:
            total = size if append else 0
            while block := response.read(1024 * 1024):
                total += len(block)
                if total > 1024**3:
                    raise RuntimeError("The cloud image exceeds its download limit")
                output.write(block)
            output.flush()
            os.fsync(output.fileno())
    if expected and digest(partial, "sha512") != expected:
        partial.unlink()
        raise RuntimeError("The cloud image checksum failed; retry the download")
    partial.replace(path)


def cloud_config(public_key: str) -> dict[str, Any]:
    """Build NoCloud data containing only a disposable public SSH key."""
    files = []
    for name in ("fixture.py", "setup.sh", "session.sh"):
        files.append({"path": "/opt/odk/" + name, "permissions": "0755", "owner": "root:root",
                      "encoding": "b64", "content": base64.b64encode((GUEST / name).read_bytes()).decode()})
    return {"hostname": "odk-xfce-fixture", "manage_etc_hosts": True,
            "users": [{"name": "bootstrap", "shell": "/bin/bash", "lock_passwd": True,
                       "sudo": ["ALL=(ALL) NOPASSWD:ALL"], "ssh_authorized_keys": [public_key]},
                      {"name": "desk", "shell": "/bin/bash", "lock_passwd": True, "groups": ["video", "input", "audio"]}],
            "disable_root": True, "ssh_pwauth": False, "package_update": False, "package_upgrade": False,
            "write_files": files, "runcmd": [["bash", "/opt/odk/setup.sh"]]}


def check_overlay(lab: Lab, image: Path) -> None:
    """Reject a partial or substituted disk before opening its backing chain."""
    overlay = lab.directory / "images/task.qcow2"
    if overlay.is_symlink() or not overlay.is_file():
        raise RuntimeError("A regular owned task disk is required")
    output = subprocess.check_output(["qemu-img", "info", "--output=json", str(overlay)], text=True)
    info = json.loads(output)
    backing = info.get("full-backing-filename") or info.get("backing-filename", "")
    if info.get("format") != "qcow2" or info.get("virtual-size") != 32 * 1024**3 or Path(backing).absolute() != image.absolute():
        raise RuntimeError("The existing task disk has an unexpected backing chain or capacity")


def prepare(lab: Lab) -> dict[str, Any]:
    """Download, verify, and prepare the guest without starting a VM."""
    for executable in ("qemu-img", "genisoimage", "ssh-keygen"):
        if not shutil.which(executable):
            raise RuntimeError(f"Required host dependency is missing: {executable}")
    with lab.lock():
        lab.storage()
        if lab.directory.exists() and any(lab.directory.iterdir()) and not lab.manifest_file.exists():
            names = {path.name for path in lab.directory.iterdir()}
            evidence = lab.directory / "storage-evidence.json"
            if not names.issubset({"lost+found", "storage-evidence.json"}) or not evidence.is_file() or json.loads(evidence.read_text()).get("owner") != MARKER:
                raise RuntimeError("Refusing an unknown existing VM directory")
        lab.directory.mkdir(parents=True, exist_ok=True)
        if lab.manifest_file.exists():
            manifest = lab.manifest()
        else:
            manifest = {"owner": MARKER, "directory": str(lab.directory), "instanceId": str(uuid.uuid4()),
                        "phase": "preparing", "image": IMAGE_NAME, "source": IMAGE_URL, "diskGiB": 32,
                        "cpus": 2, "memoryMiB": 4096, "viewport": {"width": 1280, "height": 800},
                        "scope": "Disposable local fixture. No production accounts or credentials."}
            write_json(lab.manifest_file, manifest)
        for name in ("downloads", "images", "seed", "logs", "tmp"):
            (lab.directory / name).mkdir(exist_ok=True)
        lab.budget(6 * 1024**3)
        if not lab.key.exists():
            if manifest.get("publicKeyHash"):
                raise RuntimeError("The temporary bootstrap key was lost; inspect the existing lab before rebuilding")
            command(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-C", "odk-disposable-bootstrap", "-f", str(lab.key)])
        if lab.key.is_symlink() or (lab.runtime / "bootstrap-key.pub").is_symlink():
            raise RuntimeError("Linked bootstrap keys are refused")
        os.chmod(lab.key, 0o600)
        public_key = lab.key.with_suffix(".pub").read_text().strip()
        public_hash = hashlib.sha256(public_key.encode()).hexdigest()
        if manifest.get("publicKeyHash", public_hash) != public_hash:
            raise RuntimeError("Bootstrap key identity changed")
        manifest["publicKeyHash"] = public_hash
        sums_file = lab.directory / "downloads/SHA512SUMS"
        if not sums_file.exists():
            download(IMAGE_URL + "SHA512SUMS", sums_file)
        entries = [line.split() for line in sums_file.read_text().splitlines()]
        expected = next((entry[0] for entry in entries if len(entry) == 2 and entry[1].lstrip("*") == IMAGE_NAME), None)
        if not expected or len(expected) != 128:
            raise RuntimeError("The official manifest has no matching ARM64 image")
        image = lab.directory / "images" / IMAGE_NAME
        download(IMAGE_URL + IMAGE_NAME, image, expected)
        manifest["sha512"] = expected
        code = next((path for path in (Path("/usr/share/AAVMF/AAVMF_CODE.fd"), Path("/usr/share/qemu-efi-aarch64/QEMU_EFI.fd")) if path.is_file()), None)
        variables = Path("/usr/share/AAVMF/AAVMF_VARS.fd")
        if code is None:
            raise RuntimeError("ARM64 firmware is not installed")
        manifest["firmwareCode"] = str(code)
        if variables.is_file() and not (lab.directory / "images/vars.fd").exists():
            shutil.copyfile(variables, lab.directory / "images/vars.fd")
        overlay = lab.directory / "images/task.qcow2"
        if not overlay.exists():
            command(["qemu-img", "create", "-f", "qcow2", "-F", "qcow2", "-b", str(image), str(overlay), "32G"])
        check_overlay(lab, image)
        if manifest["phase"] in ("preparing", "prepared"):
            user_data = lab.directory / "seed/user-data"
            user_data.write_text("#cloud-config\n" + json.dumps(cloud_config(public_key)), encoding="utf-8")
            (lab.directory / "seed/meta-data").write_text(json.dumps({"instance-id": manifest["instanceId"], "local-hostname": "odk-xfce-fixture"}))
            iso = lab.directory / "seed/seed.iso"
            if iso.exists():
                iso.unlink()
            command(["genisoimage", "-quiet", "-output", str(iso), "-volid", "cidata", "-joliet", "-rock", "user-data", "meta-data"], cwd=lab.directory / "seed")
            manifest["phase"] = "prepared"
        write_json(lab.manifest_file, manifest)
        return manifest


def qmp_call(lab: Lab, execute: str, arguments: dict[str, Any] | None = None) -> Any:
    """Authenticate the lab identity before a local QMP operation."""
    expected = "odk-xfce-" + lab.manifest()["instanceId"][:8]
    with socket.socket(socket.AF_UNIX) as connection:
        connection.settimeout(10)
        connection.connect(str(lab.qmp))
        with connection.makefile("rwb") as stream:
            json.loads(stream.readline())
            def call(name: str, parameters: dict[str, Any] | None = None) -> Any:
                stream.write(json.dumps({"execute": name, **({"arguments": parameters} if parameters else {})}).encode() + b"\r\n")
                stream.flush()
                while True:
                    response = json.loads(stream.readline())
                    if "return" in response:
                        return response["return"]
                    if "error" in response:
                        raise RuntimeError("The QMP operation failed")
            call("qmp_capabilities")
            if call("query-name").get("name") != expected:
                raise RuntimeError("QMP identity does not match the disposable lab")
            return call(execute, arguments)


def qemu_arguments(lab: Lab, bootstrap: bool) -> list[str]:
    """Build the explicit KVM, desktop, storage, and restricted network contract."""
    manifest = lab.manifest()
    if bootstrap and manifest["phase"] != "prepared":
        raise RuntimeError("Bootstrap networking requires a prepared unfinished guest")
    if not bootstrap and manifest["phase"] != "ready":
        raise RuntimeError("Complete bootstrap before restricted acceptance")
    image = lab.directory / "images" / manifest["image"]
    if digest(image, "sha512") != manifest["sha512"]:
        raise RuntimeError("The verified base image changed")
    args = ["qemu-system-aarch64", "-name", "odk-xfce-" + manifest["instanceId"][:8],
            "-machine", "virt,accel=kvm,gic-version=3,dump-guest-core=off", "-cpu", "host", "-smp", "2", "-m", "4096",
            "-nodefaults", "-display", "none", "-device", "virtio-gpu-pci,xres=1280,yres=800",
            "-device", "virtio-keyboard-pci,addr=0x2,multifunction=on", "-device", "virtio-tablet-pci,addr=0x2.1",
            "-vnc", "unix:" + str(lab.vnc), "-qmp", "unix:" + str(lab.qmp) + ",server=on,wait=off",
            "-drive", f"if=none,id=os,file={lab.directory}/images/task.qcow2,format=qcow2,cache=writethrough",
            "-device", "virtio-blk-pci,drive=os,bootindex=1",
            "-drive", f"if=none,id=seed,file={lab.directory}/seed/seed.iso,format=raw,readonly=on",
            "-device", "virtio-blk-pci,drive=seed",
            "-netdev", "user,id=net0,ipv6=off,restrict=" + ("off" if bootstrap else "on") + ",hostfwd=tcp:127.0.0.1:18022-:22,hostfwd=tcp:127.0.0.1:18081-:8081",
            "-device", "virtio-net-pci,netdev=net0,romfile=",
            "-serial", "file:" + str(lab.directory / "logs/guest-serial.log"), "-monitor", "none"]
    if (lab.directory / "images/vars.fd").exists():
        args.extend(["-drive", f"if=pflash,unit=0,format=raw,readonly=on,file={manifest['firmwareCode']}",
                     "-drive", f"if=pflash,unit=1,format=raw,file={lab.directory}/images/vars.fd"])
    else:
        args.extend(["-bios", manifest["firmwareCode"]])
    return args


def run(lab: Lab, bootstrap: bool) -> None:
    """Supervise one foreground QEMU process while retaining its VM lock."""
    if os.uname().machine not in ("aarch64", "arm64") or not os.access("/dev/kvm", os.R_OK | os.W_OK):
        raise RuntimeError("Accessible ARM64 KVM is required; no emulation fallback is permitted")
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    # RK3588 has heterogeneous clusters. Create and run KVM vCPUs on A76 cores.
    if not {4, 5, 6, 7}.issubset(os.sched_getaffinity(0)):
        raise RuntimeError("The CM5 A76 CPU affinity set is unavailable")
    os.sched_setaffinity(0, {4, 5, 6, 7})
    with lab.lock():
        lab.storage()
        lab.budget()
        if any(path.exists() or path.is_symlink() for path in (lab.qmp, lab.vnc, lab.runtime / "owner.json")):
            raise RuntimeError("Existing runtime endpoints require operator inspection")
        args = qemu_arguments(lab, bootstrap)
        check_overlay(lab, lab.directory / "images" / lab.manifest()["image"])
        serial = lab.directory / "logs/guest-serial.log"
        if serial.exists():
            serial.rename(serial.with_name(f"guest-serial-{time.time_ns()}.log"))
        token = str(uuid.uuid4())
        owner = {"pid": os.getpid(), "token": token, "mode": "bootstrap" if bootstrap else "restricted",
                 "cpuAffinity": sorted(os.sched_getaffinity(0)),
                 "qmpSocket": str(lab.qmp), "vncSocket": str(lab.vnc), "monitorUrl": "http://127.0.0.1:18081", "sshPort": 18022}
        write_json(lab.runtime / "owner.json", owner)
        process = None
        try:
            process = subprocess.Popen(args, cwd=lab.directory, env={**os.environ, "TMPDIR": str(lab.directory / "tmp")})
            while process.poll() is None:
                try:
                    lab.budget()
                except RuntimeError:
                    qmp_call(lab, "system_powerdown")
                    process.wait(timeout=60)
                    raise RuntimeError("The lab storage reserve was reached; guest poweroff was requested")
                time.sleep(1)
            if process.returncode != 0:
                raise RuntimeError("QEMU stopped with an error; inspect the SSD supervisor log")
        finally:
            # Never release ownership while a child QEMU can still write its disk.
            if process is not None and process.poll() is None:
                process.wait()
            for path in (lab.qmp, lab.vnc):
                if path.exists() and stat.S_ISSOCK(path.lstat().st_mode):
                    path.unlink()
            owner_file = lab.runtime / "owner.json"
            if owner_file.exists() and json.loads(owner_file.read_text()).get("token") == token:
                owner_file.unlink()


def start(lab: Lab, bootstrap: bool) -> dict[str, Any]:
    """Start the disposable supervisor and wait for its private QMP endpoint."""
    lab.manifest()
    arguments = [sys.executable, "-B", str(Path(__file__).resolve()), "run", "--directory", str(lab.directory), "--runtime-directory", str(lab.runtime)]
    if bootstrap:
        arguments.append("--bootstrap")
    with (lab.directory / "logs/supervisor.log").open("ab") as log:
        process = subprocess.Popen(arguments, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    for _ in range(100):
        if process.poll() is not None:
            raise RuntimeError("The VM supervisor failed; inspect its SSD log")
        owner_file = lab.runtime / "owner.json"
        if lab.qmp.exists() and owner_file.exists():
            owner = json.loads(owner_file.read_text())
            if owner.get("pid") == process.pid:
                qmp_call(lab, "query-status")
                return owner
        time.sleep(0.2)
    raise RuntimeError("The VM is not ready; inspect its supervisor before retrying")


def stop(lab: Lab) -> None:
    """Request guest poweroff without killing an unknown or unresponsive process."""
    qmp_call(lab, "system_powerdown")
    for _ in range(120):
        if not (lab.runtime / "owner.json").exists():
            return
        time.sleep(0.5)
    raise RuntimeError("Guest poweroff is unconfirmed; no force termination was attempted")


def finalize(lab: Lab) -> dict[str, Any]:
    """Check guest setup, stop bootstrap, and permit restricted-network boot."""
    owner = json.loads((lab.runtime / "owner.json").read_text())
    if owner.get("mode") != "bootstrap":
        raise RuntimeError("A bootstrap guest must be running")
    command(["ssh", "-i", str(lab.key), "-p", "18022", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new",
             "-o", "UserKnownHostsFile=" + str(lab.runtime / "known_hosts"), "-o", "ConnectTimeout=10",
             "bootstrap@127.0.0.1", "test -f /var/lib/odk/bootstrap-ready && systemctl is-active --quiet odk-fixture.service"])
    stop(lab)
    with lab.lock():
        manifest = lab.manifest()
        manifest["phase"] = "ready"
        write_json(lab.manifest_file, manifest)
    return manifest


def prepare_storage(directory: str) -> dict[str, Any]:
    """Create only the authorized new ext4 file and its new mount point."""
    if os.geteuid() != 0 or directory != DEFAULT_DIRECTORY + "/xfce-fixture-v1":
        raise RuntimeError("Storage preparation requires host root and the exact authorized lab path")
    target = Path(directory)
    container = target.with_suffix(".ext4")
    for path in (target, container, *target.parents):
        if path.is_symlink():
            raise RuntimeError("Linked storage paths are refused")
    if target.exists() or container.exists():
        raise RuntimeError("The storage target already exists; no existing file or mount will be changed")
    if not target.parent.is_dir() or shutil.disk_usage(target.parent).free < 26 * 1024**3:
        raise RuntimeError("The SSD parent or storage reserve is unavailable")
    for executable in ("mkfs.ext4", "mount", "findmnt", "losetup"):
        if not shutil.which(executable):
            raise RuntimeError("A native storage dependency is missing")
    descriptor = os.open(container, os.O_CREAT | os.O_EXCL | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        os.ftruncate(descriptor, 24 * 1024**3)
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    command(["mkfs.ext4", "-F", "-m", "0", "-L", "odk-xfce-lab", str(container)])
    target.mkdir(mode=0o700)
    command(["mount", "-o", "loop,nosuid,nodev,noexec,noatime", str(container), str(target)])
    account = pwd.getpwnam("orangepi")
    os.chown(target, account.pw_uid, account.pw_gid)
    os.chmod(target, 0o700)
    mounted = json.loads(subprocess.check_output(["findmnt", "--json", "--target", str(target), "--output", "TARGET,FSTYPE,OPTIONS,SOURCE"], text=True))
    loops = json.loads(subprocess.check_output(["losetup", "--json", "--associated", str(container), "--output", "NAME,BACK-FILE"], text=True))
    evidence = {"owner": MARKER, "container": str(container), "containerBytes": container.stat().st_size,
                "directory": str(target), "mount": mounted, "loop": loops,
                "persistentMountConfigured": False, "accountsAllowed": "Disposable fixture accounts only."}
    write_json(target / "storage-evidence.json", evidence)
    os.chown(target / "storage-evidence.json", account.pw_uid, account.pw_gid)
    return evidence


def main() -> None:
    """Run one explicit preparation or VM lifecycle operation."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("prepare-storage", "prepare", "start-bootstrap", "start", "run", "stop", "finalize", "status"))
    parser.add_argument("--directory", default=DEFAULT_DIRECTORY)
    parser.add_argument("--runtime-directory")
    parser.add_argument("--bootstrap", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    os.umask(0o077)
    if args.operation == "prepare-storage":
        print(json.dumps(prepare_storage(args.directory), indent=2))
        return
    if os.geteuid() == 0:
        raise RuntimeError("Run as the ordinary CM5 user, not host root")
    lab = Lab(args.directory, args.runtime_directory)
    if args.operation == "prepare":
        result = prepare(lab)
    elif args.operation in ("start", "start-bootstrap"):
        result = start(lab, args.operation == "start-bootstrap")
    elif args.operation == "run":
        run(lab, args.bootstrap)
        return
    elif args.operation == "stop":
        stop(lab)
        result = {"stopped": True}
    elif args.operation == "finalize":
        result = finalize(lab)
    else:
        result = {"manifest": lab.manifest(), "runtime": json.loads((lab.runtime / "owner.json").read_text()) if (lab.runtime / "owner.json").exists() else None}
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f"Guest lab operation failed: {error}", file=sys.stderr)
        raise SystemExit(1) from None
