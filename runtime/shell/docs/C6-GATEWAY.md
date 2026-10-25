# Pluggable peripherals and C6 Gateway

## Decision and implementation status

[ADR-0038](ARCHITECTURE.md#adr-0038) accepts pluggable ESP32 devices as a product direction.
The first gateway target is a USB-connected M5Stack NanoC6 on the Windows x64 handheld.
NanoC6 forwards data between the Shell Host and approved ESP-NOW peers.
Other USB peripherals can connect directly through their own adapters.
The preserved [P4+C6 research](../../../research/esp32-p4-c6-deskos/README.md) does not define this implementation.

This document defines system boundaries and acceptance conditions.
The [gateway source](../src/device-gateway-source.js) validates the firmware handshake and manages the selected USB worker.
The Devices App reads the selected gateway and S3 session through the existing Remote Bridge.
Installed packages use declared device access and separate host grants through the same owner.
The Remote Bridge owns the only C6 serial worker on CM5.
Its Windows port remains unavailable.

## Topology and ownership

```text
Widget (readings) / App (declared actions)
  <-> validated Main/preload interface
Shell device facade / existing Remote client
  <-> private Bridge channel
Remote Bridge / exclusive Host Link
NanoC6 USB CDC gateway
  <-> ESP-NOW
Approved peripherals

Other USB peripherals
  <-> their selected adapters in the same host service
```

| Component | Target responsibility |
| --- | --- |
| Shell Host device service | Discovery, selected identities, exclusive port ownership, state, action validation, and subscriptions |
| Device adapter | Host-specific enumeration and transport; board-specific protocol checks |
| NanoC6 firmware | USB framing, ESP-NOW peer configuration, bounded forwarding, and factual transport results |
| Peripheral firmware | Device capabilities, measurements, commands, and application acknowledgements |
| Widget | Display known state and stale or unavailable conditions |
| App | Request granted actions and show their actual outcomes |
| Firmware tools | Build exact sources, identify artifacts, and write only the selected device after authorization |

Adapters use the existing [plugin lifecycle](ARCHITECTURE.md#current-shell-plugin-composition) where their host supports it.
Firmware components can use the existing [native host](../../../peripherals/common/README.md).
A new board target requires its own descriptor support and compilation checks.
The current S3/P4 report contract does not establish C6 support.
Android device access requires separate implementation and acceptance.

## Discovery, identity, and removal

Device discovery does not open every serial port or reset devices.
USB vendor and product identifiers identify candidates, not a trusted board or compatible firmware.
A selected device requires a stable USB identity and a versioned firmware handshake.
The handshake must identify the board, firmware version, protocol version, boot session, and declared capabilities.
These fields remain untrusted device data until the host validates them.

`COM5` and numbered tty paths are temporary endpoints, not device identities.
Multiple matching devices require explicit selection.
An unknown protocol reports unsupported firmware.
A missing device reports disconnected.
A handshake deadline reports unavailable.
Only a verified handshake permits communication with configured peers.

The Bridge owns the selected C6 port.
The Devices facade and package broker do not create serial workers.
Removal cancels subscriptions and pending work for that connection.
Reconnection creates a new session after a new handshake.
Requests from an old session cannot affect the new session.
Uncertain commands remain unknown; reconnection does not replay them.
Another peripheral's failure cannot stop direct Shell touch, keyboard, or unrelated adapters.

## Host Link and ESP-NOW

NanoC6 uses USB CDC for its Host Link.
A future CM5 adapter can use crossed 3.3 V TTL UART with common ground.
UART selection requires board pin-mux and console-ownership checks.
RS-232 voltage levels are incompatible.

The target Host Link uses versioned UTF-8 JSON Lines.
Each complete record, including its newline, has a maximum size of 512 bytes.
Invalid UTF-8, oversized records, malformed JSON, unknown types, and unsupported versions cannot change host or peer state.
An oversized record must be discarded through its terminating newline before parsing resumes.
Boot logs cannot serve as protocol replies.

The first radio implementation limits each payload to 250 bytes for ESP-NOW v1 compatibility.
The adapter must check encoded byte length before transmission.
The 512-byte Host Link limit does not authorize a 512-byte radio payload.
Fragmentation needs a separate bounded protocol and tests.
The gateway and peers use the same configured radio channel.
The channel must comply with the device's configured regulatory domain.
USB operation does not require the host to join a Wi-Fi network.

The first acceptance slice uses one explicitly configured encrypted peer.
Later slices can add peers within the selected ESP-IDF encrypted-peer limit.
Each peer requires a stable device identity, MAC address, and explicit capability assignment.
PMK and peer LMK values belong in protected provisioning, outside source, application packages, and logs.
Broadcast and unpaired traffic cannot invoke device actions or Shell input.
A peer declaration cannot authorize itself.

The host assigns bounded request identifiers and operation deadlines.
A successful USB write means only that bytes reached the transport.
ESP-NOW send success means only MAC-layer receipt.
An application acknowledgement identifies the corresponding request and its device result.
An acknowledgement timeout reports unknown delivery when an action might have occurred.
Retries require operation-specific idempotency and duplicate detection.
Firmware callbacks pass bounded events to worker queues; they do not perform blocking host writes.
Queue limits and overload results require tests before radio acceptance.

## Widget and App access

Device I/O belongs outside renderer code.
The current source is `odk.source.device-gateway`; its interface is `odk:source/device-gateway/v1`.
The current App is `odk.app.devices` and appears in Built-in views.
The [shared Bridge channel](../../../integrations/remote-bridge/README.md#shared-device-channel) owns device records and transport limits.
Trusted Shell views read `odkPlatform.getDeviceGateway()` and request `deviceGatewayAction({type: 'ping'})`.
The main process permits these methods only for registered Shell main frames.
Widgets receive validated readings with device identity, source time, receive time, and availability.
Open DeskOS Data remains the single registry for measurements that the Shell and Personal Agent share.
An App requests a declared action against a selected device capability.
The host validates the caller, grant, device identity, action schema, size, deadline, and connection session.
Firmware responses and device descriptions cannot become instructions or authorization.

The [package device contract](USER_APPLICATIONS.md#device-access) defines declarations, private grants, and the device SDK.
The host binds authorization to the current installed revision and active frame.
Declarations alone grant no access.
Widgets can read granted state; Apps can send to granted general peers.
Package reads use the shared cached snapshot. They do not open a device.
The S3 Remote peer rejects arbitrary package sends.
Its reserved control packets never become package events.
Package removal, revision changes, or grant revocation stop further access.
The package [sandbox](USER_APPLICATIONS.md#runtime-safety-and-limits) remains in effect.
The existing Declared Data bridge publishes package data; it does not read peripherals or issue device commands.
Trusted [native plugins](NATIVE_PLUGINS.md) retain their separate trust contract and process authority.
Native plugin installation does not make an ordinary HTML package a device client.

## Firmware development lifecycle

The target workflow is device selection, source development, build, artifact inspection, authorized write, reconnection, and application verification.
Each board profile identifies its chip, flash size, USB behavior, toolchain, partition layout, and recovery procedure.
The build result records source revision, configuration, tool versions, artifact hashes, and intended board identity.
Private provisioning data stays outside public build reports.
Device selection and source generation do not authorize firmware installation.

Before an authorized write, the device service stops new work and releases its port.
The firmware tool rechecks the selected identity before a reset or write.
Ambiguity, identity changes, or an occupied port stop the operation.
After a write, the service requires a new identity and protocol check.
An interrupted write reports failure and provides the board's recovery procedure.
It cannot promise automatic rollback without board-specific bootloader and partition support.

The [NanoC6 documentation](https://docs.m5stack.com/en/core/NanoC6) identifies ESP32-C6FH4, 4 MB flash, and CDC support.
Its download procedure uses the front button during USB connection.
That procedure remains an operator step when software cannot enter download mode.
ESP-IDF builds need a pinned, C6-compatible version and target compilation evidence.

## Remote Control compatibility

The gateway is not limited to the S3 Remote Control.
General peripherals do not gain navigation authority.
Only the configured Remote Pair can send validated Remote Messages through the Remote Bridge adapter.
The Shell remains the owner of page state and boundaries.
The gateway cannot derive a new page state or emulate a keyboard for general peer traffic.

The existing Remote Messages retain their separate protocol:

```json
{"v":1,"type":"navigate","direction":"next","id":"request-id"}
{"v":1,"type":"state","page":1,"pages":3,"name":"Overview","canPrev":false,"canNext":true,"link":"wireless"}
```

The wired and C6 adapters retain the [Remote Bridge contract](../../../integrations/remote-bridge/README.md#protocol).
General device forwarding must not bypass its input validators.
A Windows NanoC6 implementation does not certify a Windows Remote Bridge port.

## Implementation and acceptance stages

These stages separate source verification from device acceptance.
The source includes gateway transport, shared Devices state, and granted package access.
The previous S3 radio candidate passed physical navigation acceptance on CM5.
The shared Devices candidate needs separate activated-host acceptance.
General peer communication needs its own peripheral protocol and hardware checks.
Stage 5 remains future work.

| Stage | Required result |
| --- | --- |
| 1. Identify and build | Selected NanoC6 identity, pinned firmware project, host codec, bounded handshake, reproducible build report |
| 2. USB lifecycle | Windows adapter, exclusive ownership, disconnect recovery, malformed-input checks, and unplug tests |
| 3. Radio exchange | One encrypted peer, telemetry, correlated application acknowledgements, deadlines, overload, and channel tests |
| 4. Widget/App integration | Validated readings, granted actions, frame/revision isolation, real Widget display, and App interaction |
| 5. Add devices | Another board profile and adapter, independent build/write lifecycle, and concurrent-device isolation |

The following Given/When/Then cases define acceptance before behavior changes.
Implementation tests belong in the affected host, firmware, and UI suites.

| Given | When | Then |
| --- | --- | --- |
| An unknown USB device | Discovery runs | The device remains unopened and unchanged |
| Two matching NanoC6 candidates | No exact selection exists | The host reports ambiguity and opens neither |
| A selected device | Its protocol is incompatible | The host reports unsupported firmware and sends no actions |
| An active device session | The device disconnects | Its work ends; direct Shell input and other devices remain usable |
| A pending action | A device reconnects under a new endpoint | Old replies cannot complete new work; uncertain actions do not replay |
| A valid connection | Malformed or oversized input arrives | State remains unchanged; the parser recovers at the next record |
| A configured encrypted peer | An unpaired sender transmits | No readings, commands, or Shell input gain authority |
| An ESP-NOW send succeeds | No application acknowledgement arrives | The host reports unknown delivery, not completed interaction |
| A verified package without device grants | It requests an action | The host refuses the request |
| A granted App revision | Its frame closes or the revision changes | Old subscriptions and work cannot affect the replacement |
| A built firmware artifact | No write authorization exists | The current device firmware remains unchanged |
| A selected write target | Its identity changes before reset | The firmware operation stops |

## Acceptance evidence

CM5 radio acceptance used NanoC6 identity `9C:CC:01:34:31:50` and S3 identity `F0:9E:9E:11:23:CC`.
The Bridge owned one C6 serial worker. S3 used ESP-NOW for all control and state traffic.
The operator confirmed physical S3 operation and visible desktop response.
Bridge evidence recorded eleven physical inputs. Desktop evidence recorded six page transitions.
Runtime transport disable and enable recovered through disconnected, synchronizing, and wireless states.
These checks exclude physical unplug recovery, RF-loss recovery, and precise per-input latency.
They certify the previous radio candidate, not the new shared Devices release.

The shared Devices candidate passed actual-preload fixtures across four themes and four widths, including 200% zoom.
The package SDK passed an actual opaque-frame fixture with separate host grants.
These fixtures use controlled data. Activated CM5 Devices and package acceptance remain pending.
General peer sends need a separate peripheral protocol and hardware check.

Earlier Windows checks identified ESP32-C6FH4 revision v0.2 with 4 MB flash.
The authorized firmware write preserved a protected 4 MB backup and verified the new image hashes.
Firmware `0.1.0` passed ten USB pings and five malformed-input cases.
The actual-board Devices preview passed four themes and three sizes, including pointer and keyboard entry.
The preview did not establish encrypted radio exchange or physical unplug recovery.
An enumerated board once stopped replying. Selected chip identification and a reset restored replies without another firmware write.
The cause and long idle stability remain unresolved.

Two Windows activation attempts restored main `2988cf77` after native window admission failures.
Neither attempt completed formal Devices acceptance.
Subsequent CM5 radio acceptance does not certify the Windows Bridge port or Windows formal Devices deployment.

## Technical references

- [M5Stack NanoC6](https://docs.m5stack.com/en/core/NanoC6): board, USB, pin map, and download procedure.
- [Espressif ESP-NOW](https://docs.espressif.com/projects/esp-idf/en/stable/esp32c6/api-reference/network/esp_now.html): payload limits, peers, encryption, callbacks, and acknowledgement limits.
- [Package contract](USER_APPLICATIONS.md): current HTML package authority and verification.
- [Windows runbook](WINDOWS_HOST.md): supported host, private state, transfer, and device acceptance rules.
