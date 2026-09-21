# Desk Link: a Pi machine reports itself, and a Console drives a hosted Pi

Open DeskOS normally learns about Pi sessions by scanning a machine: locally, or over SSH through the optional Mac source. A Desk Link inverts that. The machine that owns the sessions opens one outbound connection and reports them, so Open DeskOS never needs to reach it.

This exists because the pull direction is not always available and cannot carry what the desk shows. On 2026-09-17 the CM5 could not reach its configured Mac address at all (`ssh: connect to host 10.10.0.226 port 22: No route to host`) while the Mac reached the CM5, and a scan can only read metadata plus one activity line, never the session's operating events.

A machine may also open a **control connection** to the same listener. That is how a Mac's Pi session becomes a **Console** and drives a **Hosted Pi** on the desk. It is a separate connection with its own credential, never the reporting one; see [Hosted Pi control](#hosted-pi-control) and [ADR-0013](adr/0013-desk-link-carried-hosted-pi-control.md).

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

The unit reads its token from `~/.config/open-deskos/runtime.env`, the same
file the shell already loads. Put it there (mode `600`) rather than on a command
line, where any local account could read it from `/proc/<pid>/cmdline`:

```bash
sudo -iu <kiosk-user>            # the account that runs the desk shell
f=~/.config/open-deskos/runtime.env
printf 'ODK_DESK_LINK_TOKEN=%s\n' '<a shared secret, one per desk runtime>' >> "$f"
chmod 600 "$f"
```

Install and start the provided unit as that same kiosk user. It is a user unit,
so a copy installed under another account is invisible to the service:

```bash
mkdir -p ~/.config/systemd/user
sed "s#__OPEN_DESKOS_DESK_LINK_DIR__#/opt/open-deskos/current#" \
  /opt/open-deskos/current/systemd/open-deskos-desk-link.service \
  > ~/.config/systemd/user/open-deskos-desk-link.service
systemctl --user daemon-reload
systemctl --user enable --now open-deskos-desk-link.service
systemctl --user status open-deskos-desk-link.service --no-pager
```

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

A **Hosted Pi** is a Pi coding session the desk hosts. A **Console**, a Pi session on another machine, can list, launch, attach to, prompt, cancel, end, and read the history of those sessions. The rules are decided in [ADR-0013](adr/0013-desk-link-carried-hosted-pi-control.md) and specified in the reporting package's `docs/spec-desk-link-hosted-pi-console.md`.

- **A separate connection.** A machine that holds the Control Credential opens its own connection to the same listener. One-shot requests (list, launch, history) use a connection that closes after the answer; a connection is held open only while a Console is attached, and Control Attribution lives exactly as long as it does. No second listener and no second port exist.
- **A separate credential, never transmitted.** The desk sends a one-time nonce; the Console answers with an HMAC-SHA256 proof over the exact UTF-8 transcript `open-deskos-control-v2\n2\n${nonce}\n${machine}\n${sessionId}`. Every control record is refused without that proof. The credential itself never appears on the wire, so watching the network yields no reusable execution token. Content remains plaintext. On the desk, provision `ODK_DESK_LINK_CONTROL_CREDENTIAL` in the Desk Link Service's private environment; on the Mac Console, provision the matching out-of-band value as `ODK_DESK_LINK_CONTROL_TOKEN`. Rotate it by replacing both private values and restarting only the Desk Link Service and Console Pi sessions; reporting continues on its separate token.
- **No clock agreement is required.** The handshake transcript carries no timestamp, so the two sides need no skew tolerance: the nonce is single-use and an unauthenticated control socket is closed after 10 seconds of inactivity rather than held open indefinitely. A Console's session age is different in kind, because it measures the desk's own `updatedAt` against the Console's clock; a badly skewed Console clock therefore shows a skewed age rather than a failed handshake.
- **The desk's path to its host.** The service reads the existing Hosted Pi socket from `ODESK_TASK_CONFIG` (`~/.config/open-deskos/pi-tasks.json` by default). `ODK_HOSTED_PI_SOCKET` is an explicit absolute-path override for isolated operation and tests. The host keeps owning Pi credentials and session storage, so a service restart does not end a live session.
- **One coordinate for events and history.** An event batch's position is the position of one complete entry in the Hosted Pi's own session log, which the host already writes durably. A single entry can yield several Session Events, and the Console applies the whole batch before advancing that position. Attach atomically installs the live subscription and captures its fence. A resumed Attach catches up through that inclusive fence and then follows entries strictly after it. A first Attach reports the current fence without implicitly replaying earlier history; the Console requests that history explicitly. The desk keeps no replay window, so a Console can neither repeat nor silently miss events between reconnects.
- **Attribution on the desk.** While a Console drives a Hosted Pi, the desk names that machine in the Pi Sessions overview header, and the Hosted Pi is never presented as a report-only session. Local touch and keyboard keep working unchanged.
- **Refusals are explicit.** A protocol version the desk does not accept is refused with the mismatch named; a Pi host that is down or a stale host socket produces a failure that names the reason instead of waiting.
- **Unconfigured stays unchanged.** With no Control Credential configured, a machine behaves exactly as a reporting-only machine does today, in every scenario.

## Existing-session discovery

The reporting package also reads the machine's bounded `directory-sessions` metadata registry every five seconds. This makes pre-existing Working, Settled, and Exited sessions available even when those individual processes did not load the package. It does not read session histories or authentication files. Current in-process events remain separate; discovered sessions without reported events say so rather than fabricating a stream. At least one configured reporter must be running and connected.

The Shell starts at **All** and shows a count per filter. **Working** is an explicit narrower view, not the entire inventory. Discovery and service state remain bounded to 64 sessions per machine; this is not an unbounded history archive.

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