# Android Shell Host: the shared Personal Agent on a phone

Date: 2026-10-18. Status: implemented. The scenarios live in `runtime/shell/tests/features/android-host.feature`.

## Problem Statement

The owner runs the Open DeskOS Display Shell on Linux, Windows and macOS. The Personal Agent design therefore lives in one place: the Electron renderer. There is no way to see or use that design on an Android phone. The handset cannot run Electron, so the design cannot reach it today.

The owner wants the Personal Agent on the Android handset he connects through `adb`, and he wants it to look and behave the same as on the other Shell Hosts.

## Solution

An Android application hosts the same renderer the other Shell Hosts use. It loads the existing Shell document in a system WebView and supplies the preload-equivalent bridge the renderer already expects.

The Android host holds no generator and no fixture. It opens an Open DeskOS Link to the CM5 desk and subscribes to Personal Agent frames. Every briefing, reply, notification and source update is produced on CM5 and arrives over that link. Android submits owner text turns to the same CM5 resident, so generation stays on the desk.

The first supported surfaces are the Personal Agent page and the Personal Bot status panel. A development frame source on CM5 renders every design state on request, so no Android build carries sample content.

The renderer stays a single source. The build copies renderer output during packaging, and the repository holds no Android copy of the renderer. A consistency gate renders the same renderer in the Android WebView and in Electron, feeds both the same CM5 frame, and compares geometry, copy and visibility.

## User Stories

1. As a desk owner, I want the Personal Agent on my Android phone, so that I can read and continue desk work away from the fixed panel.
2. As a desk owner, I want the Android Personal Agent to look identical to the other Shell Hosts, so that I learn one design.
3. As a desk owner, I want the same composer, identity capsule and conversation as the other hosts, so that my habits carry over.
4. As a desk owner, I want the status panel to show the voice states, so that I recognize recording, transcription and reply.
5. As a desk owner, I want the generated content to come from the CM5 resident, so that one machine owns my personal data.
6. As a desk owner, I want no sample content on the phone, so that everything I read came over the link.
7. As a desk owner, I want an honest unavailable state when the link drops, so that I never trust a stale reply.
8. As a desk owner, I want the phone to name the actual link state, so that I can tell a dropped link from a failed request.
9. As a desk owner, I want to send a text turn from the phone, so that the CM5 resident continues my task.
10. As a desk owner, I want a dropped link to keep my draft, so that I do not retype a request.
11. As a desk owner, I want to install the APK over `adb`, so that installation needs no store account.
12. As a desk owner, I want one APK for Android 8 and newer versions, so that both of my devices accept it.
13. As a desk owner, I want the phone layout to use the existing compact rules, so that narrow widths stay readable.
14. As a desk owner, I want a CM5 development frame source, so that I can review every design state on the device without a service accident.
15. As a desk owner, I want that source marked as development, so that no fixture reads as personal activity.
16. As a desk owner, I want my Agent name and icon to survive a restart, so that the phone keeps my identity.
17. As a desk owner, I want touch input to work on the phone, so that I need no keyboard.
18. As a desk owner, I want the microphone control to state the real outcome, so that no recording is reported as delivered.
19. As a desk owner, I want to control which phone may read my desk, so that a lost handset cannot read my conversation.
20. As a maintainer, I want one renderer source, so that an Android fix never forks the design.
21. As a maintainer, I want the build to stage renderer output, so that no renderer copy enters version control.
22. As a maintainer, I want a consistency gate, so that a renderer change which breaks Android fails a check.
23. As a maintainer, I want the host to implement the same bridge contract, so that renderer code needs no Android branch.
24. As a maintainer, I want the link frame contract owned once, so that two implementations of it cannot drift.
25. As a maintainer, I want the shared link fixtures to run against both ends, so that a frame change fails a check on either side.
26. As a maintainer, I want Android acceptance separate from Electron acceptance, so that one host pass never implies the other.
27. As a maintainer, I want a pinned toolchain, so that a build is reproducible.
28. As a maintainer, I want the host documented in a runbook, so that another engineer can build and install it.
29. As a maintainer, I want the decision recorded as ADR-0037, so that the boundary is discoverable.
30. As a maintainer, I want the phone to read the desk without a new inbound port on the desk, so that the desk keeps its current exposure.
31. As a maintainer, I want report and control credentials to stay separate, so that a read grant never becomes a control grant.
32. As a reviewer, I want one screenshot per state, so that I can compare both hosts without a device.
33. As a reviewer, I want the tested WebView version recorded, so that an old engine cannot pass as proof.

## Scenarios

The executable scenarios live in [android-host.feature](../../runtime/shell/tests/features/android-host.feature). That file is their only owner, so a scenario cannot drift between this spec and the test corpus. It covers the link, the host, the design states, the engine baseline, the frames and the acceptance boundary. The development source's fixture and the parity script are named in the Implementation Decisions below.

