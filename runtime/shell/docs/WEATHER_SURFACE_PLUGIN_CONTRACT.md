# Weather surface replacement contract

This contract defines trusted replacements for `odk.tile.weather` on `electron-renderer`.
[The source contract](WEATHER_PLUGIN_CONTRACT.md) owns provider, location, cache, and Main request behavior.
[The built-in guide](AI_PLUGIN_GUIDE.md) owns Renderer registration, discovery, selection, and resource release.

## Declaration and ownership

The replacement retains the tile kind, display-only interaction, and existing placement identity.
Its external manifest provides `odk:surface/odk.tile.weather/v1` with no required ports or permissions.
The independent [example](../tests/fixtures/weather-surface-replacement/entry.js) owns display state, request sequencing, tick cadence, and release guards.
It does not import or call the default mount function.
Static layout, sky artwork, and the [stylesheet snapshot](../tests/fixtures/weather-surface-replacement/weather.css) retain the existing visual contract.
Shared semantic tokens, fonts, and theme icon adaptation remain Shell responsibilities.

The Renderer requests `window.odkPlatform.getWeatherStatus({ force })` through the actual preload.
It does not acquire location, read files, access credentials, or request remote Weather providers.
The Main source retains request cancellation, cache writes, and shared acquisition ownership.
Surface release cannot cancel an independent Main consumer.

## Display and refresh behavior

Waiting, live, stale, unavailable, and unconfigured displays retain their original notices and measurements.
A live response without a current reading becomes unavailable.
Falsy responses retain waiting behavior; unknown statuses become unavailable.
Failed requests and display exceptions use the existing unavailable fallback.
The surface retains place, temperature, unit, condition, daily range, source title, and sky glyph behavior.
Values remain text content; provider strings cannot add markup.

Mount requests cached status first, then forces refresh after that request settles.
Every fifth shared tick requests ordinary status.
Release guards stop subsequent requests and prevent late successful or rejected responses from changing the old element.
A factory abort signal also prevents rendering or new requests.
Enable creates a fresh mount with its own release guard.

## Acceptance and limits

The [shared registry checks](../tests/weather-surface-lifecycle.test.js) compare both implementations through controlled promises and actual lifecycle operations.
They include malformed and falsy responses, display exceptions, active request rejection, recovery, tick cadence, and SVG release isolation.
The [Electron check](../tests/weather-surface-electron.test.js) installs trusted development and signed native surfaces through the actual CLI.
Authenticated Main discovery and the Renderer loader select its actual definition before registry mount.
A throwing default mount and an executed surface marker prevent unintended default execution from passing.

Rendered checks compare six scenarios across three themes and five standard sizes through actual preload.
They verify text, glyph markup, fonts, readable minimums, positive bounds, containment, and absence of controls.
The independent surface also consumes the separately signed independent Main source in this check.
[Plugin coverage](PLUGIN_COVERAGE.md) owns current results and remaining gates.

The initial surface checks do not establish revision transitions or separate-process selection.
Pixel equality and supported-device acceptance remain unverified.
The shared stylesheet byte check and packaged density checks retain narrower evidence.

## Shared density measurements

The existing browser fixture measures default and selected surfaces through the shared Widget content collector after fonts settle.
Both use `WEATHER_PROFILE` from the [density helper](../tests/helpers/widget-density.js), with the same limits as the packaged density entry.
Six sampled states across three themes and all five standard viewport sizes retain equal fill, occupied area, and empty-band measurements.
Each measurement satisfies the existing profile without clipped content.
Development and signed loading paths both exercise these assertions.
Screenshot pixels and physical presentation require separate evidence.

## Signed captured assets

The [signed helper](../tests/helpers/weather-surface-selection.js) signs the independent entry, manifest, and shared stylesheet snapshot.
The parent installs each selection before Electron starts.
Every CLI command has a cancellation signal, a bounded timeout, and child-close ownership.
Electron refuses nested CLI launches.
The Native CLI requires explicit publisher policy and trust; the surface declares no permissions and receives no capability grants.
The fixture supplies separate explicit publisher policies for its Main source and Renderer surface stores.
It does not establish one deployed publisher configuration for both selections.

Native discovery captures verified browser entry and CSS bytes before their stored files change.
Direct asset responses retain the verified bytes, while another native store read rejects the modified files.
The actual browser loader still executes the independent surface and applies its captured stylesheet.
The existing rendered state matrix remains equal to the default baseline.

Discovery shutdown removes the signed asset protocol handler.
An actual preload discovery request then rejects because its IPC handler is absent.
Closing the original asset snapshot makes its routes return status `410`.
These checks establish controlled signed startup and release, not process restart or runtime hot replacement.


## Signed revision transitions

The [revision check](../tests/weather-surface-restart.test.js) installs, updates, rolls back, and removes the surface through the Native CLI.
Each selection loads in a different Electron process through actual Renderer discovery, the browser loader, registry, and preload.
Selected manifests and executed entry markers identify revisions `2.0.0`, `3.0.0`, restored `2.0.0`, and default `1.0.0`.
The existing six-state, three-theme, five-size matrix remains equal to the default surface at each stage.

The Main source and surface loaders read one external publisher policy through their environment configuration.
Each publisher retains its own authorized identity and host.
This fixture uses controlled Main composition; it does not execute production `src/main.js` startup.
The signed source remains selected after surface removal.

Update, rollback, and removal preserve source selection, surface enable preference, and an unrelated disabled Clock preference.
Unsigned candidate changes leave configuration unchanged.
Stored source and surface revisions retain their verified bytes.
Revision checks omit stored-file mutation because later startup must read the same signed revisions.

The source reads retained cache before provider acquisition.
Cached readings start stale until a successful provider response confirms freshness.
Later offline processes preserve the same readings and cache bytes through update, rollback, and removal.
These results do not establish runtime hot replacement, pixel equality, real providers, or supported-device acceptance.


## Actual Main joint startup

The [Main surface check](../tests/weather-main-surface.test.js) starts production `src/main.js` with signed independent source and surface selections.
One external publisher policy authorizes both identities under their separate host scopes.
The wrapper supplies a controlled Weather provider, hidden windows, and disabled unrelated features.
It retains production discovery, Host composition, preload, Renderer loading, and registry selection.

Four different Electron processes verify surface install, update, rollback, and removal while the signed source remains selected.
Actual discovery entries, catalog versions, and executed entry markers identify each surface selection.
The default mount refuses execution while an independent surface is selected.
Live place, temperature, unit, condition, and daily range remain unchanged.
Source preferences and original signed source and surface snapshots remain unchanged.

Normal quit removes the Weather and Renderer discovery handlers, stops both Main plugins, and removes the signed asset protocol handler.
This Main startup check covers live readings with controlled provider responses.
The broader rendered state matrix and persistent cache checks remain owned by the separate surface revision fixture.
Real providers, other active features, physical input, device acceptance, and full-process cancellation fault injection remain unverified.
