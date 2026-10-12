# Quota plugin contract

This contract defines replacements for `odk.source.quota` on `electron-main`.
Native plugins are trusted code with process authority; declared capabilities do not provide a sandbox.
[Configuration](CONFIGURATION.md) owns development linking, native installation, publisher policy, and grants.

## Declaration

The replacement retains the `service` kind and these provided ports:

| Port | Value |
| --- | --- |
| `odk:source/quota/v1` | An object with asynchronous `read()` and `stop()` methods |
| `odk:desk-reading/quota/v1` | An array with the Quota reading declaration |

The factory receives `ctx.signal`, `ctx.onCleanup(callback)`, and declared capabilities through `ctx.capability(name)`.
The manifest declares `source.quota` and `ipc` permissions without required ports.

## Provider and IPC

The `source.quota` capability supplies `read({ signal })`.
This operation returns the configured provider response or rejects with its provider error.
The response uses `state` and an optional `snapshot` containing `fetchedAt` and `accounts`.
Each account can contain identity fields, groups, reset credits, and provider errors.
The Quota IPC channel is `odk-opencode-go-status`.

The `ipc` capability supplies `handle(channel, handler)` and `removeHandler(channel)`.
The Quota handler returns the source's `read()` result without changing provider fields.
Cleanup removes the owned handler.

## Reading declaration

The reading has ID `odk.page.quota`, label `API quota`, and kind `page`.
Its home declaration has mode `optional`, priority `40`, icon `quota`, and fields `['accounts']`.
Its asynchronous `read()` method returns `{ state, value }`.
[Desk Data](DESK_DATA_SPEC.md) owns registry transport, reading metadata, and overall availability rules.

Provider state `available` maps to reading state `live`.
Provider state `unconfigured` maps to reading state `unconfigured`.
Other provider states map to `unavailable`.
Unconfigured and unavailable readings have a null value.

A live value contains `asOf` and `accounts`.
A valid `snapshot.fetchedAt` becomes an ISO timestamp; an absent or invalid timestamp leaves `asOf` undefined.
Absent account arrays become empty arrays.
Each account retains `id`, `provider`, `account`, and `plan`; absent values become null.
Absent group arrays become empty arrays.
Each group retains `title`, with null for an absent value, and projects its `quotas` array to `windows`.
Each window retains `label`, renames `remainingPct` to `remainingPercent`, and renames `resetAt` to `resetsAt`.
Undefined labels and percentages remain omitted; explicit null values remain null.
An absent reset value becomes null.
Measured percentages retain their exact values, including zero and fractional values.
The projection excludes account errors, file names, reset credits, and window descriptions.

## Lifecycle

Cancellation aborts the signal supplied to every active provider request.
Stop prevents new provider requests and waits for all active reads to settle.
A cancelled read returns `{ state: 'unavailable', reason: 'Quota source stopped' }` after either provider success or failure.
Provider failures reject unchanged while the source remains active.
Same-turn cancellation prevents a queued provider request from starting.
Repeated and concurrent stop calls wait for retained reads.
The factory registers source cleanup before it registers IPC handlers.
The Host owns cleanup retries and prevents another instance over retained resources.

## Stored selection changes

Native install, update, rollback, and removal change stored selections without changing a running Quota instance.
A later composition startup loads the selected signed revision.
Removal restores the default factory on the next composition startup and preserves retained signed revisions.
An update with unsigned entry changes fails without changing the previous configuration.
[Configuration](CONFIGURATION.md) owns these selection operations and their authorization requirements.

## Example and acceptance

The [independent example](../tests/fixtures/quota-replacement/entry.cjs) uses declared capabilities and standard JavaScript globals without Shell module imports.
The [shared checks](../tests/quota-plugin-parity.test.js) exercise default, linked, and signed implementations through actual Main composition and Desk Data.
The signed checks use temporary publisher policy, trust, grants, and installation records.
These checks do not certify alternative account providers, rendered interaction, deployed hosts, or physical input.
The separate [Electron consumer check](../tests/quota-electron.test.js) compares the existing page with default and signed source implementations.
It uses actual preload IPC and synthetic data in hidden windows with temporary profiles.
Its DOM navigation events do not establish physical input or pointer hit testing.

## Actual Main startup acceptance

The [bootstrap check](../tests/quota-main-bootstrap.test.js) starts four separate Electron processes through production Main and the actual preload.
Actual Native CLI installation, update, rollback, and removal select independent revisions, then restore the default source.
Each process owns private configuration, state, and profile paths.
Controlled configuration and provider operations prevent real account-file access and service requests.

Five explicit preload requests preserve populated and empty available responses, unauthorized responses, unavailable responses, and unconfigured responses.
Exact zero and fractional quota values remain unchanged.
The fixture waits for Shell initialization and Renderer shutdown before those requests.
Renderer startup requests receive controlled responses separately.
Signed startup rejects default source construction and identifies executed revision bytes.

Unsigned candidates preserve configuration bytes, and native store checks verify retained revisions after removal.
Normal Main shutdown removes the Quota handler and stops its source.
Parent cleanup waits for child closure before removing each profile.
Timeout and cancellation paths use forced termination; this scenario has no dedicated failure injection or descendant-process census.
These checks do not establish independent Renderer surfaces, real account providers, physical input, Windows, or CM5 acceptance.