## Implementation Decisions

- A new `runtime/android/` host holds the Android application. It contains Android-only host code, build files and assets. No other directory moves.
- The host is Kotlin on the Android Gradle plugin. Gradle, the plugin and Kotlin versions are pinned in a version catalog.
- The renderer is never copied into version control. A Gradle task stages `src/renderer/**` and `src/plugin-host.js` from `runtime/shell/`. It also stages the two libraries the Shell document loads from the Shell's own dependency install: `node_modules/markdown-it/dist/browser/markdown-it.umd.min.js` and `node_modules/@highlightjs/cdn-assets/highlight.min.js`. The staged layout mirrors the Shell root, so `web` holds `src` and `node_modules` sits beside it. A relative path in the document then resolves here exactly as it does on the other hosts.
- The staging excludes `renderer/themes/liquid-glass-sdk.js`. The Shell generates that bundle at build time and never commits it, so excluding it keeps the staged tree equal to what a fresh checkout holds. `runtime/android/scripts/check-staged-renderer.mjs` compares the staged tree with `runtime/shell/src` and ignores that one generated path for the same reason.
- The task fails with an explicit message when the renderer styles or those libraries are absent. `pnpm install` and `pnpm styles` in `runtime/shell` are therefore a named precondition, not a silent partial stage.
- Asset serving uses the WebView asset loader on an `https` origin. The renderer keeps `'self'` in its content security policy, and `localStorage` keeps a stable origin.
- The host injects an asynchronous message shim into the served document. The shim forwards typed text and the exact optional reply reference. CM5 owns generation, history and reply identity. Suggestion actions remain unavailable.
- The host uses an asynchronous AndroidX WebMessageListener on the exact asset origin. Native code admits only the current Shell main frame. Status and reply callbacks also check the document epoch. External main-page resources are refused.
- The status frame contract does not change. The link carries the fields the renderer reads: `state`, `transcript`, `message`, `notifications`, `agents`, `remote`, `briefing` and `proposalError`.
- Data flows over Open DeskOS Link. The Android app is one more link client. It dials the desk at port 8765 and the desk authenticates a per-link token provisioned out of band, which is the pattern ADR-0006 already accepts. The desk opens no new inbound port, and Android opens no listener.
- The desk side gains one Personal Agent frame kind on the existing link service. The desk assembles that frame from the resident Personal Bot client it already runs, so no second source of truth appears.
- Report and control authority stay separate, per ADR-0013. A report token reads the conversation. A control token may submit an owner turn. The desk refuses a turn presented with a report token, and the phone states the unconfirmed outcome.
- A development frame source lives on CM5, beside the desk. It publishes the Personal Agent states the resident cannot produce on demand, including recording, transcription failure, error, remote coverage and held updates. It runs only under an explicit development selection (`ODK_LINK_PERSONAL_AGENT_DRIVER` names the shared fixture, `ODK_LINK_PERSONAL_AGENT_SELECTED` names the chosen state), its frames carry a development marker on the link record, and the phone shows that marker as its own chrome. Android carries no fixture, so every frame on the device came over the link.
- Android declares text-only input. The microphone stays disabled and states its unavailable condition. No microphone permission, audio capture or transcription upload is added.
- The bridge is verified through the renderer, so the feature adds no renderer seam.
- One universal APK covers arm64-v8a and x86_64, because the host ships no native library. `minSdk` is 26, and `compileSdk`/`targetSdk` are 34.
- The link frame contract has one owner document and one fixture corpus. The desk side tests conformance in Node, and the Android side tests conformance in Kotlin unit tests. A changed frame fails one of them.
- Verification enables WebView remote debugging. A Node harness forwards the WebView devtools socket over `adb` and evaluates the shared assertion script through the Chrome DevTools Protocol. That is the Android equivalent of the Electron harness reading the DOM through `webContents.executeJavaScript`.
- One shared assertion script expresses the parity checks. Both hosts execute it while both receive one desk frame. The script lives with the existing test fixtures.
- The gate pins four things, because a reading must differ only where the design differs: the layout viewport, the theme, the scrollbar metric and a settled document. A desktop host reserves a classic scrollbar gutter and Android draws an overlay one, so a scroll container gives the phone about 15 px more content width. Message geometry is compared in the conversation's content coordinates, where the flush edge and the width of a content-sized bubble carry the design meaning.
- The gate records the engine each host rendered with and fails when the Android engine predates Chrome 111, so an old WebView cannot pass as proof of the design.
- The gate sets the device display to the compared size before it starts the app. Changing the viewport after the Shell booted re-composes the page, which the Electron reference never does.
- The reference test device is the redroid Android 14 image with WebView 125. The Sony SO-02J remains the arm64 install target; its Chrome 67 system WebView does not prove presentation.
- Build output, staged assets and the Gradle cache stay out of version control.
- `runtime/shell/docs/ANDROID_HOST.md` owns build, install and verification steps. `runtime/shell/docs/ODK_LINK.md` owns the added frame. ADR-0037 and the Shell Host term record the boundary.

