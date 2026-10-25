# Hydra source plugin contract

## Ownership

`odk.source.hydra` owns telemetry state, IPC handlers, Open DeskOS Data readings, and cached health.
Main grants its dependencies through `source.hydra` and `ipc`.
The default source subscribes to the existing Bridge device facade.
Bridge retains exclusive gateway ownership. Hydra does not open serial ports or another Bridge connection.
Shutdown releases subscriptions. A failed release retains cleanup ownership for retry.

## Default ESP-NOW source

Main supplies `createDefault` from [the ESP-NOW source](../src/hydra-espnow.js).
The default plugin passes the same optional device facade used by Devices.
Old MQTT URL and topic settings do not select a network transport or provide fallback.
An absent facade leaves Hydra unavailable without blocking other Shell input.

The private profile is `${XDG_STATE_HOME:-$HOME/.local/state}/odk/hydra-espnow.json` on CM5.
Main resolves the corresponding platform state directory on other hosts.
The profile contains only `{"schemaVersion":1,"peer":"02:11:22:33:44:55"}` or a null peer.
It contains no pairing keys or credentials.
Unix files must belong to the Shell user and deny group and other access.
The reader refuses symbolic links, invalid UTF-8, unknown fields, and files larger than 1024 bytes.
Selection writes use private temporary files, atomic rename, and serialized admission.

The `odk-hydra-device` channel accepts `status`, `bind`, and `unbind` for association management.
Every call requires an authorized Shell main frame.
Status returns a management snapshot directly:

```json
{"transport":"esp-now","peer":null,"status":"unconfigured","availablePeers":[],"nodes":[]}
```

Management status is `unconfigured`, `unavailable`, `syncing`, or `live`.
An accepted hello can add `firmware` and `clockValid`.
`availablePeers` lists configured general Bridge peers. The reserved Remote peer is excluded.
Bind accepts only one of those identities. Unbind stores a null selection.
Mutations return `ok` and an optional bounded error code.
Queued mutations recheck frame authority before profile writes.
Selection changes clear previous readings and sessions before subscribing to the new identity.
Generation guards reject callbacks captured for a previous selection.
Association management provides no pump, pairing, firmware, or arbitrary send operation.

## Confirmed desktop control

The same authorized host channel has a separate confirmed-control interface.
It accepts `prepare-water`, `prepare-stop`, `prepare-plan`, `confirm`, `cancel`, and `control-visibility`.
Preparation returns a bounded summary and a short-lived, single-use confirmation token.
It sends no actuator command before the user confirms that token.
The broker owns the separate control key. It never returns key material to the renderer.
Confirmation uses a fresh HMAC-authenticated device challenge for the exact prepared action.
A generic peer-send grant provides neither the key nor confirmation authority.

Devices presence expires after one second. Closing Devices cancels pending confirmation and stops heartbeats.
A watering lease releases only its desktop force owner. Physical controls remain independent.
An unknown result cannot trigger action replay or restart heartbeats.
Plan acceptance, leaf installation, and actual pump execution remain separate observations.
The [desktop control wire contract](../../../peripherals/hydra/docs/DESKTOP-CONTROL.md) owns packet, lease, replay, and relative plan rules.

Source integration and local checks do not authorize hardware operations.
Actual keys, NVS, pairing, flashing, deployment, and live pump commands remain outside this source work.

## Telemetry lifecycle

The source reads bounded general events, not the two-event snapshot cache.
The [Hydra ESP-NOW contract](HYDRA_ESPNOW.md) owns the wire schema, numeric limits, and pairing preparation.
Messages must match the selected peer and that versioned telemetry schema.
A hello establishes each session. Duplicate sequences and recently retired boots cannot publish readings.
Recent retirement records expire after ten seconds and remain bounded to 64 entries.
Events older than ten seconds, future receipt times, and negative measurement times are refused.
New sessions require a fresh hello after gateway loss or heartbeat expiry.

Hydra application liveness expires after ten seconds.
The general Bridge peer's 3500-millisecond freshness does not define Hydra liveness.
Environment and node ages use the firmware's measurement age, not the display refresh time.
Environment age retains its five-minute limit. Node age retains its three-minute limit.
Offline readings remain historical and explicitly stale. An invalid environment message clears the environment.
Clock validity is reported separately and never creates a fabricated sensor timestamp.

