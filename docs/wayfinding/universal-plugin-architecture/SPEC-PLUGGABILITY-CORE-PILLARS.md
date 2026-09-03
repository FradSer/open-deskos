# Specification: Open DeskOS Pluggability Core Pillars (Services, RPC Bridge, Auto-Assembly, Pixel Theme & Overlay Alerts)

**Document Status**: Ready for Implementation (`ready-for-agent`)  
**Route**: idea-to-ship  
**Phase**: to-spec  

---

## Problem Statement

Open DeskOS developers building desk companion apps and hardware integrations currently face rigid architectural barriers:
1. **Background Services are hardcoded**: There is no public seam to register long-running services (such as local speech-to-text / audio transcription, BLE device tracking, or sensor streaming). Any service must be hardcoded directly into the core service module.
2. **Backend IPC requires modifying core shell files**: Exposing any new Node.js capability requires modifying `main.js` and `preload.js`, creating tight coupling and merge friction.
3. **Widget layout requires manual coordinate calculations**: Developers must manually edit grid row and column coordinates in global config files rather than declaring preferred spans in plugin metadata.
4. **Themes are statically locked**: The visual palette is hardcoded to a single dark theme, preventing alternative visual aesthetics like retro pixel art.
5. **No structured alert channel**: Plugins cannot display urgent, high-priority notifications without breaking window boundaries or hacking hardcoded screen locks.

Simultaneously, opening the entire shell unconditionally risks breaking the focused, distraction-free desk instrument experience, causing fragmented UI, conflicting window paradigms, or broken viewport gestures.

---

## Solution

Open DeskOS delivers a disciplined, high-leverage pluggability model founded on **4 Authorized Extensibility Pillars plus a Controlled System Alert Channel**, while strictly keeping core shell frame invariants non-pluggable:

1. **Pluggable Background Services (`kind: 'service'`)**: A dynamic service registry allowing background daemons (such as an audio transcription service) to register, expose reactive stores, and be safely discovered by any widget or app via a standard service lookup.
2. **Capability-Gated Backend RPC Bridge (`callBackend`)**: A single, universal IPC gateway in the main process that routes plugin actions to sandboxed backend modules based on manifest-declared permissions.
3. **Desktop Grid Auto-Assembly (`contributions`)**: Automatic placement of widgets into available cells on the home grid based on declared manifest preferences, eliminating manual layout editing.
4. **Pluggable Themes (`kind: 'theme'`) with Built-in Pixel Art Theme**: A dynamic token engine supporting runtime theme switching, shipping with a second first-party retro pixel-art theme featuring sharp stepped borders and phosphor green/amber accents.
5. **Controlled Information Injection into System Overlay**: A secure host API allowing plugins to push structured alerts and status toasts into the system-managed overlay without granting arbitrary DOM overlay privileges.

Non-negotiable host invariants (Status bar center pager dots, Fullscreen app window container, and Viewport carousel navigation) remain managed by the Host Kernel to guarantee UX stability.

---

## User Stories

1. As an embedded AI developer, I want to deploy a local audio transcription background service as a plugin, so that live speech-to-text can be streamed to widgets and apps without modifying core shell code.
2. As a widget author, I want to consume live speech transcripts via a unified service lookup API, so that I can display real-time speech notes on the desk surface.
3. As a plugin developer, I want to execute Node.js backend logic through a single `callBackend` API, so that I do not need to add custom IPC handles to `main.js` or `preload.js`.
4. As a security-conscious user, I want the system to reject backend calls from plugins that have not declared required permissions in their manifest, so that malicious or misconfigured plugins cannot access unauthorized system capabilities.
5. As an app developer, I want to declare my widget's preferred grid span (e.g. 1x1, 2x2) in my plugin manifest, so that it automatically mounts onto the Home grid upon installation without manual layout editing.
6. As a user with multiple widgets, I want the desktop composer to place newly enabled widgets into available grid slots automatically, so that my desktop remains organized without overlapping tiles.
7. As a retro tech enthusiast, I want to switch my desk instrument to a Pixel Art theme, so that the display adopts authentic stepped borders, zero border-radii, and phosphor-accented typography.
8. As a developer, I want to author and register custom themes that modify semantic color, stroke, and font tokens, so that users can customize their display aesthetics within safe design boundaries.
9. As a system service developer, I want to push an urgent alert to the system-managed overlay, so that critical notifications (such as hardware disconnection or timer completion) are immediately visible without taking over window control.
10. As a desk companion user, I want the top status bar center dots and page context to remain consistently positioned and functional, so that I always know my current page regardless of active plugins.
11. As a desk companion user, I want the app window frame and Back navigation button to remain consistent across all built-in views, so that closing an app or returning to the desktop is always predictable.
12. As a touch and keyboard user, I want viewport swiping and Arrow key navigation to behave deterministically, so that third-party plugins cannot hijack the fundamental navigation gestures of the OS.

---

## Scenarios

### Scenario 1: Pluggable Background Service Registration and Discovery
```gherkin
Given a background service plugin declares "kind: service" with an audio transcription capability
When the plugin is registered and activated by the system
Then it exposes its reactive methods through the service registry
And any active widget can discover and subscribe to the transcription stream via the service context
And stopping the service cleanly tears down its audio stream and background listeners
```

