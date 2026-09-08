# CM5 Linux Device Deployment & Runtime Operations

This guide documents operational procedures for deploying, maintaining, and verifying Open DeskOS on the Orange Pi CM5 (RK3588S) hardware.

## 1. Deployment Architecture

Open DeskOS deploys immutable releases to the CM5:

```
/opt/open-deskos/
├── current -> releases/20260906T150245Z-202187/   # Atomic symlink
├── releases/                                       # Versioned releases
│   ├── 20260906T144431Z-197360/                   # Rollback target
│   └── 20260906T150245Z-202187/                   # Active release
├── staging/                                        # Rsync staging tree
└── state/migrations/                               # User migration states
```

### Staging a Release

Run from the development machine:

```bash
bash runtime/linux/scripts/cm5-stage-release.sh
```

This script:
1. Rsyncs the working tree (excluding `node_modules` and `.DS_Store`) to `/opt/open-deskos/staging/`.
2. Triggers `scripts/cm5-install.sh` on the CM5 via SSH.
3. Installs dependencies on device (`pnpm install --frozen-lockfile`).
4. Runs `pnpm preflight` and release validation on the device.
5. Atomically switches the `/opt/open-deskos/current` symlink.
6. Restarts the kiosk systemd user service.

---

## 2. Critical Operational Gotchas

### Release Disk Accumulation (`No space left on device`)

- **Root Cause**: Each immutable release directory retains its own copy of `node_modules` (~410MB including arm64 Electron binaries). After ~20 deployments, the 28GB root partition hits 100% full, causing `cp` and `pnpm install` failures.
- **Pruning Runbook**: Regularly prune old release directories, retaining only the `current` active release and the immediate prior rollback release:
  ```bash
  ssh cm5 'cd /opt/open-deskos/releases && \
    CURRENT=$(readlink /opt/open-deskos/current | xargs basename) && \
    for d in */; do \
      d=${d%/}; \
      if [ "$d" != "$CURRENT" ] && [ "$d" != "YOUR_ROLLBACK_RELEASE" ]; then \
        rm -rf "$d"; \
      fi \
    done && df -h /'
  ```

### MQTT Client ID Conflicts (Flapping Connections)

- **The Trap**: If a background service and an ad-hoc diagnostic or test script both connect to Mosquitto using a static client ID (e.g. `open-deskos-shell`), the broker terminates the older connection with disconnect/reconnect loops.
- **The Fix**: Always append a process PID and random token to the client ID:
  ```javascript
  clientId: `open-deskos-shell-${process.pid}-${Math.random().toString(16).slice(2, 8)}`
  ```

### Systemd User Service Overrides

To inject environment variables (e.g. MQTT broker URLs) into the kiosk shell:

1. Create a service override directory:
   ```bash
   mkdir -p /home/orangepi/.config/systemd/user/open-deskos-shell.service.d
   ```
2. Write the configuration file:
   ```ini
   # /home/orangepi/.config/systemd/user/open-deskos-shell.service.d/hydra.conf
   [Service]
   Environment=ODK_HYDRA_MQTT_URL=mqtt://10.10.0.195:1883
   ```
3. Set ownership, reload, and restart:
   ```bash
   chown -R 1000:1000 /home/orangepi/.config/systemd/user/open-deskos-shell.service.d
   runuser -u orangepi -- env XDG_RUNTIME_DIR=/run/user/1000 systemctl --user daemon-reload
   runuser -u orangepi -- env XDG_RUNTIME_DIR=/run/user/1000 systemctl --user restart open-deskos-shell.service
   ```

---

## 3. Headless Verification on CM5

### Capturing Screen State via X11

When remote Chrome DevTools Protocol (CDP) hangs or is not enabled, use X11 utilities to capture the live panel state directly:

```bash
# Capture full 1920x1280 frame buffer
DISPLAY=:0 XAUTHORITY=/var/run/lightdm/root/:0 import -window root /tmp/screen.png
scp cm5:/tmp/screen.png /tmp/local-screen.png
```

### Simulating Input

To navigate pages headlessly on the panel:

```bash
# Advance to Home page (Page 2)
DISPLAY=:0 XAUTHORITY=/var/run/lightdm/root/:0 xdotool key Right
# Return to Today page (Page 1)
DISPLAY=:0 XAUTHORITY=/var/run/lightdm/root/:0 xdotool key Left
```

### Temporary CDP Inspection

Pass `--remote-debugging-port=9222` into the kiosk shell via the service override:

```ini
[Service]
Environment=ELECTRON_EXTRA_LAUNCH_ARGS=--remote-debugging-port=9222
```
Restart the service, then query DOM and computed geometry over HTTP/WebSocket via `http://127.0.0.1:9222/json`. Remove the flag when debugging is complete.
