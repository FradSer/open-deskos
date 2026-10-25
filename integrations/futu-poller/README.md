# futu-poller — Futu holdings Service Plugin

CM5-resident poller.
It reads real positions from the existing NAS FutuOpenD gateway over the LAN.
It publishes bounded protocol-v1 snapshots through a Runtime Channel to one or more Shell Hosts.
See [ADR-0009](../../runtime/shell/docs/ARCHITECTURE.md#adr-0009).

One poller feeds Linux and Windows endpoint targets.
Gateway RSA/trade credentials stay on the reference host; desks receive positions only.

## Trusted development replacements

[development_plugins.py](development_plugins.py) loads explicitly selected local Python components at startup.
Install this module beside `poller.py` when you use development selections.
Default deployment includes the lifecycle, configuration, control, and management channel modules beside `poller.py`.

Each package contains `manifest.json` and one Python entry file.
Copy the selected declaration from `--plugins list`.
Add a relative `entry` path and set the replacement version.
Keep its identity, host, kind, and provided ports.
Declare required ports.
Keep permissions within the original component contract.
Export synchronous `create(context)` from the entry.
Return a raw component with the operations defined below.
Register cleanup through `context.on_cleanup()` before allocating resources.
Allocate owned resources inside the factory, rather than during module import.
Relative package imports are not supported by this single-module loader.

This example validates a replacement loop without executing its entry:

```sh
uv run python integrations/futu-poller/poller.py \
  --plugin-directory /absolute/path/to/loop-package --trust-plugins \
  --grant-plugin odk.futu.loop:poll.settings \
  --grant-plugin odk.futu.loop:poll.wait \
  --grant-plugin odk.futu.loop:poll.clock --plugins validate
```

Omit `--plugins validate` to start the selected composition.
Repeat `--plugin-directory` for additional components.
Each requested capability requires its own `IDENTITY:CAPABILITY` grant.
Selections apply to this startup and are not saved development links.
Saved enable and disable operations cannot select development entries.

The loader checks bounded regular files and rejects entries outside the selected directory.
POSIX opens each canonical ancestor through directory descriptors without following symbolic links.
Windows verifies the final path of the opened file handle before reading bytes.
The comparison accepts equivalent extended drive and UNC path prefixes.
Handle query failures reject the selection before reading entry bytes.
Windows device acceptance remains unverified.
The loader captures entry bytes during selection and executes them only when the factory starts.
Inspection, disabled components, and an unauthenticated gateway do not execute their entries.
The host validates the selected dependency graph before factory execution.
Separate loads use distinct module identities.
Entry syntax errors, missing factories, initialization failures, and loop failures produce operational command failure.
The runtime releases registered resources when initialization or polling fails.

Trusted entries have native process access.
Grants do not provide a sandbox, signed distribution, updates, rollback, or runtime hot replacement.
Entry compatibility still requires shared feature acceptance scenarios.

## Local component plugins

[plugin_host.py](plugin_host.py) owns the synchronous Python plugin lifecycle.
It uses schema version 1, the `python-agent` host identity, and exact versioned ports.
It checks duplicate ports, missing dependencies, and cycles before it starts factories.
Required consumers stop before providers.
Optional consumers restart when a provider changes.
Cleanup failure does not skip independent components.
The host retains failed cleanup operations and retries them on the next shutdown request.
Successful cleanup operations do not run again.
Stop failure prevents destroy and registered cleanup.
Retained consumers prevent provider cleanup and withdraw their public ports.
Only consumer cleanup can resolve a retained provider port.
Startup and registration cannot replace resources that the host still owns.
Lifecycle callbacks cannot start another lifecycle change.

Factories and lifecycle callbacks must return synchronous results.
The host rejects awaitables and thread Futures before it marks an operation complete.
It closes returned native coroutines without awaiting them.
A rejected shutdown result retains the instance and its required providers.
The poller adapter uses the host's `require_synchronous()` check before it wraps factory results as ports.
It rejects asynchronous component results before inspecting their methods or registering their own `close` operation.
Cleanup registered through the factory context remains owned by the host.

The host consumes failed Future results without waiting for completion or cancelling work.
Pending asyncio Futures require their event loop to continue dispatching callbacks.
Plugins must stop work that they scheduled before returning a Future.

[poller.py](poller.py) composes publisher, gateway, loop, and connection transport plugins.
`create_poller()` accepts replacement local factories without opening channels or loading the SDK.
Factories declare their ports and capabilities through the host.
Publisher instances require callable `send`.
Authenticated gateway instances require callable `snapshot`.
Loop instances require callable `run`.
Transport instances require callable `connect`.
The composition rejects missing operations before polling begins and retains registered cleanup responsibility.
These checks do not validate method signatures or certify feature compatibility.
A factory must register cleanup before it allocates resources that can survive initialization failure.
The default gateway registers cleanup before it opens trade contexts.
It attempts to close each trade context and retains contexts whose close operation raises an error.
The pinned SDK can return without cleanup after an earlier close failure.
The gateway retains that failure because the SDK has no supported recovery operation that confirms resource release.
The publisher closes independent desk connections even if another connection cannot close.
It retains an uncertain OS close failure and prevents connection reuse.
The publisher receives target settings and service identity.
The gateway receives credentials.
The loop receives polling settings, a wait function, and a clock.
The default publisher requires the `odk:futu/transport/v1` port from `odk.futu.transport`.
Pass `transport_factory` to `create_poller()` to replace connection creation without replacing the publisher.
Its `connect(endpoint)` operation receives a parsed `Endpoint` and returns a synchronous connection.
The default transport calls the existing `open_connection()` implementation.
The publisher owns returned connections and preserves endpoint authentication, service identity, revision, and protocol records.
Failed connection cleanup retains the transport provider until the publisher releases its resources.
A custom publisher has no automatic transport dependency.
Readable connections must provide callable `recv`, `gettimeout`, `settimeout`, and `fileno` operations and support `select.select()`.
The publisher checks these operations before it advertises diagnosis support.
A failed descriptor does not stop diagnosis on independent connections.
Write-only connections retain publication without diagnosis support.
Plugin catalogs contain declarations and state, without capability values.
`diagnose()` reports the current owned composition through a bounded public snapshot.
It does not call factories, providers, health callbacks, cleanup, or network operations.
Reports retain lifecycle states and enabled preferences while excluding errors, capability values, and extra manifest fields.
Undeclared health remains unknown.
Reports contain at most 128 components and 16 KiB of public plugin JSON.
Scalar and collection checks occur before serialization; incremental encoding stops when the byte budget is exceeded.
Oversized or invalid reports return unavailable without their content.
Returned data is isolated from the host's records.
The report identifies `python-agent` and the `futu-poller` instance and matches the Shell runtime report contract.
Call this synchronous API from the owning thread between lifecycle operations.
The constructing thread owns the host, runtime, and plugin contexts.
Calls from another thread fail before they access owned state or clear retained errors.
Offline CLI inspection reports declarations without starting providers.
[Negotiated runtime diagnosis](#negotiated-runtime-diagnosis) uses the existing publishing connection.

`start()` initializes the graph.
`run()` starts the selected loop and closes resources when it exits.
`close()` releases resources and retries operations that report cleanup failure.
`create_poller(disabled=(...))` excludes declared identities at startup without changing the default selection.
Unknown disabled identities fail before any factory executes.
`set_enabled()` changes components between synchronous operations.
It accepts only Boolean enable values.
This host does not provide concurrent lifecycle calls or interrupt a blocking SDK operation.
The [control dispatcher](plugin_control.py) accepts the common `inventory`, `enable`, and `disable` commands on the owner thread.
It returns bounded public results and preserves resource ownership when cleanup fails.
It does not open a management endpoint, authenticate callers, or write saved preferences.
The control plugin authenticates transport requests and remains independent of the selected publisher.
The [management channel](management_channel.py) provides an independent Unix listener with owner-thread polling.
Its directory must have private ownership.
Token-gated listeners verify the common first-line handshake before command dispatch.
Each connection carries one request and one correlated result.
Requests, clients, and response sizes have explicit limits.
Startup preserves active listeners and unrelated files while recovering a verified stale owned socket.
The Shell CLI can select this endpoint through the authenticated runtime inventory.
On Unix, an absolute `XDG_RUNTIME_DIR` selects `odk-futu/control.sock` inside that directory.
`ODK_FUTU_CONTROL` selects an explicit Unix management path.
An empty value disables automatic management selection.
The operational command starts the independent protected `odk.futu.control` plugin before feature components.
Provider startup failures retain a successfully started control plugin for recovery.
A failed control startup does not stop independent polling components.
When management is unavailable, a feature startup failure retains its original fatal error.
The default loop processes management requests during its publishing interval on the owner thread.
Component transitions end the old loop before the supervisor selects another generation.
Disabled or normally returned loops leave management available.
Managed loop execution errors retire the failed activation while preserving management and independent providers.
The CLI can explicitly enable the loop after successful resource release.
Failed cleanup retains ownership and prevents a new activation until an explicit retry succeeds.
The Host uses a separate activation token, even when a factory reuses a port object.
An error or wait from a retired activation cannot affect its replacement.
No management endpoint keeps the previous single-run behavior.
Blocking SDK calls remain synchronous and cannot process commands until they return.
External loops must use the declared wait capability and cancellation signal for cooperative management.
Windows selects `\\.\pipe\odk-futu-plugin-control` and requires the shared channel token.
`ODK_CHANNEL_TOKEN_FILE` overrides `%LOCALAPPDATA%\odk\local-channel.token`.
The backend uses CPython's [overlapped I/O wrapper](https://github.com/python/cpython/blob/v3.13.10/Modules/_winapi.c).
It processes native completions on the resource owner thread without a lifecycle worker thread.
Pending cancellation retains operations and buffers until explicit cleanup retry succeeds.
Controlled API tests do not establish native Windows pipe acceptance.
Run `uv run --with pytest pytest -q tests/test_windows_management.py` on the supported Windows Host for native client verification.
Trusted Python factories retain native process access.
Capability declarations do not sandbox them or authorize third-party native code.

The default loop retains protocol v1 records, market order, authentication requests, and polling intervals.
An absent trade password does not load the SDK.
The service unit uses the pinned virtual environment and a 20-second shutdown timeout.
Install `plugin_host.py`, `plugin_config.py`, `plugin_control.py`, and `management_channel.py` beside `poller.py`.
[Plugin scenarios](features/futu-poller.feature) define the compatibility checks.
The [shared gateway checks](tests/test_gateway_parity.py) compare the default gateway with an independently loaded replacement module.
They verify synthetic holdings, protocol output, timing, failure recovery, authentication exclusion, and disable behavior.
The replacement calls neither the built-in gateway nor its polling calculation.
These checks do not establish real SDK, gateway, or desktop channel acceptance.

### Operator inspection and startup selection

Run these commands from the repository root:

```sh
uv run integrations/futu-poller/poller.py --plugins list
uv run integrations/futu-poller/poller.py --plugins validate
uv run integrations/futu-poller/poller.py --plugins validate --disable-plugin odk.futu.gateway
```

Inspection composes declarations without reading provider settings, loading the SDK, opening channels, or executing factories.
The JSON report identifies `python-agent` and the `declarations` scope.
Its states describe unstarted declarations; they do not report a running service or current health.
Validation checks the declared dependency graph before reporting success.
Reports contain capability names without credential or endpoint values.
Unknown disabled identities cause exit code 2 without inventory output.

Use `--disable-plugin <identity>` repeatedly to exclude components when you start the poller.
Required consumers remain blocked when a provider is disabled.
Independent components retain their existing startup and cleanup behavior.
The `--disable-plugin` option selects this invocation only and does not control another running process.
The command without arguments retains its existing operational behavior.
### Saved component preferences

Use an explicit configuration path to save component selection:

```sh
uv run integrations/futu-poller/poller.py --plugins disable --plugin odk.futu.gateway --plugin-config /tmp/futu-plugins.json
uv run integrations/futu-poller/poller.py --plugins enable --plugin odk.futu.gateway --plugin-config /tmp/futu-plugins.json
uv run integrations/futu-poller/poller.py --plugins list --plugin-config /tmp/futu-plugins.json
```

These commands validate declarations without consuming provider settings or starting factories.
The mutation report uses the `preferences` scope and states that changes apply at the next startup.
Enabling one component preserves other saved component preferences.
The file contains version 1 and a `plugins` object with Boolean `enabled` preferences for known components.
Invalid values, unknown components, duplicate JSON keys, and files larger than 16 KiB are rejected.
A missing file supplies the default selection.
A malformed selected file prevents startup before any provider executes.

Pass `--plugin-config <file>` when starting the poller to read the saved selection.
Alternatively, set `ODK_FUTU_PLUGIN_CONFIG` in the poller's operational environment.
Explicit CLI paths take priority over that environment setting.
Inspection reads plugin preference settings without reading provider configuration.
Invocation disables add to saved disables; they cannot silently enable a saved disabled component.
Without any preference file or explicit exclusion, the default startup remains unchanged.

The canonical startup and inspection commands also read shared enable preferences.
The [Shell configuration contract](../../runtime/shell/docs/CONFIGURATION.md#saved-plugin-preferences) owns the common path and CLI.
Shared disables, environment exclusions, standalone disables, and invocation disables add together.
A shared enable preference cannot override another exclusion.
Only registered Futu identities affect this runtime.
The reader checks the common version, identities, and enable values.
It projects enable values without interpreting development metadata or executing entries.
It does not validate native development links.
The shared file retains the Shell reader's size and duplicate-key behavior.
Its numeric version and UTF-8 replacement behavior follow the Shell reader.
Nonstandard JSON constants are invalid.
JSON decoder nesting failures produce the generic diagnostic instead of stopping startup with a traceback.
The standalone file retains its strict 16 KiB and duplicate-key rules.
Missing shared configuration keeps default selection and explicit exclusions.
Invalid shared configuration produces a generic diagnostic and keeps explicit exclusions.
No preference read changes file contents.

Writes hold an exclusive directory lock and replace the file through a private candidate in the same directory.
An owned lock reports busy and is never removed by another writer.
A write failure before replacement preserves the existing file.
Successful writes create a file with POSIX mode 0600 where the host supports that mode.
These mode checks do not certify Windows ACLs or power-loss durability.
The [configuration module](plugin_config.py) owns these read and write rules.
Live unified operator management and native Windows diagnosis remain unfinished.

## Version pin (hard requirement)

The gateway runs Futu OpenD **10.2.6208**.
The API client must match that family or the handshake is rejected (`InitConnect check sha error`):

```sh
uv pip install "futu-api==10.2.6208"
```

## Endpoints

A target's `endpoint` is one of three forms.
The token rule uses the `local-channel` handshake.
Filesystem ownership authenticates Unix sockets; they need no token handshake.

| Endpoint | Example | Token |
| --- | --- | --- |
| Unix socket path | `/run/user/1000/odk/futu-poller.sock` | no |
| Windows named pipe | `\\.\pipe\odk-futu-poller` | yes |
| TCP address | `tcp://100.82.50.70:8790` | yes |

For a pipe or `tcp://` endpoint, send the exact shared handshake as the first line:

```json
{"v":1,"token":"<token>"}
```

then the protocol v1 records (`hello`, `data`, `error`, `auth-required`) as before.
Read the trimmed token from `tokenFile`, or fall back to `ODK_CHANNEL_TOKEN_FILE`.
A missing/empty token is refused with a reason on stderr.
The reference host never needs that file for its own Unix socket.

Each target has its own connection and its own reconnect state.
An unreachable desk does not block other desks.
Each connection attempt has a 10-second timeout.
A mid-record disconnect records failure only for that desk.
Other desks still receive the record.
Log the reason after three consecutive failed polls; routine reconnects remain quiet.

## Deploy on the CM5

Python 3.12.11 and `uv.lock` define the worker environment.
`requirements.txt` is a generated compatibility export from that lock.
Run installation commands from the repository root.
Use absolute paths in environment files; these files do not expand `$HOME` or shell variables.
Adapt example usernames, paths, and UIDs to the selected host.

These commands change device configuration/services and require operational authorization; transport tests below are isolated.

```sh
# 1. environment
# Legacy unit only: place its locked environment at the unit-selected path.
UV_PROJECT_ENVIRONMENT="$HOME/.venv/futu" uv sync --project integrations/futu-poller --locked --no-dev

# 2. gateway RSA key (client copy; treat as a secret, mode 0600).
#    Source: frad-nas:/mnt/user/appdata/futuopend/config/rsa_private.pem
install -m 600 rsa_private.pem ~/.config/odk/futu-rsa.pem

# 3. configuration (mode 0600; values never enter the package)
cat > ~/.config/odk/futu-poller.env <<'EOF'
FUTU_HOST=10.10.0.195
FUTU_PORT=11111
FUTU_RSA_FILE=/home/orangepi/.config/odk/futu-rsa.pem
FUTU_TRADE_PWD=<trade-unlock-password>
FUTU_INTERVAL=60
SERVICE_ID=futu-poller
EOF
chmod 600 ~/.config/odk/futu-poller.env

# 4. the desks to feed. `name` is optional and only labels the target in logs.
cat > ~/.config/odk/futu-targets.json <<'EOF'
{"targets":[
  {"name":"local","endpoint":"/run/user/1000/odk/futu-poller.sock"},
  {"name":"handheld","endpoint":"tcp://100.82.50.70:8790",
   "tokenFile":"/home/orangepi/.config/odk/handheld-channel.token"}
]}
EOF
chmod 600 ~/.config/odk/futu-targets.json
```

`ODK_FUTU_TARGETS_FILE` overrides the targets file location (default `~/.config/odk/futu-targets.json`).
Without a targets file, `ODK_FUTU_SOCKET` selects the single Unix socket.
It needs no token handshake.

Declare the shared socket once in `runtime.env`:

```sh
printf 'ODK_FUTU_SOCKET=%s/odk/futu-poller.sock\n' "$XDG_RUNTIME_DIR" >> ~/.config/odk/runtime.env
chmod 600 ~/.config/odk/runtime.env
```

Without `FUTU_TRADE_PWD` the poller reports `auth-required` to every desk and the tile honestly shows "trade unlock needed".

## systemd user unit

`odk-futu-poller.service` is the standalone unit template.
It runs the venv python against `poller.py`, loads `futu-poller.env` and `runtime.env`, and restarts always with `RestartSec=5`.
SIGTERM and SIGINT request cooperative cleanup on the resource owner thread.
The signal handler sets a stop flag without acquiring an event lock.
The SDK temporarily replaces SIGINT during import.
The worker restores the prior handler after import, including import failure.
SIGINT during that import window can still invoke the SDK's immediate-exit handler.
Waiting stops promptly; an active synchronous SDK call must return before cleanup starts.
The supervisor owns the 20-second final shutdown deadline.
Forced termination cannot establish SDK cleanup completion.
The unit is a template: the installer substitutes `__ODK_FUTU_POLLER_DIR__` with the installed integration path, the same pattern the other integration units use.
A manual install is:

```sh
mkdir -p ~/.config/systemd/user
sed "s|__ODK_FUTU_POLLER_DIR__|$PWD/integrations/futu-poller|g" \
  integrations/futu-poller/odk-futu-poller.service \
  > ~/.config/systemd/user/odk-futu-poller.service
systemctl --user daemon-reload
systemctl --user enable --now odk-futu-poller.service
journalctl --user -u odk-futu-poller.service -f
```

## External service package

Use the [external service runtime](../service-runtime/README.md) for install, update, enable, disable, rollback, and removal.
Its contract owns the manager commands and private operator bindings.
The standalone unit above remains a manual deployment path.
Do not run both supervisors for the same worker.

Build a source snapshot from the repository root:

```sh
uv run --project integrations/futu-poller --locked python integrations/futu-poller/build_package.py /absolute/new/futu-package
```

The builder copies a fixed runtime allowlist and generates hashed `service.json` entries.
It excludes credentials, configuration, caches, test fixtures, and virtual environments.
The generic service manager prepares a separate locked environment for each installed revision.
Keep configuration and secrets outside the installed source snapshot.
Do not load the worker into the Shell process.
Python component grants remain trusted native access, without a sandbox.

The readiness command probes the running local management channel:

```sh
uv run --project integrations/futu-poller --locked python integrations/futu-poller/healthcheck.py
```

Set `ODK_FUTU_CONTROL` to the worker's private Unix management socket.
Readiness establishes control-channel availability, not authenticated gateway access or current holdings.
The service package allows sixty seconds for SDK startup, target connections, and control-channel readiness.
Docker uses the same sixty-second startup period.
The service manager stops a worker that exceeds its readiness deadline.
The readiness command currently supports Unix hosts.

### Optional Docker backend

Build the image locally before generating its service package:

```sh
docker build --platform linux/arm64 -t odk-futu-worker:local integrations/futu-poller
docker image inspect --format '{{.Id}}' odk-futu-worker:local
uv run --project integrations/futu-poller --locked python integrations/futu-poller/build_package.py /absolute/new/futu-docker-package --backend docker --image sha256:REPLACE_WITH_ACTUAL_IMAGE_ID --platform linux/arm64
```

Use the actual immutable image ID or a registry digest.
The image pins Python, uv, and base image digests.
It installs the same locked production dependencies as the Python backend.
Its default user is UID 1000 and GID 1000.
The service manager must select the host's required UID and GID.
The image forwards SIGTERM directly to the Python process.

Mount only required private configuration, token files, RSA files, and runtime directories.
Mount secret files read-only.
Use container paths for `FUTU_RSA_FILE`, target files, token paths, and `ODK_FUTU_CONTROL`.
Give the worker write access to its private management directory.
Give the SDK a private writable home directory through `HOME` and an explicit writable state mount.
The pinned SDK creates `.com.futunn.FutuOpenD/Log` under `HOME`, including during import.
Match the Shell user's UID when sharing Unix socket directories.
The container needs network access to the configured external FutuOpenD gateway and desktop TCP targets.
TCP uses a token handshake without TLS; use a protected network.
Docker packaging does not install or start FutuOpenD.

### Publication and credential boundaries

The default publisher fails when no valid desk target exists.
It never falls back to logging private holdings on stdout.
An explicit injected output stream remains available for controlled tests.
The control channel can remain available after publication startup fails.
Valid targets with unreachable listeners retain the existing reconnect behavior.

Channel token files must be canonical absolute regular files with one link and at most 1024 bytes.
POSIX tokens require service-user ownership and mode 0600 or stricter.
Windows tokens require protected ACLs limited to the current user, Administrators, and SYSTEM.
Empty tokens and embedded whitespace are refused before connection.
Token errors do not expose contents or private paths.
Gateway passwords and RSA keys remain operator-provisioned secrets.

## Shell side (tracer bootstrap)

`ODK_FUTU_SOCKET` is absolute under `$XDG_RUNTIME_DIR/odk/` and currently registers the service.
Holdings (`odk.tile.futu`) renders live positions or truthful unavailable state.

Set `ODK_FUTU_SERVICE_REVISION` once in `runtime.env`.
The poller handshake and Shell expectation share that revision instead of separate `dev` values.

## Tests

The transport tests drive the real client against a socket server started in the test; no gateway and no futu SDK are needed:

```sh
uv run --project integrations/futu-poller --locked python -m pytest integrations/futu-poller/tests -q
```

They cover Unix sockets, TCP handshakes, and missing/empty tokens.
Multi-desk fixtures cover connection refusal, mid-record resets, and named malformed-target failures while other desks remain fed.


## Negotiated runtime diagnosis

The default publisher declares `runtime_diagnosis` on readable publishing connections.
The Shell accepts this capability in its existing `hello` acknowledgement.
Older peers retain their existing messages and receive no diagnosis commands.
Python named pipes retain their write-only publishing behavior and do not declare this capability.

The Shell sends `runtime_diagnosis` with the declared service identity and a random 32-character hexadecimal `requestId`.
The publisher returns `runtime_diagnosis_result` with the same identity, request identifier, and public `report`.
The report comes from the current owned Plugin Host.
It does not read the gateway, credentials, or hardware.
The Shell validates report declarations and removes private fields.

The default loop receives requests on its owner thread during the publishing interval.
Custom publishers and injected wait functions retain their existing contracts.
A blocking SDK call can delay diagnosis until that call completes.
The Shell reports timeout without using an earlier report as current state.

The Shell allows 16 pending requests and uses a 500 ms default deadline.
A supplied deadline must be from 1 ms to 2000 ms.
Each request belongs to one negotiated connection.
Disconnect, changed peer identity, cancellation, and server shutdown terminate its pending requests.
An ambiguous service connection cannot supply a diagnosis result.
A failed desk connection does not stop other desk connections.

Main exposes these reports through `odk:plugin-runtime/python-agent/futu-poller/v1`.
`odk plugin diagnose` includes this runtime.
`odk plugin diagnose odk.futu.publisher` selects its publisher state.
Unavailable or incompatible injected sources report unavailable without changing holdings interfaces.
