# Pi Session Events plugin contract

This contract defines replacements for `odk.source.pi-events` on `electron-main`.
The replacement retains kind `service`, required port `odk:source/desk-link/v1`, and provided port `odk:source/pi-events/v1`.
The manifest declares permissions `source.pi-events` and `ipc`.
Native plugins are trusted code with process authority; declared capabilities do not provide a sandbox.

## Source and capabilities

The provided port is a callable `source(request)` with a `stop()` method.
Both operations return promises.
The factory receives `ctx.signal`, declared ports through `ctx.get(name)`, and cleanup registration through `ctx.onCleanup(callback)`.

The `source.pi-events` capability supplies `readLocal(request)` alongside the existing default `create(options)` operation.
An independent implementation uses `readLocal` without invoking `create` or importing Shell modules.
Main supplies the existing `readSessionEvents` operation for local log inspection.
The default constructor remains available for existing factories.

The Desk Link port supplies `sessionEvents(sessionId, { hostedPi, signal })`.
The plugin passes its cancellation signal and interprets `hostedPi` as true only for boolean true.
Reported success returns the complete response without modification.

## Local fallback

These reported failure reasons permit local log inspection:

- `session-log-missing`
- `desk-link-unconfigured`
- `desk-link-unavailable`

Other reported failures remain authoritative and return without local inspection.
A rejected reported operation rejects the source read while the source remains active.
Local inspection receives the complete source request and returns its complete response.
A rejected local operation rejects the source read while the source remains active.
Neither fallback nor error handling changes event content or adds inferred events.

## IPC

The `ipc` capability supplies `handle(channel, handler)` and `removeHandler(channel)`.
The factory owns channel `odk-pi-session-events`.
The handler passes string `cwd` and `sessionId` values, with empty strings for other input types.
It passes boolean `hostedPi`, with false for other input types.
Additional request fields do not reach the source through IPC.
The handler returns the complete source response.

## Lifecycle

Cancellation aborts active reported requests and prevents additional reads.
Cancellation after a reported request prevents local fallback from starting.
An already active local read must settle before shutdown finishes.
Concurrent shutdown callers wait for all active reads.
After cancellation, success and rejection both resolve to `{ ok: false, reason: 'pi-source-stopped' }`.
The factory registers source cleanup before it registers IPC handlers.
Cleanup removes the owned handler and drains its source.
The Host retains failed cleanup and prevents another instance over retained resources.
Stopping Pi Session Events leaves the shared Desk Link and Pi Sessions consumers available.

## Example and acceptance

The [independent example](../tests/fixtures/pi-events-replacement/entry.cjs) uses declared capabilities and standard JavaScript globals.
The [shared checks](../tests/pi-plugin-parity.test.js) compare default, independently linked, and signed event implementations through actual Main composition and IPC handlers.
They reject default constructor calls by the independent factory and refuse module imports in a separate construction check.
The [native lifecycle checks](../tests/pi-source-lifecycle.test.js) cover existing source request ownership separately.
Signed checks use the actual Native CLI, temporary publisher policy, explicit trust, exact grants, and captured entry bytes.

Corruption before discovery reports an integrity rejection and restores the default event consumer.
Selection removal restores the default consumer without deleting stored entry bytes.
Event-only signed cases retain default Pi Sessions; paired signed cases replace both sources.

The [Pi Sessions contract](PI_SESSIONS_PLUGIN_CONTRACT.md) defines separate independent session aggregation acceptance.
The shared revision cases exercise actual Native CLI update, rollback, and removal for each source.
Signed execution markers distinguish captured factory bytes from selected manifest versions.
Complete Host shutdown precedes new composition; selection changes preserve consumers and the signed peer.
Unsigned updates preserve configuration bytes, and native store verification checks retained revisions after removal.

The [Electron consumer check](../tests/pi-electron.test.js) compares default and signed independent sources through the actual preload and rendered transcripts.
It preserves multiline English and CJK, folded reasoning, recorded tool outcomes, filters, and synthetic navigation across three themes and two sizes.
Delayed, empty, unreadable, malformed, and recovered responses retain the same visible behavior.
The hidden fixture uses temporary signed bundles, publisher policy, revision storage, and parent-owned profiles.

The [Main bootstrap check](../tests/pi-main-bootstrap.test.js) starts four separate Electron processes through production Main and the actual preload.
Actual Native CLI installation, update, rollback, and removal select paired independent sources, then restore both defaults.
A parent-owned Unix endpoint supplies reported sessions, a colliding Hosted Pi session, and recorded events.
Complete preload responses retain Hosted Pi precedence and event content across all four selections.
Signed startup rejects default source construction; normal shutdown removes both handlers and closes owned connections.

Unsigned candidates preserve configuration bytes, and native store checks verify all retained revisions after removal.
The fixture blocks local collectors, SSH execution, and local event inspection.
Its hidden windows and temporary profiles do not establish rendered parity or physical input acceptance.

These checks do not certify runtime hot replacement, external reporters, physical input, or supported-device acceptance.
