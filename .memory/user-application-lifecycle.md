# User application lifecycle

## Decision
Open DeskOS supports a local user-application lifecycle distinct from trusted built-in plugins. A user package is a self-contained `manifest.json` plus `index.html` draft under `ODESK_WORKSPACE/apps/<id>`, with `kind` `widget` or `app`. The Shell snapshots exact bytes, validates them, renders a candidate in a bounded verifier, and publishes only verified revisions to its installed catalog.

## Why
Users explicitly need generated Widgets/Apps without mutating `index.html`, built-in layout, plugin registry, or rebuilding the Shell release. Independent snapshots enable update, rollback, and removal while preserving the prior installed version when verification fails. Keeping packages local, opaque-origin, sandboxed, and self-contained bounds authority without claiming a marketplace or general untrusted-code platform.

## Limits
Packages have no network, filesystem, Node, preload, parent DOM, native dependency, install script, persistent per-app data, background service, or live CPU/memory quota. Widgets are display-only; Apps are interactive in their isolated frame. Built-in plugins remain trusted static runtime code and use the lifecycle in `docs/AI_PLUGIN_GUIDE.md`; user packages use `docs/USER_APPLICATIONS.md` and ADR 0003.

## Related
- `runtime/linux/docs/USER_APPLICATIONS.md`
- `runtime/linux/docs/adr/0003-user-application-lifecycle.md`
- `runtime/linux/docs/AI_PLUGIN_GUIDE.md`
- `PRODUCT.md`
- `runtime/linux/PRODUCT.md`

Hardware deployment and CM5 acceptance remain separate from this software lifecycle decision.
