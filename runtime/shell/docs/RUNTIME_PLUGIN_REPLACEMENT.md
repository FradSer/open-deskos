# Trusted Host runtime replacement

## Scope

The [common JavaScript Host](../src/plugin-host.js) accepts `replace(definition)` while running.
This programmatic interface accepts a trusted factory that its caller has already loaded.
It does not load packages, change persisted selections, or authorize code.
Native selection and captured loading remain owned by [the Native contract](NATIVE_PLUGINS.md).
Signatures and capability declarations do not provide a sandbox.

## Declaration and ownership

Replacement retains identity, kind, host, provided ports, required ports, optional requirements, and permissions.
A changed contract fails before aborting signals or releasing resources.
Manifest values and the factory reference are captured before queuing.
Names and versions can change.
Declaration equality does not prove method signatures or feature parity.
Explicit trusted recomposition for built-in restoration follows the separate rules below.

The Host serializes replacement with enable operations and shutdown.
It finds every direct and transitive consumer, including optional consumers.
Consumers release before providers; successful release phases do not repeat.
Retained release work blocks factory replacement.
Independent factories keep their instances.
Disabled selections change without constructing a factory.

The new provider starts before fresh consumers.
If candidate startup fails, the Host first releases every affected candidate resource.
Only complete release permits restoration of the previous factory and consumers.
Failed candidate cleanup retains the candidate declaration and resources for explicit recovery.
A failed rollback remains visible through ordinary Host lifecycle states and ports.
The replacement request rejects even when rollback restores service.

Shutdown aborts active work and invalidates queued replacement and enable allocation.
Queued enable preferences remain available for a later startup.
Shutdown cancellation does not certify a successful replacement.
Calls after complete shutdown require another Host startup.

## Local evidence

The [Host checks](../tests/plugin-host-replacement.test.js) cover ordered release, contract refusal, cleanup retry, rollback, serialization, shutdown races, disabled selections, and caller mutation.
Controlled promises synchronize construction and release without timing delays.
The shared existing Host and Renderer lifecycle checks retain their prior behavior.

The [Hydra check](../tests/hydra-runtime-replacement.test.js) uses actual Native installation and captured signed factories in one running Host.
It runs production source, Desk Data, and cached health plugin consumers.
Production IPC handlers run through a controlled map without Electron preload IPC.
Signed source versions `2.0.0` and `3.0.0` and the restored default preserve the same controlled telemetry values.
The previous MQTT completion callback must finish before another client starts.
Stored signed revision bytes remain unchanged.
The broker client is controlled; this check does not connect the installed MQTT SDK or render a Widget.

## Renderer programmatic replacement

The [Renderer registry](../src/renderer/core/registry.js) now accepts `replace(definition)` during an active startup.
The caller must supply a trusted, already loaded surface definition.
Admission copies its declaration, identity, factory, lifecycle functions, and stylesheet binding before queuing.
Caller mutation cannot change these admitted values during queueing or old-resource release.
The registry exposes the selected admitted definition through `get(id)`; callers must use that definition for activation.
The [runtime controller](../src/renderer/core/runtime-controller.js) serializes replacement with enable operations and both placement coordinators.
The browser loading section below owns entry discovery and execution before selection.

Replacement preserves surface kind, slot, role, interaction, App identity, minimum Cell, dependencies, ports, permissions, and the existing stylesheet binding.
Stylesheet or authenticated asset URL changes are refused before release.
A mounted dependent App must close through its existing platform path before replacement.
Queued requests immediately prevent affected external mounts.
Internal restoration can mount the current selection before the next queued transition starts.

Old surfaces release before their factory resources.
Successful replacement remounts retained desktop, page, and status placements with the original UI context and fresh factory signals.
Dependent placements receive fresh provider ports.
Unrelated factories retain their instances.
Disconnected or manually removed containers are not restored.

Factory startup failure uses Host rollback.
Mounting failure releases the candidate before restoring the previous factory and placements.
Failed candidate cleanup prevents rollback and retains the selected candidate for explicit recovery.
The Host's `definition(id)` returns copied metadata and the selected factory reference without executing it.
The registry uses that reference to distinguish rollback from retained candidate selection, including equal-version factories.

Controller shutdown immediately closes registry management before waiting for queued publication work.
This prevents delayed unmount completion from constructing or mounting a candidate after shutdown starts.
The controller still waits for queued work and owned releases to settle.

