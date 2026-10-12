# Weather plugin contract

This contract defines replacements for `odk.source.weather` on `electron-main`.
Native plugins are trusted process code; signatures and declared capabilities do not provide a sandbox.
[Configuration](CONFIGURATION.md) owns linking, native installation, publisher policy, trust, and grants.

## Declaration and capabilities

The replacement retains the `service` kind and these ports:

| Port | Value |
| --- | --- |
| `odk:source/weather/v1` | Source with `configured`, `refresh(options)`, `snapshot()`, and `stop()` |
| `odk:desk-reading/weather/v1` | Array containing the Weather reading declaration |
| `odk:plugin-health/odk.source.weather/v1` | Object with a synchronous `snapshot()` method |

The manifest declares `source.weather` and `ipc` permissions without required ports.
The factory receives `ctx.signal`, `ctx.onCleanup(callback)`, and capabilities through `ctx.capability(name)`.
The `source.weather` capability supplies source options and the default construction function.
A replacement can construct its own source from the supplied options.
The `ipc` capability supplies `handle(channel, handler)` and `removeHandler(channel)`.
The `odk-weather-status` handler calls `refresh({ force: Boolean(request?.force) })`.

## Source behavior

`refresh()` returns a promise for a Weather snapshot.
`snapshot()` returns cached state synchronously and does not request a provider.
The snapshot status is `live`, `stale`, `unavailable`, or `unconfigured`.
It contains `place`, `unit`, `current`, `daily`, `updatedAt`, `hint`, `error`, and `locationSource`.
Unavailable initial readings have null `current`, `daily`, and `updatedAt` fields.
Current readings contain `temperature`, `unit`, `code`, `condition`, and `sky`.
Daily readings contain `high` and `low`.

Source options override `ODK_WEATHER_LAT`, `ODK_WEATHER_LON`, and `ODK_WEATHER_PLACE`.
Latitude ranges from -90 to 90; longitude ranges from -180 to 180.
Explicit coordinate options prevent automatic device location.
Without configured coordinates, the default device-location helper supplies coordinates unless device location is disabled.
Without previous usable coordinates, missing location results produce unavailable state without requesting weather.
Place labels normalize whitespace and reject labels exceeding 20 display columns.
An absent place label falls back to the coordinate label.

The existing provider contract requests current temperature, WMO weather code, and daily temperature limits.
Decoded temperatures are rounded integers within -100 to 100.
Malformed responses, invalid values, non-JSON responses, and provider failures cannot become live readings.
A failed refresh preserves an existing reading as stale.
Without an existing reading, a provider failure produces unavailable state.
Default refresh freshness is ten minutes; the default provider deadline is eight seconds.
Fresh readings avoid new requests unless forced.
Cached readings can return immediately while a background request runs.
Overlapping refreshes share an active provider request.

## Cache and consumers

The persisted cache uses version `2`, with `location` and `reading` fields.
Configured cache coordinates must match the selected coordinates.
Usable cached readings start as stale.
Cache writes use mode `0600`; write failures do not discard a live reading.

The reading ID is `odk.tile.weather`, with label `Weather` and kind `tile`.
Its home declaration uses mode `optional`, priority `80`, icon `weather`, and fields `['place', 'temperatureC', 'condition']`.
Its value contains `asOf`, `place`, `temperatureC`, `condition`, `highC`, and `lowC`.
Unavailable and unconfigured readings have null values; stale readings preserve measurements.
The reading retains the source timestamp as `updatedAt`.
[Open DeskOS Data](ODK_DATA_SPEC.md) owns registry transport and reading metadata.

Health reads cached source state without requesting the provider.
Live state maps to `healthy`; stale and unconfigured states map to `degraded`; unavailable state maps to `failed`.

## Lifecycle and evidence

The factory registers source cleanup before IPC cleanup.
Stop cancels owned provider and device-location work and waits for pending refreshes.
Cancellation prevents queued provider acquisition and late publication or cache writes.
The Host retains failed cleanup for retry before creating another instance.

