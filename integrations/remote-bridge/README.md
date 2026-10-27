# Open DeskOS Remote Bridge

This integration connects the shared Display Shell (`runtime/shell/`) to the ESP32-S3 Remote Control Peripheral (`peripherals/esp32-s3-remote/`).
CM5 remains the reference host. Windows source support uses the same Bridge and an authenticated local pipe.
It does not belong to the preserved P4+C6 DeskOS research line.

A standalone Node.js user service for the Display Shell Remote Control link.
It uses only Node built-ins.
It requires the Shell plugin host from the same source checkout or immutable release.

## Protocol

On Unix, the Bridge listens at `$XDG_RUNTIME_DIR/odk-remote/bridge.sock`, matching the Display Shell client.
The socket mode is `0600`; its containing runtime directory is created with mode `0700`.
Windows uses the authenticated pipe contract in the [Windows runbook](../../runtime/shell/docs/WINDOWS_HOST.md#remote-bridge-source).
A Windows client must authenticate before it receives state or sends device requests.
Every message is one UTF-8 JSON record terminated by `\n`, is limited by the connected peer implementation, and has `"v": 1`.

- `link`: emitted by the bridge as `{ "v": 1, "type": "link", "state": "disconnected" | "syncing" | "usb" | "wireless" }`. `usb` only denotes the `usb-cdc` adapter; all non-USB adapters report `wireless`.
- `state`: sent by Display Shell as `{ "v": 1, "type": "state", "page", "pages", "name", "canPrev", "canNext", "link"? }`. The bridge rejects incomplete or contradictory page boundaries.
- `navigate`: emitted by a legacy Remote Link adapter and relayed to the Display Shell as `{ "v": 1, "type": "navigate", "direction": "previous" | "next" }`.
- `input`: emitted by a Remote Touchpad adapter and relayed as `{ "v": 1, "type": "input", "input": "left" | "right" | "up" | "down" | "primary" | "secondary" | "back" | "mic" | "action" }`. `secondary` is a long-press request; `action` requires a valid `action` ID. Unversioned, unsupported-version, and invalid records are discarded.

Single and multiple transport Hosts use the same existing navigation and Remote input validators.
Both forward accepted records unchanged.
Disabled transport plugins cannot relay further input.

The bridge retains the latest valid Shell state unchanged.
On connection, publish `syncing`.
Send adapter state with `link: "wired"` for USB CDC or `link: "wireless"` for UART/C6.
Then publish the factual `usb` or `wireless` link state.

## Wired adapter

`UsbCdcAdapter` finds exactly one `/dev/serial/by-id/` entry matching either the normalized legacy `Open DeskOS Remote` name or fixed Espressif USB JTAG serial identity.
It does not inspect or open numbered `ttyACM` paths.
No matching device reports `device-not-found`; several matches report `ambiguous-device`.
The adapter scans periodically, handles stream failure as disconnect, and resends the retained shell state after reconnection.

The `RemoteLinkAdapter` boundary provides `start`, `stop`, `send`, and `connected`/`disconnected`/`message` events, and is also used by the ESP-NOW adapter.

## Plugin lifecycle

### Runtime diagnosis

Both Bridge entry points accept `runtime_diagnose` requests on their existing local channel.
Each request contains version 1, its type, and a bounded `requestId`.
The response uses `runtime_diagnosis` and the same request identity.
It identifies the `remote-bridge` host and `bridge` instance.
The shared Shell validator excludes private errors, device details, and retained Shell state.
Lifecycle states do not certify device connection or physical input.

The Shell uses a separate short connection for each diagnosis request.
Windows diagnosis connections authenticate with the same host token as the permanent Shell connection.
Existing link, navigation, and input connections retain their protocol and size limits.
Diagnosis does not select transports or send device commands.
Older bridges ignore the request and reach its timeout without losing the existing input connection.

The client permits 16 pending requests, a 500 ms deadline, and 64 KiB of incoming data per request.
Cancellation closes only the diagnostic connection.
The responder closes a diagnostic client when its queued response would exceed 64 KiB.

### Resource ownership

Both `RemoteBridge` and `RemoteBridgeHost` use the common Shell plugin host.
The listener starts before transport plugins.
Windows also starts the required control listener before the C6 worker.
A required listener failure prevents worker startup.
Each Windows channel permits 32 connections, including clients that await authentication.
Transports stop before the listener closes.
Each transport owns its event subscriptions.
Successful cleanup removes these subscriptions, including after a startup failure.
Cancellation prevents retained subscriptions from dispatching transport events.
A failed transport stop retains its listener provider until cleanup succeeds.
Public ports become unavailable while cleanup retains resources.
Repeated stop requests retry incomplete phases without repeating successful cleanup.
Listener cleanup retains the server or socket ownership until the corresponding operation succeeds.
USB stop waits for pending device opening and retains a connection whose cleanup fails.
Retained connections cannot relay input or accept writes.
An OS descriptor close error remains unresolved because another close could affect a reused descriptor.
The adapter reports that failure and blocks replacement.

`pluginCatalog()` reports plugin declarations and current lifecycle states.
`setTransportEnabled(id, enabled)` changes a registered transport's state.
The multiple transport host selects an available fallback when its active plugin stops.
The listener remains open during transport changes.

The Plugin CLI routes explicit `--runtime` enable and disable operations to the Bridge control plugin.
Use `odk plugin disable <transport-id> --runtime` to stop one registered transport.
Use `odk plugin enable <transport-id> --runtime` to restore it through the existing host lifecycle.
These commands preserve startup preferences and do not stop the listener or control plugin.
The separate control channel uses the shared local ownership and token authentication rules.
[Shell configuration](../../runtime/shell/docs/CONFIGURATION.md#explicit-runtime-management) owns endpoint mapping and management limits.
The single adapter bridge still reports an adapter startup failure to its caller.

`lib/plugin-runtime.js` loads `runtime/shell/src/plugin-host.js` in a source checkout.
It loads `src/plugin-host.js` in an immutable release.
The service requires this kernel beside the installed integration tree.

## Run

This opens the real socket and discovers hardware; do not start beside the installed instance.
Service installation/restart needs authorization.

```sh
XDG_RUNTIME_DIR=/run/user/$(id -u) \
  node integrations/remote-bridge/lib/main.js
```

`systemd/odk-remote-bridge.service` is provided for user-session installation.
Its integration with the CM5 installer is intentionally outside this subtree.

## Test

```sh
node --test integrations/remote-bridge/test/*.test.js
```

## Development

`lib/main.js` starts the service.
The existing `bin/odk-remote-bridge.js` wrapper calls the same entry.
`lib/remote-bridge.js` owns socket/relay lifecycle; `lib/protocol.js` validates records; `lib/usb-cdc-adapter.js` discovers wired devices.
Use 2-space CommonJS and Node built-ins only.
The installer substitutes `__ODK_REMOTE_BRIDGE_DIR__` with the installed integration path.

The host suite uses temporary channels and controlled serial transports without a connected Remote.
The Windows contracts use injected platform inputs and controlled endpoints.
Scenarios live in `test/features/remote-bridge-host.feature`; regressions belong in matching `test/*.test.js` files.
Missing or ambiguous hardware must not block direct Shell input.
Mock tests do not prove CM5 USB enumeration or reconnection.
They do not prove Windows native pipes, token-file ACLs, COM ownership, interactive startup, or actual-board acceptance.

### Trusted external transport selections

The startup entry accepts `--plugin-selection FILE` with explicit `--trust-plugins`.
Native trust is required before the entry reads the selection file.
The selection contains `schemaVersion: 1` and a `replacements` array with at most 16 entries.
Each entry contains a complete `manifest` and an absolute `.cjs` `entry` path.
The selection file must be a regular file within 16 KiB.

Each manifest uses host `remote-bridge`, kind `transport`, and an identity under `odk.remote.transport.`.
It provides only `odk:remote/transport/<id>/v1` and requires `odk:remote/listener/v1`.
Permissions must be empty.
The manifest declares a nonnegative integer `priority` and transport `usb-cdc` or `wireless`.
Identity `odk.remote.transport.usb-cdc` retains priority 100 and transport `usb-cdc`.
Duplicate identities and incompatible declarations are rejected before factory execution.

The module exports `create(context, manifest)` and returns its actual transport instance.
The instance supplies callable `on`, `off`, `start`, `stop`, and `send` operations.
Its manifest identity, priority, and transport must match the selection.
Optional `init` runs in the multiple transport Host.
Optional `destroy` runs after successful stop.
Factories register allocation cleanup through `context.onCleanup` before operations that can fail.
Factories emit input and connection events after the Host attaches listeners and calls `start`.

On Unix, startup without a selected USB identity retains the built-in USB Adapter.
Windows startup requires an explicit ESP-NOW gateway configuration before any transport factory runs.
Additional selected transports use the existing multiple transport Host and priority policy.
Shutdown failures return a nonzero process status.
Lifecycle diagnosis does not certify physical connection or input behavior.

These inspection commands create no socket and execute no external entry or device discovery:

```sh
node integrations/remote-bridge/lib/main.js --plugins list
node integrations/remote-bridge/lib/main.js --plugin-selection /absolute/selection.json --trust-plugins --plugins validate
```

Selected native modules remain trusted mutable code with normal CommonJS caching.
Declarations do not sandbox module imports or filesystem access.
This entry does not provide production signatures, immutable revisions, reload, or rollback.

## ESP-NOW-only mode

This mode connects the S3 Remote through a NanoC6 gateway.
It registers only `odk.remote.transport.esp-now`.
It never constructs the USB Remote adapter.
Gateway failure reports `disconnected` without USB Remote fallback.
NanoC6 retains its USB CDC Host Link in this mode.
Local Shell touch and keyboard input retain their existing behavior.

```sh
node integrations/remote-bridge/bin/odk-remote-bridge.js --esp-now-config /private/gateway.json
```

The service also accepts `ODK_REMOTE_ESPNOW_CONFIG` from `~/.config/odk/remote-bridge.env`.
Set that variable to the same absolute private JSON path.
The command option overrides the environment selection.
Keep this environment file outside immutable releases.
The configuration file requires private permissions and an absolute path.
It contains `python`, `serialNumber`, `channel`, `pmk`, and encrypted `peers` entries with `mac` and `lmk`.
The existing one-peer configuration selects that peer as the Remote.
Multiple peers require `remoteMac` to select exactly one configured Remote peer.
`python` selects an absolute executable path with pyserial installed.
`serialNumber` selects the NanoC6 USB identity, independently of numbered serial paths.
`channel` is an integer from 1 through 11.
Both keys contain 32 hexadecimal characters.
The peer MAC selects the S3 station interface.
The [S3 pairing image](../../peripherals/esp32-s3-remote/README.md#private-pairing) stores the corresponding gateway MAC and keys.
Do not combine this mode with an external transport selection.
Offline `--plugins list` inspection does not read keys or open devices.

The transport owns one exclusive gateway worker.
Do not run another serial source, monitor, or hardware checker beside it.
The Shell Devices facade uses the existing Remote client connection.
Installed Widgets/Apps use the same facade through the granted [package device SDK](../../runtime/shell/docs/USER_APPLICATIONS.md#device-access).

### Shared device channel

The existing private Bridge channel carries bounded device records alongside Remote records.
Unix uses its private socket. Windows uses the authenticated host pipe.
Opening Devices does not start another worker or configure another gateway.
Device requests use this envelope:

```json
{"v":1,"type":"device_request","requestId":"00000000-0000-4000-8000-000000000001","action":{"type":"status"}}
```

Replies use `device_reply` with the same `requestId` and a `result` object.
Subscribed clients receive `device_snapshot` and general `device_event` records.
Device lines have a 2048-byte limit.
Each connection permits eight pending device actions and a 64 KiB write queue.
Slow clients close without blocking Remote state updates.

Gateway firmware state and Remote session state remain separate.
`remote.status` becomes `ready` only after the current S3 state acknowledgement.
The client clears readiness and events after 3500 milliseconds without a fresh snapshot.
Reconnect never replays an action.
Snapshots omit pairing keys, configuration paths, and reserved Remote payloads.
Snapshots retain at most two general receive events; `device_event` supplies the bounded live stream.

Device actions are `status`, `ping`, and `send`.
`send` accepts a configured general peer and canonical base64 data of at most 250 decoded bytes.
It rejects the entire Remote peer and the reserved `ODKR` prefix.
Success reports `mac-receipt`, not application completion.
An uncertain send reports unknown delivery without automatic retry.
General received traffic never invokes Shell navigation.

### Radio frames

Encrypted unicast packets use the gateway's existing 250-byte payload limit.
All integers use little-endian encoding.
The fixed header occupies 24 bytes.

| Offset | Field |
| --- | --- |
| 0–3 | ASCII `ODKR` |
| 4 | Protocol version 1 |
| 5 | Type: HELLO=1, HELLO_ACK=2, INPUT=3, STATE=4, STATE_ACK=5 |
| 6–7 | Zero-based fragment index and fragment count |
| 8–11 | Nonzero S3 boot identity |
| 12–15 | Bridge boot identity; zero before handshake |
| 16–19 | Sequence number |
| 20–21 | Complete payload length |
| 22–23 | Reserved zero bytes |

State JSON occupies at most 512 bytes across three fragments.
Reassembly uses one fixed buffer and a one-second deadline.
Malformed lengths, conflicting duplicates, embedded terminators, and retired sequences cannot commit state.
Only complete valid state produces `STATE_ACK`.
The Bridge publishes `wireless` after that acknowledgement.
A gateway MAC receipt alone does not establish synchronization.

State conversion preserves page boundaries and exact supported action identifiers.
It bounds name and label UTF-8 lengths to the existing display buffers.
Unsupported action identifiers are omitted.
State that cannot fit the bounded payload remains unsynchronized.

The S3 sends a heartbeat each second.
Each side expires the connection after 3.5 seconds without its peer's heartbeat.
The host challenge binds input to the current S3 and Bridge boot identities.
The Bridge rejects duplicate input sequences and undeclared action identifiers.
Input occupies one frame and is never queued for reconnection or automatically retried.
The S3 clears contextual actions after heartbeat expiry.
Radio reception and transmission callbacks use bounded queues.
Physical gestures and actual Shell navigation require separate hardware acceptance.
