# Built-in plugin guide

Use this guide for trusted plugins packaged in a Shell release. For installed Widget/App packages, use [USER_APPLICATIONS](USER_APPLICATIONS.md). Use the [Widget skill](../../../.agents/skills/odk-widget/SKILL.md) for design and verification.

## Files

| File | Responsibility |
| --- | --- |
| `src/renderer/index.html` | Empty status/page/dialog structure and local script order |
| `shell.js` / `layout.js` | Composition, geometry, paging, dialogs and keyboard input |
| `core/registry.js` | Registration, mounting and cleanup |
| `core/services.js` | Shared tick, connection state and state labels |
| `core/app-platform.js` | Built-in view intent routing |
| `core/composer.js` | Validate and assemble plugins/layout |
| `config/desktop_layout.js` | Page and Widget placement authority |
| `plugins/*.js` | Self-contained page, Widget, status or App implementation |

## Registration and lifecycle

| Kind | Placement | Contract |
| --- | --- | --- |
| `tile` | Declared grid cell | `app`, truthful `state`, `mount`; read-only |
| `page` | Declared page | `surface: 'display' \| 'app'`, lifecycle |
| `status` | Persistent State Bar | `slot: 'left' \| 'right'`, lifecycle |
| `app` | Built-in view runtime | `appId`, `appKind`, lifecycle; optional `handleAction` |

IDs use the `odk.` namespace. Declare `manifest.schemaVersion: 1`. A tile also declares its readable minimum where required by the geometry contract. Use the Cell supplied by layout, not the host or window width.

```js
;(function (root) {
  'use strict'
  root.odkPlugins.register({
    id: 'odk.tile.my-widget',
    manifest: { schemaVersion: 1 },
    kind: 'tile',
    app: 'My view',
    state: 'Pending integration',
    mount(el, ctx) {
      el.innerHTML = '<span class="w-name">My view</span>'
      ctx.onTick((now) => { /* Render a reading when the tick is needed. */ })
    },
  })
})(typeof window !== 'undefined' ? window : globalThis)
```

`mount(el, ctx)` is required. The registry supplies an empty `unmount` by default. Release resources through scoped subscriptions or explicit `unmount`. Apps can provide `handleAction(intent, ctx)`; only the built-in view runtime dispatches it.

A mount/unmount failure is isolated. A tile reports `Widget error`; a status plugin reports `Plugin error`. Other plugins and the shared tick continue. The console records the failure; do not use isolation to hide defects.

Surface release waits for unmount and all scoped cleanup callbacks.
A failed release retains its element, failed callbacks, and factory resources.
The runtime catalog reports factory shutdown failures as `cleanup-failed`.
A later shutdown request retries unfinished work without repeating successful callbacks or completed unmount.
Concurrent release requests share the pending operation.
A failed mount releases scoped resources without calling unmount on the incomplete surface.
Independent plugins can still stop when another plugin retains resources.

The App platform retains its runtime reference when surface release fails.
Close and switch failures retain the previous foreground until release succeeds.
The close error Retry uses the same shutdown path as Back.
If mounting and cleanup both fail, the target remains owned and reports a failed foreground.
The platform cannot restore another App onto that retained element.
A later close request retries cleanup before it clears the foreground.

Widgets display readings. Put interactive controls on an App page or built-in view. A plugin must not call the runtime directly or add its own routing path.

### Built-in App view replacement

