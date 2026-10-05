# Open DeskOS Remote Bridge

This integration connects the active CM5 runtime (`runtime/shell/`) to the ESP32-S3 Remote Control Peripheral (`peripherals/esp32-s3-remote/`).
It does not belong to the preserved P4+C6 DeskOS research line.

A standalone Node.js user service for the Display Shell Remote Control link.
It uses only Node built-ins.

## Protocol

The bridge listens at `$XDG_RUNTIME_DIR/open-deskos-remote/bridge.sock`, matching the Display Shell client.
The socket mode is `0600`; its containing runtime directory is created with mode `0700`.
Every message is one UTF-8 JSON record terminated by `\n`, is limited by the connected peer implementation, and has `"v": 1`.

- `link`: emitted by the bridge as `{ "v": 1, "type": "link", "state": "disconnected" | "syncing" | "usb" | "wireless" }`. `usb` only denotes the `usb-cdc` adapter; all non-USB adapters report `wireless`.
- `state`: sent by Display Shell as `{ "v": 1, "type": "state", "page", "pages", "name", "canPrev", "canNext", "link"? }`. The bridge rejects incomplete or contradictory page boundaries.
- `navigate`: emitted by a legacy Remote Link adapter and relayed to the Display Shell as `{ "v": 1, "type": "navigate", "direction": "previous" | "next" }`.
- `input`: emitted by a Remote Touchpad adapter and relayed as `{ "v": 1, "type": "input", "input": "left" | "right" | "up" | "down" | "primary" | "secondary" | "back" | "mic" | "action" }`. `secondary` is a long-press request; `action` requires a valid `action` ID. Unversioned, unsupported-version, and invalid records are discarded.

The bridge retains the latest valid Shell state unchanged.
On connection, publish `syncing`.
Send adapter state with `link: "wired"` for USB CDC or `link: "wireless"` for UART/C6.
Then publish the factual `usb` or `wireless` link state.

## Wired adapter

`UsbCdcAdapter` finds exactly one `/dev/serial/by-id/` entry matching either the normalized legacy `Open DeskOS Remote` name or fixed Espressif USB JTAG serial identity.
It does not inspect or open numbered `ttyACM` paths.
No matching device reports `device-not-found`; several matches report `ambiguous-device`.
The adapter scans periodically, handles stream failure as disconnect, and resends the retained shell state after reconnection.

The `RemoteLinkAdapter` boundary provides `start`, `stop`, `send`, and `connected`/`disconnected`/`message` events, so a future CM5 UART plus C6 Gateway adapter can use unchanged JSON Lines records.

## Run

This opens the real socket and discovers hardware; do not start beside the installed instance.
Service installation/restart needs authorization.

```sh
XDG_RUNTIME_DIR=/run/user/$(id -u) \
  node integrations/remote-bridge/bin/open-deskos-remote-bridge.js
```

`systemd/open-deskos-remote-bridge.service` is provided for user-session installation.
Its integration with the CM5 installer is intentionally outside this subtree.

## Test

```sh
node --test integrations/remote-bridge/test/*.test.js
```

## Development

`bin/open-deskos-remote-bridge.js` starts the service.
`lib/remote-bridge.js` owns socket/relay lifecycle; `lib/protocol.js` validates records; `lib/usb-cdc-adapter.js` discovers wired devices.
Use 2-space CommonJS and Node built-ins only.
The installer substitutes `__OPEN_DESKOS_REMOTE_BRIDGE_DIR__` with the installed integration path.

The host suite uses temporary Unix sockets and injected/mock serial transports without a connected Remote.
Scenarios live in `test/features/remote-bridge-host.feature`; regressions belong in matching `test/*.test.js` files.
Missing or ambiguous hardware must not block direct Shell input.
Mock tests do not prove CM5 USB enumeration or reconnection.