The [Renderer model checks](../tests/renderer-runtime-replacement.test.js) cover these ownership and placement scenarios through the actual registry and common Host.
Their containers model DOM behavior; these checks do not establish actual browser rendering or pixel parity.
The [controller checks](../tests/renderer-runtime-controller.test.js) cover replacement ordering, reconciliation, refusal, publication, and shutdown.

## Browser entry loading and live Native leases

The [browser loader](../src/renderer/core/development-plugins.js) accepts `load({ runtime: true })` after registry startup.
Authenticated Main discovery remains its only entry source.
The loader serializes all collection requests and checks declarations before script execution.
It validates executed definitions again before returning them to a trusted controller.
A rejected request does not prevent a later valid load.
The caller then passes one admitted definition to the runtime controller's `replace` method.
Loading alone does not select a factory.

Runtime entries with external stylesheets are refused before browser execution.
The existing packaged stylesheet binding remains required.
When no external stylesheet is declared, runtime previews retain the selected Shell stylesheet path.
The actual entry must still retain the same path and binding before selection.
This preview does not transfer external asset bindings or permit a new stylesheet.
Trusted entry code executes in the Shell world; declaration checks do not sandbox its top-level effects.
Operator trust, Native signatures, publisher policy, and capability grants retain their separate contracts.

Main can explicitly provide `runtimeNativeAssets: true` to its Renderer discovery capability before loading a document.
This binds the signed asset protocol even when the publisher initially has no entries.
A read-only live lease can serve later verified captures without replacing the protocol handler or restarting discovery.
Only the Main publisher can add captured bytes.
Old token contents remain immutable after another publication or stored-file mutation.
Existing entry-count and byte limits still apply across retained publications.
Closing a live lease cannot clear its publisher or another lease.
Closing the publisher invalidates its live leases.
Ordinary snapshot forks remain isolated from later publication and retain their existing closure behavior.

The [actual Hydra browser check](../tests/hydra-surface-electron.test.js) covers development and signed runtime loading in one sandboxed Electron document.
It uses actual preload, registry, controller, authenticated discovery, and controlled Hydra IPC snapshots.
The actual MQTT source factory is not executed by this fixture.
The original desktop container and document remain identical across default, independent, and restored-default phases.
Each phase captures 240 complete attribute, computed-style, text, and geometry consumers.
The independent and restored phases produce 480 full comparisons against default behavior.
A default mount trap prevents independent delegation; a captured default mount counter proves restoration executes again.
Shutdown releases discovery IPC and protocol authority, and closed signed captures return status `410`.

The first signed runtime attempt failed because the existing document could not fetch its newly registered protocol route.
The explicit live lease binds that route before document loading and accepts later verified publication.
Production Main enables this capability when its authenticated Renderer control plugin is enabled.

## In-memory state handoff

A trusted instance can declare `handoff: { schema, capture, restore }` for compatible in-memory state transfer.
The schema uses a versioned Open DeskOS interface URI.
Capture and restore must complete synchronously.
Capture must return cloneable state without acquiring resources or changing runtime state.
The Host captures all affected instances before committing detached recovery snapshots or cancelling their admissions.
If one capture fails, the running graph retains its current state.
Candidate restoration requires the same schema and completes before startup and public port publication.
Each restoration receives a separate clone; a rejected candidate cannot change the retained recovery snapshot.

Recovery snapshots remain owned until replacement or rollback settles.
Failed cleanup retains snapshots for explicit replacement retry.
Cancellation after release restores the previous implementation with its captured state.
Unsupported asynchronous hooks remain owned until their actual work settles before refusal and cleanup.
Ordinary disable, enable, shutdown, and later startup retain their existing fresh-instance behavior.
Implementations without hooks keep their existing lifecycle behavior.
Their registration does not establish state-preserving replacement compatibility.

The [App Manager contract](APP_MANAGER_PLUGIN_CONTRACT.md) owns its state schema and foreground rules.
The [Host state checks](../tests/plugin-state-handoff.test.js) cover snapshot isolation, failed capture, recovery, cancellation, and pending work.
The [App Manager checks](../tests/app-manager-handoff.test.js) cover actual signed capture and Native activation.
The [production Main checks](../tests/app-manager-main-bootstrap.test.js) retain mounted foreground state through authenticated activation and built-in recovery.
These isolated checks do not establish physical input or supported-device acceptance.

