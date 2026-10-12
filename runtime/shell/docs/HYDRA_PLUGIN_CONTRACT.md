# Hydra source plugin contract

## Ownership

`odk.source.hydra` owns one MQTT client, protocol state, IPC handlers, Open DeskOS Data readings, and cached health.
Main grants its dependencies through `source.hydra` and `ipc`.
The source releases its client before another instance starts.
Failed release retains uncertain ownership and blocks another connection.

## Connection capability

The `source.hydra` capability retains `create` and `options`, and adds `connect`.
`create` remains the existing default source constructor.
`options` retains the broker URL, topic prefix, clock overrides, and update callback.
`connect(url, options)` returns the MQTT SDK client through [the canonical connector](../src/hydra-mqtt.js).
The exported function is `connectHydraMqtt`; it uses the existing MQTT dependency resolution and canonical path.
It does not construct protocol state or a default source.

An independent implementation can call `connect` and own its parsing, readings, health, retry policy, and client lifecycle.
The [independent fixture](../tests/fixtures/hydra-replacement/entry.cjs) uses this capability without an injected connection option.
Existing callers can retain their explicitly injected `options.connectImpl` during the compatibility transition.
Native code remains trusted process code; connection declarations do not provide a sandbox.

## Preserved behavior

The default source retains its existing MQTT connector, subscription scope, reconnect settings, and connection timeout.
Snapshots preserve retained values, live values, timestamps, stale boundaries, diagnostics, soil limits, and watering states.
IPC and Open DeskOS Data share the same source instance.
Health reads cached state without initiating connection retries.
Shutdown suppresses late publications and waits for the client completion callback.
A failed completion does not certify client release.

## Evidence

The [canonical connector checks](../tests/hydra-dependency-resolution.test.js) verify dependency resolution, canonical loading, and raw client return without constructing a source.
The [Main wiring checks](../tests/odk-data-wiring.test.js) inspect the actual Main capability passed to Plugin Host under controlled dependencies.
The [shared cases](../tests/hydra-plugin-parity.test.js) compare default, linked, and signed implementations through IPC, Open DeskOS Data, health, and ownership scenarios.
The [revision cases](../tests/hydra-revision.test.js) exercise actual Native CLI operations and captured signed execution through controlled Node Hosts.
The [wire cases](../tests/hydra-mqtt-wire.test.js) use the installed SDK and real TCP packets through a controlled loopback endpoint.

The [Main bootstrap cases](../tests/hydra-main-bootstrap.test.js) start four distinct actual Main processes with a parent-owned loopback MQTT endpoint.
Actual preload preserves environment and plant snapshots after signed installation, update, rollback, and default restoration.
Each process uses the canonical installed SDK and verifies the executed source revision.
The wrapper changes the clock and update observation, hides its window, and disables unrelated Main factories and packaged content surfaces.
Cached health rejects ordinary snapshots and requires exactly two cached reads.
Normal shutdown releases Hydra IPC and its SDK connection before the parent accepts the process result.

[Coverage](PLUGIN_COVERAGE.md) records commands, results, and remaining gates.

The controlled endpoint does not establish external broker behavior, rendered Hydra consumers, or physical device acceptance.
This bootstrap does not establish complete application startup with all services enabled.
Windows and CM5 require separate host and device evidence.
