# Open DeskOS Remote Bridge

This integration connects the active CM5 runtime (`runtime/linux/`) to the required ESP32-S3 Remote Control Peripheral (`peripherals/esp32-s3-remote/`). It does not belong to the preserved P4+C6 DeskOS research line.

A standalone Node.js user service for the Display Shell Remote Control link. It uses only Node built-ins.

## Protocol

The bridge listens at `$XDG_RUNTIME_DIR/open-deskos-remote/bridge.sock`, matching the Display Shell client. The socket mode is `0600`; its containing runtime directory is created with mode `0700`. Every message is one UTF-8 JSON record terminated by `\n`, is limited by the connected peer implementation, and has `"v": 1`.

- `link`: emitted by the bridge as `{ "v": 1, "type": "link", "state": "disconnected" | "syncing" | "usb" | "wireless" }`. `usb` only denotes the `usb-cdc` adapter; all non-USB adapters report `wireless`.
- `state`: sent by Display Shell as `{ "v": 1, "type": "state", "page", "pages", "name", "canPrev", "canNext", "link"? }`. The bridge rejects incomplete or contradictory page boundaries.
- `navigate`: emitted by a Remote Link adapter and relayed to the Display Shell as `{ "v": 1, "type": "navigate", "direction": "previous" | "next" }`. Unversioned, unsupported-version, and invalid messages are discarded.

The bridge retains the latest valid Shell state unchanged. When a Remote Link connects, it publishes `syncing`, derives an adapter state with `link: "wired"` for USB CDC or `link: "wireless"` for a future UART/C6 adapter, sends that state, then publishes factual `usb` or `wireless` link state.

## Wired adapter

`UsbCdcAdapter` finds exactly one `/dev/serial/by-id/` entry whose normalized name includes `Open DeskOS Remote`. It does not inspect or open numbered `ttyACM` paths. No matching device reports `device-not-found`; several matches report `ambiguous-device`. The adapter scans periodically, handles stream failure as disconnect, and resends the retained shell state after reconnection.

The `RemoteLinkAdapter` boundary provides `start`, `stop`, `send`, and `connected`/`disconnected`/`message` events, so a future CM5 UART plus C6 Gateway adapter can use unchanged JSON Lines records.

## Run

```sh
XDG_RUNTIME_DIR=/run/user/$(id -u) \
  node integrations/remote-bridge/bin/open-deskos-remote-bridge.js
```

`systemd/open-deskos-remote-bridge.service` is provided for user-session installation. Its integration with the CM5 installer is intentionally outside this subtree.

## Test

```sh
node --test integrations/remote-bridge/test/*.test.js
```
