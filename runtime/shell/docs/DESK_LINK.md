# Desk Link: a Pi machine reports itself, and a Console drives a hosted Pi

Open DeskOS normally learns about Pi sessions by scanning a machine: locally, or over SSH through the optional Mac source. A Desk Link inverts that. The machine that owns the sessions opens one outbound connection and reports them, so Open DeskOS never needs to reach it.

A machine may also open a **control connection** to the same listener. That is how a Mac's Pi session becomes a **Console** and drives a **Hosted Pi** on the desk. It is a separate connection with its own credential, never the reporting one; see [Hosted Pi control](#hosted-pi-control) and [ADR-0013](ARCHITECTURE.md#adr-0013).

## Pieces

| Piece | Lives in | Job |
|---|---|---|
| `@fradser/pi-open-deskos` | the reporting machine | Reports session state and bounded events; optionally acts as a Console |
| Desk Link Service | the Open DeskOS runtime | Accepts links on the local network, holds state, brokers control to the Pi host, serves the runtime |
| Pi host | the Open DeskOS runtime | Owns Pi credentials and session storage; runs Hosted Pi sessions |
| Desk Link client + source | the Electron main process | Reads the service over a Unix socket and answers as a Pi source |

## Reporting side

```bash
cd ~/.pi/agent   # Pi records the path relative to its settings directory
pi install ../../Developer/FradSer/pi-packages/packages/open-deskos
```

`@fradser/pi-open-deskos` is not published yet, so the npm form fails with a 404:
use the repository path until it is.

Then make the variables part of the environment Pi runs with. A 0600 file
sourced from the shell profile keeps the secret out of the profile itself:

```bash
install -m 600 /dev/null ~/.config/open-deskos/desk-link.env
cat >> ~/.config/open-deskos/desk-link.env <<'ENV'
ODK_DESK_LINK_ADDRESS="<desk-lan-address>:8765"
ODK_DESK_LINK_TOKEN="<the same token the service uses>"
ODK_DESK_LINK_MACHINE="desk-mac"
ENV

printf '\n# Open DeskOS Desk Link\n[ -f "$HOME/.config/open-deskos/desk-link.env" ] && { set -a; source "$HOME/.config/open-deskos/desk-link.env"; set +a; }\n' >> ~/.zshrc
```

Pi inherits the environment of the shell that starts it, so a shell started
before this change needs a restart. `/open-deskos` inside Pi reports the state
either way: `desk link · no config` means the variables are missing.

A missing address **or** token keeps the machine silent; there is no partially
configured link. `/open-deskos` inside Pi shows the link state, machine, reported session count, and event count.

## Runtime side

The service listens on the local network only and authenticates every Desk Link with the token. Its channel to the runtime is a Unix socket in an owner-only directory, authenticated by filesystem ownership rather than by the token.

The unit reads its token from a mode-`0600` file, named by
`ODK_DESK_LINK_TOKEN_FILE` in `~/.config/open-deskos/runtime.env`, the same
file the shell already loads. A value in the unit's environment is readable by
anything that can read this user's process environment, so the file is the
carrier to provision; `ODK_DESK_LINK_TOKEN=<secret>` still works for the
migration window, and setting the file makes the service refuse the environment
form instead of choosing between two values:

```bash
sudo -iu <kiosk-user>            # the account that runs the desk shell
umask 077; printf '%s\n' '<a shared secret, one per desk runtime>' > ~/.config/open-deskos/desk-link.token
printf 'ODK_DESK_LINK_TOKEN_FILE=%s\n' "$HOME/.config/open-deskos/desk-link.token" >> ~/.config/open-deskos/runtime.env
chmod 600 ~/.config/open-deskos/runtime.env
```

The runtime installer stages this unit from the active release and starts it as
soon as `runtime.env` carries the token, so provisioning the secret is the only
step an operator takes. It is a user unit, so a copy installed under another
account is invisible to the service:

