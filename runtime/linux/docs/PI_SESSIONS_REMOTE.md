# Monitor Pi on a Mac over SSH

The default source remains local. Optional SSH configuration replaces it with one Mac source; it does not merge hosts. The existing collector runs on the Mac, so PIDs, process liveness, working directories, and session metadata belong to that Mac. No HTTP listener or Apple companion is required.

## 1. Prepare the Mac

Enable macOS **System Settings → General → Sharing → Remote Login**, allowing only the account that runs Pi. Install Node.js 20 or later. In a checkout of this repository on the Mac:

```sh
mkdir -p "$HOME/.local/share/open-deskos/pi-monitor/src" "$HOME/.local/share/open-deskos/pi-monitor/scripts"
cp runtime/linux/src/pi-sessions.js "$HOME/.local/share/open-deskos/pi-monitor/src/"
cp runtime/linux/scripts/pi-sessions-snapshot.js "$HOME/.local/share/open-deskos/pi-monitor/scripts/"
command -v node
node "$HOME/.local/share/open-deskos/pi-monitor/scripts/pi-sessions-snapshot.js"
```

Keep both files from the same runtime version. Record the absolute Node executable path (version-manager paths work, but must be updated after removing that Node version). The collector reads this account's `~/.pi/agent/directory-sessions` and process table; a custom `PI_AGENT_DIR` must be set in the remote SSH command environment, not on CM5. Do not copy Pi authentication files or session trees to CM5. Session goals and file names are personal data transmitted through SSH and displayed on the desk screen.

## 2. Configure authentication on CM5

All values below are **placeholders**, not an existing machine configuration. As the kiosk Linux user, configure an SSH alias in `~/.ssh/config`:

```sshconfig
Host pi-mac
  HostName <mac-address>
  User <mac-pi-user>
  IdentityFile ~/.ssh/pi-monitor_ed25519
  IdentitiesOnly yes
```

Use a dedicated key authorized on that Mac account. Install its public key using your normal approved process; never put a private key in the repository. Verify the Mac host-key fingerprint out of band before accepting it with an interactive `ssh pi-mac` connection. The runtime requires an existing trusted host key and noninteractive key authentication: it will never accept a new key or prompt for a password. For tighter permissions, use an authorized_keys forced command pointing at the absolute Node and collector paths with forwarding/PTY disabled; this key then cannot run other commands. Restrict Remote Login/firewall to your trusted network or VPN, not the public Internet.

Test as the same kiosk user, substituting actual absolute paths:

```sh
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes pi-mac "'/absolute/path/to/node' '/Users/<mac-pi-user>/.local/share/open-deskos/pi-monitor/scripts/pi-sessions-snapshot.js'"
```

The output must be a single JSON snapshot, without shell greeting text. If the key is passphrase protected, the kiosk service needs a reachable unlocked SSH agent; otherwise scans remain unavailable. An SSH shell's agent is not automatically available to systemd.

## 3. Persist the selected source

In the CM5 kiosk user's session, run `systemctl --user edit open-deskos-shell.service` and add:

```ini
[Service]
Environment="ODK_PI_SSH_HOST=pi-mac"
Environment="ODK_PI_SSH_NODE=/absolute/path/to/node"
Environment="ODK_PI_SSH_COLLECTOR=/Users/<mac-pi-user>/.local/share/open-deskos/pi-monitor/scripts/pi-sessions-snapshot.js"
```

Then:

```sh
systemctl --user daemon-reload
systemctl --user restart open-deskos-shell.service
```

A shell `export` in an unrelated SSH session does not configure this service. The SSH host accepts a host alias or user@host, not shell arguments; use SSH config for ports, identities, and IPv6 addresses. Both remote paths must be absolute. To return to local monitoring, remove all three Environment entries and restart the service. Partial or empty SSH configuration is an error, not a request to fall back.

## Behavior and troubleshooting

- The source label identifies `Mac / SSH` and the configured alias. Disconnects or invalid snapshots report unavailable, never local data or zero active sessions.
- SSH execution is asynchronous with a 10-second hard timeout, 5-second connection timeout, and 2 MiB output limit. Concurrent UI requests share one in-flight scan; each subsequent request collects fresh data.
- Mac and CM5 clocks must be within 60 seconds. Stale/malformed output, missing Node/collector, unknown host keys, authentication failure, sleeping/offline Macs, and excessive snapshot output all remain unavailable. Wake the Mac or fix configuration and the next poll retries.
- The local collector's existing discovery limitations still apply. It reads processes visible to the Mac login account, and only metadata-registered sessions are listed: live Pi worker processes without metadata are counted as hidden and never shown as sessions. It does not read another user's Pi history. The remote CLI fails rather than reporting idle when process-table inspection fails; ensure the SSH account PATH includes the system `ps` and `lsof` utilities.
- A host test is not real CM5-to-Mac acceptance. Verify with a Pi process running on the configured Mac, stop it and observe the change, then disconnect the Mac and confirm unavailable rather than idle. Actual network/key setup and CM5 display behavior require device acceptance.