Calendar, Clock, Pomodoro, Year progress, Built-in views, and AI usage use `odk.app.*` identities in the existing Renderer registry.
Use the existing Renderer controller and public App intents for replacement and opening.
The [alternative view fixture](../tests/fixtures/builtin-view-replacements.js) owns these interiors without calling packaged mount functions.
It shares Shell styles, navigation, Tick delivery, and the Main App Manager.
The [shared browser check](../tests/builtin-view-replacement.test.js) covers reading transitions, catalog recovery, late replies, and dialog keyboard behavior.
Read the [feature matrix](PLUGIN_FEATURE_MATRIX.md) before choosing an acceptance gap or changing an entry point.
Read [Plugin coverage](PLUGIN_COVERAGE.md#built-in-app-views-through-existing-replacement) before reporting loading, production integration, or completion results.

The Pi App and Pi page have separate replacement identities.
Their packaged definitions share a local view function without looking up another selected plugin's mount function.
Replacing the Pi App does not replace the Pi page.
Select the page identity when replacing its implementation.

The Pi Widget has an independent replacement fixture through the existing Renderer controller and trusted development loader.
Shared checks preserve scan ordering, reading states, goal formatting, and release behavior.
Released size callbacks must remain inert even when observer disconnection fails and requires retry.

## Plugin context

### Trusted replacement composition

Trusted packaged scripts can set `window.odkRendererReplacements` before `shell.js` runs.
The value contains replacement definitions for previously registered identities.
The Shell passes this collection to `odkPlugins.start({ disabled, replacements })`.

Each replacement retains its kind, slot, surface role, interaction, App identity, and App kind.
It retains the Minimum Readable Cell declaration to preserve placement behavior.
It also retains provided interfaces, required interfaces with optional flags, and permission names.
The registry validates the complete candidate graph before any factory executes.

Invalid or duplicate replacements leave the original registry composition available.
The Shell reports the rejection and starts the original composition with the same disabled identities.
The Shell captures packaged defaults before loading external surface entries.
The startup replacement collection does not apply runtime changes.
Use the [runtime replacement contract](RUNTIME_PLUGIN_REPLACEMENT.md) for changes to running surfaces.
The registry uses the selected definition for factory creation, mounting, catalog reporting, and cleanup.
Layout declarations continue to reference the same identity.
Each replacement needs its feature scenarios and rendered acceptance checks.

This interface accepts preloaded trusted code without adding a sandbox or download path.
The [development CLI](CONFIGURATION.md#development-links) can link trusted local renderer replacements with `--trust --replace` and explicit grants.
Main returns validated declarations and file URLs to known Shell main frames without executing browser entries.
The renderer checks declarations before loading any entry under the existing Content Security Policy.
Each browser entry calls `window.odkRendererDevelopment.define(definition)` once for its selected identity.
Call it synchronously while the selected script executes.
Delayed callbacks cannot define replacements for another load.
The loader checks actual definitions before factory execution.
Use an IIFE to contain entry variables.
Load failures restore the default composition with the same disabled identities.
A renderer development manifest can declare one relative `css` file inside its linked directory.
Main validates its path and size; the renderer checks availability without applying the stylesheet before executing entries.
The registry uses the validated file URL only for the selected definition.
Rejected entries leave no temporary stylesheet applied to the default composition.
Ordinary packaged definitions retain Shell-relative `css` paths.
The [development contract](CONFIGURATION.md#development-links) owns stylesheet limits and additional asset verification scope.
Disable and removal operations apply on the next Shell startup.
Signed surface revisions use the separate [native startup contract](NATIVE_PLUGINS.md#renderer-startup).
Native CLI revision rollback changes the next startup selection.
Read [the runtime contract](RUNTIME_PLUGIN_REPLACEMENT.md#renderer-programmatic-replacement) for trusted programmatic replacement and its remaining browser-loading gates.
Appearance links use the separate [declaration contract](CONFIGURATION.md#appearance-declarations) without browser entries or external stylesheets.

Trusted packaged scripts can set `window.odkAppearanceFactoryReplacements` before `core/theme.js` runs.
Each selected factory retains its appearance identity, provided interface, and complete declared appearance data.
The Host compares actual port data before and after startup without adding declaration defaults.
Object key order can differ; field presence, token values, and font order must match.
The selected factory owns startup, stop, destroy, and scoped cleanup.
Invalid ports release resources and leave independent appearances available.
Invalid selections retain the complete previous composition before any factory executes.
Signed Appearance entries use the separate [startup contract](NATIVE_PLUGINS.md#appearance-startup).
They register through `window.odkAppearanceNative.define` and preserve the same complete Appearance context.
The packaged preload interface remains separate from signed entry discovery.

### Renderer bridge implementation replacement

Trusted Shell code can await `window.odkRendererDiagnosis.ready` before replacing a control or diagnosis bridge.
`window.odkRendererDiagnosis.catalog()` returns their current Host lifecycle records.
`await window.odkRendererDiagnosis.replace(definition)` uses the common Host replacement contract.
The identities are `odk.renderer.plugin-control` and `odk.renderer.plugin-diagnostics`.
Replacement retains declared contracts and releases the previous request subscription before starting the selected factory.
The existing pagehide handler stops the same Host.
This interface accepts trusted definitions; it does not load external browser entries or expose a CLI command.
Read [the bridge checks](../tests/renderer-bridge-replacement.test.js) for current comparison limits.

### Programmatic runtime lifecycle

`await odkPlugins.setEnabled(id, enabled)` changes selected factory states after startup.
The registry uses the common Host dependency and resource release rules.
It blocks affected mounts while a lifecycle transition waits.
Required consumers stop before their providers; independent plugins remain available.
Failed release retains ownership and permits a later lifecycle retry.
Repeated startup configuration uses the same runtime checks.
Shutdown refuses new runtime management requests.

A mounted affected App must close through the App platform before lifecycle changes.
This check occurs before cancellation and includes optional dependency consumers.
The registry records mounting ownership before it calls plugin code.

The registry remembers mounted Widget, Page, and status containers with their original UI contexts.
After successful release, it clears their content and preserves their placement attributes.
When their factories become available, it mounts the same selected definitions with fresh factory signals.
Restoration errors do not prevent other affected surfaces from mounting.
Failed mounting or release cannot certify successful surface restoration.
Manual deactivation and Shell shutdown remove restoration records.
Disconnected containers cannot receive a new mount.

The registry does not restore foreground Apps or change pager membership.
Initially excluded desktop surfaces need the [desktop reconciliation interface](#programmatic-desktop-reconciliation).
Initially excluded status surfaces need the [State Bar reconciliation interface](#programmatic-state-bar-reconciliation).
The authenticated [runtime CLI](CONFIGURATION.md#explicit-runtime-management) uses the Shell controller for renderer changes.
The [Shell runtime controller](#shell-runtime-coordination) coordinates placement and paging.
The registry interface alone does not coordinate paging.

### Programmatic desktop reconciliation

`await odkComposer.reconcile(layout, track, uiCtx, disabled)` coordinates fixed desktop declarations with runtime exclusions.
Without `disabled`, it excludes factories that report `disabled` or `blocked`.
It creates missing Widget and Page containers in declaration order.
It retains existing containers and installed user package nodes.
It waits for resource release before removing excluded containers.
Failed release keeps the container available for a later retry.
Included inactive containers retry cleanup before mounting again.
Repeated reconciliation does not remount active instances.

The interface rejects existing page kind, plugin, or surface changes before cleanup.
It also rejects removal of a base grid declaration.
These checks preserve page ownership and installed package placement.

Reconciliation requests run in order and continue after a rejected request.
The controller must coordinate registry transitions, reconciliation, Shell shutdown, and full composition builds.
After reconciliation, it must update geometry, pager selection, page names, and Remote page ownership.
Use the [Shell runtime controller](#shell-runtime-coordination) for coordinated placement changes.
The authenticated runtime CLI uses the Shell controller for coordinated changes.

### Programmatic State Bar reconciliation

The Shell calls `odkComposer.buildStatus(uiCtx, disabled)` for initial status placement.
`await odkComposer.reconcileStatus(uiCtx, disabled)` coordinates declared status plugins with runtime exclusions.
Without `disabled`, it excludes factories that report `disabled` or `blocked`.
It creates missing containers in each declared slot and registration order.
It preserves existing containers and unrelated slot content.
It waits for resource release before removing an excluded container.
Failed release retains the container for retry.
Included inactive containers retry cleanup before mounting again.
Active containers do not mount again.
Restoration resets the previous error fallback before mounting.
Reconciliation also clears obsolete composer error markers after the registry restores an active container.
It preserves plugin-owned classes and changed titles during this recovery.
Status plugins must release subscriptions through their scoped cleanup context.

State Bar and desktop reconciliation share one request queue.
A rejected request does not prevent later requests.
The controller must coordinate registry transitions, both reconciliation interfaces, Shell shutdown, and full composition builds.
The authenticated runtime CLI uses the Shell controller for coordinated changes.

### Shell runtime coordination

`await window.odkRendererRuntime.setEnabled(id, enabled)` coordinates trusted renderer runtime changes.
It serializes factory changes, desktop reconciliation, and State Bar reconciliation.
It then updates geometry, page names, pager controls, and Remote page state.
The current page retains selection when its identity remains available.
Removing the current page selects the nearest remaining page.
Existing containers and installed package placements remain under their original owners.
Page-owned Remote declarations use page elements as keys, not changing page indices.
Runtime transitions defer Remote publication until placement synchronization finishes.
Partial failure still synchronizes retained placements before publication resumes.
An independent State Bar reconciliation can proceed after desktop reconciliation fails.
The returned catalog reports factory lifecycle states; it does not establish feature health.

Affected foreground Apps must close through the existing App platform before lifecycle changes.
The controller preserves the registry refusal when an affected App remains mounted.
`await window.odkRendererRuntime.stop()` closes runtime management and drains active controller work before registry shutdown.
Queued lifecycle changes cannot mount surfaces after shutdown starts.
Concurrent shutdown requests share one operation.
A later shutdown request can retry retained cleanup.
Shell pagehide uses this shutdown path.

This trusted programmatic interface does not add native distribution or runtime replacement loading.
The authenticated runtime CLI routes renderer requests through a separate Main-owned management channel.
It accepts only correlated replies from the selected Shell main frame.
Failed affected placements prevent a successful lifecycle receipt.
The inventory includes appearance factories through `odkTheme.catalog()`.
Appearance lifecycle commands use `odkTheme.setEnabled()` and retain existing theme preference and fallback behavior.
Duplicate identities across the surface and appearance Hosts refuse commands before lifecycle work starts.
Failed appearance startup or cleanup cannot return a successful receipt.
Supported-device acceptance remains unfinished.

### Supplied context

| Member | Contract |
| --- | --- |
| `ctx.focus.snapshot()` / `.subscribe(cb)` | Optional read-only Pomodoro state from the active App implementation; subscription returns cleanup |
| `ctx.onTick(cb)` | Shared one-second tick; immediate initial call; returns cleanup; final cleanup stops its interval |
| `ctx.connection.subscribe(cb)` | Network boolean; immediate initial call; returns cleanup |
| `ctx.connection.labelFor(online)` | Shared network wording |
| `ctx.services.get('odk.service.gamepad').subscribe(cb)` / `.snapshot()` | Read-only gamepad presence; immediate retained state; subscription returns cleanup |
| `ctx.homeBriefing.subscribe(cb)` / `.snapshot()` | Personal Agent home statements and source states |
| `ctx.briefing.subscribe(cb)` / `.list()` | Ordered plugin statements; retained for existing consumers |
| `ctx.briefing.contribute({ id, order, parts })` / `.withdraw(id)` | Publish/remove this plugin's statement |
| `ctx.subscription.subscribe(cb)` / `.refresh()` | Usage snapshot and main-process refresh |
| `ctx.SUBSCRIPTION_LABELS` / `ctx.NETWORK_LABELS` / `ctx.REMOTE_LINK_LABELS` | Shared state vocabulary |
| `ctx.openDialog(title, message, sub, showSteps?, action?)` | Shell dialog with an optional recovery action |
| `ctx.emitIntent({ type: 'open-app', appId, widgetId, route })` | Open a built-in view through the owned runtime |
| `ctx.emitIntent({ type: 'action', appId, action })` | Send a built-in view action |
| `await ctx.platform.listApps()` | Authoritative main-process catalog; report IPC failure |
| `ctx.platform.catalog()` | Local renderer adaptation/test catalog, not runtime authority |
| `ctx.openNavigationHelp()` | Open Shell navigation help |
| `ctx.runtimeConfig` | Read-only main-process startup configuration. `piSessionReasoning` is `hidden` by default or explicit `shown`. |
| `ctx.publishPageRemote(el, remote)` | Page-owned Remote actions/focus. Pass `null` to withdraw. |

Each shared service subscription owns a separate cleanup, even when subscriptions use the same callback.
Repeated cleanup cannot remove another subscription or a later registration.
Connection, Camera, Quota, Remote Link, Briefing, and Home Briefing propagate initial callback errors and remove the failed registration.
Gamepad and Tick contain callback errors and return cleanup as before.

`ctx.services.registerService(id, instance)` selects the implementation used by named service getters.
Replacing or removing default Home Briefing, Remote Link, connection, or gamepad services releases their upstream listeners.
Restoring a default service reconnects its listeners and reads current source state.
Retained callbacks and pending responses cannot update a deselected default service.
Failed listener release retains ownership; repeat selection or removal to retry cleanup.
Default input cleanup is registered before restoration notifies consumers.
Replacement implementations own their resources; registration does not acquire or release those resources.
Existing mounted consumers use another implementation after remounting.
Registration does not rebind their existing subscriptions.
The Pomodoro Widget checks its optional focus reader on each Tick.
It releases the previous reader before it subscribes to a replacement.
Opening a Pomodoro App publishes that implementation's read-only focus state.

Plugins read configuration from `ctx`. They must not read environment variables or URL parameters themselves.

## Weather surface contract

Read [the Weather surface contract](WEATHER_SURFACE_PLUGIN_CONTRACT.md) when replacing Weather display, refresh sequencing, or surface release behavior.

## Hydra surface contract

Read [the Hydra surface contract](HYDRA_SURFACE_PLUGIN_CONTRACT.md) when replacing telemetry display, measured cell composition, or surface release behavior.

## Camera source contract

Read [the Camera source contract](CAMERA_PLUGIN_CONTRACT.md) when replacing capture, frame caching, or source lifecycle behavior.
The Camera Widget is retired. The Camera source and peripheral status remain separate.

## Year and State Bar time contracts

Read [time contracts](CALENDAR_TIME_SURFACE_PLUGIN_CONTRACT.md) when replacing Year or State Bar time.

## Pomodoro surface contract

Read the [Pomodoro surface contract](POMODORO_SURFACE_PLUGIN_CONTRACT.md) when replacing its not-started display.

## Quota surface contract

Read [the Quota surface contract](QUOTA_SURFACE_PLUGIN_CONTRACT.md) when replacing quota rendering, refresh interaction, disclosure recovery, or subscription cleanup.

## Pi State Bar surface contract

Read [the Pi State Bar contract](PI_STATUS_SURFACE_PLUGIN_CONTRACT.md) when replacing session counts, legacy briefings, scan cadence, or status listener cleanup.

## Connection and gamepad State Bar contracts

Read [input status contracts](INPUT_STATUS_SURFACE_PLUGIN_CONTRACT.md) when replacing reachability or gamepad indicators, their input resources, or runtime reading continuity.

## WeRead surface contract

Read [the WeRead surface contract](WEREAD_SURFACE_PLUGIN_CONTRACT.md) when replacing highlight display, decoding, fitting, keyboard scrolling, or surface release behavior.

## Native source contracts

Read [the WeRead contract](WEREAD_PLUGIN_CONTRACT.md) when implementing highlight sources, cache behavior, and owned cancellation.
Read [the Weather contract](WEATHER_PLUGIN_CONTRACT.md) when implementing location, provider responses, cache behavior, and source cancellation.

Read [the Camera contract](CAMERA_PLUGIN_CONTRACT.md) when implementing frame consumers, capture ownership, and source shutdown.
Read [the Hydra contract](HYDRA_PLUGIN_CONTRACT.md) when implementing MQTT sources, protocol state, cached health, or connection ownership.
Its independent example shares the public reading projection and captures that module in signed acceptance bundles.
Read [the Quota contract](QUOTA_PLUGIN_CONTRACT.md) when implementing a Main Quota replacement through declared capabilities.
Its independent example implements request ownership and Open DeskOS Data projection without Shell module imports.
Read [the Pi Session Events contract](PI_EVENTS_PLUGIN_CONTRACT.md) when implementing event reads, local fallback, and owned cancellation.
Read [the Pi Sessions contract](PI_SESSIONS_PLUGIN_CONTRACT.md) when implementing session aggregation, configured inspection, and Open DeskOS Data projection.
Read [the Open DeskOS Link contract](ODK_LINK_PLUGIN_CONTRACT.md) when implementing reporting reads, raw transport, request cancellation, or source shutdown.

## Home statements

Personal Agent supplies Today content through `ctx.homeBriefing`.
[The Personal Bot contract](../../../integrations/personal-bot/docs/CONTRACT.md#home-briefing) owns generation, source limits, and update rules.
The briefing frame retains source states and measurement times.
Today reports loading, empty, unavailable, error, and stale states.
It does not replace unavailable Agent output with fixed plugin sentences.

New home items contain ordered literal segments.
Context segments contain text; fact segments contain text and an approved icon name.
The client validates the joined text and the 240-character paragraph limit.
The page has no attribution footer, update timestamp, or Sources controls.
The briefing paragraph announces availability changes.

## Home selection declarations

Declare `home` on a Open DeskOS Data registration or an installed package manifest.
Use [the Personal Bot contract](../../../integrations/personal-bot/docs/CONTRACT.md#home-selection) for its schema and generation rules.
A renderer statement does not control home selection.
All visible sources participate; legacy required modes and priorities reserve no display positions.
The source owner declares semantic fields; the Agent selects current facts across sources.

## Plugin statement store

Existing plugins can contribute ordered statements through `ctx.briefing`.
The store remains available to existing consumers.
Today uses the separate Personal Agent output.

```js
ctx.briefing.contribute({
  id: 'odk.briefing.my-signal',
  order: 20,
  parts: [
    { text: 'You have ' },
    { text: '2 sessions', emphasis: true, icon: ICON_SVG },
    { text: ', today.' },
  ],
})
```

The same ID replaces its previous statement. Unchanged contributions do not redraw. Empty/non-string parts and invalid icons are dropped. If every part is invalid, the whole contribution is refused.

An icon is a complete inline SVG with `data-tabler`, `viewBox` and the original stroke paths. Reject scripts and `on*` handlers. Original paths let the icon adapter switch between standard and Pixel artwork. `emphasis:true` renders `<b>`; plain connectives remain quiet.

Use only measured local or configured-provider facts. Never invent personal activity. With no contribution, the plugin statement store returns an empty list.

## Page input and Remote state

A page can publish `{ actions: [{ id, label }], focus: 'items' }`. In App Focus Mode, `focus:'items'` gives that page directional input. Events are scoped to its current page element:

| Event | Detail | Meaning |
| --- | --- | --- |
| `odk-remote-page-input` | `{ input }` | `left`, `right`, `up`, `down`, `primary` or `back`; Back also leaves focus mode |
| `odk-remote-action` | Action ID | Invoke a declared Strip action; unknown IDs do nothing |
| `odk-page-shown` | None | Refresh when this page becomes visible |

Mark one visible entry with `[data-page-focus]`. Only the visible view can own it. A status indicator can use an owned `open-app` intent to navigate; it cannot bypass the App contract.

## Layout and delivery

The production desktop contains Home, Desk, and Reading display pages.
Pi Sessions opens only from its Home Widget.
The State Bar Pi indicator selects Home and focuses that Widget.
The retained `odk.page.pi-sessions` identity supports compatibility checks; production layout does not mount it.


Declare placement in `config/desktop_layout.js`:

```js
{ id: 'home', name: 'Home', kind: 'grid', surface: 'display', widgets: [
  { id: 'odk.tile.my-widget', col: '3', row: '4' },
]},
{ id: 'my-app-page', name: 'My App', kind: 'page', surface: 'app', plugin: 'odk.page.my-app' },
```

Page names supply page context and accessible labels. Keep page content out of `index.html`.

1. Add a Given/When/Then scenario to the affected feature and a failing regression test.
2. Add the plugin and its local script before `shell.js` in dependency order.
3. Declare placement and readable geometry. Use Tabler outline SVG paths with `data-tabler`.
4. Run affected Node tests, `pnpm geometry` for layout changes and `pnpm e2e` for interaction changes. Fix change-caused failures.
5. Follow the repository commit workflow when a commit is requested. Deployment remains separately authorized.

Use checked `--odk-*` tokens from root `DESIGN.md`. The documented Pi transcript exception remains scoped to quoted Pi content. State must stay truthful. User-visible Shell copy and catalog values are English. Do not use emojis. Built-ins stay packaged local scripts; do not download or hot-reload third-party plugins/themes. Installed packages use their own verified sandbox.

To disable a suspect plugin during diagnosis:

```sh
ODK_DISABLED_PLUGINS="odk.tile.hydra odk.page.quota" ./run.sh --kiosk
```

Tiles are removed, status slots remain empty and disabled pages leave the pager. Unknown IDs are ignored. Main passes this startup configuration to the renderer; plugins never inspect the environment.

### Appearance factory activation and recovery

Read [Appearance activation](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-appearance-activation) and [Appearance recovery](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-appearance-restoration) when changing theme factory lifecycle or runtime management.
Factory recovery retains configured palette declarations and saved preferences.
It does not reset the Appearance Context supplied to installed packages.