## Testing Decisions

- A good test drives the public renderer boundary, states observable behavior, and reads no private renderer state.
- Selected seam: the renderer-in-host seam, and only that seam. Both hosts load the same Shell document, receive the same desk frame through their own link client, and answer the same assertion script.
- The link contract is checked at its two ends by one fixture corpus. This is a contract check on an existing protocol boundary, not a second renderer seam.
- Prior art: `tests/agent-home.cjs`, `tests/personal-bot-status.cjs` and `tests/personal-bot-floating-panel.cjs` drive the renderer in a host and assert geometry; `tests/responsive-matrix.cjs` fixes the compared viewports; `tests/helpers/` owns shared fixture modules; `tests/features/*.feature` owns the Gherkin corpus; `runtime/shell/tests/` covers the desk link service.
- New checks: the per-state parity run against the Android WebView at both phone viewports, a device composition check that reaches an honest unavailable state with the desk unreachable, a staged-asset check that no renderer file under Android differs from the shared source, a link conformance run at both ends, and a control refusal for a report token.
- Device verification found three host defects that no host-side check could: a JavaScript interface resolves a method by name and arity, so `status` never answered and the renderer fell back to unavailable; the native side passes a receipt as an object literal, which the shim parsed as JSON text and abandoned before it resolved; and a link that went live before the document booted lost its first frame. The runbook now names all three under its verification steps.
- The shared assertion script is the regression guard. When a renderer change breaks a checked state, the Android run fails and the Electron run keeps passing.
- Host checks do not prove device presentation. The acceptance record separates the tested device and its WebView version from other host acceptance.
- Two branches are code-reviewed but not executed by a check. The gate's below-baseline engine branch is one: Chrome 111 is a threshold, and the connected device runs 125. The phone's drop path after a version refusal is the other: it needs a live link. The desk's connected-client surface is covered: `odk-link-personal-agent.test.js` asserts one client, none after close, and that it is not a reporter.

## Out of Scope

- Voice capture on Android: microphone permission, audio capture, transcription upload and Input Level.
- An Android listener or any inbound path on the desk.
- Surfaces other than the Personal Agent page and the Personal Bot status panel.
- Updating the system WebView on any device.
- iOS, Play Store distribution and public release signing.
- Merging Android acceptance into another host's acceptance.
- A hosted Pi session on the phone. The phone reaches the resident Personal Agent only.

## Further Notes

- The CM5 desk is `orangepicm5-tablet` at `10.10.0.152`. Its `open-deskos-desk-link` unit already listens on `10.10.0.152:8765`, so the link is LAN-reachable today. The desk runs one Shell, one resident Personal Bot and six further units, and the record of that deployment is `docs/deployments/2026-10-12-cm5-deployment-state.md`.
- The Sony SO-02J (`BH9075T25U`) runs Android 8.0 (API 26) on arm64-v8a with a 720x1280 display at 320 dpi, which is a 360x640 density-independent viewport. Its system WebView is Chrome 67 (2018). The shared renderer uses optional chaining, `Object.hasOwn` and CSS `:has()`, so that device cannot render the design faithfully until its WebView updates. That update is a separate device change and needs explicit authorization. The phone reaches the desk on wlan0 at `10.10.0.175`.
- The redroid image at `10.10.0.195:5555` runs Android 14 (API 34) on x86_64 with WebView 125 and a 480x853 density-independent viewport. It is the fidelity target for this work. It reaches the desk from its container address `172.17.0.2`.
- The third adb target, `10.10.0.152:5555`, is the CM5 host itself with an adbd on port 5555. Its shell is Linux, not Android. It is not a phone and not a render target.
- The renderer already carries compact rules for narrow widths, including breakpoints below 380 px and a portrait rule. No Android-specific stylesheet is expected.
- Token provisioning stays out of band, per ADR-0006. For development, provisioning copies a token to the app through `adb` and through an on-device entry that is host chrome rather than renderer chrome.
- The decision record is ADR-0037 in `runtime/shell/docs/ARCHITECTURE.md`.
- Third deviation, recorded here because the first scenario over-promised: a dropped link states the unavailable condition in the Agent capsule and keeps the conversation the desk already sent. The renderer draws no per-message stale mark, and adding one would change every Shell Host for a state only a phone reaches. Reading the retained conversation together with the capsule is what this host offers, and the composition check pins the honest path.
