# Installed desktop composition plugin contract

Read this when replacing installed Widget placement and installed App page composition.
[User applications](USER_APPLICATIONS.md) owns package verification, revisions, placement, sandbox limits, and package data.
This component does not replace that package runtime.

## Public interface and ownership

The [Renderer adapter](../src/renderer/core/user-app-desktop-plugins.js) registers `odk.system.user-app-desktop` with the common Host.
Its public port is `odk:system/user-app-desktop/v1`.
Trusted preloaded code can supply one definition through `window.odkUserAppDesktopReplacements` before Shell startup.
An external browser entry can define the factory through `window.odkUserAppDesktopLoading.define({ id, create })`.
Development links require explicit trust and replacement authorization through the existing Plugin CLI.
Signed revisions use the existing publisher policy, verified byte capture, trust record, and exact grant checks.
The definition must retain the identity, Renderer host, system kind, port declarations, and empty requirements and permissions.
The adapter captures the default mount function before later replacement code can change it.

The factory returns a port with synchronous `mount(options)`.
Mount receives the track, layout, status element, and catalog and page change callbacks.
Its controller provides `refresh()` and `dispose()`.
The Host owns mounted controllers and waits for their cleanup during shutdown.
A rejected controller with `dispose()` remains owned until cleanup succeeds.
Invalid factory results still release registered context cleanup.
Rejected asynchronous mounts retain settlement ownership and release eventual controllers without permitting asynchronous mounting.
Failed cleanup retains ownership for an explicit stop retry.

The [default implementation](../src/renderer/core/user-app-desktop.js) owns catalog reconciliation and mounted package frames.
It retains unchanged frames and replaces changed revisions or placements.
Catalog failures preserve stale content with an unavailable status.
Released controllers ignore refresh calls and pending catalog responses.
Failed frame release preserves the entry for cleanup retry.

The [Shell](../src/renderer/shell.js) retains pager, foreground navigation, Back, startup fallback, and recovery authority.
Invalid definitions fall back to the built-in implementation before construction.
Startup failure requires successful resource release before built-in recovery.
Retained cleanup failure leaves a visible unavailable status and a manual Refresh action.
Shutdown refuses new recovery and waits for pending recovery.
Page shutdown also cancels initial startup before installed surfaces can mount.
Recovery cannot construct or mount another implementation after shutdown begins.

## External startup loading

The external manifest uses `entry` for a relative browser JavaScript file.
It retains the same system identity and public port without surface placement fields or a replacement stylesheet.
The [discovery validator](../src/development-plugins.js) uses the same interface validator as the Renderer adapter.
Discovery reads declarations without executing browser code in Main.
The [shared browser loader](../src/renderer/core/development-plugins.js) receives selected entries through the authenticated Renderer discovery channel.
It accepts at most one desktop entry and validates its declaration before script execution.
Only that executing script can define its selected identity, exactly once, with a factory function.
The loader captures the declared manifest independently from the script's factory definition.
Wrong, duplicate, missing, or failed definitions leave the built-in implementation available.
Desktop and surface consumers share one loading queue, script identity check, and definition collection.
Each consumer retains its own declaration checks and definition endpoint.
The desktop endpoint remains `window.odkUserAppDesktopLoading`; it does not own a separate loading implementation.
Surface discovery excludes the desktop system identity.
Conflicting preloaded and external desktop selections reject composition and restore the built-in implementation.
Shutdown cancels pending entry loading and waits for its operation to settle before releasing the desktop owner.
Cancellation abandons a pending read-only discovery reply without waiting for Main to return it.
Late replies cannot execute scripts, and late rejections remain handled.

## Evidence and limits

The [independent fixture](../tests/fixtures/user-app-desktop-replacement/entry.js) uses array reconciliation instead of the default keyed map.
It shares public catalog, sandboxed frame, and grid placement services without calling the default desktop factory.
The [shared behavior checks](../tests/user-app-desktop-independent.test.js) run the default scenarios against its public mount port.
These direct port checks do not prove Host loading.
The [Host checks](../tests/user-app-desktop-plugins.test.js) cover selection, shutdown, malformed controllers, and retained cleanup.

The [Electron checks](../tests/user-app-desktop-plugins-electron.test.js) load the actual Shell and preload in private profiles.
External modes use actual CLI development links or signed installations and the authenticated discovery plugin.
They execute the independent browser entry through the same loader that production Shell startup uses.
Controlled catalog records and protocol responses supply package fixtures.
Checks cover default and independent factories, invalid declarations, failed startup, cleanup retry, and shutdown during recovery cleanup and startup.
They retain unchanged frames, built-in views, foreground state, and package counter state across catalog changes.
They exercise Back through browser pointer input and preserve package state across three Shell themes.
A wrong App surface role is rejected through the same loading path.
Both external modes also reject a factory definition with the wrong identity and retain functional built-in desktop composition.
Shutdown removes discovery access and closes captured native assets before the parent removes the private profile.
Gated discovery checks exercise shutdown before the authenticated desktop reply returns in both external modes.
Execution markers are added to private entry copies before signing or linking and confirmed in healthy external modes.
These checks do not verify package installation or live provider data.

The [production Main checks](../tests/app-manager-main-bootstrap.test.js) start all Main plugins with private state and controlled external inputs.
Default and trusted development selections mount real catalog snapshots through actual preload, discovery, and the package document protocol.
The alternative executes its entry marker while the default desktop mount is forbidden.
A missing alternative entry fails through the same startup path.
Public package commands move and remove the Widget while retaining the unchanged App frame, counter state, and built-in foreground.
Renderer shutdown removes installed surfaces; Main shutdown removes its handlers.
Private accepted snapshots seed this startup check; it does not exercise installation verification or signed desktop selection in production Main.

Authenticated runtime management, runtime replacement, and state transfer are not implemented for this component.
Theme checks do not establish screenshot equivalence, density, or complete package appearance propagation.
Physical input, assistive technology, density, raster pixels, and display presentation remain unverified.
[Native host evidence](PLUGIN_COVERAGE.md#native-installed-desktop-acceptance) records controlled Windows and CM5 composition acceptance.
[The feature matrix](PLUGIN_FEATURE_MATRIX.md) owns remaining feature gaps.
[Plugin coverage](PLUGIN_COVERAGE.md) owns recorded command results.