The [independent source](../tests/fixtures/weather-replacement/source.cjs) owns request, decode, cache, and cancellation behavior without importing the default Weather source.
It explicitly shares the device-location helper and public reading and health projections.
This independence does not prove an alternative provider protocol.
The [source scenarios](../tests/weather-source.test.js) run against default and independent algorithms.
The [consumer scenarios](../tests/weather-plugin-parity.test.js) run against default, linked, and signed selections through Main composition, IPC, and Open DeskOS Data.
Signed tests use actual Native CLI installation, temporary publisher policy, explicit trust, and grants.
They verify actual source execution and captured execution after stored modules change following discovery.

## Stored selection changes

Native install, update, rollback, and removal change stored selections without changing a running Weather instance.
A later Host composition loads the selected signed revision.
Removal restores the default factory at the next composition startup and preserves retained signed revisions.
Unsigned entry changes cannot update the selection or configuration.
[Configuration](CONFIGURATION.md) owns these operations and their authorization requirements.

The [revision checks](../tests/weather-revision.test.js) exercise actual Native CLI update, rollback, and removal with cached and controlled live readings.
They compare IPC, Open DeskOS Data, health, cache bytes, and unrelated preferences across complete Host reconstructions.
Executed source markers identify each signed implementation; default construction is allowed only after removal.
Each reconstructed live source forces one controlled refresh; subsequent fresh consumer reads avoid additional requests.
These are in-process Host reconstructions, not separate Electron process startups or deployed revision changes.

## Remaining limits

Device relocation invalidates freshness while retaining the previous reading with its original label as stale.
An earlier request cannot publish or persist a result after its selected location changes.
Its replacement request waits for the earlier request to settle.
An older location lookup cannot overwrite a newer lookup result.
Concurrent device lookups share applicable provider work without suppressing an explicitly forced refresh.
Cancellation prevents queued relocation requests from starting.
The source and consumer scenarios cover these transitions with controlled completion and cache checks.

The [Electron check](../tests/weather-electron.test.js) runs a [hidden fixture](../tests/weather-plugin-electron.cjs) with actual Main composition and preload.
It compares default and signed independent sources through the existing Weather Widget.
Waiting, live, stale, unavailable, unconfigured, and recovery states match across three themes and five standard sizes.
The fixture checks text, units, daily limits, condition glyph markup, font sizes, loaded fonts, and contained element geometry.
Widget remounts preserve the shared source and its IPC handler.
Compact layout checks use programmatic scrolling to the Weather Widget.
The [process checks](../tests/weather-restart-electron.test.js) use separate Electron processes for signed update, rollback, and restored default selections.
They load persistent Native CLI selections through the same Main composition and preload fixture.
Four distinct child process IDs and actual source markers identify each executed selection.
Complete consumer matrices remain equal, while unsigned updates preserve configuration and removal retains verified revisions.
Full rendering matrices use private caches; a later continuity phase uses a parent-owned persistent cache across all four processes.
The first selected source writes a live reading through actual provider handling.
Updated, rolled-back, and default sources load that reading before an offline refresh.
Actual preload, rendered values, and cached health preserve the reading as stale while persisted cache bytes remain unchanged.
Child processes validate the persistent path and leave cache deletion to their parent after shutdown.
These checks do not establish physical scrolling, rendered relocation, production bootstrap, or live providers.
Windows, CM5, physical input, and assistive-technology acceptance remain unverified.

## Main bootstrap acceptance

The [bootstrap check](../tests/weather-main-bootstrap.test.js) installs a signed source and launches the actual `src/main.js` entry without smoke mode.
The [wrapper](../tests/weather-main-bootstrap.cjs) uses temporary configuration, storage, profiles, and controlled provider responses with unrelated Main factories disabled.
It suppresses window display and normalizes Electron's application path to the production Shell root.
Actual Host manifests, executed source markers, and default constructor poisoning verify signed selection.

Four separate processes preserve live preload and Widget values across signed installation, update, rollback, and restored default selection.
Parent assertions match spawned process IDs, executed source versions, and selected Host manifests.
Unsigned updates preserve configuration bytes, and removal retains both verified signed revisions.
Normal Main shutdown releases the Weather handler before application exit.
This evidence does not establish full-service startup, live providers, cross-process cache through this entry, or supported-device acceptance.