## Authenticated signed Main activation

The Plugin CLI accepts `activate <id> --runtime` for an existing Main plugin.
The existing management inventory selects its owner before the command reaches the authenticated local control channel.
The request contains only the plugin identity.
It cannot supply code, paths, revisions, grants, or publisher policy.
The control plugin cannot activate itself.

The [Main activator](../src/native-runtime-activation.js) serializes capture and replacement requests.
Each request reads the current configuration and publisher policy through the Native startup loader.
Signature, identity, host, trust, namespace, and exact grant checks complete before old resources release.
Captured signed bytes remain immutable during replacement.
The selected plugin must remain enabled and running after capture.
Saved disables and environment exclusions prevent activation.
Shutdown cancels pending capture continuations and queued requests before factory construction.

The existing Host owns dependency release, candidate startup, cleanup, and rollback.
Candidate failure returns `activation-failed`, including when rollback restores service.
Private errors do not enter control responses.
Success identifies the activated revision, version, and running state.
Activation does not write configuration or change saved revision history.
A concurrent selection update can therefore differ from the activated revision in the receipt.
Connection loss and timeout retain the client's existing unknown-outcome behavior.
The CLI does not retry these mutations automatically.

The [activation checks](../tests/native-runtime-activation.test.js) exercise signed capture, revision changes, unchanged preferences, refused authorization, cancellation, concurrent disable, recovery, and channel authentication.
The [actual Main check](../tests/hydra-main-bootstrap.test.js) activates signed Hydra revisions and restores the built-in source inside one production Main process.
It uses the actual CLI, installed MQTT SDK, isolated loopback broker, actual preload, and cached health consumers.
Each activation preserves controlled telemetry and saved configuration bytes.
Normal shutdown releases source handlers and the management listener.
The controlled broker does not establish external broker or device acceptance.

## Authenticated built-in Main restoration

The Plugin CLI accepts `restore-default <id> --runtime` through the existing authenticated Main management channel.
The request supplies only an identity.
Main captures built-in factories from its actual startup composition before selecting external replacements.
Dynamic reading and diagnostic dependencies remain part of these captured declarations.
Extension-only identities have no built-in default.
The control plugin cannot restore itself.

The activator copies each default manifest and factory reference at construction.
Restoration shares the signed activation queue and shutdown fences.
It requires an enabled runtime identity and respects environment exclusions.
It does not read or write saved configuration, signed bundles, or publisher policy.
Malformed configuration and revoked external publishers therefore cannot prevent default recovery.
Saved selections still control the next startup.
Success reports `implementation: built-in`, the default version, and running state without a signed revision.
Failure reports `restoration-failed`, including when the previous factory recovers through rollback.

The trusted restoration path calls `replace(definition, { recompose: true })` on the common Host.
Identity, kind, and host remain fixed.
The Host validates changed ports, dependencies, and permissions against the complete candidate graph before cancellation or release.
Missing required ports, duplicate providers, and cycles reject the candidate without changing running resources.
Affected consumers include dependencies on old and new provided ports.
Release uses the current graph; candidate activation uses the candidate graph.
Successful candidate cleanup permits rollback to the previous factory and dependency order.
Failed cleanup retains its current graph and resources for retry.
Ordinary replacement retains its strict declaration contract.

Queued enable and disable operations recalculate their affected closure when execution starts.
Their immediate cancellation fence remains in place.
This prevents a queued provider disable from missing consumers added by restoration.

The Host checks exercise graph preflight, optional consumers, rollback, queued disable, and recovery.
Main checks restore actual Camera defaults after legacy port selections and Weather defaults after extension dependencies.
The actual Hydra process executes signed `3.0.0`, signed `2.0.0`, built-in `1.0.0`, and signed `3.0.0` without restarting Main.
Actual preload telemetry and cached health remain equal through the controlled loopback broker.
Default construction counters and signed execution markers identify each implementation.
The Windows runtime phase remains skipped until private named-pipe isolation exists.

## Authenticated signed Renderer activation