### Scenario 2: Generic Capability-Gated Backend RPC Execution
```gherkin
Given a plugin declares permission "hardware:audio:capture" in its manifest
And an associated backend handler is registered in the main process
When the renderer plugin calls "ctx.callBackend('startTranscription', { sampleRate: 16000 })"
Then the main process validates that the requested action matches declared permissions
And the backend handler executes and returns the result to the renderer
```

### Scenario 3: Unauthorized Backend RPC Rejection
```gherkin
Given a plugin does not declare permission "system:process:exec" in its manifest
When the renderer plugin attempts to call an action requiring that permission via "callBackend"
Then the main process rejects the call with a permission-denied error
And the unauthorized execution is logged to system diagnostics
```

### Scenario 4: Desktop Grid Auto-Assembly via Manifest Contributions
```gherkin
Given a widget plugin declares "contributions.slot = 'home.grid'" with a "1x1" preferred span
And the Home grid currently has an open cell
When the plugin is registered and the desktop layout is built
Then the composer automatically places the widget in the first available cell
And the widget renders with its declared interaction and visual state
```

### Scenario 5: Dynamic Theme Switching to Pixel Art Theme
```gherkin
Given the Pixel Art theme plugin is registered with retro phosphor tokens and zero radius
When the user switches the active theme to Pixel Art
Then the host applies the pixel theme custom properties to the document root
And all widgets, status bars, and buttons render with sharp rectangular borders and retro typography
And switching back to the default minimal theme restores standard radii and colors without reload
```

### Scenario 6: Information Injection into the System Overlay
```gherkin
Given a running timer service finishes a focus session
When the service posts an alert via the system overlay API
Then the host displays a high-priority alert banner across the screen
And the alert automatically dismisses after its declared duration or upon acknowledgment
And the underlying page and navigation remain intact and uncorrupted
```

---

## Implementation Decisions

### 1. Dynamic Service Bus Architecture
- Introduce a dynamic `ServiceRegistry` in the renderer core.
- Replace static `SERVICE_KEYS` iteration with a dynamic proxy/map lookup on `ctx.services.get(serviceId)`.
- Core services (connection, remoteLink, subscription, faceAgent, piSessions) migrate to standard `kind: 'service'` registrations.
- Services implement the standard 8-phase lifecycle: `install`, `enable`, `mount` (no-op for headless services), `start`, `pause`, `resume`, `stop`, `destroy`.

### 2. Universal Capability-Gated IPC Router
- Implement a single IPC handler `odk-plugin-rpc` in the main process.
- The router checks caller plugin identity against loaded manifest permissions.
- Preload wraps this into a scoped helper: `ctx.callBackend(action, payload)`.
- Replaces individual ad-hoc IPC handles across the codebase.

### 3. Grid Auto-Packing Algorithm
- The composer retains declarative layout overrides from configuration if present.
- If a plugin declares `contributions.slot = "home.grid"` and is omitted from manual configuration, the composer scans the grid matrix (5 columns on widescreen, 3 on portrait) and places the tile in the first contiguous bounding box matching `preferredSpan`.

### 4. Theme Token Engine & Pixel Art Built-in
- Create a `ThemeRegistry` in `core/theme.js`.
- Plugins with `kind: 'theme'` supply a semantic token dictionary matching the `--odk-*` variables defined in `DESIGN.md`.
- Provide two first-party themes:
  - `odk.theme.default`: The existing quiet dark minimalist theme.
  - `odk.theme.pixel-art`: A high-contrast retro theme with 0px border radius, stepped pixel accents, phosphor green/amber accents, and crisp monospace/pixel typography.

### 5. Managed System Overlay Channel
- The host retains sole ownership of `#system-overlay-root`.
- Plugins receive `ctx.postAlert({ title, message, level, timeoutMs })`.
- Overlays render via a unified, host-controlled component with accessible dismiss mechanics.

---

## Testing Decisions

1. **High-Level Seam Principle**:
   - Test through public plugin registration, IPC invocations, and DOM output. Avoid testing private internal map structures.
2. **Module Test Targets**:
   - `service-registry.test.js`: Validates dynamic service registration, lifecycle dispatch, and inter-plugin service subscription.
   - `plugin-rpc.test.js`: Validates permission validation, routing, and error rejection of unauthorized calls.
   - `composer-autopack.test.js`: Validates 5x3 and 3x5 grid slot allocation from manifest `contributions`.
   - `theme-engine.test.js`: Validates token application, style variable updates, and Pixel Art theme contract.
   - `e2e.js`: End-to-end browser verification of theme switching, auto-assembled widgets, and overlay alerts.
3. **Prior Art**:
   - Builds directly on patterns established in `runtime/linux/tests/plugin-contract.test.js` and `runtime/linux/tests/e2e.js`.

---

## Out of Scope

- Modifying or replacing the top status bar center dots and page context indicator.
- Allowing custom modal window chrome or arbitrary third-party window decorators for full-screen apps.
- Replacing the core viewport horizontal carousel pager with custom 3D or vertical scroll engines.
- Allowing plugins to execute arbitrary, unverified native binaries on the host system without manifest permission grants.
- Historical ESP32-P4+C6 firmware tree modifications (`research/esp32-p4-c6-deskos/`).

---

## Further Notes

All work must strictly adhere to the project's zero AI-code-slop standards: functions under ~50 lines, no unnecessary try/catch blocks in trusted code, no `any` casts, and zero emojis in production code, paths, or commit messages.
