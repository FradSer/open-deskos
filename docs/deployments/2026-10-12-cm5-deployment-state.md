# CM5 deployment state

Date: 2026-10-12. Host: Orange Pi CM5 (RK3588S, Linux arm64), kiosk user `orangepi` (uid 1000).

## Scope and method

This record states the live deployment as measured on the device. It is not a
target state. [Shell runbook](../../runtime/shell/README.md) owns CM5 operations
and [Shell context](../../runtime/shell/CONTEXT.md) owns the current names.
Read [the container deployment evaluation](../evaluations/2026-10-12-container-deployment-cost.md)
when a decision needs the cost of moving this runtime into containers.

Measured with read-only commands only:

```sh
ssh cm5 'runuser -u orangepi -- env XDG_RUNTIME_DIR=/run/user/1000 systemctl --user list-units --state=active --type=service'
ssh cm5 'ps -eo user,pid,etime,args --sort=start_time'
ssh cm5 'ss -ltnp; find /run/user/1000 -maxdepth 3 -name "*.sock"'
ssh cm5 'cat /opt/open-deskos/state/runtime-state.json'
```

## Live inventory

Eight user units run under the user manager of `orangepi`. All eight report
`active`. Linger is off, so the user manager lives with the graphical session.

| Unit | Process | Interface |
| --- | --- | --- |
| `open-deskos-shell` | Electron 43.4.1 kiosk on X11 `:0`, Openbox | 127.0.0.1:9222 |
| `open-deskos-personal-bot` | `node main.mjs` | `open-deskos-personal-bot/agent.sock` |
| `open-deskos-pi-tasks` | `node task-daemon.mjs` | Hosted Pi endpoint |
| `open-deskos-desk-link` | `node desk-link-service.js` | 127.0.0.1:8765, `open-deskos-desk-link/service.sock` |
| `open-deskos-remote-bridge` | `node open-deskos-remote-bridge.js` | `open-deskos-remote/bridge.sock` |
| `open-deskos-stt-bridge` | `/opt/stt-bridge/whisper-server` | 127.0.0.1:17840 |
| `open-deskos-futu-poller` | `~/.venv/futu/bin/python poller.py` | `open-deskos/futu-poller.sock` |
| `open-deskos-cliproxy-tunnel` | `ssh -NT -L 127.0.0.1:8317:...root@frad-nas` | 127.0.0.1:8317 |

The Shell main process also creates `open-deskos-desk-data/service.sock` and
`open-deskos-apps/control.sock`.

Active release: `/opt/open-deskos/current` points to
`releases/20261004-connection-fixes-v2`. `runtime-state.json` records
`active=20261004-connection-fixes-v2` and `rollback=20261004-connection-fixes`.

## Naming drift

The device runs the pre-rename deployment. The repository owns the new names.

| Item | Device | Repository |
| --- | --- | --- |
| Runtime root | `/opt/open-deskos` | `/opt/odk` |
| Units | `open-deskos-*` | `odk-*` |
| Configuration | `~/.config/open-deskos/` | `~/.config/odk/` |
| Sockets | `open-deskos-*/*.sock` | `odk-*/*.sock` (ADR-0025, ADR-0026) |
| State | `~/.local/state/open-deskos/` | `.../odk/` |
| Link service | `scripts/desk-link-service.js` | `scripts/odk-link-service.js` |
| udev rules | `99-open-deskos-p4-camera.rules` | `99-odk-p4-camera.rules` |
| P4 camera symlink | `/dev/open-deskos-p4-camera` | `/dev/odk-p4-camera` |
| CJK font | `/usr/local/share/fonts/open-deskos/` | `/usr/local/share/fonts/odk/` |
| Kiosk autostart | `open-deskos-shell.desktop` | `odk-shell.desktop` |
| Microphone gate helper | absent | `/usr/local/bin/odk-p4-microphone-acceptance` |

[Shell context](../../runtime/shell/CONTEXT.md) states that previous names have
no aliases and that deployment must transfer configuration and state before
activation. A mixed install therefore fails: the repository client resolves
`odk-apps/control.sock`, and the running Shell created
`open-deskos-apps/control.sock`.

## Device-local items a migration must carry

These exist only on the device. A repository release does not contain them.

