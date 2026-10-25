import json
import os
import subprocess
import tempfile
import unittest
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path

from odk_service_runtime.docker_backend import DockerBackend, DockerBackendError

IMAGE = 'sha256:' + '1' * 64
CONTAINER = '2' * 64
MANIFEST = {'runtime': {'kind': 'docker', 'image': IMAGE, 'platform': 'linux/arm64', 'args': ['sleep', '60']}}


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.labels = {}
        self.architecture = 'arm64'
        self.fail_remove = False
        self.fail_start = False
        self.missing_image = False
        self.exists = False
        self.name = None
        self.lose_create = False
        self.lose_remove = False
        self.inspect_error = False

    def __call__(self, command, **kwargs):
        self.calls.append(command)
        args = command[1:]
        if args[:2] == ['image', 'inspect']:
            if self.missing_image:
                return subprocess.CompletedProcess(command, 1, '', 'No such image')
            value = [{'Id': IMAGE, 'Os': 'linux', 'Architecture': self.architecture, 'RepoDigests': ['example.test/fixture@' + IMAGE]}]
        elif args[0] == 'pull':
            self.missing_image = False
            return subprocess.CompletedProcess(command, 0, '', '')
        elif args[0] == 'create':
            self.labels = dict(args[index + 1].split('=', 1) for index, arg in enumerate(args) if arg == '--label')
            self.exists = True
            self.name = args[args.index('--name') + 1]
            if self.lose_create:
                raise subprocess.TimeoutExpired(command, 30)
            return subprocess.CompletedProcess(command, 0, CONTAINER + '\n', '')
        elif args[:2] == ['container', 'inspect']:
            if self.inspect_error:
                return subprocess.CompletedProcess(command, 1, '', 'Cannot connect to the Docker daemon')
            if not self.exists:
                return subprocess.CompletedProcess(command, 1, '', 'Error: No such container: ' + args[2])
            value = [{'Id': CONTAINER, 'Name': '/' + self.name, 'Config': {'Labels': self.labels}, 'State': {'Running': True, 'Status': 'running'}}]
        elif args[0] == 'start' and self.fail_start:
            return subprocess.CompletedProcess(command, 1, '', 'secret provider output')
        elif args[0] == 'rm' and self.fail_remove:
            return subprocess.CompletedProcess(command, 1, '', 'secret provider output')
        elif args[0] == 'rm':
            self.exists = False
            if self.lose_remove:
                raise subprocess.TimeoutExpired(command, 30)
            return subprocess.CompletedProcess(command, 0, '', '')
        else:
            return subprocess.CompletedProcess(command, 0, '', '')
        return subprocess.CompletedProcess(command, 0, json.dumps(value), '')


class DockerBackendTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.cli = FakeDocker()
        self.backend = DockerBackend(runner=self.cli)
        self.config = {'envFile': None, 'mounts': [], 'uid': 1000, 'gid': 1000}

    def start(self):
        return self.backend.start('sample', 'a' * 64, MANIFEST, self.config, self.directory)

    def test_reservation_has_no_docker_effect_and_survives_creation_result_loss(self):
        handle = self.backend.reserve('sample', 'a' * 64, MANIFEST, self.config, self.directory)
        self.assertEqual(self.cli.calls, [])
        self.cli.lose_create = True
        with self.assertRaises(DockerBackendError) as raised:
            self.backend.start('sample', 'a' * 64, MANIFEST, self.config, self.directory, handle=handle)
        self.assertEqual(raised.exception.handle, handle)
        self.backend.remove(handle)
        confirmed = {**handle, 'creationPending': False}
        self.assertEqual(self.backend.status(confirmed)['state'], 'absent')

    def test_creation_timeout_before_visibility_retains_reservation(self):
        handle = self.backend.reserve('sample', 'a' * 64, MANIFEST, self.config, self.directory)
        self.cli.lose_create = True
        with self.assertRaises(DockerBackendError):
            self.backend.start('sample', 'a' * 64, MANIFEST, self.config, self.directory, handle=handle)
        self.cli.exists = False
        with self.assertRaises(DockerBackendError) as raised:
            self.backend.remove(handle)
        self.assertTrue(raised.exception.handle['creationPending'])
        self.assertEqual(self.backend.status(handle)['state'], 'unknown')
        self.cli.exists = True
        self.cli.lose_remove = True
        with self.assertRaises(DockerBackendError) as raised:
            self.backend.remove(handle)
        self.assertFalse(raised.exception.handle['creationPending'])
        self.backend.remove(raised.exception.handle)

    def test_removal_retry_accepts_only_confirmed_absence(self):
        handle = self.start()
        self.cli.lose_remove = True
        with self.assertRaises(DockerBackendError):
            self.backend.remove(handle)
        self.backend.remove(handle)
        self.cli.inspect_error = True
        with self.assertRaises(DockerBackendError) as raised:
            self.backend.remove(handle)
        self.assertEqual(raised.exception.handle, handle)

    def test_environment_overrides_are_rejected_and_home_is_permitted(self):
        env = self.directory / 'private.env'
        env.touch(mode=0o600)
        self.config['envFile'] = str(env)
        for key in ['PYTHONPATH', 'UV_PROJECT', 'LD_PRELOAD', 'NODE_OPTIONS', 'PATH', 'ODK_SERVICE_REVISION']:
            env.write_text(key + '=sensitive-value\n')
            with self.assertRaises(DockerBackendError) as raised:
                self.start()
            self.assertNotIn('sensitive-value', str(raised.exception))
        self.assertFalse(any(call[1] == 'create' for call in self.cli.calls))
        env.write_text('HOME=/state\n')
        self.start()

    def test_prepare_requires_immutable_image_and_matching_architecture(self):
        self.backend.prepare(self.directory, MANIFEST)
        self.cli.architecture = 'amd64'
        with self.assertRaises(DockerBackendError):
            self.backend.prepare(self.directory, MANIFEST)
        for image in ['alpine:latest', 'repo:1', '--privileged']:
            with self.assertRaises(DockerBackendError):
                self.backend.prepare(self.directory, {'runtime': {**MANIFEST['runtime'], 'image': image}})
        self.assertFalse(any(call[1] == 'pull' for call in self.cli.calls))

    def test_prepare_pulls_only_missing_pinned_digest(self):
        self.cli.missing_image = True
        manifest = {'runtime': {**MANIFEST['runtime'], 'image': 'example.test/fixture@' + IMAGE}}
        self.backend.prepare(self.directory, manifest)
        self.assertIn(['docker', 'pull', '--platform', 'linux/arm64', manifest['runtime']['image']], self.cli.calls)

    def test_start_uses_restrictions_and_external_env_file(self):
        env = self.directory / 'private.env'
        env.touch(mode=0o600)
        env.write_text('SECRET=never-in-command\n')
        mount = self.directory / 'data'
        mount.mkdir()
        self.config.update(envFile=str(env), mounts=[{'source': str(mount), 'target': '/data', 'readOnly': True}])
        handle = self.start()
        self.assertTrue(handle['containerId'].startswith('odk-service-'))
        command = next(call for call in self.cli.calls if call[1] == 'create')
        text = ' '.join(command)
        for flag in ['--read-only', '--cap-drop', '--security-opt', '--pids-limit', '--memory', '--cpus', '--tmpfs', '--init', '--log-driver']:
            self.assertIn(flag, command)
        self.assertIn('1000:1000', command)
        self.assertEqual(command[command.index('--restart') + 1], 'unless-stopped')
        self.assertNotIn('never-in-command', text)
        self.assertNotIn('--privileged', command)
        self.assertNotIn('--network', command)
        self.assertEqual(command[-3:], [IMAGE, 'sleep', '60'])

    def test_root_user_socket_and_root_mount_are_rejected_before_create(self):
        bad_configs = [{**self.config, 'uid': 0}, {**self.config, 'gid': 0}]
        for source in ['/', '/var/run/docker.sock', '/var/run', '/run/podman/podman.sock']:
            bad_configs.append({**self.config, 'mounts': [{'source': source, 'target': '/data', 'readOnly': True}]})
        for config in bad_configs:
            with self.assertRaises(DockerBackendError):
                self.backend.start('sample', 'a' * 64, MANIFEST, config, self.directory)
        self.assertFalse(any(call[1] == 'create' for call in self.cli.calls))

    def test_stop_and_remove_refuse_unrelated_ownership(self):
        handle = self.start()
        self.cli.labels = {}
        for method in [self.backend.stop, self.backend.remove]:
            with self.assertRaises(DockerBackendError):
                method(handle)
        self.assertFalse(any(call[1] in ['stop', 'rm'] for call in self.cli.calls))
        self.assertEqual(self.backend.status(handle)['state'], 'unknown')

    def test_owned_remove_checks_labels_before_each_mutation(self):
        handle = self.start()
        self.backend.remove(handle)
        mutations = [call[1] for call in self.cli.calls if call[1] in ['stop', 'rm']]
        self.assertEqual(mutations, ['stop', 'rm'])
        self.assertEqual(self.backend.status(handle)['state'], 'absent')

    def test_failure_preserves_handle_and_sanitizes_provider_output(self):
        handle = self.start()
        self.cli.fail_remove = True
        with self.assertRaises(DockerBackendError) as raised:
            self.backend.remove(handle)
        self.assertEqual(raised.exception.handle, handle)
        self.assertNotIn('secret', str(raised.exception))
        self.cli.fail_start = True
        with self.assertRaises(DockerBackendError) as raised:
            self.start()
        self.assertTrue(raised.exception.handle['containerId'].startswith('odk-service-'))


    def test_health_checks_ownership_before_exec(self):
        handle = self.start()
        manifest = {**MANIFEST, 'health': {'argv': ['test', '-d', '/tmp'], 'timeoutSeconds': 2}}
        self.assertTrue(self.backend.health(handle, manifest, self.config))
        self.assertIn(['docker', 'exec', CONTAINER, 'test', '-d', '/tmp'], self.cli.calls)
        self.cli.labels = {}
        count = len(self.cli.calls)
        with self.assertRaises(DockerBackendError):
            self.backend.health(handle, manifest, self.config)
        self.assertFalse(any(call[1] == 'exec' for call in self.cli.calls[count:]))


    def test_root_context_rejects_foreign_handles_and_dotted_ids_work(self):
        first = DockerBackend(runner=self.cli, root_directory=self.directory / 'runtime-one')
        handle = first.start('odk.futu.poller', 'a' * 64, MANIFEST, self.config, self.directory)
        other = DockerBackend(runner=self.cli, root_directory=self.directory / 'runtime-two')
        before = len(self.cli.calls)
        with self.assertRaises(DockerBackendError):
            other.stop(handle)
        self.assertEqual(len(self.cli.calls), before)

    def test_regular_file_mounts_are_read_only(self):
        secret = self.directory / 'secret'
        secret.write_text('private value')
        self.config['mounts'] = [{'source': str(secret), 'target': '/config/private', 'readOnly': False}]
        with self.assertRaises(DockerBackendError):
            self.start()
        self.config['mounts'][0]['readOnly'] = True
        self.start()

    def test_only_private_owned_runtime_subdirectories_can_be_writable(self):
        source = f'/run/user/{os.getuid()}/odk/service'
        self.config['mounts'] = [{'source': source, 'target': '/runtime', 'readOnly': False}]
        metadata = SimpleNamespace(st_uid=os.getuid(), st_mode=0o40700)
        with ExitStack() as stack:
            stack.enter_context(patch.object(Path, 'resolve', lambda path: path))
            stack.enter_context(patch.object(Path, 'exists', return_value=True))
            stack.enter_context(patch.object(Path, 'is_dir', return_value=True))
            stack.enter_context(patch.object(Path, 'is_file', return_value=False))
            stack.enter_context(patch.object(Path, 'stat', return_value=metadata))
            stack.enter_context(patch.object(Path, 'rglob', return_value=[]))
            self.start()
            metadata.st_mode = 0o40755
            with self.assertRaises(DockerBackendError):
                self.start()
            metadata.st_mode = 0o40700
            metadata.st_uid += 1
            with self.assertRaises(DockerBackendError):
                self.start()
            metadata.st_uid = os.getuid()
            self.config['mounts'][0]['source'] = f'/run/user/{os.getuid()}'
            with self.assertRaises(DockerBackendError):
                self.start()

    def test_mounting_a_docker_socket_parent_is_refused(self):
        directory = self.directory / 'runtime'
        directory.mkdir()
        (directory / 'docker.sock').touch()
        self.config['mounts'] = [{'source': str(directory), 'target': '/runtime', 'readOnly': True}]
        with self.assertRaises(DockerBackendError):
            self.start()


