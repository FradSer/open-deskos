# Hydra through ESP-NOW

## Ownership

The default Hydra source uses the existing Bridge device facade.
It does not start another serial worker, socket, or MQTT connection.
The selected Hydra controller supplies environment readings and its watering-node reports.
The existing Hydra Widget, App, and Open DeskOS Data retain their measurement interfaces.
The [source contract](HYDRA_PLUGIN_CONTRACT.md) defines those interfaces and explicit legacy replacement capabilities.

```text
Hydra watering nodes <-> Hydra main controller
                         -> encrypted ESP-NOW unicast
                         -> NanoC6 -> sole Bridge -> Hydra source
                                                   -> Devices
                                                   -> Hydra Widget / App / Data
```

The controller uplink uses one configured encrypted peer.
The existing S3 Remote retains its reserved peer, protocol, and channel.
The local Hydra fleet retains its existing broadcast protocol and watering authority.
Encrypted controller telemetry does not establish encryption of that local fleet.
The [firmware project](../../../peripherals/hydra/README.md) owns builds, private provisioning, and hardware acceptance.

## Telemetry protocol

Each payload is one UTF-8 JSON object with a maximum encoded size of 250 bytes.
The transport carries canonical Base64 through the existing Bridge channel.
The source accepts only the explicitly associated, configured general peer.
It rejects unknown fields, invalid types, unsupported versions, malformed UTF-8, and oversized records.
It never interprets raw Hydra fleet frames as desktop telemetry.

Every object has these fields:

| Field | Contract |
| --- | --- |
| `p` | Literal `hydra` |
| `v` | Integer `1` |
| `k` | `hello`, `env`, or `node` |
| `boot` | Sixteen lowercase hexadecimal characters identifying the controller session |
| `seq` | Increasing integer from 1 through 4294967295 within that session |

`hello` establishes the session before measurements can arrive.
Its additional fields are `firmware`, `uptime`, and `clock`.
`firmware` contains 1–24 printable ASCII characters. `uptime` is an unsigned 32-bit count of seconds.
`clock` reports whether the controller has valid local time.
The controller repeats its announcement within three seconds.
The source expires its application connection after ten seconds without a current announcement.

`env` adds `age` and Boolean `valid`.
`age` is the unsigned 32-bit measurement age in milliseconds.
When `valid` is false, the record has no measurement fields.
When `valid` is true, these fields are required:

| Field | Unit and accepted range |
| --- | --- |
| `tc` | Temperature in degrees Celsius, −50 through 100 |
| `rh` | Relative humidity in percent, 0 through 100 |
| `hp` | Pressure in hPa, 100 through 1300 |
| `lx` | Illuminance in lux, 0 through 200000, or `null` |
| `vp` | VPD in kPa, 0 through 100, or `null` |

`node` adds `id`, `age`, `online`, `soil`, and `status`.
`id` identifies watering node 1 through 6. `age` measures time since its last status report.
`online` is Boolean. `soil` contains 0–100 percent, or `null` for an unavailable measurement.
`status` is `IDLE`, `PULSE`, `SOAK`, `WATER`, `PAUSE`, `WAIT`, `DORM`, or `FAULT`.
`PULSE` and `WATER` indicate pump operation. `SOAK` indicates a cycle without an energized pump.

The active session rejects duplicate sequences, older sequences, and recently retired boot identifiers.
These checks limit queued telemetry within the freshness window. They do not authenticate a new session after a receiver reset.
Measurement time comes from Bridge receipt time minus the reported age.
Environment readings expire after five minutes. Node readings expire after three minutes.
Bridge loss and application-heartbeat expiry also mark retained measurements stale.
Repeated cached telemetry does not refresh its original measurement time.
Missing or invalid readings remain unavailable.

## Devices management

Devices lists configured general peers in its Hydra controller selector.
Select the controller. Select **Use for Hydra**.
The host saves the association in its private state directory as `hydra-espnow.json`.
The file contains only `schemaVersion: 1` and `peer`, which is a unicast MAC address or `null`.
Unix hosts require private, user-owned storage. The runtime refuses symbolic-link profiles.
The association changes neither radio keys nor the S3 Remote identity.

Devices distinguishes unconfigured, unavailable, synchronizing, and connected Hydra states.
It shows the selected controller, firmware, clock availability, and plant readings.
**Remove association** clears the Hydra selection and its cached session.
The gateway and local watering continue under their existing owners.
Only registered Shell main frames can change this association.

## Confirmed control

Devices provides bounded watering and relative plans through the same Bridge facade.
The host signs [HDC1 packets](../../../peripherals/hydra/docs/DESKTOP-CONTROL.md) outside the renderer.
An ordinary package send grant does not provide signing authority.
The complete S3 peer remains reserved for Remote Control.

The host reads `hydra-control.key` from its private state directory.
This file contains exactly 32 binary key bytes.
An all-zero key is invalid.
The firmware requires the matching separate control key in its reviewed NVS namespace.
The host does not create or provision either key.
Missing or unsafe keys disable control while telemetry remains available.

POSIX control files require the current user's ownership, mode `0600`, one link, and safe parent directories.
The host rejects symbolic links and files that change during a read.
Windows control remains unavailable because this implementation does not verify Windows ACLs.
These restrictions do not change the existing telemetry interface.

For manual watering:

1. Open **Devices**.
2. Select a plant.
3. Set a duration from 1 through 30 whole seconds.
4. Select **Review watering**.
5. Check the plant and duration in the confirmation summary.
6. Select **Confirm** within 30 seconds.

Preparation requests authenticated status without sending a watering action.
Confirmation obtains a fresh challenge and signs the prepared action once.
**Review stop** prepares release of the desktop watering owner only.
It does not cancel independent physical watering.

Desktop watering requires the Devices view to remain visible.
Closing or hiding Devices stops host heartbeats and cancels pending confirmation.
The device releases its desktop owner after one second without accepted contact.
No heartbeat can extend the original fixed lease.

The four-hour plan has at most four entries.
Each entry selects an offset from 0 through 239 minutes, a watering intent, and a day or night marker.
This marker records the author's label. It does not select a sensor condition.
Offsets must increase strictly.
The plant node starts the relative window when it installs the plan.
**Review routine pause** prepares an empty plan without disabling critical-dry protection.

The host reserves each plan sequence before transmission in private `hydra-control-plan-sequences.json` state.
An unknown result does not release the reserved sequence.
The current protocol does not report the device's previous plan sequence.
The controller can reject a host proposal when its existing sequence is higher.
An unsafe sequence file disables plan submission without disabling bounded manual watering.

Devices distinguishes controller admission, plant installation history, rejection, and an unknown result.
Neither admission nor installation history proves current plan activity or pump execution.
Host watering contact does not prove that the device accepted each heartbeat.
The physical-owner indicator describes the last authenticated acknowledgement, not a live leaf-button state.
An unknown action is not retried automatically.

## Pairing and verification

Radio pairing precedes the Devices association.
The offline [pairing tool](../../../peripherals/hydra/tools/prepare_pairing.py) prepares private files for operator review.
It preserves the existing Remote peer and PMK, then creates one new controller LMK.
It requires explicit controller and gateway radio identities.
It does not install configuration or write firmware.

Firmware writes, live pairing changes, and production activation require separate authorization.
Host tests and firmware builds do not establish a working physical radio link.
Real acceptance requires the selected controller, matching channel and keys, fresh readings, and observed disconnection recovery.
The [Espressif transport documentation](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/network/esp_now.html) defines encryption and delivery limits.
MAC receipt alone does not establish application receipt or completed watering.