```bash
systemctl --user enable --now open-deskos-desk-link.service
systemctl --user status open-deskos-desk-link.service --no-pager
```

If the unit is not installed yet, run the runtime installer again; it derives the
unit from `systemd/open-deskos-desk-link.service` in the active release instead
of asking for a hand-sed copy that would drift from the release.

Expect `listening on <lan-address>:8765`. To run it by hand first, source the
environment file instead of passing the token as an argument:

```bash
set -a; . ~/.config/open-deskos/runtime.env; set +a
node /opt/open-deskos/current/scripts/desk-link-service.js
```

Optional overrides: `ODK_DESK_LINK_PORT` (default `8765`), `ODK_DESK_LINK_BIND` (default: the first non-internal IPv4 address, never every interface), `ODK_DESK_LINK_SOCKET` (default: `$XDG_RUNTIME_DIR/open-deskos-desk-link/service.sock`).

## Source precedence

1. A connected Desk Link answers, and nothing else does, because mixing a link with a scan would report one list from two sources.
2. With no connected link, the configured SSH source answers.
3. Otherwise the local collector answers.

The label always names which source answered: `Desk Link · <machine>`, `Mac / SSH · <host>`, or `Local`.

## What is reported and what is not

Reported sessions carry identity, state, the latest prompt as a goal, and bounded events: at most 300 entries and 1 MiB of text per session. Every event keeps the multiline body Pi produced, bounded by kind: result 64 KiB, assistant 16 KiB, user 8 KiB, thinking 4 KiB, and tool 4 KiB. Tool results keep a separate bounded tool name, and any body cut at its limit carries an explicit truncation flag. The service enforces the same bounds itself, because a reporting machine is never trusted to have bounded its own data. See ADR-0012 for Markdown, table, and text-only safety rules.

**Reporting is never management.** A machine that holds only the reporting token can report and nothing else, and visibility through a Desk Link never makes a reported session controllable. Control is a separate capability with its own credential, described next.

**The transport is not encrypted.** It is a plain connection to a LAN-only listener. Do not expose the Desk Link Service beyond the local network.

## Hosted Pi control

A **Hosted Pi** is a Pi coding session the desk hosts. A **Console**, a Pi session on another machine, can list, launch, attach to, prompt, cancel, end, and read the history of those sessions. The rules are decided in [ADR-0013](ARCHITECTURE.md#adr-0013) and specified in the reporting package's `docs/spec-desk-link-hosted-pi-console.md`.

- **A separate connection.** A machine that holds the Control Credential opens its own connection to the same listener. One-shot requests (list, launch, history) use a connection that closes after the answer; a connection is held open only while a Console is attached, and Control Attribution lives exactly as long as it does. No second listener and no second port exist.
- **A separate credential, never transmitted.** The desk sends a one-time nonce; the Console answers with an HMAC-SHA256 proof over the exact UTF-8 transcript `open-deskos-control-v2\n2\n${nonce}\n${machine}\n${sessionId}`. Every control record is refused without that proof. The credential itself never appears on the wire, so watching the network yields no reusable execution token. Content remains plaintext. On the desk, provision the value through `ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE` (a mode-`0600` file; `ODK_DESK_LINK_CONTROL_CREDENTIAL` in the environment still works and a file takes precedence); on the Mac Console, provision the matching out-of-band value as `ODK_DESK_LINK_CONTROL_TOKEN` in that machine's own private session environment (a mode-`0600` file it sources, not a unit's environment). Rotate it by replacing both private values and restarting only the Desk Link Service and Console Pi sessions; reporting continues on its separate token.
- **No clock agreement is required.** The handshake transcript carries no timestamp, so the two sides need no skew tolerance: the nonce is single-use and an unauthenticated control socket is closed after 10 seconds of inactivity rather than held open indefinitely. A Console's session age is different in kind, because it measures the desk's own `updatedAt` against the Console's clock; a badly skewed Console clock therefore shows a skewed age rather than a failed handshake.
- **The desk's path to its host.** The Hosted Pi daemon publishes where it answers, as `endpoint.json` in the session's runtime directory (`$XDG_RUNTIME_DIR/open-deskos/hosted-pi/`), and the service resolves that descriptor instead of reading the host's private configuration. The host's `pi-tasks.json` therefore has one reader, under the ownership and mode check it already applies, while the published socket cannot disagree with the one the host actually bound. `ODK_HOSTED_PI_SOCKET` is an explicit absolute-path override for isolated operation and tests. The host keeps owning Pi credentials and session storage, so a service restart does not end a live session.
- **One coordinate for events and history.** An event batch's position is the position of one complete entry in the Hosted Pi's own session log, which the host already writes durably. A single entry can yield several Session Events, and the Console applies the whole batch before advancing that position. Attach atomically installs the live subscription and captures its fence. A resumed Attach catches up through that inclusive fence and then follows entries strictly after it. A first Attach reports the current fence without implicitly replaying earlier history; the Console requests that history explicitly. The desk keeps no replay window, so a Console can neither repeat nor silently miss events between reconnects.
- **Attribution on the desk.** While a Console drives a Hosted Pi, the desk names that machine in the Pi Sessions overview header, and the Hosted Pi is never presented as a report-only session. Local touch and keyboard keep working unchanged.
- **Refusals are explicit.** A protocol version the desk does not accept is refused with the mismatch named; a Pi host that is down or a stale host socket produces a failure that names the reason instead of waiting.
- **Unconfigured stays unchanged.** With no Control Credential configured, a machine behaves exactly as a reporting-only machine does today, in every scenario.