The Plugin CLI accepts `activate <id> --runtime` for an existing Renderer surface.
The existing inventory resolves its unique owner before the authenticated control request.
The request supplies only the identity.
Main reads current selection settings and publisher policy through the Native startup loader.
Signature, trust, identity, host, namespace, and exact grant checks precede publication.
Saved disables and environment exclusions prevent capture.
Appearance factory activation follows the separate contract below.
Built-in Renderer restoration follows the separate recovery contract below.

Main binds a live signed asset route before loading the document.
It publishes captured bytes and replaces only that identity in authenticated discovery.
The command carries the captured entry URL, revision, and version.
The browser loader selects exactly that discovered identity and URL before execution.
Unrelated entries are not executed.
Definitions must come synchronously from the currently executing selected script.
Delayed callbacks cannot supply code for a later selection.
Trusted Native code retains Shell-world authority; these checks do not provide a sandbox.

The controller owns replacement, dependent placements, cleanup, and rollback under its existing contract.
External stylesheets remain refused before execution and before retaining another capture.
Success requires the selected running version and no failed affected placements.
Main validates the receipt against the captured revision, version, identity, and original main frame.
Private failures become `activation-failed`.
Activation does not write saved configuration.

One activation or built-in restoration can run at a time; another implementation request receives `runtime-busy`.
Timeout, shutdown, and changed frames prevent late sends from preparation.
Timeout or lost responses after dispatch retain unknown outcomes without automatic replay.
An uncertain dispatched operation retains its implementation slot until its original main frame supplies a valid completion receipt.
Invalid, foreign, duplicate, and navigated-frame receipts cannot clear that slot or release assets.
Inventory and lifecycle requests remain available under their existing contracts.
Preparation that times out retains its slot until the loader settles without dispatch.
If completion never arrives, further implementation changes require a Shell restart.
Frame changes alone do not establish resource release.

Repeated activation reuses the same identity and revision capture after fresh policy and signature verification.
Revoked policy or changed stored bytes prevent reuse.
Distinct captures retain the existing thirty-two-entry and sixty-four-mebibyte limits.
Each preparation retains its captured revision until preparation settles.
Cancellation or rejected validation before discovery publication releases that preparation's ownership.
The last owner retires an unpublished capture and returns its entry and byte allowance.
Another preparation can retain the same capture through an overlapping failure.
Settled loader callbacks cannot publish further captures.
Publication attempts retain their captures because callbacks can expose URLs before returning an error.
Published revision retirement remains unimplemented.
The current path does not provide unlimited distinct revisions within one process.
Retained loaded definitions remain valid inputs to the supported programmatic replacement API.
A management receipt does not prove release of these definitions or queued programmatic operations.
Retirement must account for these owners before removing their signed lazy assets.
The Main implementation slot serializes authenticated commands only; it does not establish exclusive ownership of all Renderer replacement paths.

The asset publisher can retire an exact captured entry URL through its internal asset interface.
Retirement removes that bundle from the publisher and its live views.
Independent snapshots retain their captured resources until their own release.
Snapshot byte accounting uses the resources held when the snapshot is created.
Live views cannot publish or retire resources through the publisher's authority.
The asset interface does not add an operator command or authorize retirement of running resources.

The [preparation checks](../tests/native-renderer-activation.test.js) cover signed selection, configuration preservation, policy revocation, and byte mutation.
They also cover cancellation, stylesheet refusal, repeated capture, and unpublished ownership.
They preserve earlier published resources after another revision is selected for discovery.
The [asset checks](../tests/native-renderer-plugins.test.js) cover entry and byte limits, retirement, live views, and independent snapshots.
The [management checks](../tests/renderer-management.test.js) cover frame authority, receipt validation, timeout, cancellation, and concurrent capture refusal.
The [loader checks](../tests/renderer-development.test.js) cover exact selection and rejection of delayed definitions from prior entries.
The [actual Main check](../tests/hydra-main-surface.test.js) activates signed Hydra surfaces `3.0.0`, `2.0.0`, and `3.0.0` within one document.
Actual CLI, preload, installed MQTT SDK, and an isolated loopback broker execute this path.
Rendered attributes and text remain equal; the document, Widget container, and source instance remain identical.
A separate phase starts with no signed surface assets, then installs and activates both signed versions without navigation.
Windows runtime checks remain skipped until private named-pipe isolation exists.
These checks do not establish external broker, physical input, or CM5 acceptance.

## Authenticated built-in Renderer restoration

