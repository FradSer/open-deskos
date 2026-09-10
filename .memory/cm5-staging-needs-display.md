---
name: cm5-staging-needs-display
description: CM5 release staging over SSH fails preflight without DISPLAY
type: public
---

# CM5 Staging Needs a Display for Preflight

## Why

`runtime/linux/scripts/cm5-stage-release.sh` runs `cm5-install.sh` over SSH,
which runs `pnpm preflight` without `DISPLAY`. The `user-app-runtime.test.js`
Electron verifier tests then fail with `verifier-exited-without-result` and
`update-runtime.js` correctly refuses to promote (active release unchanged).
This failure is environmental and pre-existing, unrelated to the staged code.

Pi Sessions scene evidence: five staged candidates in one day, none promoted,
all blocked by the same two network-verifier tests.

## How to apply

- Stage with a display: after rsync, run the remote install with
  `DISPLAY=:0 XAUTHORITY=/home/orangepi/.Xauthority` in the SSH command
  environment. `runuser` preserves it into `pnpm preflight` and the verifier
  tests pass.
- After promotion, restart the kiosk to pick up the release:
  `runuser -u orangepi -- env HOME=/home/orangepi
  XDG_RUNTIME_DIR=/run/user/1000
  DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus systemctl --user
  restart open-deskos-shell.service`
- When the desk polls a Mac over SSH (`pi-monitor.conf`), re-copy
  `src/pi-sessions.js` + `scripts/pi-sessions-snapshot.js` to
  `~/.local/share/open-deskos/pi-monitor/` on that Mac after every scanner
  change; the desk keeps running the deployed copy otherwise.

## Related

- [[cerberus-os-top-spec]]
