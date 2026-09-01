# Repository Guidelines

## Project Structure & Module Organization
This is a standalone Node.js systemd user service connecting `runtime/linux/` to `peripherals/esp32-s3-remote/`. Use Node built-ins only. `bin/open-deskos-remote-bridge.js` starts the service; `lib/remote-bridge.js` owns socket and relay lifecycle; `lib/protocol.js` validates v1 JSON Lines; `lib/usb-cdc-adapter.js` handles wired discovery. The service template is `systemd/open-deskos-remote-bridge.service`; tests are in `test/`.

## Build, Test & Development Commands
No package install is needed:
```sh
node --test test/*.test.js
XDG_RUNTIME_DIR=/run/user/$(id -u) node bin/open-deskos-remote-bridge.js
```
The systemd installer substitutes `__OPEN_DESKOS_REMOTE_BRIDGE_DIR__` with the installed integration path.

## Coding Style & Naming Conventions
- 2-space CommonJS with Node.js built-in modules only (zero external npm dependencies).
- Every protocol record is newline-delimited JSON with `v: 1`.
- Keep runtime sockets below `$XDG_RUNTIME_DIR/open-deskos-remote/` (dir `0700`, socket `0600`).
- Discover exactly one matching `/dev/serial/by-id/` device; never fall back to numbered `ttyACM` paths.
- Preserve factual link states: `disconnected`, `syncing`, `usb`, and `wireless`.

## Testing Guidelines
- Unit and contract tests run with `node --test test/*.test.js`.
- Validate authoritative page boundaries before retaining or forwarding shell state.
- Missing or ambiguous Remote hardware must fail gracefully and not block direct shell usage.

## Commit & Pull Request Guidelines
- Use focused Conventional Commits (`fix(link):`, `feat(link):`, `refactor(link):`).
- Report Node test results and indicate whether USB reconnection was verified on hardware.
- Never commit active sockets, logs, hardware serial paths, credentials, or temporary diagnostics.