The Plugin CLI accepts `restore-default <id> --runtime` for an existing Renderer surface through its authenticated management channel.
The request supplies only the identity.
The Shell calls `odkPlugins.captureDefaults()` before loading external surface entries.
The registry copies packaged manifests and lifecycle functions and retains their factory references in a private collection.
Later caller changes cannot alter these captured values.
Identities registered after capture have no built-in default.
Standalone registry startup captures defaults before applying its startup replacement collection.

The controller serializes `restoreDefault(id)` with placement reconciliation, replacement, enable operations, and shutdown.
The registry requires an enabled identity before admission and again when queued work starts.
Startup disables remain effective.
Mounted dependent Apps must close through their existing lifecycle path first.
Restoration retains the ordinary Renderer layout and dependency contract.
It can restore the captured built-in stylesheet binding from an external startup selection.
Ordinary replacement still requires identical stylesheet bindings, including when queued work begins.

The registry first loads a different built-in stylesheet with inactive media rules.
Unavailable stylesheets fail before the selected surface releases.
Shutdown cancels pending stylesheet preparation.
The external stylesheet remains active until its owned resources release.
The registry then activates the selected implementation's stylesheet before restoring placements.
Rollback retains the previously loaded stylesheet and restores its media rules before remounting.
Failed cleanup keeps the stylesheet for the implementation that retains ownership.
Successful recovery removes the released external stylesheet, including when the built-in default has no stylesheet.
Disable and enable operations retain the selected stylesheet under their existing contract.

The existing Host releases affected surfaces and factory resources before constructing the captured default.
Retained cleanup prevents another default construction until an explicit successful retry.
Failed default startup or mounting follows existing candidate cleanup and rollback rules.
The operation rejects even when rollback restores the independent implementation.
Shutdown prevents delayed release completion from constructing or remounting defaults.

Success requires the selected factory and lifecycle functions to match the captured default.
It also requires a running enabled surface and no failed affected placements.
The receipt reports `implementation: built-in`, the captured version, and running state without a signed revision.
Main validates the receipt against its original frame authority.
Timeout, navigation, and lost responses retain unknown outcomes.
Restoration does not read external configuration, publisher policy, or signed entries.
It preserves saved selections and their effect on the next startup.
Signed discovery entries remain available for a later authorized activation.

The [registry checks](../tests/renderer-runtime-replacement.test.js) cover capture mutation, disabled identities, queued disable, failed defaults, cleanup retry, shutdown, and strict ordinary replacement.
The [stylesheet checks](../tests/plugin-scoped-styles.test.js) cover preparation, rollback, retained cleanup, queued binding checks, and stylesheet removal.
The [Electron check](../tests/renderer-css-recovery.test.js) measures applied styles across successful and failed recovery.
The [controller](../tests/renderer-runtime-controller.test.js), [browser control](../tests/renderer-control-bridge.test.js), and [Main bridge](../tests/renderer-management.test.js) checks cover coordination and receipts.
The [actual Main check](../tests/hydra-main-surface.test.js) restores Hydra defaults while configuration is malformed and publisher policy is revoked.
Both files remain unchanged during recovery.
The document, Widget container, MQTT source instance, and rendered attributes and text remain unchanged across implementation transitions.
The same page can then activate its saved signed selection again.
These local checks do not establish physical input or supported-device acceptance.

## Authenticated signed Appearance activation

The Plugin CLI accepts `activate <id> --runtime` for an existing Appearance factory through authenticated Renderer management.
Main selects the Appearance startup loader for theme identities.
Each request verifies current publisher policy, signature, identity, grants, and enabled selection before publishing captured bytes.
Main updates the Appearance discovery collection without duplicating the identity in surface discovery.
Pure palette declarations have no executable entry and cannot use this operation.
Discovery capacity is checked before capture and again before publication.
A newly full discovery list refuses publication and releases any unpublished capture.

The browser loads only the identity and entry URL captured by Main.
Appearance entry collection is serialized.
Definitions must come synchronously from the selected executing script.
Delayed callbacks cannot define a later selection.
Declaration validation precedes entry execution and follows factory definition.
The candidate must preserve the configured theme data, fonts, packaged styles, dependencies, ports, and permissions.
Trusted entry code retains Shell-world authority; these checks do not provide a sandbox.

