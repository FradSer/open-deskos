# WeRead surface replacement contract

This contract defines trusted replacements for `odk.tile.weread` on `electron-renderer`.
[The source contract](WEREAD_PLUGIN_CONTRACT.md) owns provider requests, credentials, highlight selection, and cache behavior.
[The built-in guide](AI_PLUGIN_GUIDE.md) owns Renderer discovery, registration, and resource release.

## Ownership and declaration

The independent [entry](../tests/fixtures/weread-surface-replacement/entry.js) owns display updates, text fitting, image decoding, keyboard scrolling, and release guards.
It does not import or call the default mount.
Static HTML layout and the [stylesheet snapshot](../tests/fixtures/weread-surface-replacement/weread.css) preserve the existing visual contract.
Fonts, theme selection, and semantic tokens remain shared Shell assets.

The surface retains its tile identity, display-only interaction, and minimum cell size of `186`.
Its declaration provides `odk:surface/odk.tile.weread/v1` without required ports or capability permissions.
The Renderer reads `window.odkPlatform.getWeReadHighlight()` through preload.
It cannot acquire provider credentials or perform Main synchronization.
Surface release does not stop the shared Main source.

## Preserved behavior

Loading, unconfigured, empty, synchronization error, and available highlight states retain their existing notices.
Book titles remove surrounding brackets; missing titles use `WeRead`.
Missing author or date values hide their respective lines.
Dates preserve the existing local calendar format and seconds-or-milliseconds timestamp interpretation.
Excerpt values remain text content, including literal HTML and complete English/CJK readings.

Fitting reserves copy padding, resolved row gap, and metadata height.
It retains the existing width-and-length calculation, shrink steps, and fourteen-pixel minimum.
Overflow excerpts remain focusable and scrollable through their final character.
Vertical scroll keys stay inside the excerpt; Escape and horizontal navigation remain available to the Shell.

Covers retain their decoded aspect ratio and standard smoothing.
Pixel themes retain two-pixel blocks sampled from each block center.
Only the current image can draw or hide its canvas.
Unchanged ticks retain pending decoding; theme changes supersede it and failed theme loads remain retryable.

Mount requests a highlight immediately.
The first shared tick and every sixty ticks thereafter request another highlight.
Release stops new requests and isolates late reading success, rejection, image callbacks, resize callbacks, and fitting frames.
Failed observer disconnection remains owned and retryable.
A new mount receives independent resource ownership.

## Acceptance and limits

The [shared tests](../tests/weread-tile.test.js) exercise default and independent surfaces through the actual registry and Host.
They cover metadata, fitting, scroll keys, release isolation, observer retry, decoding ownership, and theme-change retry.
A byte comparison verifies the shared stylesheet snapshot.

The [Electron check](../tests/weread-surface-electron.test.js) links the independent surface through the actual trusted CLI.
Actual discovery and browser loading select its definition before registry mount.
A throwing default mount and executed surface marker prevent unintended default execution from passing.
The surface consumes a separately signed independent Main source through actual sandboxed preload.

Rendered comparisons cover loading, available, empty, failed, recovered, missing metadata, rejected cover, and unconfigured states across three themes and five standard sizes.
They compare text, metadata visibility, fonts, decoded canvas pixels, distinct image regions, aspect ratio, bounds, and absence of controls.
Long English/CJK excerpts must overflow in every theme and size.
Actual End/Home input verifies tail reachability, focus retention, and unchanged page ownership for both implementations.

[Plugin coverage](PLUGIN_COVERAGE.md) owns recorded results and remaining gates.
The initial checks establish trusted development linking.
The signed asset checks below own Native installation evidence.
The revision and actual Main checks below cover separate-process selection transitions.
Whole-Widget screenshot equality, real providers, physical input, assistive technology, Windows, and CM5 remain unverified.

### Shared density scenario

The same Electron fixture also compares the existing shared density excerpt and title without optional metadata or a cover.
Both implementations use the unchanged [WeRead profile](../tests/helpers/widget-density.js) after fonts settle.
The fixture compares fill, occupied area, and empty-band measurements across five standard sizes and three themes.
It also requires complete short-text visibility and no ancestor clipping.
The separate long-excerpt scenarios retain decoded covers, metadata, actual keyboard scrolling, and final-character access.
Density with covers and optional metadata remains unverified.
An initial check found scrolling at `480x854` with a cover, long title, author, and date in the default implementation.
This result does not establish a replacement regression or authorize a layout change.


## Signed captured assets

The [surface Electron check](../tests/weread-surface-electron.test.js) also installs the independent surface through the actual Native CLI.
The [signed helper](../tests/helpers/weread-surface-selection.js) signs the entry, manifest, and stylesheet with an identity-and-host-scoped publisher key.
Explicit operator trust remains required.
The surface declares no permissions and receives no capability grants.
Signatures establish provenance and integrity, not a sandbox.

The parent prepares signed source and surface selections before Electron starts.
Each CLI command receives test cancellation and a ten-second timeout and waits for child closure.
The controlled composition supplies separate explicit publisher policies for Main source and Renderer surface loading.
It does not establish one production publisher policy for both selections.

Native Renderer discovery captures verified entry and CSS bytes before browser loading.
The fixture then changes both stored files.
Asset responses retain the signed content, while a later store snapshot rejects the changed revision.
Actual browser loading, registry selection, and sandboxed preload retain the complete rendered state, cover, and keyboard matrix.

Shutdown removes the signed asset protocol handler.
An actual preload discovery request then rejects because its IPC handler is absent.
Closing the original asset snapshot makes its routes return status `410`.
These checks cover controlled signed discovery and release, not revision transitions, process restart, or production Main joint startup.
Full-process cancellation fault injection and device acceptance remain unverified.

## Signed revisions and retained highlights

The [revision check](../tests/weread-surface-restart.test.js) installs signed source and surface selections under one external publisher policy.
Actual Native commands update, roll back, and remove the surface selection.
Four Electron processes execute surface versions `2.0.0`, `3.0.0`, `2.0.0`, and default `1.0.0`.
Executed markers identify independent versions without calling the default mount.
The source selection, unrelated preferences, and stored source and surface bytes remain unchanged.
Invalid updates preserve configuration bytes.

Each process compares the complete rendered state, cover, and keyboard matrix with its default baseline.
The first process primes a retained highlight cache through the default source baseline.
The signed source then reads that cache without another provider request.
Later processes supply no API key and preserve highlight values and cache bytes without provider requests.
The child waits for its complete stdout report before exit.

## Actual Main joint startup

The [joint startup check](../tests/weread-main-surface.test.js) runs actual `src/main.js` through a controlled bootstrap wrapper.
It uses one external publisher policy for signed Main source and Renderer surface loading.
Unrelated Main factories and desktop surfaces remain disabled in private state.
Four processes follow the same surface transitions while retaining source version `2.0.0`.
The actual preload and mounted Widget preserve excerpt, title, author, date, and absent-cover behavior.
The first process acquires controlled highlights; later processes retain cache bytes without API credentials or requests.
Normal shutdown removes source and discovery IPC handlers and the signed asset protocol.

This joint startup check covers one size and the startup theme with a controlled provider and no cover.
The separate rendered matrix owns decoded-cover, theme, size, and keyboard evidence.
Independent density, real providers, full-process cancellation, assistive technology, physical input, Windows, and CM5 remain unverified.