## Connection capability

The `source.hydra` capability retains legacy `create`, `options`, and `connect`.
`create` remains the existing MQTT source constructor for explicit trusted replacements and legacy fixtures.
`createDefault` selects the production ESP-NOW constructor without changing the legacy capability.
`options` retains the broker URL, topic prefix, clock overrides, and update callback.
`connect(url, options)` returns the MQTT SDK client through [the canonical connector](../src/hydra-mqtt.js).
The exported function is `connectHydraMqtt`; it uses the existing MQTT dependency resolution and canonical path.
It does not construct protocol state or a default source.

An independent implementation can call `connect` and own its parsing, readings, health, retry policy, and client lifecycle.
The [independent fixture](../tests/fixtures/hydra-replacement/entry.cjs) uses this capability without an injected connection option.
Existing callers can retain their explicitly injected `options.connectImpl` during the compatibility transition.
Native code remains trusted process code; connection declarations do not provide a sandbox.

The default now declares an optional dependency on `odk:source/device-gateway/v1`.
This changes its dependency graph, not the Hydra reading port or legacy capability methods.
Old signed sources can retain startup selection and activation between matching legacy graphs.
Restoring the default uses the existing explicit recomposition policy.
Hot activation from the new default to an old empty dependency graph remains refused before resource release.
Use a compatible graph or an authorized restart. Do not infer universal runtime replacement compatibility.

## Preserved behavior

The explicit legacy source retains its MQTT connector, subscription scope, reconnect settings, and connection timeout.
Public snapshots retain environment units, timestamps, diagnostics, soil limits, watering states, and node identity.
The existing Hydra Widget, App, reading ID, and source port remain unchanged.
IPC and Open DeskOS Data share the same source instance.
Health reads cached state without initiating connection retries.
The legacy shutdown waits for its MQTT completion callback. A failed completion does not certify client release.

## Evidence

The [canonical connector checks](../tests/hydra-dependency-resolution.test.js) verify dependency resolution, canonical loading, and raw client return without constructing a source.
The [Main wiring checks](../tests/odk-data-wiring.test.js) inspect the actual Main capability passed to Plugin Host under controlled dependencies.
The [shared legacy cases](../tests/hydra-plugin-parity.test.js) compare explicit MQTT constructors and replacements through IPC, readings, health, and ownership scenarios.
The [revision cases](../tests/hydra-revision.test.js) exercise actual Native CLI operations and captured signed execution through controlled Node Hosts.
The [wire cases](../tests/hydra-mqtt-wire.test.js) use the installed SDK and real TCP packets through a controlled loopback endpoint.

The [Main bootstrap cases](../tests/hydra-main-bootstrap.test.js) explicitly select the legacy factory and prior graph with a loopback MQTT endpoint.
Actual preload preserves environment and plant snapshots after signed installation, update, rollback, and default restoration.
Each process uses the canonical installed SDK and verifies the executed source revision.
The wrapper changes the clock and update observation, hides its window, and disables unrelated Main factories and packaged content surfaces.
Cached health rejects ordinary snapshots and requires exactly two cached reads.
Normal shutdown releases Hydra IPC and its SDK connection before the parent accepts the process result.

[Coverage](PLUGIN_COVERAGE.md) records commands, results, and remaining gates.

The [ESP-NOW host cases](../tests/hydra-espnow.test.js) verify telemetry validation, session isolation, freshness, private selection, and cleanup.
The [source wiring cases](../tests/data-source-plugins.test.js) reject MQTT construction while an old broker URL remains configured.
They use one injected Bridge facade and preserve the existing Hydra reading interface.
These cases do not establish encrypted hardware delivery or physical Hydra sensor acceptance.

The [ESP-NOW Main fixture](../tests/hydra-espnow-main.test.js) uses actual Main, preload, and the unchanged Hydra Widget and App.
A controlled adapter supplies telemetry through a real private Bridge socket and the default source graph.
Legacy MQTT constructors reject calls while the old broker URL remains set.
The fixture requires one shared Bridge connection. It does not use a serial device or establish physical acceptance.

Legacy endpoint tests do not establish external broker behavior or physical device acceptance.
The isolated Main fixtures do not establish complete startup with all services enabled.
Windows and CM5 require separate host and device evidence.