The Appearance Host uses the common Host for release, replacement, cleanup, and rollback.
Disable immediately cancels pending discovery and factory construction.
An activation signal reaches candidate construction and startup.
Cancelled candidates release before the previous factory can resume.
Failed cleanup retains ownership and blocks another construction.
A replacement cancelled while queued fails before releasing the running factory.
After startup completes, the factory retains the Host lifetime rather than the caller's completed activation lifetime.
Shutdown prevents late factory construction and theme updates.

Success requires the selected running version and the captured revision receipt.
Main validates the receipt against its original main frame.
Failed startup reports failure even when rollback restores the previous factory.
Cancellation or receipt loss after completed selection can leave an unknown outcome that requires observation before another mutation.
Activation preserves palette declarations, Appearance Context, saved theme preference, and saved plugin selection.
It does not reload the document or rewrite preference storage.

The [Appearance checks](../tests/native-appearance-plugins.test.js) cover policy revocation, scoped loading, disable, delayed definitions, and candidate cancellation.
The [Host checks](../tests/appearance-plugins.test.js) cover strict declarations, rollback, and candidate resource release.
The [common Host checks](../tests/plugin-host-replacement.test.js) cover cancellation before queued execution.
The [Electron checks](../tests/appearance-restoration.test.js) exercise actual preload, signed loading, authenticated CLI activation, and default recovery.
One phase starts with no signed assets and activates without document navigation.
Both phases preserve the document, Clock node, saved preference, and measured styles across three themes.
These fixtures use controlled Main composition and data responses.
The [production Main checks](../tests/appearance-main-bootstrap.test.js) also exercise signed and empty startup through actual Main composition.
Its real verifier installs an interactive HTML App through actual preload.
Signed activation and built-in recovery retain the document, Clock node, opaque App frame, and App memory state across three themes.
Recovery also succeeds with malformed configuration and revoked publisher trust without rewriting either file.
These controlled checks use private state, software rendering, and programmatic App interaction.
Windows runtime isolation, physical input, live providers, and supported-device acceptance remain unverified.

## Authenticated built-in Appearance restoration

The Plugin CLI accepts `restore-default <id> --runtime` for existing Appearance identities through authenticated Renderer management.
Appearance captures configured built-in factories before external factory selection or entry execution.
The recovery baseline includes validated palette declarations selected at startup.
Factory recovery preserves these declarations, saved theme preferences, and the Appearance Context supplied to installed packages.
It does not reset palette configuration.
The captured declaration can therefore retain a configured version instead of the packaged version.

The Appearance Host serializes restoration with enable operations and rejects disabled or uncaptured identities.
It verifies declaration equality before releasing the external factory.
The common Host completes owned cleanup before constructing the captured factory.
Failed cleanup retains ownership until successful retry.
Failed default startup follows candidate cleanup and rollback; rollback success does not produce a successful restoration receipt.
Shutdown prevents late default construction and theme updates.
Success requires the captured factory reference, captured version, enabled identity, and running state.

Recovery does not read external configuration, publisher policy, or signed entries.
It does not load another browser entry or write theme preferences.
The [Host checks](../tests/appearance-plugins.test.js) cover capture mutation, disabled identities, retained cleanup, failed startup, and shutdown.
The [declaration checks](../tests/appearance-development.test.js) cover configured palettes, style retention, and unchanged installed-package documents.
The [browser checks](../tests/native-appearance-plugins.test.js) verify external release without another discovery or entry execution.
The [Electron check](../tests/appearance-restoration.test.js) uses actual preload, signed startup loading, Renderer management, and the CLI.
It restores the built-in factory after external configuration becomes malformed and publisher trust is revoked.
The document, Clock node, saved theme, and measured styles across three themes remain unchanged.
Its Main composition and data responses are controlled fixtures.
The Windows runtime phase remains skipped until private named-pipe isolation exists.
The [production Main checks](../tests/appearance-main-bootstrap.test.js) cover recovery with a verified installed App in the same Shell.
The App retains its frame, memory state, and measured theme context through recovery.
These checks do not establish live providers, physical input, or supported-device acceptance.

## Remaining integration

Per-revision asset retirement and arbitrary stylesheet replacement require separate integration.
Native install, update, and rollback commands still change selection only.
Development activation, new runtime identities, and multi-plugin activation require separate integration.
External providers, Windows, and CM5 remain unverified.
The common Host API does not establish those broader acceptance gates.
