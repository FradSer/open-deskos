# WeRead source plugin contract

This contract defines replacements for `odk.source.weread` on `electron-main`.
The replacement retains kind `service`, no required ports, and permissions `source.weread` and `ipc`.
Its [manifest example](../tests/fixtures/weread-replacement/manifest.json) declares the complete provided port set.
Native plugins remain trusted process code; signatures and declared grants do not provide a sandbox.

## Source and capabilities

The `odk:source/weread/v1` port provides `refresh()`, `snapshot()`, and `stop()`.
Refresh and stop return promises; snapshot returns the current response without provider requests.
The `source.weread` capability supplies `options` and the existing default `create(options)` constructor.
An independent implementation consumes options without calling that constructor.
Main currently supplies the Host-owned cache path through options.

The [default source](../src/weread-source.js) owns option defaults and the existing provider behavior.
Options include `apiKey`, `fetchImpl`, `now`, `random`, `cacheFile`, `fsImpl`, and `signal`.
The existing API key default reads `WEREAD_API_KEY` from the process environment.
The factory passes its Host cancellation signal to its owned source.
The signed example captures its shared reading modules within the verified bundle.

## Consumer contracts

The factory owns channel `odk-weread-highlight` through the `ipc` capability.
Its handler waits for refresh and returns the current complete snapshot.
Snapshot states are `loading`, `live`, `empty`, `error`, and `unconfigured`.
Responses preserve the selected highlight, measurement timestamp, cover data, and existing error text.
Valid cached highlights remain readable without a configured API key.

The `odk:desk-reading/weread/v1` port provides reading declarations for `odk.tile.weread`.
The [reading projection](../src/plugins/readings/weread.js) owns fields, home metadata, availability mapping, and text limits.
It retains source measurement time, book identity, highlight text, and chapter range without cover images.
Both implementations use this same public projection.
The signed bundle contains its verified projection, common helpers, and health module.

The `odk:plugin-health/odk.source.weread/v1` port provides `snapshot()`.
Health reads cached source state and never starts provider requests.
The reading module owns health state and timestamp mapping.
Cached health does not prove live provider connectivity.

## Preserved behavior and lifecycle

Synchronization retains the existing eight-notebook limit, twenty-highlight limit, and thirty-minute refresh interval.
Highlight selection preserves four-book cooldown, random endpoints, and concurrent request completion behavior.
Cover handling preserves image types, the 512 KiB limit, empty-image rejection, cached values, and retry behavior.
Cache schema version 2 and existing highlights remain unchanged.
Cache read or write failures do not prevent successful live readings.

Cancellation aborts owned requests and prevents new requests or late state and cache writes.
Shutdown waits for active requests and response bodies, including siblings retained after another request fails.
The factory registers source cleanup before IPC cleanup.
Disable removes the owned handler and reading before enable creates another source.
The Host retains failed cleanup resources and owns retry behavior.

## Example and acceptance

The [independent example](../tests/fixtures/weread-replacement/entry.cjs) implements notebook requests, highlight selection, synchronization, caching, and cover resolution.
It does not import the default source or call its constructor.
The [shared checks](../tests/weread-plugin-parity.test.js) compare default, development-linked, and signed implementations through actual Main composition, IPC, Desk Data, and health.
The [signed helper](../tests/helpers/weread-selection.js) uses the actual Native CLI, temporary publisher policy, explicit trust, and exact grants.
Signed entry execution markers distinguish the actual source from selected manifest metadata.

Entry and shared module changes after discovery cannot alter captured consumer behavior.
Corruption before discovery reports a hash rejection and restores actual default IPC, readings, and health.
Removal follows complete Host shutdown and preserves verified revision files before default composition starts.
The shared scenarios use isolated provider responses, cache files, configuration, and revision storage.

The [rendered checks](../tests/weread-electron.test.js) compare default and signed independent sources through actual Main composition, preload, and the mounted Widget.
The matrix covers three themes, five standard sizes, loading, live, empty, error, recovery, and unconfigured states.
It checks complete plain text, metadata, contained geometry, and decoded cover regions with distinct colors.
Long excerpts retain a fourteen-pixel minimum and a focusable vertical scroll region.
Electron keyboard input verifies End and Home inside that region without changing the Reading page.

The [Widget](../src/renderer/plugins/weread.js) owns its resize observer, fitting frame, and current cover image through scoped cleanup.
Release disconnects the observer, cancels fitting, and clears image callbacks.
Released reading responses and superseded cover callbacks cannot change the mounted content.
Failed observer cleanup remains available for the registry's release retry.
Widget release does not cancel shared Main provider requests; the source owns provider cancellation and drain.

The [revision checks](../tests/weread-revision.test.js) use actual Native CLI update, rollback, and removal for cached and controlled live consumers.
Selection changes retain running instances until complete Host shutdown and new composition.
IPC, Desk Data, cached health, cache bytes, and unrelated enable preferences remain unchanged.
Unsigned update rejection preserves configuration bytes; removal preserves both verified revisions.

The [process checks](../tests/weread-restart-electron.test.js) launch separate Electron consumers for version two, version three, rollback, and restored default selection.
Each process uses the same persistent native configuration and revision store, plus its own temporary Electron profile.
Actual selected source markers and spawned process identities are checked before comparing the full rendered state matrix.
These processes use controlled Main composition and actual preload, with replayed provider inputs and fresh rendering caches.
The source checks establish cache preservation across Host reconstruction separately.

These checks do not establish alternative live provider compatibility, deployed revision changes, or runtime replacement.
Windows, CM5, deployed services, and physical input remain unverified.

## Actual Main startup acceptance

The [bootstrap check](../tests/weread-main-bootstrap.test.js) starts production Main and the actual preload across sixteen separate Electron processes.
Live, empty, error, and unconfigured cases each select installed, updated, rolled-back, and restored default implementations.
Actual Native CLI operations use temporary publisher policy, trust, and exact grants.
Signed startup identifies captured entry bytes and rejects default source construction.
The independent source retains its shared public reading and health projection modules.

Controlled fetch, clock, random selection, and private cache paths supply deterministic provider results.
Global fetch rejects uncontrolled network access.
Live responses preserve complete English and CJK text, book metadata, cover bytes, and timestamps.
The first live process writes schema version 2 cache data.
Later processes reuse identical cache bytes without notebook synchronization and preserve complete preload responses and health.

Health checks retain cached state while source refresh is unavailable and request counts remain unchanged.
Normal Main shutdown removes the WeRead handler and stops its source.
Parent cleanup waits for child closure before removing each profile or the shared cache.
Unsigned updates preserve configuration, and native store checks verify both retained revisions after removal.

Forced termination handles parent timeout and cancellation; this bootstrap has no dedicated failure injection or descendant-process census.
Controlled cover bytes do not establish image decoding; separate rendered checks retain that evidence.
These checks do not establish independent surfaces, real providers, physical input, Windows, or CM5 acceptance.
