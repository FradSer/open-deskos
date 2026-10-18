# Open DeskOS Link source replacement contract

## Scope

The Main plugin identity is `odk.source.odk-link`.
It provides `odk:source/link/v1` and requires the `source.odk-link` capability.
[Main composition](../src/plugins/main-composition.js) owns selection checks.
[Open DeskOS Link client](../src/odk-link-client.js) owns the default implementation and raw transport.
[CONTEXT](../CONTEXT.md#pi-sessions-inspection) owns Open DeskOS Link terms.

## Raw transport capability

Main grants `createTransport(options)` alongside the existing `create(options)` client constructor.
`createTransport` returns `{ socketPath, request, subscribeCompletions }` without creating a source client or sending a request.
`request(record, { signal })` sends one record and returns the transport response.
The default transport retains endpoint resolution, lazy credential loading, handshake selection, framing, response bounds, timeout, and connection closure.
Abort signals suppress late values and cancelled failures.
Other request failures remain visible to the source.

An independent source owns result validation, unavailable states, request lifetime, and shutdown.
The transport does not implement these source contracts.
Trusted native code retains process authority.
This capability does not provide a sandbox.

## Public source behavior

| Method | Existing request | Existing result contract |
| --- | --- | --- |
| `snapshot(options)` | `{ v: 1, type: 'snapshot' }` | Successful records retain sessions and workspace metadata; unavailable records retain reason and empty collections |
| `hostedSessions(options)` | `{ v: 1, type: 'hosted-sessions' }` | Successful records return sessions and scan time; unavailable records preserve the existing reason policy |
| `machines(options)` | `{ v: 1, type: 'machines' }` | Available machine arrays or an empty array |
| `sessionEvents(id, options)` | `{ v: 1, type: 'events', sessionId: id }` | Existing event, truncation, and failure fields |
| `stop()` | No new request | Cancellation followed by completion of all owned requests |

Request options can contain an AbortSignal.
Only `hostedPi: true` adds the existing `hostedPi` field to event requests.
An absent endpoint prevents transport requests.
An invalid event identity preserves the existing unconfigured result.

Cancellation of one request must leave independent requests available.
Cancellation between transport completion and public method completion must suppress the result.
Source shutdown prevents new requests and suppresses late results.

## Completion notifications

`create(options)` accepts an optional `onCompletion` callback.
`subscribeCompletions(callback, { signal })` opens a read-only runtime subscription and returns `{ stop, snapshot }`.
The runtime accepts `{ v: 1, type: 'subscribe-completions' }` through the existing authenticated local channel.
It sends only `{ v: 1, type: 'completion' }`, without report content or control authority.
Each connection receives one catch-up hint, which also acknowledges the subscription.
The first hint must arrive within two seconds.
A connected runtime without that acknowledgement becomes `unsupported`; the client closes it without automatic reconnection.
Connection failures remain `unavailable` during transport recovery.
`completionStatus()` exposes the fixed state without report content.
When the callback is enabled, snapshot results also include `completionNotifications.state` for source inspection.
Sources without the callback retain their existing snapshot results.
Transport recovery reconnects the subscription; it does not scan Pi progress.

Reported completion requires a settled or exited session and its latest event with `kind: 'assistant'`, `stopReason: 'stop'`, and `eventId`.
Either arrival order can complete these conditions.
Legacy events without an identifier remain readable but cannot produce automatic completion hints.
The server suppresses recent repeated event identifiers per reported session.
Personal Agent owns durable deduplication after it reads current source records.
Hints do not establish successful task execution.

Main routes these hints as `odk.app.pi-sessions.completed` service notifications.
The Bot client retains one pending completion hint until its authenticated connection is ready.
After a participating Bot connection closes, its next handshake sends one read-only catch-up hint.
This hint never repeats an owner command or task mutation.
Other source updates keep their existing delivery behavior.
Shutdown cancels reconnection, suppresses late callbacks, and joins the subscribed socket.
Independent sources must retain this optional callback and shutdown behavior.

## Consumers and ownership

The [Pi Sessions source](../src/pi-sessions-source.js) consumes machines, hosted sessions, and snapshots.
The [Pi Session Events source](../src/pi-session-events-source.js) consumes reported events before applicable local fallback.
Known reported-session failures remain authoritative.
Plugin shutdown releases consumers before their required Open DeskOS Link source.
Every pending transport request remains owned until it settles.

## Acceptance sources

The [shared cases](../tests/odk-link-plugin-parity.test.js) exercise default, development-linked, and signed independent sources.
The [independent entry](../tests/fixtures/odk-link-replacement/entry.cjs) imports no Shell implementation and never constructs the default client.
Signed cases execute captured entry bytes after stored entry mutation.
Controlled transport cases compare wire records, results, actual Pi consumers, local fallback, cancellation, and shutdown.
Owned Unix socket cases exercise framing, CJK responses, reported event IPC, and pending connection closure.
[Transport checks](../tests/odk-link-transport.test.js) inspect raw construction and retained token handshake inputs.

The [Main bootstrap cases](../tests/odk-link-main-bootstrap.test.js) start four actual Main processes through an isolated Electron wrapper.
Actual preload consumers preserve Pi session and event results across signed installation, update, rollback, and default restoration.
Each process has a private profile and uses a parent-owned Unix endpoint.
The wrapper disables unrelated Main sources and hides its window.
It verifies selected source execution, normal shutdown, IPC release, and request connection closure.

These fixtures do not establish rendered replacement parity, external reporters, or deployed-host acceptance.
Token input checks do not establish a real Windows named-pipe handshake.
The [native source results](PLUGIN_COVERAGE.md#native-odk-link-source-acceptance) record CM5 execution of these existing checks.
Windows, physical input, and real Hosted Pi control require separate acceptance.
[Plugin coverage](PLUGIN_COVERAGE.md) owns recorded check results.
