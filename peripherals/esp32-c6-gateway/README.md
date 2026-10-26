# NanoC6 USB ESP-NOW gateway

This firmware targets M5Stack NanoC6, ESP32-C6FH4, and 4 MB flash.
The [gateway contract](../../runtime/shell/docs/C6-GATEWAY.md) owns system boundaries and acceptance stages.
The board uses native USB Serial/JTAG for JSON Lines.
It requires no Wi-Fi access point.

## Build and check

Use ESP-IDF v5.5.4.
Activate its environment before these commands.

```sh
idf.py -C peripherals/esp32-c6-gateway -B /tmp/odk-c6-build build
cc -std=c11 -Wall -Wextra -Werror -I peripherals/esp32-c6-gateway/main \
  peripherals/esp32-c6-gateway/main/gateway_line.c \
  peripherals/esp32-c6-gateway/tests/line_test.c -o /tmp/odk-c6-line-test
/tmp/odk-c6-line-test
uv sync --project peripherals/esp32-c6-gateway/tools
node peripherals/esp32-c6-gateway/tools/bundle.mjs /tmp/odk-c6-build /tmp/odk-c6-bundle
```

The bundle directory must be new.
The bundle records the toolchain, flash addresses, and artifact SHA-256 hashes.
Its `sourceRevision` field contains `project_version` from `project_description.json`.
This value does not prove an exact Git commit or source packet.
Record the source packet SHA-256 separately in the build receipt.
Build output and generated device configuration stay outside source control.
The firmware includes no peer keys.

## Windows firmware installation

Firmware installation requires operator authorization.
The serial service must release the selected port first.
The tool environment requires the locked Python dependencies above.
The following command replaces firmware on the selected device.

```powershell
.\flash-windows.ps1 -Bundle C:\path\to\bundle `
  -Python C:\path\to\venv\Scripts\python.exe `
  -SerialNumber 'selected-usb-serial-number' -ConfirmFlash
```

The script verifies artifact hashes and the fixed flash layout before device access.
It selects one Espressif USB endpoint by serial number.
It checks the chip through esptool before flash access.
It saves a protected 4 MB backup under `%LOCALAPPDATA%\odk\firmware-backups` before the write.
Backup files can contain private data.
The script checks the selected USB identity again before the write.
Esptool verifies written data hashes.
An interrupted write requires the NanoC6 download procedure and an authorized retry.
The firmware does not implement OTA or automatic rollback.

The Windows Remote Bridge port remains unavailable.
The standalone Windows firmware installer does not implement that port.
It does not establish formal Devices acceptance on Windows.

## Host configuration

The deployed Devices App consumes the existing shared Remote Bridge.
The Bridge owns the selected C6 serial worker.
The App and package broker do not start another worker.
The [shared gateway contract](../../runtime/shell/docs/C6-GATEWAY.md) defines this ownership.

The following configuration describes the standalone adapter and its separately authorized tests.
Do not start this adapter beside a Bridge-owned C6 connection.
Set `ODK_DEVICE_GATEWAY_CONFIG` to an absolute private JSON file for that adapter.
Use the selected host's Python executable with pyserial installed.
Keep private configuration and launchers outside release directories.
The standalone test launcher supplies this environment variable.
The minimal configuration has no radio peers:

```json
{
  "python": "C:\\path\\to\\venv\\Scripts\\python.exe",
  "serialNumber": "selected-usb-serial-number"
}
```

Optional fields are `channel`, `pmk`, and `peers`.
The channel is an integer from 1 through 11.
`pmk` is a 16-byte key encoded as 32 hexadecimal characters.
Each peer has exactly `mac` and `lmk` fields.
`lmk` uses the same key encoding.
The host permits seven distinct unicast peers.
The peer firmware requires a corresponding encrypted peer configuration and the same channel.
Keys remain in protected host configuration and volatile device memory.
They do not appear in renderer snapshots.
Unix configuration files require mode `0600`.
Windows configuration files require a private user directory and access controls.

The worker's `--inventory` mode lists candidate ports without opening them.
The host opens only the exact selected USB serial identity.
A standalone adapter starts its worker when an authorized test reads the configured source.
Closing that adapter stops its polling and releases its worker.
The deployed App uses the Bridge-owned connection instead.

## Firmware protocol

Each request includes integer `v: 1`, a string `id` of 1–48 bytes, and a `type`.
The maximum record size is 512 bytes, including the newline.
The firmware rejects invalid UTF-8, duplicate keys, malformed JSON, and unsupported versions.

| Type | Additional fields | Result |
| --- | --- | --- |
| `hello`, `status` | None | Board, firmware, boot session, MAC, channel, encrypted peer count, radio state, dropped receive count |
| `ping` | None | USB `ok` reply |
| `configure` | `channel`, `pmk` | Clear prior peers and set the radio channel and PMK |
| `peer` | `mac`, `lmk` | Add one encrypted unicast peer |
| `send` | `peer`, base64 `payload` | Correlated MAC send result; payload maximum 250 bytes |

An `error` result has the original request identity and `ok: false`.
Unknown or malformed request identities receive no correlated reply.
An `rx` event contains peer MAC, boot session, and base64 payload.
Only configured unicast peers can produce forwarded receive events.
The host also checks its peer grant and current boot session.
The receive queue holds eight packets.
A separate single-entry queue holds the send callback result.
The firmware permits one radio send at a time.
Queue overload increments the dropped receive counter.

The source retains up to 16 validated receive events.
It permits 16 pending USB requests with a two-second deadline.
No action automatically retries after a deadline or reconnection.
A MAC receipt does not establish an application acknowledgement.
Each peripheral protocol must define that acknowledgement and duplicate handling before actuator use.

## Widget and App authoring

The trusted Shell provides `odkPlatform.getDeviceGateway()` and `odkPlatform.deviceGatewayAction(request)`.
The Devices App uses the existing App registry and appears in Built-in views.
The status bar's peripheral button also opens Devices.
Its accessible name is `Open Devices`.
The action interface accepts only `{ type: 'ping' }` or `{ type: 'send', peer, payload }`.
Send requires a host-configured peer and a base64 payload within 250 bytes.
Renderer requests cannot provision keys, reset a device, or install firmware.
Only the known Shell main frame can call this IPC channel.
Installed HTML packages retain their existing sandbox and cannot use these methods.

New trusted Widgets can display source snapshots through the same interface.
New trusted Apps can define device-specific controls over granted send operations.
Device-specific measurement schemas and application acknowledgements remain their responsibility.
Ordinary installed packages need the separate device grant bridge described in the gateway contract.

## Verification

```sh
cd runtime/shell
node --test tests/device-gateway.test.js tests/data-source-plugins.test.js tests/config-inventory.test.js
pnpm exec electron tests/device-gateway-electron.cjs
```

The Electron fixture uses an isolated profile and deterministic device state by default.
`ODK_DEVICE_GATEWAY_TEST_CONFIG` selects a real device for separately authorized device acceptance.
That fixture opens the selected port and sends a USB ping.
It does not send peer commands or replace the running Shell release.
Host tests and a USB reply do not establish two-device ESP-NOW acceptance.

The explicit hardware script checks ten USB pings and five malformed-input cases.
It also checks invalid configuration and sends without configured peers.
It requires an unprovisioned gateway and does not configure a radio peer.

```powershell
python check-device.py --serial-number 'selected-usb-serial-number'
```
