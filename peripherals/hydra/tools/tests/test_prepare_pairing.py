"""Offline checks use fabricated keys and temporary files only."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("prepare_pairing", Path(__file__).parents[1] / "prepare_pairing.py")
tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tool)
GATEWAY = "9c:cc:01:34:31:50"
HYDRA = "02:00:00:00:00:02"
S3_MAC = "f0:9e:9e:11:23:cc"


class PairingTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.input = self.root / "gateway.json"
        self.output = self.root / "review"
        self.config = {"python": "/usr/bin/python3", "serialNumber": "9C:CC:01:34:31:50", "channel": 1,
                       "pmk": "a" * 32, "peers": [{"mac": S3_MAC.upper(), "lmk": "b" * 32}]}
        self.write()

    def write(self):
        self.input.write_text(json.dumps(self.config))
        self.input.chmod(0o600)

    def prepare(self, **kwargs):
        tool.prepare_pairing(kwargs.get("input", self.input), kwargs.get("gateway", GATEWAY),
                             kwargs.get("hydra", HYDRA), kwargs.get("output", self.output))

    def test_preserves_s3_fields_and_creates_only_private_review_files(self):
        original = self.input.read_bytes()
        with patch.object(tool.secrets, "token_hex", return_value="c" * 32):
            self.prepare()
        self.assertEqual(self.input.read_bytes(), original)
        self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o700)
        self.assertEqual({p.name for p in self.output.iterdir()}, {"gateway.next.json", "hydra-desk.json"})
        for p in self.output.iterdir():
            self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
        gateway = json.loads((self.output / "gateway.next.json").read_text())
        self.assertEqual(gateway, {**self.config, "remoteMac": S3_MAC,
                                  "peers": [*self.config["peers"], {"mac": HYDRA, "lmk": "c" * 32}]})
        self.assertEqual(json.loads((self.output / "hydra-desk.json").read_text()),
                         {"schemaVersion": 1, "gatewayMac": GATEWAY, "channel": 1, "pmk": "a" * 32, "lmk": "c" * 32})

    def test_fresh_lmk_and_existing_multi_peer_remote_are_preserved(self):
        self.config["remoteMac"] = S3_MAC.upper()
        self.config.pop("channel")
        self.config["peers"].append({"mac": "02:00:00:00:00:03", "lmk": "d" * 32})
        self.write()
        self.prepare()
        first = json.loads((self.output / "hydra-desk.json").read_text())
        self.prepare(output=self.root / "review2")
        second = json.loads((self.root / "review2/hydra-desk.json").read_text())
        self.assertRegex(first["lmk"], r"^[a-f0-9]{32}$")
        self.assertNotEqual(first["lmk"], second["lmk"])
        result = json.loads((self.output / "gateway.next.json").read_text())
        self.assertEqual(result["remoteMac"], self.config["remoteMac"])
        self.assertNotIn("channel", result)
        self.assertEqual(result["peers"][:-1], self.config["peers"])

    def test_colliding_or_invalid_station_addresses_are_rejected(self):
        for gateway, hydra in [(GATEWAY, GATEWAY), (GATEWAY, S3_MAC), (S3_MAC, HYDRA),
                               (GATEWAY, "ff:ff:ff:ff:ff:ff"), (GATEWAY, "00:00:00:00:00:00"),
                               (GATEWAY, "01:00:00:00:00:02"), ("ttyACM1", HYDRA)]:
            with self.subTest(gateway=gateway, hydra=hydra), self.assertRaises(ValueError):
                self.prepare(gateway=gateway, hydra=hydra)
            self.assertFalse(self.output.exists())

    def test_unknown_invalid_or_ambiguous_configurations_fail_closed(self):
        invalid = [{**self.config, "unknown": 1}, {**self.config, "channel": True},
                   {**self.config, "channel": 12}, {**self.config, "pmk": "short"},
                   {**self.config, "python": "python"}, {**self.config, "serialNumber": "bad value"},
                   {**self.config, "remoteMac": HYDRA}, {**self.config, "peers": []},
                   {**self.config, "peers": [*self.config["peers"], *self.config["peers"]]},
                   {**self.config, "peers": [{"mac": S3_MAC, "lmk": "b" * 32, "encrypt": True}]},
                   {**self.config, "peers": [*self.config["peers"], {"mac": HYDRA, "lmk": "b" * 32}]}]
        for config in invalid:
            self.config = config
            self.write()
            with self.subTest(config=config), self.assertRaises(ValueError):
                self.prepare()
            self.assertFalse(self.output.exists())

    def test_full_peer_list_is_rejected(self):
        self.config["remoteMac"] = S3_MAC
        self.config["peers"] += [{"mac": f"02:00:00:00:01:{n:02x}", "lmk": "d" * 32} for n in range(6)]
        self.write()
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_public_other_owner_duplicate_json_and_large_input_are_rejected(self):
        self.input.chmod(0o644)
        with self.assertRaises(ValueError):
            self.prepare()
        self.input.chmod(0o600)
        with patch.object(tool.os, "getuid", return_value=os.getuid() + 1), self.assertRaises(ValueError):
            self.prepare()
        for data in ['{"python":"/usr/bin/python3","python":"/tmp/other"}', "x" * 16385]:
            self.input.write_text(data)
            with self.assertRaises((ValueError, json.JSONDecodeError)):
                self.prepare()
        self.assertFalse(self.output.exists())

    def test_links_relative_paths_and_output_overwrite_are_rejected(self):
        link = self.root / "input-link"
        link.symlink_to(self.input)
        parent_link = self.root / "linked-parent"
        parent_link.symlink_to(self.root, target_is_directory=True)
        for request in [{"input": link}, {"input": Path("gateway.json")}, {"output": parent_link / "review"}]:
            with self.subTest(request=request), self.assertRaises(ValueError):
                self.prepare(**request)
        self.output.symlink_to(self.root / "absent", target_is_directory=True)
        with self.assertRaises(ValueError):
            self.prepare()
        self.output.unlink()
        self.output.mkdir()
        sentinel = self.output / "keep"
        sentinel.write_text("preserved")
        with self.assertRaises(ValueError):
            self.prepare()
        self.assertEqual(sentinel.read_text(), "preserved")

    def test_partial_write_failure_removes_only_created_outputs(self):
        original = self.input.read_bytes()
        write = tool.write_private
        def failure(fd, name, value, created):
            write(fd, name, value, created)
            if name == "hydra-desk.json":
                raise OSError("simulated write failure")
        with patch.object(tool, "write_private", side_effect=failure), self.assertRaises(OSError):
            self.prepare()
        self.assertFalse(self.output.exists())
        self.assertEqual(self.input.read_bytes(), original)

    def test_output_open_failure_removes_new_empty_directory(self):
        original_open = tool.os.open
        def opening(path, flags, *args, **kwargs):
            if path == self.output:
                raise OSError("simulated directory open failure")
            return original_open(path, flags, *args, **kwargs)
        with patch.object(tool.os, "open", side_effect=opening), self.assertRaises(OSError):
            self.prepare()
        self.assertFalse(self.output.exists())

    def test_raced_directory_identity_cannot_delete_another_directorys_files(self):
        foreign = self.root / "other-review"
        foreign.mkdir()
        for name in ("gateway.next.json", "hydra-desk.json"):
            (foreign / name).write_text("preserved")
        original_open = tool.os.open
        def opening(path, flags, *args, **kwargs):
            return original_open(foreign if path == self.output else path, flags, *args, **kwargs)
        with patch.object(tool.os, "open", side_effect=opening), self.assertRaises(ValueError):
            self.prepare()
        for name in ("gateway.next.json", "hydra-desk.json"):
            self.assertEqual((foreign / name).read_text(), "preserved")

    def test_other_remote_identity_is_preserved_without_a_fixed_device_mac(self):
        other = "02:11:22:33:44:55"
        self.config["peers"][0]["mac"] = other
        self.write()
        self.prepare()
        self.assertEqual(json.loads((self.output / "gateway.next.json").read_text())["remoteMac"], other)
        self.config["remoteMac"] = other.upper()
        self.config["peers"].append({"mac": "02:11:22:33:44:56", "lmk": "d" * 32})
        self.write()
        second = self.root / "explicit-remote"
        self.prepare(output=second)
        self.assertEqual(json.loads((second / "gateway.next.json").read_text())["remoteMac"], other.upper())

    def test_cleanup_preserves_a_foreign_file_that_blocks_exclusive_creation(self):
        original = tool.write_private
        def collide(fd, name, value, created):
            (self.output / name).write_text("foreign file")
            return original(fd, name, value, created)
        with patch.object(tool, "write_private", side_effect=collide), self.assertRaises(FileExistsError):
            self.prepare()
        self.assertEqual((self.output / "gateway.next.json").read_text(), "foreign file")

    def test_cleanup_preserves_a_foreign_replacement_of_an_owned_output(self):
        original = tool.write_private
        def replace(fd, name, value, created):
            if name == "hydra-desk.json":
                replacement = self.output / "replacement"
                replacement.write_text("foreign replacement")
                replacement.replace(self.output / "gateway.next.json")
                raise OSError("simulated later failure")
            return original(fd, name, value, created)
        with patch.object(tool, "write_private", side_effect=replace), self.assertRaises(OSError):
            self.prepare()
        self.assertEqual((self.output / "gateway.next.json").read_text(), "foreign replacement")

    def test_cli_emits_no_keys_or_private_error_details(self):
        out = io.StringIO()
        args = ["--gateway-config", str(self.input), "--gateway-mac", GATEWAY, "--hydra-mac", HYDRA, "--output", str(self.output)]
        with contextlib.redirect_stdout(out):
            self.assertEqual(tool.main(args), 0)
            self.assertEqual(tool.main(args), 1)
        self.assertNotIn("a" * 32, out.getvalue())
        self.assertNotIn(str(self.input), out.getvalue())
        self.assertNotIn("Traceback", out.getvalue())
        err = io.StringIO()
        with contextlib.redirect_stderr(err), self.assertRaises(SystemExit):
            tool.main(["--secret-key=private-value"])
        self.assertNotIn("private-value", err.getvalue())


if __name__ == "__main__":
    unittest.main()
