# Camera plugin contract

This contract defines replacements for `odk.source.camera` on `electron-main`.
Native plugins are trusted code with process authority; declared capabilities do not provide a sandbox.
[Configuration](CONFIGURATION.md) owns native selection, development linking, trust, and grants.

## Declaration and consumers

The source retains kind `service` and port `odk:source/camera/v1`.
Its public methods are asynchronous `refresh()` and synchronous `snapshot()`.
The current default also provides health port `odk:plugin-health/odk.source.camera/v1`.
Legacy replacements with only the source port remain accepted without undeclared health.
The manifest declares permissions `source.camera` and `ipc` without required ports.

The `source.camera` capability supplies source options and the default `create(options)` constructor.
It also supplies `provider(options)` for independent source implementations.
The default factory adds its lifecycle signal to the supplied options.
The `ipc` capability supplies `handle(channel, handler)` and `removeHandler(channel)`.
The `odk-camera-frame` handler waits for refresh and returns the current snapshot.

A snapshot contains `status`, `frame`, `capturedAt`, `width`, and `height`.
Live frames use JPEG data URLs; unavailable snapshots contain null frame and capture time.
The default dimensions remain 1280 by 720.
The capture interval, frame-size bounds, JPEG checks, and missing-device behavior remain unchanged.
Healthy diagnosis describes a cached frame and does not request another capture or certify current device connection.

## Capture provider

The provider returns `present()`, asynchronous `captureFrame()`, `now()`, `width`, `height`, `minIntervalMs`, and `maxFrameBytes`.
Construction starts no capture and creates no cached source state.
`present()` checks the configured device path.
`captureFrame()` returns raw bytes after the existing bounded command and temporary-file cleanup.
The command retains its `flock` lock, device path, MJPEG dimensions, and stream arguments.
Each source owns JPEG validation, frame encoding, cached state, throttling, and request lifetime.

Default and independent implementations share the capture primitive without invoking each other's source constructors.
The primitive retains the existing capture timeout and best-effort temporary-file deletion policy.
The provider does not stop an active command; source shutdown waits for the owned operation to settle.

## Resource ownership

The default source supplies `stop()` for its factory cleanup.
Other replacements register equivalent resource cleanup through `ctx.onCleanup`.
Source cleanup registration precedes IPC registration.
Cancellation clears the current frame and prevents subsequent capture requests.
Pre-aborted default construction starts no capture.
Stop waits for every pending capture operation, including a sibling that remains pending after another operation completes.

Capture ownership is registered before provider execution.
A synchronous provider callback that requests stop therefore observes its own pending operation.
Late success or failure after cancellation cannot publish a frame or restore healthy diagnosis.
Repeated stop operations remain safe.
Host disable removes the handler and waits for source cleanup before another source can start.
Owned capture commands retain their existing timeout and settle before source release.

## Evidence and limits

The [source checks](../tests/camera-source.test.js) preserve the default frame and throttle scenarios and cover pre-aborted construction.
The [shared checks](../tests/camera-plugin-parity.test.js) compare default, linked, and signed independent implementations through actual Main composition and IPC handlers.
They use controlled frame providers without live capture.
They cover delayed completion, multiple captures, provider reentry, late frame suppression, cached health, and disable followed by enable.
The independent example uses the declared provider with existing source options and no default source imports.

Signed cases use actual Native CLI installation, temporary publisher policy, explicit trust, and exact grants.
Executed source markers identify the selected revision; stored entry changes after discovery cannot alter captured factory code.

The [revision checks](../tests/camera-revision.test.js) exercise actual Native CLI update, rollback, unsigned rejection, and removal with live and unavailable consumers.
Selection changes preserve the active instance until complete Host shutdown and new composition.
New instances execute the selected revision or restored default and preserve frame payloads, cached health, enable state, and unrelated preferences.
Removal preserves both signed revisions; their stored files remain verified and unchanged.
Each composed source performs one controlled capture; cached consumers and health add no capture requests.

The [Main bootstrap cases](../tests/camera-main-bootstrap.test.js) execute four separate actual Main processes for each live or unavailable controlled state.
Actual preload supplies equivalent frame payloads after signed installation, update, rollback, and default restoration.
Signed processes reject default source construction.
Both implementations use the production capture primitive with virtual files and an injected command implementation.
Cached health rejects source refresh and adds no capture request.
Normal shutdown removes Camera IPC and stops the source before process exit.

The wrapper hides each window and disables unrelated Main factories and packaged content surfaces.
Its frame bytes have JPEG markers without establishing image decoding or pixel correctness.
The initial fixture access check failed before the bootstrap wrapper existed.
The parent waits for child closure before removing each private profile.
This establishes controlled Main startup without certifying full application startup or physical capture.

Hardware capture compatibility and supported-device acceptance remain unverified.
The retired Camera Widget had separate rendering and generated-image acceptance.
The current Shell keeps the Camera source independent from any renderer surface.
Actual capture-process cancellation, temporary-file deletion failures, deployed hosts, and physical camera acceptance remain separate gates.
