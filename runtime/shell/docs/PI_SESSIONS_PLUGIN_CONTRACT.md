# Pi Sessions plugin contract

This contract defines replacements for `odk.source.pi-sessions` on `electron-main`.
Native plugins are trusted code with process authority; declared capabilities do not provide a sandbox.
[Configuration](CONFIGURATION.md) owns development linking, signed selections, publisher policy, trust, and grants.

## Declaration

The replacement retains the `service` kind and these provided ports:

| Port | Value |
| --- | --- |
| `odk:source/pi-sessions/v1` | A callable asynchronous scan with a `stop()` method |
| `odk:desk-reading/pi-sessions/v1` | An array containing the Pi Sessions reading declaration |

The manifest requires `odk:source/desk-link/v1` and declares `source.pi-sessions` and `ipc` permissions.
The factory receives `ctx.signal`, `ctx.onCleanup(callback)`, declared ports through `ctx.get(name)`, and capabilities through `ctx.capability(name)`.

## Configured inspection

The `source.pi-sessions` capability supplies `configured()` alongside the existing default `create()` constructor.
An independent factory uses `configured()` without invoking the default constructor.
The returned reader supplies a `source` descriptor and asynchronous `read({ signal })` operation.
It retains the existing configured local collector or SSH transport, validation, request bounds, and source labels.
It does not select Desk Link data, overlay Hosted Pi, deduplicate sessions, or project readings.
The factory owns those operations and the reader's request lifecycle.
After cancellation, the existing SSH reader waits for its child process to close before settling.

## Source selection and aggregation

Each scan requests connected machines and Hosted Pi sessions from Desk Link with the same cancellation signal.
Connected reporting machines select the Desk Link snapshot instead of configured inspection.
An empty machine list selects configured inspection.
A failed selected snapshot remains unavailable; Hosted Pi cannot replace a failed source.
Successful Hosted Pi results overlay successful selected snapshots.

Session identity uses nonempty `uuid`, then `sessionId`.
Sessions without identity remain separate.
Hosted Pi wins identity collisions with reported or local sessions.
Otherwise, the newer numeric `updatedAt`, or fallback `startedAt`, wins.
Equal timestamps prefer a nonempty activity; an equal remaining candidate retains the first observation.
The first identity occurrence determines output order.
Deduplication and Hosted Pi overlays rebuild workspace groups and status totals.
Workspace keys use `cwd`, then `workspaceName`, then `Default`.
Snapshots without duplicates or Hosted Pi overlays retain their original workspace metadata.

## IPC and reading

The `ipc` capability supplies `handle(channel, handler)` and `removeHandler(channel)`.
The factory owns `odk-pi-sessions` and returns the complete scan response through its handler.
The reading has ID `odk.app.pi-sessions`, label `Pi sessions`, and kind `app`.
Its home declaration has mode `optional`, priority `70`, icon `sessions`, and fields `['total', 'counts', 'truncated']`.
Failed scans produce `{ state: 'unavailable', value: null }`.
Successful scans produce a live reading with the snapshot's `updatedAt`.

The value includes `asOf`, total session count, sorted status counts, projected sessions, and `truncated`.
Missing status values count as `unknown`.
The projection retains the first 20 sessions and reports truncation above that limit.
Each projected session contains available identity, project, working directory, state, goal, activity, and observation time fields.
Undefined identity, project, working directory, and state fields remain omitted.
Missing goal and activity become null; explicit null values remain null.
Goal and activity strings retain 160 characters before an appended `...`.
Finite observation times become ISO timestamps; missing session times become null and missing snapshot time leaves `asOf` undefined.
Private source fields do not enter the projection.
[Desk Data](DESK_DATA_SPEC.md) owns reading transport and registry behavior.

## Lifecycle and failures

Concurrent and reentrant scans return the same active promise.
A scan after settlement starts another request.
Asynchronous scan failures return the existing `Pi scan unavailable.` response.
Synchronous Desk Link invocation failures retain their rejection while active.
Cancellation prevents new requests and aborts active requests.
After cancellation, successful and rejected operations resolve to the existing `Pi source stopped.` response.
Shutdown waits for active configured inspection and each parallel Desk Link request, including requests retained after another request fails.
The factory registers source cleanup before IPC cleanup.
Stopping Pi Sessions leaves Desk Link and Pi Events available.
The Host owns cleanup retries and prevents new instances over retained resources.

## Example and acceptance

The [independent example](../tests/fixtures/pi-sessions-replacement/entry.cjs) implements aggregation, projection, and request ownership without Shell imports or default constructor calls.
The [shared checks](../tests/pi-plugin-parity.test.js) compare default, linked, and signed session consumers through actual Main composition, IPC handlers, and Desk Data.
Event-only signed cases retain default Pi Sessions; paired signed cases replace both sources.

Signed installation uses the actual Native CLI with temporary publisher policy, trust, exact grants, and captured factory bytes.
Corruption before discovery reports an integrity rejection and restores only the affected default factory.
The independent signed peer retains its source and consumer behavior.
Removing both selections restores both defaults and preserves every fixture revision file.
The retained valid peer passes native store integrity checks; the retained corrupted revision still fails those checks.

Revision cases exercise actual Native CLI update, rollback, and removal for each source independently.
Execution markers distinguish captured factory bytes from selected manifest versions.
Stored selection changes leave running instances unchanged until complete Host shutdown and new composition.
Session, event, and Desk Data responses remain unchanged after each transition.
Unsigned updates preserve configuration bytes and running instances.
Native store checks verify retained old, updated, and peer revisions after removal.

SSH parity uses injected process responses; existing [source checks](../tests/pi-sessions-source.test.js) verify collector behavior separately.
Main capability wiring also has the actual startup check below.
The [Electron consumer check](../tests/pi-electron.test.js) compares default and signed independent sources through the actual preload and Pi page.
Three themes and two sizes preserve filters, details, announcements, and synthetic keyboard and Remote page events.
Loading, empty, unavailable, malformed, and recovered responses retain the same visible behavior.
The hidden fixture owns temporary profiles and removes source handlers before the next composition.

The [Main bootstrap check](../tests/pi-main-bootstrap.test.js) starts four separate Electron processes through production Main and the actual preload.
Actual Native CLI installation, update, rollback, and removal select paired independent sources, then restore both defaults.
A parent-owned Unix endpoint supplies reported sessions, a colliding Hosted Pi session, and recorded events.
Complete preload responses retain Hosted Pi precedence and event content across all four selections.
Signed startup rejects default source construction; normal shutdown removes both handlers and closes owned connections.

Unsigned candidates preserve configuration bytes, and native store checks verify all retained revisions after removal.
The fixture blocks local collectors, SSH execution, and local event inspection.
Its hidden windows and temporary profiles do not establish rendered parity or physical input acceptance.

These checks do not certify alternative collectors, runtime hot replacement, external reporters, live SSH, or supported-device acceptance.
