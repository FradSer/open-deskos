"""Exercise unit ownership and lifecycle with a disposable fake systemctl."""

from pathlib import Path
import subprocess
import tempfile
import unittest

from odk_service_runtime.systemd_controller import SystemdController, SystemdControllerError


class FakeSystemd:
    def __init__(self) -> None:
        self.calls = []
        self.fragment = ""
        self.active = "inactive"
        self.fail = None
        self.load = None
        self.link_directory = None
        self.disable_forgets_fragment = False

    def __call__(self, argv: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        self.calls.append(argv)
        command = argv[2]
        if command == self.fail:
            raise subprocess.TimeoutExpired(argv, 30, output="private-token", stderr="private-token")
        output = ""
        if command == "show":
            output = f"FragmentPath={self.fragment}\nLoadState={self.load or ('loaded' if self.fragment else 'not-found')}\nActiveState={self.active}\n"
            if '--property=MainPID' in argv: output += f"MainPID={123 if self.active == 'active' else 0}\n"
        elif command == "link":
            self.fragment = argv[3]
            if self.link_directory:
                alias = self.link_directory / Path(argv[3]).name
                alias.symlink_to(argv[3])
                self.fragment = str(alias)
        elif command == "enable":
            self.active = "active"
        elif command == "stop":
            self.active = "inactive"
        elif command == "disable" and self.fragment and Path(self.fragment).is_symlink():
            Path(self.fragment).unlink()
            if self.disable_forgets_fragment:
                self.fragment = ""
                self.load = None
        elif command == "daemon-reload" and self.fragment and not Path(self.fragment).exists():
            self.fragment = ""
            self.load = None
        return subprocess.CompletedProcess(argv, 0, output, "")


class SystemdControllerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="odk-systemd-% space-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.fake = FakeSystemd()
        self.launcher = self.root / "manager % script.py"
        self.controller = SystemdController(self.root, runner=self.fake, launcher=self.launcher, platform="linux")
        self.manifest = {"runtime": {"kind": "python"}, "stopTimeoutSeconds": 12}
        self.revision = "a" * 64

    def start(self) -> dict:
        return self.controller.start("report-poller", self.revision, self.manifest, {"secret": "must-not-enter-unit"}, self.root / "data")

    def test_linked_fragment_is_accepted_and_replacement_is_refused(self) -> None:
        alias_directory = self.root / "user-units"
        alias_directory.mkdir(mode=0o700)
        self.fake.link_directory = alias_directory
        handle = self.start()
        alias = Path(self.fake.fragment)
        self.assertTrue(alias.is_symlink())
        self.assertEqual(self.controller.status(handle), {"state": "running"})
        target = alias.resolve()
        alias.unlink()
        unrelated = self.root / "unrelated.service"
        unrelated.write_text(target.read_text())
        alias.symlink_to(unrelated)
        self.fake.calls.clear()
        with self.assertRaises(SystemdControllerError): self.controller.remove(handle)
        self.assertTrue(all(call[2] == "show" for call in self.fake.calls))
        alias.unlink(); alias.symlink_to(target)
        self.controller.remove(handle)
        self.assertFalse(target.exists())

    def test_inactive_owned_bad_setting_unit_can_be_cleaned(self) -> None:
        handle = self.start()
        unit = Path(self.fake.fragment)
        self.fake.load = "bad-setting"
        self.fake.active = "inactive"
        self.controller.remove(handle)
        self.assertFalse(unit.exists())
        self.assertIn("disable", [call[2] for call in self.fake.calls])

    def test_inactive_bad_setting_with_process_retains_ownership(self) -> None:
        handle = self.start()
        self.fake.load = "bad-setting"
        self.fake.active = "inactive"
        original = self.controller.runner
        def runner(argv: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            result = original(argv, **kwargs)
            return subprocess.CompletedProcess(argv, result.returncode, result.stdout.replace("MainPID=0", "MainPID=12"), result.stderr)
        self.controller.runner = runner
        self.fake.calls.clear()
        with self.assertRaises(SystemdControllerError): self.controller.remove(handle)
        self.assertTrue(all(call[2] == "show" for call in self.fake.calls))

    def test_group_writable_installed_link_parent_is_refused(self) -> None:
        alias_directory = self.root / "user-units"
        alias_directory.mkdir(mode=0o700)
        self.fake.link_directory = alias_directory
        handle = self.start()
        alias_directory.chmod(0o777)
        self.fake.calls.clear()
        with self.assertRaises(SystemdControllerError): self.controller.remove(handle)
        self.assertTrue(all(call[2] == "show" for call in self.fake.calls))

    def test_disable_can_immediately_forget_the_owned_fragment(self) -> None:
        alias_directory = self.root / "user-units"
        alias_directory.mkdir(mode=0o700)
        self.fake.link_directory = alias_directory
        handle = self.start()
        target = Path(self.fake.fragment).resolve()
        self.fake.disable_forgets_fragment = True
        self.controller.remove(handle)
        self.assertFalse(target.exists())
        self.assertEqual(self.fake.fragment, "")

    def test_disable_replacement_or_active_unit_preserves_source(self) -> None:
        for replacement in ["unrelated", "active", "process"]:
            with self.subTest(replacement=replacement):
                handle = self.start()
                target = Path(self.fake.fragment)
                original = self.controller.runner
                def runner(argv: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                    result = original(argv, **kwargs)
                    if argv[2] == "disable":
                        if replacement == "unrelated": self.fake.fragment = "/unrelated/unit.service"
                        elif replacement == "active": self.fake.active = "active"
                    if argv[2] == "show" and replacement == "process" and any(call[2] == "disable" for call in self.fake.calls):
                        return subprocess.CompletedProcess(argv, 0, result.stdout.replace("MainPID=0", "MainPID=12"), "")
                    return result
                self.controller.runner = runner
                self.fake.calls.clear()
                with self.assertRaises(SystemdControllerError): self.controller.remove(handle)
                self.assertTrue(target.exists())
                self.controller.runner = original
                self.fake.fragment = str(target)
                self.fake.active = "inactive"
                self.fake.calls.clear()
                self.controller.remove(handle)

    def test_linked_bad_setting_unit_is_cleaned(self) -> None:
        alias_directory = self.root / "user-units"
        alias_directory.mkdir(mode=0o700)
        self.fake.link_directory = alias_directory
        handle = self.start()
        alias = Path(self.fake.fragment)
        target = alias.resolve()
        self.fake.load = "bad-setting"
        self.fake.active = "inactive"
        self.controller.remove(handle)
        self.assertFalse(alias.is_symlink())
        self.assertFalse(target.exists())

    def test_active_bad_setting_unit_cannot_be_cleaned(self) -> None:
        handle = self.start()
        self.fake.load = "bad-setting"
        self.fake.calls.clear()
        with self.assertRaises(SystemdControllerError): self.controller.remove(handle)
        self.assertTrue(all(call[2] == "show" for call in self.fake.calls))

    def test_unit_omits_unnecessary_working_directory(self) -> None:
        self.start()
        self.assertNotIn("WorkingDirectory=", Path(self.fake.fragment).read_text())

    def test_unit_escapes_arguments_and_has_no_secrets_or_shell(self) -> None:
        handle = self.start()
        text = Path(self.fake.fragment).read_text(encoding="utf-8")
        self.assertIn('manager %% script.py"', text)
        self.assertIn('"--state-dir"', text)
        self.assertIn('"--revision" "' + self.revision + '"', text)
        self.assertNotIn("must-not-enter-unit", text)
        self.assertNotIn("/bin/sh", text)
        for setting in ["UMask=0077", "NoNewPrivileges=true", "KillMode=control-group", "TimeoutStopSec=17", "Restart=on-failure", "StartLimitBurst=3"]:
            self.assertIn(setting, text)
        self.assertEqual(Path(self.fake.fragment).stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.controller.status(handle), {"state": "running"})

    def test_unrelated_fragment_blocks_every_mutation(self) -> None:
        handle = self.start()
        self.fake.fragment = "/unrelated/user/unit.service"
        self.fake.calls.clear()
        for operation in [self.start, lambda: self.controller.stop(handle), lambda: self.controller.remove(handle)]:
            with self.subTest(operation=operation), self.assertRaises(SystemdControllerError):
                operation()
        self.assertTrue(all(call[2] == "show" for call in self.fake.calls))

    def test_remove_stops_disables_and_only_deletes_managed_unit(self) -> None:
        handle = self.start()
        unit_file = Path(self.fake.fragment)
        unrelated = unit_file.parent / "keep.service"
        unrelated.write_text("unrelated", encoding="utf-8")
        self.fake.calls.clear()
        self.controller.remove(handle)
        operations = [call[2] for call in self.fake.calls]
        self.assertLess(operations.index("stop"), operations.index("disable"))
        self.assertEqual(operations[-1], "daemon-reload")
        self.assertFalse(unit_file.exists())
        self.assertTrue(unrelated.exists())

    def test_stale_revision_handle_cannot_stop_replacement(self) -> None:
        handle = self.start()
        unit = Path(self.fake.fragment)
        unit.write_text(unit.read_text(encoding="utf-8").replace(self.revision, "b" * 64), encoding="utf-8")
        self.fake.calls.clear()
        with self.assertRaises(SystemdControllerError):
            self.controller.stop(handle)
        self.assertFalse(any(call[2] == "stop" for call in self.fake.calls))

    def test_start_failure_preserves_recovery_handle_and_sanitizes_errors(self) -> None:
        self.fake.fail = "enable"
        with self.assertRaises(SystemdControllerError) as result:
            self.start()
        self.assertNotIn("private-token", str(result.exception))
        self.assertEqual(result.exception.handle["revision"], self.revision)
        self.assertTrue(Path(self.fake.fragment).is_file())

    def test_invalid_identity_and_newline_paths_are_rejected(self) -> None:
        for identity in ["bad\nExecStart=evil", "../evil", "bad..service", "bad%name"]:
            with self.subTest(identity=identity), self.assertRaises(SystemdControllerError):
                self.controller.start(identity, self.revision, self.manifest, {}, self.root)
        with self.assertRaises(SystemdControllerError):
            SystemdController(self.root, runner=self.fake, launcher=self.root / "bad\npath", platform="linux")
        self.assertEqual(self.fake.calls, [])

    def test_dotted_identity_matches_the_package_contract(self) -> None:
        handle = self.controller.start("odk.futu", self.revision, self.manifest, {}, self.root)
        self.assertTrue(handle["unit"].endswith("-odk.futu.service"))

    def test_non_linux_platform_refuses_service_operations(self) -> None:
        controller = SystemdController(self.root, runner=self.fake, platform="darwin")
        with self.assertRaisesRegex(SystemdControllerError, "Unsupported platform"):
            controller.start("report-poller", self.revision, self.manifest, {}, self.root)
        self.assertEqual(self.fake.calls, [])

    def test_unknown_service_manager_state_is_never_treated_as_an_unused_name(self) -> None:
        def runner(argv: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            self.assertEqual(argv[2], "show")
            return subprocess.CompletedProcess(argv, 1, "", "private-token")
        controller = SystemdController(self.root, runner=runner, platform="linux")
        with self.assertRaises(SystemdControllerError) as error:
            controller.start("report-poller", self.revision, self.manifest, {}, self.root)
        self.assertNotIn("private-token", str(error.exception))
        self.assertFalse((self.root / "units").exists())

    def test_running_state_after_stop_blocks_unit_removal(self) -> None:
        handle = self.start()
        original_runner = self.controller.runner
        def runner(argv: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            result = original_runner(argv, **kwargs)
            if argv[2] == "stop":
                self.fake.active = "active"
            return result
        self.controller.runner = runner
        self.fake.calls.clear()
        with self.assertRaises(SystemdControllerError):
            self.controller.remove(handle)
        self.assertTrue(Path(self.fake.fragment).is_file())
        self.assertFalse(any(call[2] == "disable" for call in self.fake.calls))

    def test_reservation_is_pure_and_start_accepts_only_the_exact_reservation(self) -> None:
        handle = self.controller.reserve("report-poller", self.revision, self.manifest, {}, self.root)
        self.assertEqual(self.fake.calls, [])
        self.assertFalse((self.root / "units").exists())
        self.assertEqual(self.controller.start("report-poller", self.revision, self.manifest, {}, self.root, handle=handle), handle)
        with self.assertRaises(SystemdControllerError):
            self.controller.start("report-poller", "b" * 64, self.manifest, {}, self.root, handle=handle)

    def test_remove_recovers_after_unlink_succeeded_but_reload_failed(self) -> None:
        handle = self.start()
        self.fake.fail = "daemon-reload"
        with self.assertRaises(SystemdControllerError) as error:
            self.controller.remove(handle)
        self.assertEqual(error.exception.handle, handle)
        self.assertFalse(Path(self.fake.fragment).exists())
        self.fake.fail = None
        self.controller.remove(handle)
        self.assertEqual(self.fake.fragment, "")
        self.controller.remove(handle)

    def test_remove_does_not_infer_absence_from_an_unrelated_fragment(self) -> None:
        handle = self.start()
        Path(self.fake.fragment).unlink()
        self.fake.fragment = "/unrelated/service"
        self.fake.calls.clear()
        with self.assertRaises(SystemdControllerError):
            self.controller.remove(handle)
        self.assertTrue(all(call[2] == "show" for call in self.fake.calls))


if __name__ == "__main__":
    unittest.main()
