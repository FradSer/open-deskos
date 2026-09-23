# The Hosted Pi host publishes its endpoint

## Status

Accepted. Extends [ADR-0013](0013-desk-link-carried-hosted-pi-control.md), which gave the Desk Link
Service a path to the desk's Pi host.

## Context

ADR-0013 gave the service a client to the host's socket, and the service found that socket by reading
the host's own private configuration, `pi-tasks.json`. That made one file have two readers with two
policies: the daemon requires the file to be owned by the current user and not writable by anyone else,
and the service checked neither. Two readers of one declaration also cannot express which of them is
right when the file is edited: the service would pick up a new socket path on its next restart, while
the running daemon kept serving the old one, and the Console would report a host that is not there.

The socket path was not the only fact in that file. Roots, state directory and model are the host's
private policy; a client that reads the file to find a socket reads policy it has no use for and no
authority over.

## Decision

- The daemon **publishes where it answers**. At startup, after the socket is bound and the service is
  ready, it writes `endpoint.json` — `{version, socketPath, stateDir}` — under
  `$XDG_RUNTIME_DIR/open-deskos/hosted-pi/`, mode `0600` in a `0700` directory, atomically.
- The session runtime directory is the only absolute path the daemon and a client of the same session
  can both derive without configuring anything, so the descriptor needs no configuration and no
  discovery protocol.
- **Publishing happens after serving, never before.** Discovery may lag readiness by a few
  milliseconds; it must never promise a socket that cannot answer.
- The daemon **withdraws the descriptor** as its first act of shutdown, so a stopped host cannot look
  like a host whose socket is merely unreachable.
- The Desk Link Service resolves the socket from the descriptor and **no longer reads
  `pi-tasks.json`**. `ODK_HOSTED_PI_SOCKET` stays as the explicit override for isolated operation and
  tests.
- A host that cannot publish **keeps running**: voice-driven Hosted Pi work does not depend on the
  descriptor, so failing the whole service would take away a working capability to protect a
  discoverable one. The daemon states the reason on stderr and the Console path reports no host.
- The two sides share a **versioned, validated schema**: a descriptor whose version is not `1`, whose
  socket path is not absolute, or which cannot be parsed is treated as no host rather than
  half-read, because a wrong socket path and a dead host are indistinguishable to an operator.

## Consequences

- `pi-tasks.json` has one reader, under one policy, and the console path cannot disagree with the
  daemon about the socket that was bound.
- The descriptor is a second place that names the socket. It is written by the process that binds it
  and removed by that same process, so it is a publication rather than a declaration, and no
  operator edits it.
- A descriptor left behind by a killed host (SIGKILL, power loss) names a socket that is gone. That is
  reported as an unreachable host, exactly as before, and the next daemon start overwrites it.
- ADR-0013's contract is unchanged in every other respect: the same listener, the same credential
  handshake, the same control records, the same one coordinate for events and history.