@unittest.skipUnless(os.environ.get('ODK_SERVICE_DOCKER_TEST_IMAGE'), 'Set an immutable cached arm64 image for the offline Docker check')
class DockerOfflineAcceptance(unittest.TestCase):
    def test_cached_arm64_container_lifecycle(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            backend = DockerBackend()
            manifest = {'runtime': {'kind': 'docker', 'image': os.environ['ODK_SERVICE_DOCKER_TEST_IMAGE'],
                        'platform': 'linux/arm64', 'args': ['sh', '-c', 'sleep 90']},
                        'health': {'argv': ['sh', '-c', 'test "$(id -u)" != 0 && test -w /tmp'], 'timeoutSeconds': 5},
                        'stopTimeoutSeconds': 3}
            config = {'envFile': None, 'mounts': [], 'uid': 1000, 'gid': 1000}
            backend.prepare(directory, manifest)
            handle = None
            try:
                handle = backend.start('offline-check', 'f' * 64, manifest, config, directory)
                self.assertEqual(backend.status(handle)['state'], 'running')
                self.assertTrue(backend.health(handle, manifest, config))
                backend.stop(handle)
                self.assertEqual(backend.status(handle)['state'], 'exited')
                backend.remove(handle)
                self.assertEqual(backend.status(handle)['state'], 'absent')
                handle = None
            except DockerBackendError as error:
                handle = handle or error.handle
                raise
            finally:
                if handle:
                    backend.remove(handle)
