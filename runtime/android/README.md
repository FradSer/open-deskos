# Android Shell Host

Android runs the shared Shell renderer in a system WebView. It is another Shell Host, not a fork: the build stages the renderer from `runtime/shell/src` and the APK carries no Android copy of it.

Build, install, verification steps and device limits live in [the Android host runbook](../shell/docs/ANDROID_HOST.md).

The engine baseline is a modern Chromium WebView. `minSdk` is 26.