## Existing-session discovery

The reporting package also reads the machine's bounded `directory-sessions` metadata registry every five seconds. This makes pre-existing Working, Settled, and Exited sessions available even when those individual processes did not load the package. It does not read session histories or authentication files. Current in-process events remain separate; discovered sessions without reported events say so rather than fabricating a stream. At least one configured reporter must be running and connected.

The Shell starts at **Live** and shows a count per filter. Working and Idle narrow the live set; Exited and All expose history explicitly. See [ADR-0015](ARCHITECTURE.md#adr-0015). Discovery and service state remain bounded to 64 sessions per machine; this is not an unbounded history archive.

## Independent reporters on one machine

Each authenticated connection owns the sessions it reports. A `sessions` record replaces only that connection's previous set; the runtime exposes the union of all connected reporters on the machine. One Pi process cannot erase the sessions reported by another process with the same machine name. Duplicate session identities share one entry, with the newest report supplying its state. Events are accepted only from a connection reporting that session.

Each Console is likewise identified by its own session identity and machine name, so two Pi sessions on one machine are two distinguishable Consoles rather than one.

The machine-wide session and event limits still apply to this union. Runtime snapshot replies have a separate 2 MiB limit because they repeat workspace membership; fragmented UTF-8 is decoded across TCP boundaries rather than character-by-character chunks. A connection dropping removes only its ownership; a session remains available if another connected reporter still reports it.

## When a link drops

When the last link drops, the machine disappears from the snapshot and its sessions become unavailable rather than stale-and-trusted, because a disconnected reporter is not a mirror. The reporting side reconnects with a growing wait (1s, 2s, 4s … capped at 30s), keeps one link, and retains only the newest bounded events, so an outage costs freshness rather than memory. Open DeskOS falls back to the next source in precedence.

A dropped control connection is not a dropped Hosted Pi: the session keeps running, keeps its identity, stays attachable, and its attribution clears. The Console can attach again and read what it missed from the session's own log.

## Troubleshooting

- Nothing appears: check `ODK_DESK_LINK_TOKEN` matches on both sides, then the address and port, then that the service's bind address is reachable from the reporting machine.
- The desk shows `Local` while a machine should be reporting: the link is not currently connected. `/open-deskos` on the reporting machine states the link state and the last error.
- The desk shows `Unavailable`: the source that answered could not produce a snapshot. The label names it.
- Control is refused: check the Control Credential on both sides, then whether the desk and the Console agree on the protocol version. A version mismatch is refused by name rather than treated as a credential failure.
- A launch or list fails while reporting works: the Pi host is not answering. The failure names that reason; reporting is unaffected.
## Verification limits

Reporting protocol v1 has no event identity/replay acknowledgement contract. Reconnection while a sibling link retains the machine can repeat bounded recent events. Do not claim exactly-once reporting. Control positions use the Hosted Pi log and have a separate resume contract. A local result outside the bounded 2 MiB log tail must report the limit, not an empty successful stream. Headless DOM checks do not prove physical touch, S3 Remote, GPU/HDMI performance, screen-reader announcements or the active release.

## Optional Mac SSH source

> A machine that owns its sessions can report them itself instead of being scanned over SSH. That needs no inbound access, carries the session's operating events, and is preferred whenever a Desk Link is connected. See the reporting contract above. This document covers the SSH source, which remains a separate, optional source.

The default source remains local. Optional SSH configuration replaces it with one Mac source; it does not merge hosts. The existing collector runs on the Mac, so PIDs, process liveness, working directories, and session metadata belong to that Mac. No HTTP listener or Apple companion is required.

### 1. Prepare the Mac

Enable macOS **System Settings → General → Sharing → Remote Login**, allowing only the account that runs Pi. Install Node.js 20 or later. In a checkout of this repository on the Mac:

```sh
mkdir -p "$HOME/.local/share/open-deskos/pi-monitor/src" "$HOME/.local/share/open-deskos/pi-monitor/scripts"
cp runtime/shell/src/pi-sessions.js runtime/shell/src/pi-session-events.js "$HOME/.local/share/open-deskos/pi-monitor/src/"
cp runtime/shell/scripts/pi-sessions-snapshot.js "$HOME/.local/share/open-deskos/pi-monitor/scripts/"
command -v node
node "$HOME/.local/share/open-deskos/pi-monitor/scripts/pi-sessions-snapshot.js"
```

Keep the collector and both source modules from the same runtime version. Record the absolute Node executable path (version-manager paths work, but must be updated after removing that Node version). The collector reads this account's `~/.pi/agent/directory-sessions` and process table; a custom `PI_AGENT_DIR` must be set in the remote SSH command environment, not on CM5. Do not copy Pi authentication files or session trees to CM5. Session goals and file names are personal data transmitted through SSH and displayed on the desk screen.

### 2. Configure authentication on CM5

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

### 3. Persist the selected source

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

### Behavior and troubleshooting

- The source label identifies `Mac / SSH` and the configured alias. Disconnects or invalid snapshots report unavailable, never local data or zero active sessions.
- SSH execution is asynchronous with a 10-second hard timeout, 5-second connection timeout, and 2 MiB output limit. Concurrent UI requests share one in-flight scan; each subsequent request collects fresh data.
- Mac and CM5 clocks must be within 60 seconds. Stale/malformed output, missing Node/collector, unknown host keys, authentication failure, sleeping/offline Macs, and excessive snapshot output all remain unavailable. Wake the Mac or fix configuration and the next poll retries.
- The local collector's existing discovery limitations still apply. It reads processes visible to the Mac login account, and only metadata-registered sessions are listed: live Pi worker processes without metadata are counted as hidden and never shown as sessions. It does not read another user's Pi history. The remote CLI fails rather than reporting idle when process-table inspection fails; ensure the SSH account PATH includes the system `ps` and `lsof` utilities.
- A host test is not real CM5-to-Mac acceptance. Verify with a Pi process running on the configured Mac, stop it and observe the change, then disconnect the Mac and confirm unavailable rather than idle. Actual network/key setup and CM5 display behavior require device acceptance.
