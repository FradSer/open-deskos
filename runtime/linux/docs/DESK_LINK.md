# Desk Link: a Pi machine reports itself

Open DeskOS normally learns about Pi sessions by scanning a machine: locally, or over SSH through the optional Mac source. A Desk Link inverts that. The machine that owns the sessions opens one outbound connection and reports them, so Open DeskOS never needs to reach it.

This exists because the pull direction is not always available and cannot carry what the desk shows. On 2026-09-17 the CM5 could not reach its configured Mac address at all (`ssh: connect to host 10.10.0.226 port 22: No route to host`) while the Mac reached the CM5, and a scan can only read metadata plus one activity line — never the session's operating events.

## Pieces

| Piece | Lives in | Job |
|---|---|---|
| `@fradser/pi-open-deskos` | the reporting machine | Reports session state and bounded events |
| Desk Link Service | the Open DeskOS runtime | Accepts links on the local network, holds state, serves the runtime |
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

A missing address **or** token keeps the machine silent; there is no partially configured link. `/open-deskos` inside Pi shows the link state, machine, reported session count, and event count.

## Runtime side

The service listens on the local network only and authenticates every Desk Link with the token. Its channel to the runtime is a Unix socket in an owner-only directory, authenticated by filesystem ownership rather than by the token.

The unit reads its token from `~/.config/open-deskos/runtime.env` — the same
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

1. A connected Desk Link answers, and nothing else does — mixing a link with a scan would report one list from two sources.
2. With no connected link, the configured SSH source answers.
3. Otherwise the local collector answers.

The label always names which source answered: `Desk Link · <machine>`, `Mac / SSH · <host>`, or `Local`.

## What is reported and what is not

Reported sessions carry identity, state, the latest prompt as a goal, and bounded events: at most 300 entries and 1 MiB of text per session. Every event keeps the body Pi produced, bounded per kind with an explicit truncation flag — a tool result 64 KiB, an assistant reply 16 KiB, a prompt 8 KiB, a thought or a tool call 4 KiB — so a bash command, a prompt, and a result are read in full instead of being flattened to one line. A result also carries a separate tool name. The service enforces the same bounds itself, because a reporting machine is never trusted to have bounded its own data; the service and the reporter read one shared set of constants, so they cannot disagree. See ADR-0012 for Markdown, table, and text-only safety rules and ADR-0015 for the reading palette, body bounds, and retention window.

**Management is out of scope.** v1 is report-only: the package never sends a prompt, blocks a turn, or mutates a message, and a reported session offers no control in Open DeskOS. Visibility through a Desk Link never makes a session controllable.

**The transport is not encrypted.** It is a plain connection to a LAN-only listener, with the token as the only gate. Do not expose the Desk Link Service beyond the local network.

## Existing-session discovery

The reporting package also reads the machine's bounded `directory-sessions` metadata registry every five seconds. This makes pre-existing Working, Settled, and Exited sessions available even when those individual processes did not load the package. It does not read session histories or authentication files. Current in-process events remain separate; discovered sessions without reported events say so rather than fabricating a stream. At least one configured reporter must be running and connected.

The Pi Sessions page lands on its Session Filter's Live set, so a discovered session that has exited waits behind the Exited tab instead of crowding current work. Discovery and service state remain bounded to 64 sessions per machine; this is not an unbounded history archive.

## Independent reporters on one machine

Each authenticated connection owns the sessions it reports. A `sessions` record replaces only that connection's previous set; the runtime exposes the union of all connected reporters on the machine. One Pi process cannot erase the sessions reported by another process with the same machine name. Events are accepted only from a connection reporting that session.

One session is one snapshot entry even when several reporters describe it, because every reporter's inventory names the whole machine's sessions while the owner also reports its own. The entry's report is the richest one: a report with events wins over one without, then the newest. Counts, workspaces, and the page all follow that deduplicated set. Session events are then read from whichever machine actually holds them, so a session known to a machine without events is not answered as "no events yet" while its owner has a stream.

The runtime deduplicates again for every source, so the desk stays correct while an older service instance is still running. A machine identity that two reporters disagree about — the package derives it from the system hostname, which can change between boot and network configuration — therefore shows one row, not two.

The machine-wide session and event limits still apply to this union. Runtime snapshot replies have a separate 2 MiB limit because they repeat workspace membership; fragmented UTF-8 is decoded across TCP boundaries rather than character-by-character chunks. A connection dropping removes only its ownership; a session remains available if another connected reporter still reports it.

## When a link drops

When the last link drops, the machine disappears from the snapshot and its sessions become unavailable rather than stale-and-trusted — a disconnected reporter is not a mirror. The reporting side reconnects with a growing wait (1s, 2s, 4s … capped at 30s), keeps one link, and retains only the newest bounded events, so an outage costs freshness rather than memory. Open DeskOS falls back to the next source in precedence.

## Troubleshooting

- Nothing appears: check `ODK_DESK_LINK_TOKEN` matches on both sides, then the address and port, then that the service's bind address is reachable from the reporting machine.
- The desk shows `Local` while a machine should be reporting: the link is not currently connected. `/open-deskos` on the reporting machine states the link state and the last error.
- The desk shows `Unavailable`: the source that answered could not produce a snapshot. The label names it.
- One session appears twice, or the label names one machine twice: the reporting processes disagree about their machine identity, which the package derives from the system hostname. The desk deduplicates by session identity regardless, but fix the reporters so `/open-deskos` on each names the same machine.