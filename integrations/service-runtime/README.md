# External service runtime

This operator-owned runtime manages independent Service Plugin revisions.
[Futu](../futu-poller/README.md#external-service-package) is the first packaged service.
The Shell and Personal Bot continue to consume the existing Open DeskOS Data interfaces.

## Host requirements

The manager uses Python 3.10 or later and the Python standard library.
Python services require Linux, a working systemd user manager, and `uv` on the operator's path.
Each service declares its exact Python patch version.
Docker services require an available Docker daemon and an immutable Linux image for the declared architecture.
CM5 uses `linux/arm64`.

The CM5 release includes the manager sources and launcher.
Release packaging excludes virtual environments, tests, credentials, and runtime state.
Packaging does not install backends or enable services.
Installing host prerequisites or activating a device service requires separate operational authorization.

The foreground Python runner also supports local POSIX checks without systemd.
Direct `run` holds a service lease but does not enable a managed unit.
Terminate that foreground runner to stop its local check.
This manager does not implement Windows service supervision.
The existing Futu Windows worker path remains separate.

## Operator commands

Use the installed `odk` CLI when its Shell release includes the service handler:

```sh
odk plugin service list
odk plugin service install /absolute/futu-package --config /absolute/private/bindings.json --trust
odk plugin service inspect odk.futu.poller
odk plugin service enable odk.futu.poller
odk plugin service update /absolute/futu-update --config /absolute/private/update-bindings.json --trust
odk plugin service rollback odk.futu.poller
odk plugin service disable odk.futu.poller
odk plugin service remove odk.futu.poller
```

An independent rollout can preserve the existing Shell release.
An older Shell does not provide `odk plugin service`.
On CM5, use the separate operator launcher at `/home/orangepi/.local/bin/odk-service`.
Run these commands as `orangepi` with its systemd user-session environment.

```sh
/home/orangepi/.local/bin/odk-service list
/home/orangepi/.local/bin/odk-service inspect odk.futu.poller
/home/orangepi/.local/bin/odk-service disable odk.futu.poller
/home/orangepi/.local/bin/odk-service enable odk.futu.poller
```

From a root SSH session, supply that environment explicitly:

```sh
runuser -u orangepi -- env HOME=/home/orangepi \
  XDG_RUNTIME_DIR=/run/user/1000 \
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
  /home/orangepi/.local/bin/odk-service list
```

The independent launcher accepts the same arguments after `odk plugin service`.
It selects a manager release separately from `/opt/odk/current`.
Keep manager releases available while managed user units reference their launchers.
See [CONTEXT](CONTEXT.md) for the observed deployment and acceptance state.

Set `ODK_SERVICE_RUNTIME_PYTHON` for the Shell CLI when the operator interpreter has another executable path.
From `runtime/shell`, `pnpm exec node scripts/odk-plugin-cli.js service list` runs the same source command.
The worker interpreter comes from its manifest, independently of the manager interpreter.
For a direct launcher, use `python3 /absolute/release/integrations/service-runtime/service_runtime.py list`.
Supply `--state-dir /absolute/private/root` before the lifecycle command to select another state root.
The default root is `$XDG_STATE_HOME/odk-service-runtime` or `$HOME/.local/state/odk-service-runtime`.

Installation requires `--trust` and selects a prepared revision without starting it.
Updating an enabled service prepares the candidate before stopping the current revision.
Readiness failure stops the candidate before restoring the current revision.
Unknown cleanup blocks further activation.
Retry `disable` to reconcile an interrupted operation.
Confirmed absence completes cleanup; unavailable runtime evidence does not.
An interrupted Docker creation retains its reservation even when the container is temporarily absent.
The daemon can finish creation after its client exits.
Cleanup can resume when the owned container becomes observable.
If it never appears, the reservation requires separate operator recovery; this runtime does not infer completion from elapsed time.

Rollback restores retained code, its environment, and its operator binding references.
Secret file contents and provider state are not versioned or restored.
Removal releases owned processes, units, or containers.
It preserves private state, retained revisions, and external secret files.
List and inspect return saved lifecycle metadata, not continuous health or provider acceptance.
Their public output excludes configuration, credentials, handles, and provider output.

Check the existing Futu user unit and its aliases before migration.
CM5 can use `open-deskos-futu-poller.service`; the standalone template uses `odk-futu-poller.service`.
Disable the actual resident unit through the authorized host workflow.
Confirm its processes have stopped before enabling the managed revision.
Run one Futu supervisor for the existing publication targets.

## Package contract

A package contains `service.json` and exactly the files listed in its `files` inventory.
The manifest uses `schemaVersion: 1` and a stable service `id`, `name`, and `version`.
Identifiers contain lowercase letters, digits, dots, or hyphens and have at most 64 characters.
Inventory entries contain a relative `path` and lowercase SHA-256 `sha256` value, sorted by path.
Links, extra files, undeclared directories, aliases, and parent traversal are refused.
The limits are 128 inputs, 4 MiB per input, 16 MiB total, and a 32 KiB manifest.
The revision is the SHA-256 digest of the canonical manifest, including its file hashes.

A Python `runtime` declares `kind: "python"`, exact `python`, relative `entry`, and optional `args`.
Its inventory includes `pyproject.toml`, `uv.lock`, `.python-version`, and the entry file.
The manager validates the lock before synchronizing a separate `.venv` inside each retained revision.
It verifies the interpreter patch version and suppresses inherited Python and uv overrides.
Reinstalling the selected revision does not synchronize a running environment.

A Docker `runtime` declares `kind: "docker"`, immutable `image`, `platform`, and optional `args`.
Images use `repository@sha256:digest` or a local `sha256:content-id`.
Mutable tags are refused.
The daemon verifies image identity and architecture before creation.
A missing registry digest can be pulled; a missing local content ID fails.

Every manifest declares `health: {"kind":"exec","argv":[...],"timeoutSeconds":10}`.
Python probes run in the retained revision; `{python}` selects its interpreter and `{revision}` selects its directory.
Docker probes run inside the owned container.
Readiness has a maximum 60-second deadline.
`stopTimeoutSeconds` defaults to 20 and has a maximum of 300.
Probe and worker output are discarded because they can contain private provider data.

## Private operator bindings

The configuration file and its parent directory must be canonical, owned by the operator, and private.
Use directory mode `0700` and file mode `0600`.
Environment files have the same requirements and a 64 KiB limit.
These files stay outside packages and releases.

```json
{
  "envFile": "/home/orangepi/.config/odk/services/futu/worker.env",
  "uid": 1000,
  "gid": 1000,
  "mounts": []
}
```

Python processes run as the operator and use host paths from their declared environment file.
Their private persistent directory becomes `HOME` and `ODK_SERVICE_STATE_DIR`.
The manager supplies `ODK_SERVICE_REVISION` and `PYTHONUNBUFFERED`.
Environment values use literal `KEY=value` lines without shell expansion.
Inherited account credentials are not forwarded.
Python runtime overrides and preload settings are refused.

The manager does not forward `XDG_RUNTIME_DIR` to Python services.
Futu requires explicit paths because its managed `HOME` differs from the operator home.
Set these values in the private environment file, with paths for the selected host:

```dotenv
FUTU_RSA_FILE=/home/orangepi/.config/odk/futu-rsa.pem
ODK_FUTU_TARGETS_FILE=/home/orangepi/.config/odk/futu-targets.json
ODK_FUTU_CONTROL=/run/user/1000/odk-futu/control.sock
```

Use `ODK_FUTU_SOCKET` instead of the targets file for a single Unix publication target.
Keep `ODK_FUTU_SERVICE_REVISION` consistent with the Shell expectation.
Retain existing gateway credentials in the private operator configuration.

Docker uses the declared non-root UID and GID.
Mount entries contain absolute `source`, absolute container `target`, and Boolean `readOnly` fields.
File mounts must be read-only.
Only explicit private state or runtime directories should be writable.
System roots, device directories, and Docker socket mounts are refused.
Use container paths inside the Docker environment file.
Futu requires a writable private `HOME` for SDK logs and a private management socket directory.
See the [Futu Docker instructions](../futu-poller/README.md#optional-docker-backend).

## Ownership and limits

The manager serializes mutations and saves resource ownership before external creation.
Python supervision uses a revision-bound systemd user unit and a foreground process-group lease.
Docker supervision uses a random reserved name and exact root, service, and revision labels.
Cleanup verifies ownership independently of retained executable files.
Uncertain outcomes retain handles for later cleanup.
No cleanup operation signals a saved host process identifier.

Python virtual environments isolate dependencies; they are not an operating-system security sandbox.
Trusted Python packages and dependency build hooks retain the operator's native authority.
Do not install untrusted packages.
Docker has a read-only root, dropped capabilities, no privilege escalation, and explicit writable mounts.
It limits memory to 512 MiB, CPU to one core, and processes to 128.
Container restart policy preserves enabled services across daemon restarts.
The manager caller requires authorized Docker daemon access for Docker lifecycle operations.
Container UID settings do not grant that access.
Access to a privileged Docker daemon carries broad host authority.
Provision daemon access through the authorized host workflow.
Neither backend enforces a destination network allowlist or provides a credential vault.
Container packaging does not prove that its image was built from the accompanying source inventory.
The current trust gate is explicit local installation, not signed package distribution.

Futu readiness proves local management-channel availability.
It does not prove OpenD connectivity, account authentication, current holdings, or physical CM5 acceptance.
Gateway credentials and the existing NAS FutuOpenD remain external.
This layer does not grant HTML packages native execution or change renderer permissions.
The [Gmail plugin](../gmail/README.md) uses this lifecycle with a private socket and separate Google authorization.

## Verification

Run the host lifecycle suite with `uv run --with pytest pytest` in this directory.
Set `ODK_SERVICE_DOCKER_TEST_IMAGE` to a cached immutable ARM64 image for the offline container check.
The Futu acceptance tests accept staged package paths through their documented test environment variables.
Systemd command tests use a controlled manager substitute; they do not certify a physical CM5 installation.

```sh
ODK_FUTU_ACCEPTANCE_PYTHON_PACKAGE=/absolute/futu-package \
ODK_FUTU_ACCEPTANCE_DOCKER_PACKAGE=/absolute/futu-docker-package \
uv run --with pytest pytest tests/test_futu_acceptance.py
```

The Docker acceptance package must refer to an already cached local image ID.
Both Futu checks use private local fixtures without gateway credentials.
See [CONTEXT](CONTEXT.md) for local checks, observed device acceptance, and remaining limits.
