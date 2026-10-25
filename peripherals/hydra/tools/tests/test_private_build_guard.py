"""Pre-build checks use empty synthetic directories and fabricated header bytes."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("private_build_guard", Path(__file__).parents[1] / "private_build_guard.py")
guard = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(guard)


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.local = self.root / ".local"
        self.build = self.local / "build"
        self.environment_build = self.build / "main-node-private"
        for path in [self.local, self.build, self.environment_build]:
            path.mkdir(mode=0o700)
        self.header = self.local / "hydra_host_config.h"
        self.header.write_text("// Fabricated test input. No key is loaded.\n")
        self.header.chmod(0o600)

    def validate(self, **kwargs):
        guard.validate_private_build(self.root, kwargs.get("project_build", self.build),
                                     kwargs.get("build", self.environment_build),
                                     kwargs.get("cache", ""), kwargs.get("explicit", str(self.build)))

    def test_protected_layout_is_accepted_without_reading_header(self):
        with patch.object(Path, "read_bytes", side_effect=AssertionError("must not read keys")):
            self.validate()

    def test_default_public_build_external_build_missing_explicit_and_caches_refused(self):
        for options in [{"project_build": self.root / ".pio/build"}, {"build": self.root / "outside"},
                        {"explicit": None}, {"explicit": str(self.build) + "/"},
                        {"cache": str(self.root / "public-cache")}, {"cache": str(self.local / "cache")}]:
            with self.subTest(options=options), self.assertRaises(RuntimeError):
                self.validate(**options)

    def test_private_root_build_and_header_permissions_fail_closed(self):
        for path, wrong, correct in [(self.local, 0o755, 0o700), (self.build, 0o755, 0o700),
                                     (self.environment_build, 0o755, 0o700), (self.header, 0o644, 0o600)]:
            path.chmod(wrong)
            try:
                with self.subTest(path=path), self.assertRaises(RuntimeError):
                    self.validate()
            finally:
                path.chmod(correct)
        with patch.object(guard.os, "getuid", return_value=os.getuid() + 1), self.assertRaises(RuntimeError):
            self.validate()

    def test_links_and_unsafe_existing_build_products_are_refused(self):
        product = self.environment_build / "firmware.elf"
        outside = self.root / "public-object"
        outside.write_text("fabricated")
        product.symlink_to(outside)
        with self.assertRaises(RuntimeError):
            self.validate()
        product.unlink()
        product.write_text("fabricated")
        product.chmod(0o644)
        with self.assertRaises(RuntimeError):
            self.validate()
        product.chmod(0o600)
        self.validate()
        original = self.local / "saved-header"
        self.header.rename(original)
        self.header.symlink_to(original)
        with self.assertRaises(RuntimeError):
            self.validate()

    def test_scons_adapter_uses_effective_paths_and_private_creation_mask(self):
        values = {"$PIOENV": "main-node-private", "$PROJECT_DIR": str(self.root),
                  "$PROJECT_BUILD_DIR": str(self.build), "$BUILD_DIR": str(self.environment_build),
                  "$BUILD_CACHE_DIR": ""}
        class Environment(dict):
            def subst(self, name):
                return values[name]
        env = Environment(ENV={})
        with patch.dict(os.environ, {"PLATFORMIO_BUILD_DIR": str(self.build)}), patch.object(guard.os, "umask") as mask:
            guard.enforce_private_build(env)
            mask.assert_called_once_with(0o077)
            self.assertEqual(env["ENV"]["CCACHE_DISABLE"], "1")
            self.assertEqual(os.environ["CCACHE_DISABLE"], "1")
        values["$BUILD_CACHE_DIR"] = str(self.root / "cache")
        with patch.dict(os.environ, {"PLATFORMIO_BUILD_DIR": str(self.build)}), patch.object(guard.os, "umask") as mask:
            with self.assertRaises(RuntimeError):
                guard.enforce_private_build(env)
            mask.assert_not_called()


if __name__ == "__main__":
    unittest.main()
