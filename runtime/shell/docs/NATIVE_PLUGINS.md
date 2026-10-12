# Native plugin revision storage

## Current scope

[The native store](../src/native-plugin-store.js) stages signed Shell bundles without selecting or executing their entries.
The store supports existing Main and Renderer development declaration contracts.
[The selection manager](../src/native-plugin-manager.js) records authorized installation, update, rollback, and removal selections.
Main startup loads selected signed CommonJS modules from captured verified bytes.
Renderer startup loads selected signed surface entries and assets from captured verified bytes.
Appearance startup loads selected signed factories or palette declarations.
Installed desktop composition also supports a signed Renderer system factory through its [separate contract](INSTALLED_DESKTOP_PLUGIN_CONTRACT.md).
Complete module compatibility, replacement parity, and supported-device acceptance remain unfinished.
Installed HTML packages retain their separate [package contract](USER_APPLICATIONS.md).
Native signatures do not provide a sandbox or grant capabilities.

## Signed bundle

A bundle directory contains `bundle.json`, `manifest.json`, and every declared entry or asset.
The descriptor has exactly these fields:

| Field | Contract |
| --- | --- |
| `schemaVersion` | Integer `1` |
| `keyId` | Explicit publisher key identifier |
| `replace` | Boolean replacement selection declaration |
| `files` | Sorted array of `{ path, sha256 }` file records |
| `signature` | Base64 Ed25519 signature |

