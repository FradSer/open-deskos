# Repository Guidelines

## Project Structure & Module Organization

This directory is a standalone Node.js systemd user service using only Node built-ins. `bin/open-deskos-remote-bridge.js` is the process entry point; `lib/remote-bridge.js` owns the Unix socket and relay lifecycle; `lib/protocol.js` validates v1 JSON Lines records; `lib/usb-cdc-adapter.js` implements wired discovery. The service template is `systemd/open-deskos-remote-bridge.service`, and executable Node tests are in `test/`. The shared behavior specification is `../tests/features/remote-bridge.feature`.

## Build, Test & Development Commands

No dependency installation is required for this subtree. Run its suite from `firmware/linux/`:

```sh
node --test remote-bridge/test/*.test.js
XDG_RUNTIME_DIR=/run/user/$(id -u) \
  node remote-bridge/bin/open-deskos-remote-bridge.js
```

Also run `pnpm test` from the parent directory after changes that affect Electron integration. The bridge requires an absolute `XDG_RUNTIME_DIR`; the service installer substitutes `__OPEN_DESKOS_SHELL_DIR__` with the installed shell path.

## Coding Style & Testing Guidelines

Use 2-space CommonJS JavaScript and Node built-ins only. Keep every socket record newline-delimited JSON with `v: 1`. Shell state remains authoritative: validate page boundaries before retaining or forwarding it. Keep socket paths below `$XDG_RUNTIME_DIR/open-deskos-remote/`, directory mode `0700`, and socket mode `0600`. USB discovery must use exactly one matching `/dev/serial/by-id/` link, never numbered `ttyACM` paths.

Update the parent feature and relevant Node tests first. Preserve factual link states (`disconnected`, `syncing`, `usb`, `wireless`) and do not let an absent or ambiguous remote block direct shell operation.

## Commit & Pull Request Guidelines

Use focused Conventional Commits. State the test command and whether USB device reconnection was exercised on hardware. Do not commit runtime sockets, logs, device identifiers, credentials, or temporary diagnostics.
