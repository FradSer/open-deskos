"""Check provisioning contracts without network, QEMU, or host changes."""

from __future__ import annotations

import contextlib
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import provision


class ProvisionTests(unittest.TestCase):
    def test_public_configuration_is_readable_and_profile_is_ephemeral(self) -> None:
        directory = Path(__file__).parent
        setup = (directory / "setup.sh").read_text()
        self.assertIn("chmod 0644 /etc/chromium/policies/managed/odk.json", setup)
        self.assertIn("chmod 0644 /etc/X11/xorg.conf.d/20-odk-display.conf", setup)
        session = (directory / "session.sh").read_text()
        self.assertNotIn("/home/desk/.local/share/odk-fixture-chrome", session)
        self.assertIn('stat -f -c %T', session)
        self.assertIn('stat -c %u', session)
        self.assertIn('stat -c %a', session)
        self.assertIn('mktemp -d', session)
        self.assertNotIn("--no-sandbox", session)

    def test_cloud_data_contains_only_public_bootstrap_material(self) -> None:
        config = provision.cloud_config("ssh-ed25519 AAAA-disposable-public-key")
        bootstrap, desk = config["users"]
        self.assertEqual(bootstrap["name"], "bootstrap")
        self.assertEqual(bootstrap["ssh_authorized_keys"], ["ssh-ed25519 AAAA-disposable-public-key"])
        self.assertEqual(desk["name"], "desk")
        self.assertNotIn("sudo", desk)
        self.assertNotIn("ssh_authorized_keys", desk)
        self.assertFalse(config["ssh_pwauth"])
        self.assertFalse(config["package_upgrade"])
        self.assertTrue(all(item["path"].startswith("/opt/odk/") for item in config["write_files"]))

    def test_acceptance_uses_kvm_private_sockets_and_restricted_host_forwarding(self) -> None:
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "images").mkdir()
            image = directory / "images" / provision.IMAGE_NAME
            image.write_bytes(b"verified test image")
            manifest = {"phase": "ready", "image": image.name, "sha512": hashlib.sha512(image.read_bytes()).hexdigest(), "instanceId": "01234567-test", "firmwareCode": "/read-only-firmware.fd"}
            lab = SimpleNamespace(directory=directory, qmp=Path("/run/user/1000/lab/qmp.sock"), vnc=Path("/run/user/1000/lab/vnc.sock"), manifest=lambda: manifest)
            arguments = provision.qemu_arguments(lab, False)
            network = arguments[arguments.index("-netdev") + 1]
            self.assertIn("restrict=on", network)
            self.assertIn("hostfwd=tcp:127.0.0.1:18022-:22", network)
            self.assertIn("hostfwd=tcp:127.0.0.1:18081-:8081", network)
            self.assertNotIn("0.0.0.0", network)
            self.assertIn("accel=kvm", arguments[arguments.index("-machine") + 1])
            self.assertIn("gic-version=3", arguments[arguments.index("-machine") + 1])
            self.assertEqual(arguments[arguments.index("-m") + 1], "4096")
            self.assertEqual(arguments[arguments.index("-smp") + 1], "2")
            self.assertEqual(arguments[arguments.index("-vnc") + 1], "unix:/run/user/1000/lab/vnc.sock")
            self.assertNotIn("-snapshot", arguments)
            self.assertIn("virtio-keyboard-pci,addr=0x2,multifunction=on", arguments)
            self.assertIn("virtio-tablet-pci,addr=0x2.1", arguments)
            self.assertIn("virtio-blk-pci,drive=os,bootindex=1", arguments)
            self.assertNotIn("qemu-xhci", arguments)
            self.assertNotIn("usb-kbd", arguments)
            self.assertNotIn("usb-tablet", arguments)
            self.assertIn("virtio-net-pci,netdev=net0,romfile=", arguments)
            self.assertFalse(any("locking=off" in value for value in arguments))
            with self.assertRaises(RuntimeError):
                provision.qemu_arguments(lab, True)

    def test_base_image_modification_fails_before_launch(self) -> None:
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "images").mkdir()
            (directory / "images" / provision.IMAGE_NAME).write_bytes(b"changed")
            lab = SimpleNamespace(directory=directory, manifest=lambda: {"phase": "ready", "image": provision.IMAGE_NAME, "sha512": "0" * 128})
            with self.assertRaisesRegex(RuntimeError, "base image changed"):
                provision.qemu_arguments(lab, False)

    def test_prepare_refuses_unknown_existing_files(self) -> None:
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "preserve.txt").write_text("another task")
            lab = SimpleNamespace(directory=directory, manifest_file=directory / "lab.json", lock=contextlib.nullcontext, storage=lambda: {})
            with patch.object(provision.shutil, "which", return_value="/fixed/tool"):
                with self.assertRaisesRegex(RuntimeError, "unknown existing"):
                    provision.prepare(lab)
            self.assertEqual((directory / "preserve.txt").read_text(), "another task")
            self.assertEqual(len(list(directory.iterdir())), 1)

    def test_existing_wrong_download_is_not_replaced(self) -> None:
        with TemporaryDirectory() as temporary:
            image = Path(temporary) / "image.qcow2"
            image.write_bytes(b"preserve")
            with self.assertRaisesRegex(RuntimeError, "operator inspection"):
                provision.download("https://cloud.debian.org/unused", image, "0" * 128)
            self.assertEqual(image.read_bytes(), b"preserve")

    def test_overlay_backing_chain_and_capacity_must_match_owned_base(self) -> None:
        with TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / "images").mkdir()
            (directory / "images/task.qcow2").write_bytes(b"header")
            image = directory / "images" / provision.IMAGE_NAME
            lab = SimpleNamespace(directory=directory)
            info = {"format": "qcow2", "virtual-size": 32 * 1024**3, "full-backing-filename": str(image)}
            with patch.object(provision.subprocess, "check_output", return_value=json.dumps(info)):
                provision.check_overlay(lab, image)
            info["full-backing-filename"] = "/unrelated/production.qcow2"
            with patch.object(provision.subprocess, "check_output", return_value=json.dumps(info)):
                with self.assertRaisesRegex(RuntimeError, "unexpected backing"):
                    provision.check_overlay(lab, image)

    def test_storage_requires_exact_native_container_and_isolation_flags(self) -> None:
        lab = SimpleNamespace(directory=Path(provision.DEFAULT_DIRECTORY) / "xfce-fixture-v1")
        mounted = {"target": str(lab.directory), "fstype": "ext4", "options": "rw,nosuid,nodev,noexec,noatime", "source": "/dev/loop0"}
        with patch.object(provision.subprocess, "check_output", return_value=json.dumps({"filesystems": [mounted]})):
            self.assertEqual(provision.Lab.storage(lab)["fstype"], "ext4")
        for changed in ({"fstype": "exfat"}, {"target": "/mnt/ssd"}, {"options": "rw,nosuid,nodev,noexec"}):
            with patch.object(provision.subprocess, "check_output", return_value=json.dumps({"filesystems": [{**mounted, **changed}]})):
                with self.assertRaisesRegex(RuntimeError, "not mounted"):
                    provision.Lab.storage(lab)


if __name__ == "__main__":
    unittest.main()
