# Built-in plugin guide

Use this guide for trusted plugins packaged in a Shell release. For installed Widget/App packages, use [USER_APPLICATIONS](USER_APPLICATIONS.md). Use the [Widget skill](../../../.agents/skills/open-deskos-widget/SKILL.md) for design and verification.

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

Widgets display readings. Put interactive controls on an App page or built-in view. A plugin must not call the runtime directly or add its own routing path.

## Plugin context

| Member | Contract |
| --- | --- |
| `ctx.onTick(cb)` | Shared one-second tick; immediate initial call; returns cleanup |
| `ctx.connection.subscribe(cb)` | Network boolean; immediate initial call; returns cleanup |
| `ctx.connection.labelFor(online)` | Shared network wording |
| `ctx.briefing.subscribe(cb)` / `.list()` | Ordered Today statements |
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

Plugins read configuration from `ctx`. They must not read environment variables or URL parameters themselves.

## Today statements

Today renders plugin statements in `order` (default 100). It supplies typography; plugins supply words and optional inline icons.

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

Use only measured local or configured-provider facts. Never invent personal activity. With no contribution, Today reports `No desk briefing is available.`

## Page input and Remote state

A page can publish `{ actions: [{ id, label }], focus: 'items' }`. In App Focus Mode, `focus:'items'` gives that page directional input. Events are scoped to its current page element:

| Event | Detail | Meaning |
| --- | --- | --- |
| `odk-remote-page-input` | `{ input }` | `left`, `right`, `up`, `down`, `primary` or `back`; Back also leaves focus mode |
| `odk-remote-action` | Action ID | Invoke a declared Strip action; unknown IDs do nothing |
| `odk-page-shown` | None | Refresh when this page becomes visible |

Mark one visible entry with `[data-page-focus]`. Only the visible view can own it. A status indicator can use an owned `open-app` intent to navigate; it cannot bypass the App contract.

## Layout and delivery

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
ODESK_DISABLED_PLUGINS="odk.tile.hydra odk.page.quota" ./run.sh --kiosk
```

Tiles are removed, status slots remain empty and disabled pages leave the pager. Unknown IDs are ignored. Main passes this startup configuration to the renderer; plugins never inspect the environment.
