# Desk Link carries Hosted Pi control

## Status

Accepted. Revised after an independent review: control runs on its own connection rather than multiplexing into the reporter's, the service's path to the Pi host is stated as work to be added rather than an existing socket, the reserved `prompt` reply's direction is corrected, and the ACP/MCP alternatives are recorded.

## Context

ADR-0006 deferred management: a Desk Link reported sessions and never delivered a prompt, and the package's v1 README reserved a `prompt` reply the service could send to a reporter, which nothing implemented. The v1 record union carries only hello, sessions, events, and bye, so the reserved reply is service-to-reporter while control needs a reporter-to-desk prompt record — the opposite direction. The operator now needs the opposite direction of that decision — sitting at a Mac, launching and driving a Pi session that the desk hosts, following its progress, and intervening mid-turn.

Two of the three available directions were already ruled out by facts on the machines. A scan-style source cannot carry a live event stream. The desk's own cross-host task transport is SSH (desk → Mac), which is batch, single-request, and polled, and running it in reverse would need the desk's SSH surface, a second credential path, and a second interpretation of the same capability.

## Decision

- Control uses the same LAN listener and the same kind of package-initiated link, but the Console opens its own connection instead of multiplexing into the reporter's socket: that transport is private to the reporter, connects in its constructor, resets its backoff only on `ack`, and has no request/reply correlation. Open DeskOS still never requires inbound access to the Mac, and no second listener is added.
- The control side is the **Control Link**, authorized by a **Control Credential** that is separate from the reporting token, and the credential itself never travels on the wire: the desk sends a one-time nonce, the Console answers with an HMAC proof over it, and control records are refused without that proof. A link that presents only the reporting token stays exactly as report-only as it is today.
- A **Console** launches, prompts, attaches to, and cancels **Hosted Pi** sessions over the Control Link, and receives their events. One Console drives one Hosted Pi at a time.
- Hosted Pi sessions keep a durable identity, survive their Console's disconnect, and publish a bounded event stream carrying a per-session monotonic sequence. Attaching or reconnecting replays the retained tail without repeating an event.
- Event content reuses the bounded Session Event contract. A Console may pull a Hosted Pi's complete history and complete tool results on demand, while what enters the driving session's own context stays bounded.
- The desk states Control Attribution for as long as a Console drives a Hosted Pi, and local touch and keyboard keep working unchanged.
- The protocol version moves to v2. A v1 reporter's records and the service's v1 replies stay valid.

## Consequences

- Open DeskOS's LAN listener becomes an execution surface: the Control Credential is equivalent to running prompts as the desk's Pi host user. It stays LAN-only, credential-separated, and attributed by machine and session identity; it must never be exposed beyond the local network.
- The Desk Link Service gains a configured path to the desk's Pi host, which it does not have today: the service's only socket is the runtime channel, and the Pi host is a separate process on its own configured socket. The service gets a client to that socket rather than becoming the host, for three reasons: the host owns Pi credentials and the session storage, the desk's existing pattern is separate user services on their own private sockets, and the service is a restart-on-failure unit, so merging them would let a two-second service restart kill live sessions. Either way the control records and event push belong to the Desk Link Service and not to the Electron runtime, so both sides change: the desk gains the host path, the control records, and the event push, and the reporting package gains a Console client, its tools, and its console surface.
- `docs/DESK_LINK.md`'s "Management is out of scope" statement and the reporting package's "no management" claim are superseded for links holding a Control Credential; both documents must be updated with the spec, and the v1 report-only behaviour of an unconfigured machine must be kept as a scenario.
- A Hosted Pi with no attached Console keeps running and stays attachable by identity. Control is therefore a property of the Hosted Pi, not of one Console's lifetime.
- The reserved v1 `prompt` reply — a service-to-reporter reply, never a reporter-to-desk record — stays unimplemented. Control defines a new reporter-to-desk prompt record; nothing revives the reserved reply for a reported session.

## Considered options

- **Mac → desk over SSH**, mirroring the desk's own `task-client` transport. Rejected: it can only poll, it needs the desk's SSH daemon and a separate credential, and it would define the same capability twice on two transports.
- **A second listener or port for control.** Rejected: it adds a credential, a discovery path, and another exposed socket for isolation that the credential split already provides.
- **Reusing the reporting token for control.** Rejected: a leaked token would silently escalate from read-only reporting to prompt execution on the desk.
- **Sending the control credential in the handshake the way the reporting token is sent.** Rejected after review: the link is plaintext, so a passive capture would yield a replayable execution token. A one-time nonce with an HMAC proof keeps the secret off the wire for one extra round trip. Full stream confidentiality and integrity remain the transport's job and are out of scope for a LAN-only link.
- **A separate controller-initiated protocol from the runtime.** Rejected: the runtime already has a Unix-socket contract with the shell, and the desk must not need inbound reachability for this to work.
- **Multiplexing control into the reporter's existing connection.** Rejected after review: the reporter owns a private transport, connects in its constructor, treats only `ack` as proof of acceptance, and has no request/reply correlation, so sharing it would merge two lifecycles into one failure domain. A second connection to the same listener adds no new exposed surface.
- **Adopting ACP or MCP as the control protocol.** Rejected: ACP's stable transport is stdio only, it explicitly does not replay in-flight messages, it defines no message sequencing or stream resumption, it defines no client authorization, and it leaves multiple clients on one session undefined. OpenAI reports that MCP semantics did not fit this job and replaced them with a purpose-built JSON-RPC surface.