The signature payload starts with the exact UTF-8 prefix `Open DeskOS native bundle v1\n`.
The prefix ends with one newline byte.
Append compact JSON with fields in this order: `schemaVersion`, `keyId`, `replace`, `files`.
Preserve each file record's property order during serialization.
The revision identifier is the full SHA-256 digest of this payload.
[Node crypto](https://nodejs.org/api/crypto.html#cryptoverifyalgorithm-data-key-signature-callback) supplies signature verification.

The caller supplies an explicit keyring with public keys, authorized identities, and authorized hosts.
Package content cannot add a trusted key or authorize its own identity.
Every signed file must appear in the inventory.
Only directories required by signed paths can appear.
Paths must remain relative and portable across supported Shell hosts.
Links, case collisions, Windows device names, traversal, and unlisted content are rejected.
Limits are 64 files, 4 MiB per file, 16 MiB total, and 16 KiB for each descriptor or manifest.

## Store behavior

`createNativePluginStore({ stateDir, keyring })` requires an absolute state directory and an explicit keyring Map.
`stage(source)` reads verified bytes and copies them into a private staging directory.
The store validates copied declarations before publishing the content-addressed revision directory.
Concurrent writers reuse a complete matching revision.
The store does not rewrite an existing revision.
Failed candidates preserve existing revisions and source files.

`read(revision)` verifies the signature, file hashes, publisher authorization, and declaration again.
Revoked publisher keys prevent later reads.
Mutation between verification and declaration validation causes failure.
Returned entry paths identify local files; they do not guarantee execution integrity.
`snapshot(revision)` also returns captured verified file bytes.
The startup loaders execute those captured bytes instead of rereading entry paths.
This store does not establish native Windows, CM5, or deployed-host acceptance.

## Selection management

`createNativePluginManager({ store, configPath })` uses the verified store and existing atomic configuration writer.
[Configuration](CONFIGURATION.md#native-revision-selection-records) owns the persisted record format.
`install(source, authorization)` requires `trust: true` and exact grants for every declared permission.
Signed content cannot supply this independent authorization.
Installation refuses identities already owned by native selections or development links.

`update(id, source, authorization)` verifies the current revision and the signed candidate before selection changes.
The candidate retains identity, host, kind, public ports, dependencies, and renderer placement contracts.
Update requires explicit candidate authorization and retains the previous revision's authorization separately.
`rollback(id)` verifies both revisions against current publisher policy and their own grants.
Rollback exchanges the selected and previous records after checking interface compatibility.

Every mutation checks its expected selection under the shared configuration lock.
Conflicting selections fail without overwriting a concurrent writer.
Independent enable preference changes remain intact.
`remove(id)` clears only the native selection and preserves stored revisions, sources, and unrelated preferences.
`inspect(id)` verifies the selected revision without executing its entry.
These records do not change running factories.
Main startup uses these records when an external publisher policy is configured.

## Main startup

Set `OPEN_DESKOS_NATIVE_KEYRING` to the external publisher policy file.
The [Main loader](../src/native-plugin-loader.js) uses the same Host state directory as the Native CLI.
Startup checks the current signature, publisher policy, identity, replacement declaration, trust record, and exact capability grants.
Disabled selections do not load code.
Rejected selections leave the default composition available.
Main checks dependencies before it executes factories.
Factory failures use the existing Host failure behavior; they do not automatically select another implementation.
Quitting during discovery prevents factory startup.
Smoke mode excludes native selections.

The loader captures signed entry bytes and relative module bytes before execution.
Later file changes cannot alter these captured module inputs.
Supported local inputs are CommonJS `.js`, `.cjs`, and JSON modules.
Relative imports support extension resolution, directory entry points, and circular dependencies.
Bare imports use Shell runtime dependencies.
The injected `require` does not provide the complete Node module API.
ES modules, native addons, dynamic imports, and package-local bare dependencies need separate compatibility work.
Trusted native code retains full process authority and can access external files directly.
Captured module integrity does not provide a sandbox or verify external file access.

Main uses the existing factory lifecycle and reading validation wrapper.
Native reading namespaces cannot overlap selected native or development namespaces.
Appearance selections use the separate startup path below.

## Renderer startup

Renderer surface selections use the same external publisher policy, trust record, and exact grant checks as Main selections.
Main captures selected signed browser entries and assets before Renderer startup.
Known Shell main frames receive entry declarations and asset URLs through the existing authenticated discovery channel.
Native and development selections share the 32-entry startup limit.
Captured Renderer assets have a 64 MiB memory limit.

The `odk-native-plugin` protocol serves captured bytes through temporary authority URLs.
Requests do not read stored files.
Unknown routes, metadata, unsupported asset types, and mutation methods have no successful response.
Supported assets include JavaScript, CSS, JSON, images, and fonts.
The Shell permits connections only to this signed asset protocol.
Installed HTML packages retain their separate connection restrictions.
Native browser entries remain trusted Shell code; this protocol does not provide a sandbox.

The existing Renderer loader checks replacement declarations before loading entries.
Each entry follows the [browser definition contract](AI_PLUGIN_GUIDE.md#trusted-replacement-composition).
Installed desktop system entries follow their separate definition contract; they do not register as Renderer surfaces.
Actual definitions receive another contract check before factory execution.
Cross-origin error reporting makes failed signed scripts reject their selections.
Rejected entries leave the default composition and temporary styles unapplied.
Selected CSS resolves relative assets within the captured bundle.
External network assets remain blocked.
The existing surface lifecycle owns factory resources, mounted elements, and cleanup.

The discovery plugin owns a protocol lease that supports disable and enable operations.
Its cleanup removes the protocol handler and releases the lease.
Selected source snapshots remain available for re-enable until Shell shutdown.
Shell shutdown releases the selected source snapshots.
`window.odkShellReady` resolves after Renderer loading and Shell composition complete.
It rejects when Shell composition fails.

These checks do not establish runtime replacement loading, complete replacement parity, or supported-device acceptance.

## Appearance startup

Signed Appearance selections use the same publisher policy, independent trust record, exact grants, and captured asset protocol.
A declaration without `entry` selects palette data through the existing declaration validator.
A factory declaration adds a relative JavaScript `entry` and retains the complete packaged Appearance context.
This context includes identity, theme, tokens, fonts, stylesheet, and additional style data.
Factory declarations cannot change that context or use the palette-only exception.

Each signed entry calls `window.odkAppearanceNative.define({ id, appearance, create })` once for its selected identity.
The loader validates declarations before script execution and validates actual definitions before factory execution.
The Appearance Host compares actual port data before and after startup.
The factory owns start, stop, destroy, and scoped cleanup through the existing Host lifecycle.

The synchronous preview preserves the first theme before body content.
`window.odkTheme.ready` waits for signed factory loading and Appearance startup.
Shell composition waits for this promise before reporting `window.odkShellReady`.
Rejected entries retain packaged factories and saved preferences.
Invalid factory ports release owned resources and leave independent themes available through existing fallback behavior.
Disabled selections execute no external Appearance entry.
Page shutdown cancels script loading and prevents late factory startup.
Native revision changes select the next startup implementation; runtime commands only enable or disable the selected factory.

Local checks cover captured entry mutation, failed entries, invalid ports, lifecycle cleanup, and three-theme Clock geometry comparisons.
These checks do not establish installed-package interaction, arbitrary theme replacements, physical input, or supported-device acceptance.

## Native CLI

The Plugin CLI has a separate `native` command group.
Use `native install <path>` or `native update <id> <path>` with `--keyring <file>` and `--trust`.
Supply one `--grant <capability>` argument for each declared permission.
Use `native inspect <id>`, `native list`, or `native rollback <id>` with `--keyring <file>`.
Use `native remove <id>` to clear a selection without removing its stored revisions.
Removal does not require publisher verification, so revoked or corrupt revisions can remain unselected.
Commands store revisions under `plugins/native` in the resolved Host state directory.
Mutation results report `effect: selection-only`.
These commands do not execute entries or change running factories.
The separate `activate <id> --runtime` command applies a saved signed selection to an existing Main plugin, Renderer surface, or Appearance factory.
[Main activation](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-main-activation) and [Renderer activation](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-renderer-activation) own authorization, lifecycle, receipts, and acceptance limits.
Use `restore-default <id> --runtime` to select a captured built-in Main implementation or Renderer surface without changing saved selections.
[Main restoration](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-main-restoration) and [Renderer restoration](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-renderer-restoration) own their recovery and dependency contracts.
The ordinary installed HTML package commands retain their existing meanings.

List results use `verified` for valid selections and `unavailable` for failed verification.
A failed selection causes a nonzero exit status without hiding independent verified selections.
These states describe stored selection verification, not runtime lifecycle or feature health.

## Publisher policy file

The CLI requires an explicit local public keyring file rather than discovering keys inside a package.
The file has `schemaVersion: 1` and a `publishers` object keyed by publisher identifiers.
Each publisher record contains only `publicKey`, `identities`, and `hosts`.
The public key must be an Ed25519 SPKI PEM public key.
Identities contain distinct exact plugin identifiers; hosts contain distinct supported Shell host names.
The file permits 16 publishers and 64 identities per publisher within 64 KiB.
Private keys, file links, malformed records, and unsupported hosts are rejected.
An empty publisher set can represent complete revocation.
Policy errors do not print the supplied JSON content.
The caller must provision the policy independently of package signatures and grant authorization.
