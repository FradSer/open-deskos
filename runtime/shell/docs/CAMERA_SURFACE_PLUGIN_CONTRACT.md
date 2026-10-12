# Camera surface replacement contract

This contract defines trusted replacements for `odk.tile.camera` on `electron-renderer`.
[The source contract](CAMERA_PLUGIN_CONTRACT.md) owns capture, frame validation, and source shutdown.
[The built-in guide](AI_PLUGIN_GUIDE.md) owns registration and surface cleanup.

## Ownership and preserved behavior

The independent [entry](../tests/fixtures/camera-surface-replacement/entry.js) owns reading display, capture-time formatting, subscription release, and late-callback guards.
It shares static markup, Shell CSS, semantic tokens, fonts, icons, and the existing Camera service.
It does not call the default mount or import its display implementation.
Its [manifest](../tests/fixtures/camera-surface-replacement/manifest.json) retains the tile identity, display-only interaction, and existing surface interface.
It requests no permissions and introduces no capture provider.

The existing service supplies current readings through `ctx.camera.subscribe()`.
Mount requests one refresh through that service.
A live reading with a string frame displays the image and `Updated` caption.
Capture time uses local hours and minutes.
Missing or invalid capture time retains the existing empty time suffix.
Other readings hide the image, remove its source, and display `Camera unavailable`.
The viewfinder remains visible in both states.
Image placement retains `object-fit: cover`.
The surface does not add controls or change source refresh cadence.

The registry owns subscription cleanup through `ctx.trackCleanup()`.
Release fences callbacks before attempting cancellation.
Failed cancellation retains cleanup ownership and permits retry.
A later mount has a separate subscription and callback guard.
Built-in recovery retains the container and its supplied Camera service.

## Shared lifecycle acceptance

The [shared checks](../tests/camera-surface-lifecycle.test.js) run both implementations through the actual registry and common Host.
They compare live, unavailable, missing, stale, empty-frame, and invalid-time readings.
They also cover absent services, rejected refresh, late callbacks, failed cleanup, retry, disable, enable, and built-in recovery.
A throwing default mount rejects delegation during independent execution.
The DOM model compares markup and queried state; it does not establish browser rendering.

## Browser replacement acceptance

The [browser check](../tests/camera-surface-electron.test.js) links the independent entry through the actual development CLI with explicit trust.
An isolated hidden Electron window uses actual sandboxed preload and production Renderer discovery.
Controlled IPC supplies generated PNG frames without camera or microphone access.
External network requests and permission requests are refused.

One document runs default, independent, and restored surfaces through the public runtime controller.
The desktop placement and measured container retain their identities.
Each phase covers three themes, three square sizes, and four ordered readings.
All descendant attributes, computed CSS properties, leaf text, and geometry match the default baseline.
Checks also retain containment, caption size, display-only behavior, and image placement.
Decoded frames retain a two-to-one intrinsic ratio and distinct red and blue regions.
These decoding checks do not establish screenshot pixel equivalence or physical camera quality.

The fixture fixes device scale and page zoom before comparison.
Each measurement checks those inputs, settled fonts, and scoped motion suppression.
Cleanup releases the measured surface and removes its stylesheet.
Discovery shutdown removes its IPC handler.
The parent waits for child closure before deleting private state.

Physical input remains unverified.
The coverage record identifies current native host results.
[Plugin coverage](PLUGIN_COVERAGE.md) owns current results and remaining gates.

## Independent desktop density

Both browser entry modes measure the actual desktop Camera container before replacement, after independent replacement, and after built-in recovery.
Each phase covers Instrument, Pixel, and Border Beam themes at five standard viewports.
The viewports are `1920x1280`, `1920x1080`, `960x640`, `480x854`, and `320x480`.
Each viewport covers live and unavailable readings.

The checks use the existing Widget collector and shared density limits without a Camera-specific profile.
They verify positive frames, inner containment, and ancestor clipping within the Widget.
The independent and restored measurements equal the default measurements.
Each entry mode performs ninety measurements and sixty comparisons without navigation or container replacement.

