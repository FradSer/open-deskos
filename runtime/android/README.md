# Android Shell Host

Android runs the shared Shell renderer in a system WebView. It is another Shell Host, not a fork: the build stages the renderer from `runtime/shell/src` and the APK carries no Android copy of it.

Build, install, verification steps and device limits live in [the Android host runbook](../shell/docs/ANDROID_HOST.md).

The engine baseline is a modern Chromium WebView. `minSdk` is 26.

`ShellActivity` also answers the HOME intent, so an operator can select the Shell as the device's default Home app in system Home Settings. The declaration grants no extra authority, and a HOME start keeps a host-owned control that reopens Home Settings. See [ADR-0037](../shell/docs/ARCHITECTURE.md#adr-0037) and the [Android host runbook](../shell/docs/ANDROID_HOST.md#default-home-app).
