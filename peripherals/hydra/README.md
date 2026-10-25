# Hydra desktop firmware

This directory imports the Hydra main and sub firmware under the upstream MIT license.
[UPSTREAM.json](UPSTREAM.json) records the source revision and original file hashes.

The main board is an M5StickC Plus. Each plant uses an M5NanoC6 sub board.
The desktop link sends environmental measurements and plant status through the existing NanoC6 Bridge gateway.
It uses a separate encrypted ESP-NOW unicast peer on the configured fleet channel.
The gateway retains the S3 remote peer.

Without a control key, the main firmware sends telemetry only.
It rejects legacy unicast frames before the fleet decoder.
[HDC1](docs/DESKTOP-CONTROL.md) adds authenticated, bounded watering and relative plans.
The main reads the separate `hydra-control` namespace without writing it.
Its schema is uint8 `schema=1` with a nonzero 32-byte blob named `key`.
Missing, zero, or incomplete keys disable desktop control.
The default build does not provision this key.
It does not accept desktop credentials or update requests.
A radio send result does not prove that an application received a measurement.

The telemetry baseline retains the original upstream domain and sub policy.
The control extension adds an independent main force owner and leaf installation receipts.
It does not change the leaf irrigation policy or the FleetMessage v6 layout.
Physical controls, fleet broadcasts, local irrigation, and fleet pairing retain their existing roles.
The desktop main profile disables Wi-Fi association, MQTT, network recovery, credential delivery, setup portals, and network time synchronization.
An invalid local clock remains invalid.

## Build profiles

Run these commands from this directory:

```sh
pio test -e native
pio run -e main-node -j 2
pio run -e sub-node -j 2
```

`main-node` is the default profile. It reads the `hydra-host` NVS namespace without changing it.
An unconfigured main continues local fleet operation without desktop telemetry.
`main-node-private` explicitly enables private configuration provisioning.
Private preparation and builds require a POSIX host with ownership and file-mode support.
The private tools and guard do not support Windows.
Ordinary builds ignore a leftover private header.

The private profile reads `.local/hydra_host_config.h` at build time.
The offline tool creates this header from an owned JSON file with mode `0600`.
The JSON uses `schemaVersion`, `gatewayMac`, `channel`, `pmk`, and `lmk`.
Prepare the header before the protected build:

```sh
uv run python tools/prepare_firmware_config.py --desk-config /absolute/private/hydra-desk.json --output "$PWD/.local"
```

The output directory must not exist before preparation.
The tool creates it with mode `0700` and verifies the header bytes.
`tools/prepare_pairing.py` prepares the corresponding reviewed gateway configuration without changing a running Bridge.
The `main-node-private` profile requires a private build directory and rejects an active build cache.
Use this protected invocation from this directory:

```sh
umask 077
PLATFORMIO_BUILD_DIR="$PWD/.local/build" PLATFORMIO_BUILD_CACHE_DIR= pio run -e main-node-private -j 2 > .local/private-build.log 2>&1
```

The guard requires an owned `.local` directory with mode `0700` and an owned header with mode `0600`.
It rejects symbolic links and external build directories.
It sets the process file mask before compilation.
Keep compiler output in the private log because diagnostics can quote private source lines.

Provisioning changes only the `hydra-host` namespace. It does not erase fleet settings or the NVS partition.
Successful provisioning requires complete field writes and matching readback.
Failed readback invalidates the configuration marker.
Identical configuration causes no writes.

Private firmware binaries contain keys. Keep those binaries outside source archives and desktop release packages.
No firmware upload or hardware acceptance is part of the local build checks.

## Verification boundaries

[BUILD-VERIFICATION.json](BUILD-VERIFICATION.json) preserves the frozen telemetry baseline checks.
[CONTROL-VERIFICATION.json](CONTROL-VERIFICATION.json) records the separate control extension checks.
The target builds used PlatformIO Core `6.2.0` with isolated package copies and existing library caches.
The platform and Arduino framework URLs select exact source revisions.
Native tests include radio callback stand-ins. They do not establish physical radio delivery or pump operation.
