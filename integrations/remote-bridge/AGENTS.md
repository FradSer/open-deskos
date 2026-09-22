# Repository Guidelines

## Project Structure & Module Organization
This is a standalone Node.js systemd user service connecting `runtime/linux/` to `peripherals/esp32-s3-remote/`. `bin/open-deskos-remote-bridge.js` starts the service; `lib/remote-bridge.js` owns socket and relay lifecycle; `lib/protocol.js` validates v1 JSON Lines; `lib/usb-cdc-adapter.js` handles wired discovery. The service template is `systemd/open-deskos-remote-bridge.service`; tests are in `test/`.

## Build, Test & Development Commands
No package install is needed:
```sh
node --test test/*.test.js
```
The suite uses temporary Unix sockets and injected/mock serial transports. Run it and fix/rerun change-caused failures without repeated approval; no connected Remote is required. Running `bin/open-deskos-remote-bridge.js` instead opens the session's real bridge socket and discovers hardware; do not start a second instance alongside the installed service.

The systemd installer substitutes `__OPEN_DESKOS_REMOTE_BRIDGE_DIR__` with the installed integration path.

## Coding Style & Naming Conventions
- 2-space CommonJS with Node.js built-in modules only (zero external npm dependencies).
- Every protocol record is newline-delimited JSON with `v: 1`.
- Keep runtime sockets below `$XDG_RUNTIME_DIR/open-deskos-remote/` (dir `0700`, socket `0600`).
- Discover exactly one matching `/dev/serial/by-id/` device; accept both the legacy `Open DeskOS Remote` name and the fixed Espressif USB JTAG serial identity. Never fall back to numbered `ttyACM` paths.
- Preserve factual link states: `disconnected`, `syncing`, `usb`, and `wireless`.

## Testing Guidelines
- Host-service behavior scenarios live in `test/features/remote-bridge-host.feature`; protocol and adapter regressions belong in the matching `test/*.test.js`.
- Validate authoritative page boundaries before retaining or forwarding shell state.
- Missing or ambiguous Remote hardware must fail gracefully and not block direct shell usage.
- Mock transport tests do not prove USB enumeration or reconnection on the CM5; report that hardware evidence separately.
