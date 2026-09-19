# Weather instrument: one provider seam in the main process

## Status

Accepted

## Context

The Home grid had a package-installed weather tile whose reading could never be live: a sandboxed package has no network (`connect-src 'none'`) and no geolocation permission, so the tile rendered a packaged example and the previous revision labeled a fabricated `29°C / Shenzhen (demo)` as current weather.

Two things follow from that. The desk needs a weather reading that is either substantiated or explicitly absent, and the only surface allowed to substantiate it is the trusted main process, which already holds the network seam for WeRead, usage, Pi Sessions, Hydra, and the camera.

## Decision

- `src/weather-source.js` owns the provider: one Open-Meteo request, a bounded timeout, an in-flight dedupe, a ten-minute freshness interval, and a `0600` cache under the Shell's user-data directory.
- The renderer never performs network I/O. `odk.tile.weather` asks `odk-weather-status` for a snapshot, exactly like every other instrument.
- The location is configuration, never a guess: `ODK_WEATHER_LAT`, `ODK_WEATHER_LON`, and optional `ODK_WEATHER_PLACE` in `~/.config/open-deskos/runtime.env`. Without a location the source performs no request and the tile reads `Unconfigured` and names the setting.
- Exactly four internal states reach the tile: `live`, `stale`, `unavailable`, and `unconfigured`. A successful reading shows weather without a Live badge. A cached stale reading keeps a short `Stale` notice; unavailable and unconfigured readings remain explicit. No state displays a refresh time. Provider timestamps and freshness logic remain internal and unchanged.
- Payloads are validated before rendering: a non-OK response, a non-JSON body, a missing or non-numeric temperature, a temperature beyond ±100, or a missing daily range is rejected rather than rendered.
- A smoke run constructs the source with an explicit empty location, so `--smoke` stays offline.

## Consequences

- The tile's reading is provider-backed, and every failure mode is visible instead of plausible.
- A new external dependency (`api.open-meteo.com`, keyless) is part of the CM5's expected egress.
- The provider is the only network surface this instrument adds; the cache means one request per ten minutes while the desk is on.
- Installing a built-in tile in a cell an installed package occupies is now a real transition. The catalog reports `occupied-placement` on that package instead of hiding the whole catalog, and the package keeps its bytes, its removal, and its re-placement.

## Acceptance

`node --test tests/weather-source.test.js` covers the provider vocabulary, the unconfigured path, rounding and place naming, the freshness interval, in-flight dedupe, the cache and its permissions, a restart that serves the cache, failures with and without a cache, malformed payloads, and the timeout. `tests/widget-density.cjs` measures the tile in both the live and unavailable fixture at every standard resolution. `pnpm exec electron tests/weather-layout.cjs` verifies the place-led reading, balanced Low/High columns, truthful state text, long English/CJK places, extreme temperatures, and Pixel icon sizing across three themes and five resolutions. Every fixture, including wide-place outages and zoom, enforces the same 54–70% content envelope and 28% maximum empty band. The existing weather instrument profile retains a 10% occupied-area floor for sparse waiting and single-digit readings; it never relaxes overflow or clipping checks. The header and daily range keep intrinsic rows while the hero adapts to the remaining height. `tests/user-app-placement.test.js` covers the contested-cell transition.