# A runtime channel is authenticated by ownership, and by a token where ownership cannot reach

## Status

Accepted

## Context

The Display Shell and the services beside it talk over local channels: the Desk Link runtime channel, the user-application control endpoint, the Remote Bridge, and the personal bot. On the reference host each of these is a Unix socket inside a directory only its owner can enter, with the socket mode set to `0600`. That ownership is the authentication: a peer that could open the socket is a peer that runs as this user, and no credential has to be provisioned or rotated for the channel to be trustworthy.

A 64-bit Windows host has named pipes instead of Unix sockets. A pipe carries no owner, no mode, and no uid, and there is no private parent directory to lean on. Node cannot express a pipe's own security descriptor either, so a host that moved a channel onto a pipe without a replacement would silently drop the only thing that authenticated it: any local process could connect to `\\.\pipe\open-deskos-desk-link` and ask for the runtime snapshot.

## Decision

- Every runtime channel gets its authentication from the platform's own means. On a Unix host that is ownership, unchanged: the private directory, the `0700` directory mode, the `0600` socket mode, the owner checks, and the refusal to delete anything at that path that is not this user's socket all stay exactly as they were.
- Where ownership cannot authenticate a peer, the channel authenticates with a token: a 32-byte value from the platform's cryptographic random source, kept in one file per host at `localChannelTokenFile` (`local-channel.token` under the host's state directory), written `0600` on a host that has modes and restricted by the profile ACL where it does not, created on first use so no operator provisions it, and readable only by the user the desk runs as.
- The token is presented as the first line of the connection (`{"v":1,"token":"…"}\n`) and compared in constant time. The handshake is removed from the stream before the channel's own protocol sees anything, so a client that writes the handshake and its first frame in one write is not misread.
- A channel that ownership *can* authenticate keeps ownership as its gate and treats the token as a second layer: our own clients present it, and a client that predates the token still reaches the protocol with every byte it sent intact. A channel that ownership cannot authenticate refuses a connection without a valid token before its protocol is reached, and states the refusal once per distinct reason.
- A presented handshake must verify. A wrong token is a refusal, not a fallback to ownership.
- The endpoint's ownership rules stay the endpoint's rules: an existing socket file left behind by a stopped service is replaced, a live service is never stolen from (its socket is not unlinked, and a second listener reports that one is already listening), and anything at that path that is not this user's socket is refused rather than deleted.
- The channel that a bundled external service plugin connects to is unchanged. Its peer is a component outside this repository, so requiring a handshake there would break a contract this change is not authorized to break. A service plugin ported to a Windows host adopts the token handshake as part of that port.

## Considered Options

- **Requiring the handshake on every host, strictly.** Rejected: it breaks every existing Unix client, including the external service plugin and any agent that already speaks the user-application control endpoint, for no gain where ownership has already established who the peer is.
- **Relying on the pipe name being unguessable.** Rejected: a name is not a secret. Any local process can enumerate the pipe namespace, so an unguessable name delays detection at best; the token is what actually authenticates.
- **Setting a restrictive ACL on the pipe with a native addon.** Not available: Node's `net` server has no API for a pipe security descriptor, and adding one would make the channel depend on a compiled module that the shell is otherwise designed to run without. The token file reaches the same place with no native dependency.
- **Leaving the Windows channels unprovisioned.** Rejected: it removes Futu monitoring, the Desk Link, and user-application control from a supported host, which is the parity this work exists to deliver.

## Consequences

- A supported Windows host provisions the Desk Link runtime channel and the user-application control endpoint as named pipes, authenticated by the channel token.
- The token file is the one secret this channel adds, and it is per host: a token copied between two machines is only meaningful on the machine whose file it came from. An administrator of a Windows host, or `root` on a Unix host, can read it, which is the same reach those accounts already have over the process.
- The ownership path is untouched, so the reference host's behavior, including its refusals, does not change.
- `runtime/shell/tests/local-channel.test.js` holds the transport's own scenarios, and the Windows-only ones run on a Windows host when the suite is run there.