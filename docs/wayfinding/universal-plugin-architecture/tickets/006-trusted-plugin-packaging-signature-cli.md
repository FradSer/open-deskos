# Ticket: Trusted Plugin Packaging, Signature & CLI Management Tooling

**ID**: `006-trusted-plugin-packaging-signature-cli`  
**Type**: `wayfinder:grilling` (HITL)  
**Parent Map**: [Universal Plugin Architecture Map](../MAP.md)  
**Status**: Closed (Resolved)  
**Assignee**: Agent / FradSer  
**Resolution Date**: 2026-08-31  

## Question

How should the plugin management CLI (`open-deskos plugin add / validate / enable / disable / list / diagnose / update`) operate on system and user directories (`~/.config/open-deskos/plugins/`), enforce local signature/checksum verification and user consent, generate diagnostics, and support dev-mode hot-reload without introducing unsandboxed remote execution risks?

## Resolution & Specification

### 1. Directory Structure & Precedence Hierarchy

The CM5 Host Kernel discovers plugins from three well-defined scopes with strict precedence:

```text
1. Development Link Scope:
   ~/.config/open-deskos/plugins.dev/      (Highest: local symlinks created via `open-deskos plugin link`)

2. User-Installed Scope:
   ~/.config/open-deskos/plugins/          (User-installed plugins; must pass consent / signature check)

3. System Shipped Scope:
   /opt/open-deskos/runtime/plugins/       (Lowest: immutable first-party plugins verified with Release Key)
```

Configuration and enabled states are persisted centrally in `~/.config/open-deskos/plugins.json`:

```json
{
  "version": 1,
  "plugins": {
    "odk.tile.pomodoro": { "enabled": true, "config": { "duration": 1500 } },
    "odk.transport.usb-cdc": { "enabled": true },
    "user.custom.stock-ticker": { "enabled": true, "trustAcknowledgedAt": 1756627200000 }
  }
}
```

### 2. CLI Tooling Architecture (`open-deskos plugin`)

The CLI exposes the following comprehensive suite:

| Command | Description |
|---|---|
| `open-deskos plugin list` | Lists all discovered plugins across system, user, and dev scopes with status & permissions. |
| `open-deskos plugin validate <path>` | Checks `manifest.json` against Schema v1, validates entrypoints, dependency DAG, and config schema. |
| `open-deskos plugin add <git-url | path>` | Clones/copies plugin to user directory, outputs permission audit summary, and requires explicit user consent (`y/N`). |
| `open-deskos plugin remove <id>` | Safely unmounts and removes user plugin directory. |
| `open-deskos plugin link <path>` | Symlinks local development directory to `plugins.dev/` for live iteration. |
| `open-deskos plugin enable <id>` | Enables plugin in `plugins.json` and triggers hot-activation if shell is running. |
| `open-deskos plugin disable <id>` | Disables plugin, halts lifecycle tasks, and restores fallback degradation card. |
| `open-deskos plugin diagnose [id]` | Runs health checks, outputs DAG topological sort, and dumps active port bindings. |
| `open-deskos plugin update [id]` | Fast-forward pulls git-managed plugins, validates manifest diffs, and reloads. |

### 3. Security Model & Trust Boundaries

1. **Release Key Signature Verification**:
   System plugins carry cryptographic signatures (`distribution.signature`) signed with the Open DeskOS Release Key and verified against `/etc/open-deskos/keyring.pub`.
2. **Explicit Interactive Consent**:
   When installing third-party or unsigned plugins, the CLI inspects `manifest.json` and prompts:
   ```text
   Plugin "user.weather-station" requests the following permissions:
     - network:http:external (api.openweathermap.org)
     - ui:surface:tile
   Do you trust and wish to install this plugin? [y/N]:
   ```
3. **Preload IPC Isolation**:
   Preload contextBridge validates requested actions against the plugin's declared `permissions` before executing IPC calls.

### 4. Development-Mode Hot-Reload

- In development mode (`NODE_ENV=development` or `--dev`), the Host Kernel attaches `fs.watch` to `plugins.dev/` and `src/renderer/plugins/`.
- On change, it triggers `deactivate()` on the affected plugin, clears the ES Module cache, dynamically re-imports the updated file, and runs `activate()`, updating the live screen in < 200ms without restarting Electron.