Each measurement checks viewport dimensions, device scale, page zoom, theme, loaded fonts, and scoped motion suppression.
The fixture releases its debugger connection and removes its comparison stylesheet before exit.
The density collector measures text, SVG framing marks, and meters; it does not measure raster frame pixels.
Decoded image checks remain separate from density and screenshot equivalence.
The standard geometry entrypoint includes both isolated Camera entry modes.

## Signed browser loading

The browser check also installs the independent surface through the actual Native CLI with explicit publisher policy and operator trust.
The [selection helper](../tests/helpers/camera-surface-selection.js) signs manifest and entry bytes with an Ed25519 publisher restricted to Camera Renderer identity.
The surface requests no capability grants.
Signatures establish integrity and provenance; they do not provide a sandbox.

The production loader captures verified entry bytes before publication.
The fixture then changes the stored entry and confirms that a later store snapshot rejects those bytes.
The browser still executes the captured signed entry and its revision marker.
The same seventy-two runtime replacement and recovery comparisons retain default behavior.
Shutdown removes discovery IPC and the asset protocol handler.
Closing the publisher makes its captured route return status `410`.
Published revision retirement remains outside these checks.

## Joint actual Main source and surface revisions

The [joint checks](../tests/camera-main-surface.test.js) select independent signed Main source and Renderer surface implementations together.
Their separate publishers retain explicit identity and host restrictions.
The source receives existing Camera and IPC grants; the surface requests none.
Each state starts separate production Main processes for signed selection, runtime activation, rollback, and default selection.
The source remains at version `2.0.0` without constructing the default source.
Entry markers and actual child PIDs identify the executed implementations and process.

Actual preload and the production Camera service supply the mounted desktop surface.
The production capture primitive uses virtual files and a controlled command implementation.
Generated JPEG frames preserve the default dimensions and decode into distinct red and blue regions.
Trailing JPEG padding satisfies the existing minimum frame size without changing source validation.
The unavailable case retains hidden images and truthful wording.
The live case retains capture time and `object-fit: cover`.
All surface attributes and leaf text match across launches.
The separate browser matrix owns theme, size, computed-style, and containment comparisons.

Unsigned updates preserve configuration bytes.
Surface updates, rollback, and removal preserve the source selection, unrelated Clock preference, and stored source and surface revisions.
Each process makes one controlled capture; cached health adds no capture requests.
Shutdown releases Camera IPC, discovery IPC, source lifecycle, and the signed asset protocol.
The parent waits for each child to close before deleting its private profile.

The fixture disables unrelated sources and surfaces and keeps windows hidden.
No camera, microphone, external provider, or deployment operation executes.
Arbitrary asset retirement, capture-command faults, screenshot equivalence, and physical input remain separate gates.

## Authenticated runtime activation and recovery

The joint checks also use the production authenticated Renderer channel and actual operator CLI in private fixtures.
Each state runs five separate Main processes, including two runtime activation processes.
Windows fixtures require a unique private pipe prefix before Main or the runtime CLI imports production modules.
The test adapter maps known endpoints while retaining native Windows paths and authentication.
Missing or invalid prefixes refuse fixture startup.
The parent checks actual pipe closure after child shutdown; Unix fixtures retain their socket removal check.

One runtime process starts with signed surface version `3.0.0`.
Another starts with the built-in surface and an initially empty native asset route.
Both select signed version `2.0.0`, restore the built-in surface, reactivate `2.0.0`, and activate `3.0.0`.
Receipts identify the Renderer runtime, implementation version, and captured signed revision where applicable.
Activation preserves saved configuration bytes.

Recovery also runs with malformed external configuration and revoked publisher policy.
It selects the captured built-in surface without changing either file.
The fixture then restores its own private files before the next signed activation.

Every transition retains the document, desktop container, selected source instance, frame content, and capture time.
Each process makes one controlled capture.
Resource tracking starts before service publication and includes the initial mount.
Each replacement releases its subscription before another mount subscribes; final shutdown leaves no tracked subscriptions.
Shutdown also releases the authenticated endpoint.

Parent-owned checkpoints coordinate CLI operations with consumer assertions.
Required-phase failure stops dependent operations and retains available child diagnostics before private cleanup.
These fixtures do not establish live capture or physical input.
[Plugin coverage](PLUGIN_COVERAGE.md#camera-main-host-acceptance-and-private-windows-channels) owns native execution results and pending Windows acceptance.