1. `~/.config/open-deskos/runtime.env` (`ODESK_WORKSPACE=/home/orangepi/Developer/open-deskos`).
2. `open-deskos-shell.service.d/` drop-ins: `ODK_HYDRA_MQTT_URL`, `ELECTRON_EXTRA_LAUNCH_ARGS=--remote-debugging-port=9222`, three `ODK_PI_SSH_*` values.
3. `open-deskos-personal-bot.service.d/` drop-ins: `ODESK_JEV_KEY_FILE`, `ODESK_JEV_MODEL`, `ODESK_PROACTIVE_CONFIG`, `ODESK_TASK_TARGETS_FILE`.
4. `~/.config/open-deskos/task-targets.json`: targets `cm5` (root `/home/orangepi/Developer`) and `mac` (`odesk-control-mac`, roots under `/Users/FradSer`).
5. `~/.config/open-deskos/proactive/`: owner and goal configuration plus the Jev key.
6. `open-deskos-cliproxy-tunnel.service`: an SSH loopback tunnel to `frad-nas`. It has no repository counterpart.
7. `~/Developer/open-deskos` (the writable workspace) with the `apps/weather-widget` draft.
8. `~/.local/state/open-deskos/` and `~/.local/share/open-deskos/futu-poller/`.
9. `/etc/udev/rules.d/99-open-deskos-p4-camera.rules`, which creates `/dev/open-deskos-p4-camera` for the UVC camera.
10. `/usr/local/share/fonts/open-deskos/NotoSansSC-Regular.ttf`, the Openbox theme at `/usr/share/themes/OpenDeskOS` with `~/.config/openbox/rc.xml`, and `~/.config/autostart/open-deskos-shell.desktop`.
11. `*-deployment/` records inside the active release: `patch.hashes` and `rollback.json` per deployment.

## Fixes applied on 2026-10-12

Backups of every removed unit file are in `/root/odk-fix-backup-20261012`.

| Fix | Evidence |
| --- | --- |
| Removed the superseded `open-deskos-voice-agent.service` and its drop-in | The unit was already `disabled` and `inactive`; the repository migration disables it too |
| Pruned four superseded releases | Each deletion first greps all state and `*-deployment` records for the name; the guard refused three further candidates |
| Stopped and disabled `open-deskos-face-agent.service` | It ran as root, held `/dev/open-deskos-p4-camera` at 1280×720@30fps, and served 127.0.0.1:8790. [Product](../../PRODUCT.md) and ADR-0004 exclude recognition on the P4 camera, and no active component consumed the service |

Release retention after the prune: 13 releases, 8.5 GB. Disk changed from 85 %
used (4.0 GB free) to 75 % used (6.6 GB free). All eight services stayed active.

## Open items

1. **Release retention is pinned by stale records.** `personal-bot-deployment/patch.hashes`
   lists 386 paths under `runtime/linux`, and `jev-deployment/patch.hashes` lists
   7. That directory does not exist in the active release, so those records cannot
   resolve. Eleven further releases outside the pointer pair stay pinned for
   that reason. Retiring the
   records would release about 7 GB. This is a destructive operation on
   device-built artifacts, so it needs an explicit decision.
2. **Port 9222 is an operator debugging facility, not a defect.** A drop-in adds
   `--remote-debugging-port=9222`. Any local process can attach to the renderer.
   Remove that environment line to close it, and restore it only while debugging.
3. **The naming migration is not started.** It needs deployment authorization.
   See the handover below.

## Migration handover

A repository release is not a superset of the running release, so this migration
also deploys current HEAD. Sequence:

```sh
# 1. Reclaim space first, so a new release and its dependencies fit.
# 2. Stage and install from the development checkout (this activates a new release).
bash runtime/shell/scripts/cm5-stage-release.sh
# 3. Transfer configuration and state to the new paths before the new units start.
#    Copy each item in the list above to its odk counterpart with mode 0600.
# 4. Stop the old units BEFORE the new Shell starts.
ssh cm5 'runuser -u orangepi -- env XDG_RUNTIME_DIR=/run/user/1000 \
  systemctl --user disable --now open-deskos-shell open-deskos-personal-bot \
  open-deskos-pi-tasks open-deskos-desk-link open-deskos-remote-bridge \
  open-deskos-stt-bridge open-deskos-futu-poller open-deskos-cliproxy-tunnel'
# 5. Enable the new units and verify.
ssh cm5 'cd /opt/odk/current && bash scripts/cm5-acceptance.sh'
# 6. Remove the old tree only after step 5 passes.
```

Hazards:

- Steps 2 and 4 are ordered badly if step 4 comes first: the installer enables
  and starts the new units, so both Shells can hold the display at once. Stop the
  old kiosk unit before step 2, and expect the desk to be dark until step 5.
- The installer runs `pnpm preflight` on the device. It needs the declared pnpm
  and about 450 MB of dependencies.
- Rollback is the old tree. Keep `/opt/open-deskos` and its units until step 5
  passes on real hardware.

## Limits of this record

- No hardware gate was run. Camera, microphone, touch, GPU and Remote input stay
  unverified.
- The original reason for the empty Widget catalog is unrecoverable: journald
  holds no boots on this device. A fresh verified install succeeded, so the draft
  and the pipeline are healthy.
- These measurements are one host at one time. They do not describe Windows or
  macOS Shell Hosts.