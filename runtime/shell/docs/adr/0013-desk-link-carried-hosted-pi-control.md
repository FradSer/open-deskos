# Desk Link carries Hosted Pi control

## Status

Accepted. Rewritten after an independent review and a simplification pass: control opens its own connection instead of multiplexing into the reporter's, the credential never travels on the wire, the desk gains a path to its own Pi host, a replay window is deliberately absent, and the ACP and MCP alternatives are recorded.

## Context

ADR-0006 deferred management: a Desk Link reported sessions and never delivered a prompt, and the package's v1 README reserved a `prompt` reply the service could send to a reporter, which nothing implemented. (The v1 record union carries only hello, sessions, events, and bye, so that reserved reply is service-to-reporter; control needs a reporter-to-desk prompt record, the opposite direction.) The operator now needs the direction that decision deferred: sitting at a Mac, launching and driving a Pi session that the desk hosts, following its progress, and intervening mid-turn.

Two facts from the code fixed the shape of the answer. The reporter's transport is private to the reporter, connects in its constructor, treats only `ack` as proof of acceptance, and has no request/reply correlation, so it cannot carry control without being rebuilt around a second lifecycle. And the desk's Pi host is a separate process on its own configured socket that the Desk Link Service has no path to at all: the service's only socket is the runtime channel.

## Decision

- Control uses the same LAN listener and the same kind of package-initiated link, but the Console opens **its own connection** rather than multiplexing into the reporter's. The reporting connection and its backoff are untouched.
- That control connection is **short-lived or attachment-scoped**: a list, launch, or history request uses a one-shot connection, and a held connection exists only while a Console is attached. Control Attribution's lifetime follows that held connection, so there is no long-lived idle control connection to keep alive and no idle reconnect state.
- The control side is the **Control Link**, authorized by a **Control Credential** that is separate from the reporting token, and the credential itself **never travels on the wire**: the desk challenges with a one-time nonce, the Console answers with an HMAC proof over it, and every control record is refused without that proof. A link holding only the reporting token stays exactly as report-only as it is today.
- The handshake carries the protocol version and a **Console identity**: the driving Pi session's identity plus its machine name, so two Pi sessions on one machine are distinguishable Consoles and attribution is representable.
- The desk accepts a defined window of protocol versions and **refuses a mismatch explicitly**. Silently dropping a record whose version is not 1 makes a newer Console look like a credential failure and reconnect forever.
- Console-to-desk records are list, launch, attach, prompt, cancel, end, and history; desk-to-Console records are state, event, acknowledgement, and error. There is no detach record, because disconnecting or attaching elsewhere is what detaching means.
- Live events and history share **one coordinate**: the position of the corresponding entry in the Hosted Pi's own Pi session log, which the host already writes durably. No separate counter, reset rule, or persisted sequence store is introduced.
- There is **no replay window and no resync record**. On attach a Console states the position it last applied, or learns the current boundary on a first attach, reads history from that position, and then consumes live events from that boundary onward. Nothing earlier is replayed from memory, so the desk keeps no per-session replay buffer, needs no window sizing or expiry rule, and a silent gap has no way to occur.
- The service gains a **client to the Pi host's socket** rather than becoming the host. The host owns Pi credentials and session storage, the desk's existing pattern is separate user services on private sockets, and the service restarts on failure, so merging them would let a two-second restart kill live sessions.
- The desk states **Control Attribution** for as long as a Console drives a Hosted Pi, and local touch and keyboard keep working unchanged.
- The protocol version moves to v2. A v1 reporter's records and the service's v1 replies stay valid.

## Consequences

- Open DeskOS's LAN listener becomes an execution surface: the Control Credential is equivalent to running prompts as the desk's Pi host user. It stays LAN-only, credential-separated, attributed by machine and session identity, and must never be exposed beyond the local network. Content remains plaintext; keeping the credential off the wire removes the replayable-token risk, not the confidentiality risk.
- Both sides change. The desk gains a path to its Pi host, the control records, the event push, and the surface work that attribution and the new states require; the reporting package gains a Console client, its tools, and its console surface.
- The desk's Pi host must be **rewritten, not reused**: it creates, runs, and disposes a session per request today. ADR-0014 covers what that session may then do.
- `docs/DESK_LINK.md`'s "Management is out of scope" statement and the reporting package's "no management" claim are superseded for links that can prove the Control Credential; both documents must be updated with the spec, and the v1 report-only behavior of an unconfigured machine must be kept as a scenario.
- Control is a property of a Hosted Pi: it keeps running and stays attachable by identity with no attached Console. Attribution is a property of the held connection and clears when it ends.
- The desk holds no per-session replay buffer for control, and the failure mode of a Console silently missing events between reconnects is removed rather than bounded.

## Considered options

- **Mac → desk over SSH**, mirroring the desk's own `task-client` transport. Rejected: it can only poll, it needs the desk's SSH daemon and a separate credential, and it would define the same capability twice on two transports.
- **A second listener or port for control.** Rejected: it adds a credential, a discovery path, and another exposed socket for isolation that the credential split already provides.
- **Reusing the reporting token for control.** Rejected: a leaked token would silently escalate from read-only reporting to prompt execution on the desk.
- **Sending the control credential in the handshake the way the reporting token is sent.** Rejected after review: the link is plaintext, so a passive capture would yield a replayable execution token. A one-time nonce with an HMAC proof keeps the secret off the wire for one extra round trip.
- **Multiplexing control into the reporter's existing connection.** Rejected after review: the reporter owns a private transport, connects in its constructor, treats only `ack` as proof of acceptance, and has no request/reply correlation, so sharing it would merge two lifecycles into one failure domain.
- **Bounding and expiring a replay window, with an explicit resync when a cursor aged out.** Rejected in the simplification pass: it required a window, a sizing rule, an age bound, an eviction case, a resync record, and client-side gap handling, to buy a bounded tail that the session log already holds durably. Stating a position and reading history from it achieves the same guarantee with none of those mechanisms.
- **A persisted per-session sequence counter.** Rejected after checking Pi's session format: entries carry stable tree ids but no ordered cursor, while the log's line order is durable append order. The position in the log is therefore already the coordinate, and no counter has to survive a restart without resetting.
- **A separate detach record.** Rejected: disconnecting or attaching elsewhere already means detaching.
- **Adopting ACP or MCP as the control protocol.** Rejected: ACP's stable transport is stdio only, it explicitly does not replay in-flight messages, it defines no message sequencing or stream resumption, it defines no client authorization, and it leaves multiple clients on one session undefined. OpenAI reports that MCP semantics did not fit this job and replaced them with a purpose-built JSON-RPC surface.