"""Private-header preparation uses fabricated keys and temporary files only."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
import prepare_firmware_config as tool
import prepare_pairing as shared


class FirmwareConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.patch = patch.object(tool, "FIRMWARE_ROOT", self.root)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        (self.root / ".gitignore").write_text(".pio/\n.local/\n")
        self.config = {"schemaVersion": 1, "gatewayMac": "02:00:00:00:00:01", "channel": 1,
                       "pmk": "a" * 32, "lmk": "b" * 32}
        self.input = self.root / "hydra-desk.json"
        self.output = self.root / ".local"
        self.write()

    def write(self):
        self.input.write_text(json.dumps(self.config))
        self.input.chmod(0o600)

    def test_header_matches_firmware_arrays_and_receipt_verifies_readback(self):
        original = self.input.read_bytes()
        receipt = tool.prepare_firmware_config(self.input, self.output)
        self.assertEqual({p.name for p in self.output.iterdir()}, {"hydra_host_config.h", "receipt.json"})
        header = (self.output / "hydra_host_config.h").read_bytes()
        self.assertIn(b"namespace hydra_private_host", header)
        self.assertIn(b"constexpr uint8_t gateway[6] = {0x02, 0x00, 0x00, 0x00, 0x00, 0x01};", header)
        self.assertIn(b"constexpr uint8_t pmk[16] = {" + b", ".join([b"0xaa"] * 16) + b"};", header)
        self.assertIn(b"constexpr uint8_t lmk[16] = {" + b", ".join([b"0xbb"] * 16) + b"};", header)
        self.assertIn(b"constexpr uint8_t channel = 1;", header)
        self.assertIn(b"constexpr uint8_t schema = 1;", header)
        self.assertEqual(receipt["headerSha256"], hashlib.sha256(header).hexdigest())
        self.assertEqual(receipt, json.loads((self.output / "receipt.json").read_text()))
        self.assertTrue(receipt["privateBuild"])
        self.assertTrue(receipt["readbackVerified"])
        self.assertEqual(receipt["profile"], "main-node-private")
        self.assertFalse(receipt["deploymentExecuted"])
        self.assertEqual(self.input.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        for p in self.output.iterdir():
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)

    def test_only_new_ignored_firmware_local_directory_is_accepted(self):
        with self.assertRaises(ValueError):
            tool.prepare_firmware_config(self.input, self.root / "other")
        (self.root / ".gitignore").write_text(".pio/\n")
        with self.assertRaises(ValueError):
            tool.prepare_firmware_config(self.input, self.output)
        (self.root / ".gitignore").write_text(".local/\n!.local/hydra_host_config.h\n")
        with self.assertRaises(ValueError):
            tool.prepare_firmware_config(self.input, self.output)
        (self.root / ".gitignore").write_text(".local/\n")
        tool.prepare_firmware_config(self.input, self.output)
        original = (self.output / "hydra_host_config.h").read_bytes()
        with self.assertRaises(ValueError):
            tool.prepare_firmware_config(self.input, self.output)
        self.assertEqual((self.output / "hydra_host_config.h").read_bytes(), original)

    def test_unknown_shape_unsafe_keys_or_invalid_schema_are_refused(self):
        for config in [{**self.config, "schemaVersion": True}, {**self.config, "schemaVersion": 2},
                       {**self.config, "channel": True}, {**self.config, "channel": 0},
                       {**self.config, "gatewayMac": "ff:ff:ff:ff:ff:ff"},
                       {**self.config, "pmk": '";system("bad")'},
                       {**self.config, "lmk": "b" * 30}, {**self.config, "python": "/tmp/other"}]:
            with self.subTest(config=config), self.assertRaises(ValueError):
                tool.firmware_header(config)
        self.assertFalse(self.output.exists())

    def test_private_input_links_and_writable_parent_are_rejected(self):
        self.input.chmod(0o644)
        with self.assertRaises(ValueError):
            tool.prepare_firmware_config(self.input, self.output)
        self.input.chmod(0o600)
        link = self.root / "linked.json"
        link.symlink_to(self.input)
        with self.assertRaises(ValueError):
            tool.prepare_firmware_config(link, self.output)
        self.root.chmod(0o777)
        try:
            with self.assertRaises(ValueError):
                tool.prepare_firmware_config(self.input, self.output)
        finally:
            self.root.chmod(0o700)
        self.assertFalse(self.output.exists())

    def test_readback_failure_cleans_owned_private_header(self):
        with patch.object(shared.os, "pread", return_value=b"corrupted"), self.assertRaises(ValueError):
            tool.prepare_firmware_config(self.input, self.output)
        self.assertFalse(self.output.exists())

    def test_receipt_write_failure_does_not_leave_half_a_private_build_input(self):
        original = shared.write_private
        def failure(fd, name, value, created):
            if name == "receipt.json":
                raise OSError("simulated receipt failure")
            return original(fd, name, value, created)
        with patch.object(shared, "write_private", side_effect=failure), self.assertRaises(OSError):
            tool.prepare_firmware_config(self.input, self.output)
        self.assertFalse(self.output.exists())

    def test_cli_receipt_is_non_sensitive_and_errors_are_sanitized(self):
        out = io.StringIO()
        args = ["--desk-config", str(self.input), "--output", str(self.output)]
        with contextlib.redirect_stdout(out):
            self.assertEqual(tool.main(args), 0)
            self.assertEqual(tool.main(args), 1)
        for private in ["a" * 32, "b" * 32, "0xaa", str(self.input), "Traceback"]:
            self.assertNotIn(private, out.getvalue())


if __name__ == "__main__":
    unittest.main()
