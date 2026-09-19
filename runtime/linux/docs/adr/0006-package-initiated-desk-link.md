# A Pi machine reports to Open DeskOS over a package-initiated Desk Link

## Status

Accepted. The deferral of management recorded here is superseded by ADR-0013, which carries control on its own connection with a separate credential. Reporting itself is unchanged.

## Context

Open DeskOS learned about Pi sessions by scanning a machine: locally, or over SSH through the optional Mac source. Two limits forced this decision. The direction is not always available — on 2026-09-17 the CM5 could not reach its configured Mac address at all (`ssh: connect to host 10.10.0.226 port 22: No route to host`) while the Mac reached the CM5, so the pull source degraded to `unavailable`. And a scan reads metadata plus one activity line: the Session Detail's operating events live in the session log on that machine, which the SSH pull cannot stream.

The alternative — the package exposing a local endpoint that Open DeskOS pulls from — keeps the same inbound-access requirement, and the planned management capability (delivering a prompt into a reported session) needs a channel Open DeskOS can also speak back on.

## Decision

- A Pi package on the reporting machine opens the connection to Open DeskOS. Open DeskOS never requires inbound access to that machine.
- Open DeskOS runs a Desk Link Service as a user service that listens on the local network only and authenticates every connection with a per-link token.
- The link carries the machine's session state and bounded Session Events, reusing the bounded, single-line event shape the local collector already produces.
- A Reported Session appears beside scanned sessions, and its provenance is a Desk Link rather than a filesystem or SSH source.
- The optional SSH Mac source is not replaced by this decision; it remains a separate source.
- Management of a reported session is explicitly deferred: visibility through a Desk Link never implies manageability.

## Consequences

- Open DeskOS gains its first listening network surface. It is LAN-only, token-authenticated, and owned by a dedicated service, so its failure cannot take down the shell.
- One Desk Link outlives individual sessions: a machine reports many sessions over a single link.
- Reported data is bounded by the same event rules as the local collector, so a reporting machine cannot flood the desk.
- A token is a per-link shared secret provisioned out of band; the service is not a discovery protocol, and a machine that does not know a token cannot register.
- A Desk Link is not a synchronized mirror: a disconnected reporting machine's sessions become unavailable rather than stale-and-trusted.
