# Android host runbook

Android runs the shared Shell renderer in a system WebView. It is another Shell Host, not a fork. The build stages the renderer from `runtime/shell/src`. The APK carries no copy of it. [ADR-0037](ARCHITECTURE.md#adr-0037) owns the decision, and [ODK_LINK](ODK_LINK.md#personal-agent-link) owns the link the phone reads.

The desk owns generation. The phone holds no generator and no fixture, so every word the Personal Agent shows came from the desk.

## Toolchain

| Piece | Version | Location |
| --- | --- | --- |
| JDK | Temurin 17.0.20.1 | `$HOME/.local/share/jdks/temurin-17` |
| Android SDK | platform 34, build-tools 34.0.0, platform-tools 37.0.1 | `/opt/homebrew/share/android-commandlinetools` |
| Gradle | 9.8.1 (wrapper) | `runtime/android` |
| Android Gradle plugin | 9.4.1 | `runtime/android/gradle/libs.versions.toml` |

AGP 9 supplies Kotlin: it brings `kotlin-gradle-plugin` 2.2.10. Do not apply a Kotlin plugin, and do not add a Kotlin version to the catalog.

Export both paths before a build:

```sh
export JAVA_HOME="$HOME/.local/share/jdks/temurin-17/Contents/Home"
```

`runtime/android/local.properties` names the SDK. Do not commit it.

## Build

1. Run `pnpm install` in `runtime/shell` once. The shell document loads markdown-it and highlight.js from that install.
2. Run `pnpm styles` in `runtime/shell` after a renderer style change. The committed `uno.css` is otherwise current.
3. Run `./gradlew assembleDebug` in `runtime/android`.

The `stageRenderer` task copies `runtime/shell/src/renderer/**`, `runtime/shell/src/plugin-host.js`, and the two libraries into a generated asset tree. The tree mirrors the Shell root: `web` holds `src`, and `node_modules` sits beside it. Nothing lands in version control. The staging excludes `renderer/themes/liquid-glass-sdk.js`, which the Shell generates at build time. The task fails with an explicit message when a precondition is missing.

## Provision the phone

Provisioning is out of band, as [ADR-0006](ARCHITECTURE.md#adr-0006) requires. The phone holds its own copy of the link configuration in its private files directory.

1. Write `odk-link.json`:

```json
{"host":"<desk lan address>","port":8765,"reportToken":"<report token>","controlCredential":"<control credential>"}
```

2. Push it, then copy it into the app's private storage:

```sh
adb -s <serial> push odk-link.json /data/local/tmp/odk-link.json
adb -s <serial> shell "run-as com.odk.shell sh -c 'cat /data/local/tmp/odk-link.json > files/odk-link.json'"
```

The report token reads the Personal Agent. The control credential is separate and optional; without it the phone reads the desk and refuses to submit. `run-as` needs a debug or a debuggable build.

Without a configuration file the phone reports `Personal Bot link unavailable`. It dials the desk itself, so the desk gains no inbound port and the phone opens no listener.

## Install and run

```sh
adb -s <serial> install -r app/build/outputs/apk/debug/app-debug.apk
adb -s <serial> shell am start -n com.odk.shell/.ShellActivity
```

One APK serves arm64-v8a and x86_64: the host ships no native library. `minSdk` is 26.

A debug build enables WebView remote debugging. Verification reads the rendered document through the Chrome DevTools Protocol over `adb forward`. That is the Android equivalent of the Electron harness reading the DOM through `webContents.executeJavaScript`.

## Host bridge

The renderer reads `window.odkPersonalBot` against the promise-returning contract Electron's preload exposes. A WebView JavaScript interface answers inside the calling task. Every other host's bridge answers later. The host therefore injects a small shim into the served document. Electron injects its preload the same way. The staged renderer file is never modified.

The shim answers on a later task, as every other host's bridge does. A frame that arrives before the document finishes booting is delivered when the page finishes loading.

`odkPersonalBot` is backed by the link, and only it is provided in this work. The other bridges stay absent. The renderer then states its own honest unavailable condition, instead of a shape this host invented. `toggle` and `proposalCommand` answer `accepted: false`. Android captures no audio, and the link carries no suggestion response. For `proposalCommand` the renderer draws its own sentence; for `toggle` it draws nothing.

## Development state

The desk marks a frame that its development frame source produced. The phone shows `Development state from the desk` as its own chrome in the corner. The renderer never draws that mark, and a page screenshot cannot contain it.

Select a state on the desk, not on the phone:

```sh
cd runtime/shell
ODK_LINK_TOKEN=<report token> \
ODK_LINK_CONTROL_CREDENTIAL=<control credential> \
ODK_LINK_PERSONAL_AGENT_DRIVER=$PWD/tests/fixtures/personal-agent-v1.json \
ODK_LINK_PERSONAL_AGENT_SELECTED=/tmp/odk-dev/selected \
ODK_LINK_SOCKET=/tmp/odk-dev/service.sock \
node scripts/odk-link-service.js
```

The socket directory must be owner-only. Write a fixture key into the selection file, for example `idle-reply`, and the desk publishes it within about 500 ms.

## Verification

Run the unit tests:

```sh
cd runtime/android && ./gradlew :app:testDebugUnitTest
```

They read the shared fixture `runtime/shell/tests/fixtures/personal-agent-v1.json`, so a desk contract change fails on the phone.

Run the parity gate:

```sh
cd runtime/shell && pnpm parity:android -- --viewport=redroid --device=<serial>
cd runtime/shell && pnpm parity:android -- --viewport=sony --device=<serial>
```

The gate renders one state per host and compares geometry, copy and visibility. It pins the layout viewport, the theme, the scrollbar metric and a settled document, so a reading differs only where the design differs. It writes one screenshot per host and state, and a report, under `/tmp/odk-parity`. The report names the engine of each host, and the run fails when the Android engine predates Chrome 111.

The gate sets the device display to the compared size before it starts the app. A viewport change after the Shell booted would re-compose the page, which the Electron reference never does. The gate resets the display afterwards.

Run the composition check:

```sh
cd runtime/shell && pnpm composition:android -- --device=<serial>
```

It points the phone at a closed port, so the desk cannot answer. It asserts that composition completes, that the Agent states the unavailable condition, and that the host shows no message and no notification. It restores the provisioned configuration afterwards.

Prove the APK carries the shared renderer:

```sh
cd runtime/android && node scripts/check-staged-renderer.mjs
```

It compares the staged asset tree with `runtime/shell/src`. It fails on any difference, any missing file, and any staged file the shared renderer does not have.

The two device gates need a connected phone, so they are not part of `pnpm geometry`. Run them with the script names above.

## Device limits

- The reference test device is the redroid Android 14 image at `10.10.0.195:5555` with WebView 125. It is the fidelity target.
- The Sony SO-02J at `BH9075T25U` runs Android 8.0 (API 26) with Chrome 67 as its system WebView. That engine predates optional chaining, `Object.hasOwn` and CSS `:has()`, so the design does not render there. Installing the APK on that device proves installation only. Upgrading its WebView is a separate device change.
- The phone reads a desk that carries the Personal Agent link. A desk on an older revision refuses the token or closes the link. Deploy the desk revision before you expect phone data.
- Android draws overlay scrollbars and a desktop host reserves a classic scrollbar gutter. The compact layout's scroll containers therefore give the phone about 15 px more content width. The gate accounts for that metric; it is not a renderer difference.
- Hover and pointer media features differ by nature. The renderer uses them for hover affordances only, and no geometry depends on them.

## Not covered

- Voice capture. The microphone control reports the outcome it received and this host captures no audio.
- Live desk verification on CM5. Deployment and activation need separate authorization.
- Frame delivery to a Sony device, which its system WebView cannot render.