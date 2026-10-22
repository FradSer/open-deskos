# Configuration inventory

This file lists environment variables read by the Shell and integrations. Update it when you add or change a variable. `tests/config-inventory.test.js` checks names and consumer paths.

## Layers and rules

| Layer | Values | Source |
| --- | --- | --- |
| L2 install | Release defaults, unit templates and updater transaction paths | Release templates and install scripts |
| L3 device | Host paths, endpoints and credentials that a release cannot select | Host environment/JSON files, mode `0600` |
| Test | Overrides used only by tests | Test process environment |

- The resource owner declares its port or socket. Clients read that declaration or the published endpoint. The STT bridge declares `ODK_STT_PORT`; the bot derives its loopback endpoint.
- The Hosted Pi daemon checks project admission once. Clients reject invalid transport paths; they do not copy the daemon root policy.
- Do not copy release defaults into device files. Remove a setting that only repeats the code default.
- Installers generate personal-bot, pi-tasks, remote-bridge and odk-link units from release templates.
- Use one source per setting. Keep permanent settings in environment files. A temporary systemd drop-in overrides `EnvironmentFile=`; remove it after use.
- Use `ODK_` for new variables. Keep existing `ODK_` names unchanged.

## Inventory

A `sensitive` value is a credential or credential path. Keep it in a mode-`0600` file. Do not put it in units, source or logs. Consumers are repository-relative paths. External tools run outside the bundled runtime.

| Variable | Layer | Owner | Consumer | Default | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ALIYUNCS_TOKEN` | L3 device (sensitive) | personal-bot.env | integrations/personal-bot/src/transcribe.mjs | — | DashScope bearer credential. Only the aliyun provider reads it. OpenAI uses ODK_PERSONAL_BOT_STT_KEY_FILE. |
| `DISPLAY` | Environment | Graphical session | runtime/shell/src/main.js | — | The graphical session imports this value into the user systemd environment. |
| `FUTU_HOST` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 10.10.0.195 | Futu gateway address. |
| `FUTU_INTERVAL` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 60 | Poll interval in seconds. |
| `FUTU_PORT` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 11111 | Futu gateway port. |
| `FUTU_RSA_FILE` | External tool (sensitive) | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | — | Path to the gateway RSA private key copy. |
| `FUTU_TRADE_PWD` | External tool (sensitive) | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | — | Trade unlock password. |
| `ODK_CHANNEL_TOKEN_FILE` | L3 device (sensitive) | Plugin and Personal Bot clients | integrations/futu-poller/poller.py, integrations/personal-bot/src/runtime-channel.mjs | — | Read-only client token file for TCP or named-pipe channels. The bot uses it for app control and Open DeskOS Data. Unix socket ownership supplies authentication without a token. |
| `HOME` | Environment | Login session | runtime/shell/src/opencode-go.js, runtime/shell/src/plugin-config.js | — | Find host configuration and credentials. |
| `LIBGL_ALWAYS_SOFTWARE` | Environment | Operator | runtime/shell/src/main.js | — | Force software rendering for diagnosis. |
| `ODK_AGENT_BROWSER_PROBE_TIMEOUT` | L2 install | Installer override | runtime/shell/scripts/cm5-agent-browser.sh | 120 | Deadline in seconds for each browser verification command. |
| `ODK_AGENT_BROWSER_SHA256` | L2 install | Installer override | runtime/shell/scripts/cm5-agent-browser.sh | Pinned in consumer | SHA-256 digest for the CLI archive. A version override requires its matching reviewed digest. |
| `ODK_AGENT_BROWSER_VERSION` | L2 install | Installer override | runtime/shell/scripts/cm5-agent-browser.sh | 0.39.1 | Pinned CLI release. Change the version and archive digest together. |
| `ODK_CHROME_SHA256` | L2 install | Installer override | runtime/shell/scripts/cm5-agent-browser.sh | Pinned in consumer | SHA-256 digest for the browser archive. A version override requires its matching reviewed digest. |
| `ODK_CHROME_VERSION` | L2 install | Installer override | runtime/shell/scripts/cm5-agent-browser.sh | 155.0.8059.79 | Pinned Chrome for Testing release. Change the version and archive digest together. |
| `LOCALAPPDATA` | Environment | Windows user session | runtime/shell/src/platform/index.js | — | Windows persistent state root. If absent, use AppData/Local under the user directory. |
| `ODK_APPS_CONTROL_SOCKET` | Test | Test process | integrations/personal-bot/src/apps-control.mjs | Host app control socket (Windows: `\\.\pipe\odk-user-app-control`) | Test override only. Production uses the host endpoint. A missing Unix runtime directory makes the channel unavailable; do not guess a path. |
| `ODK_CAMERA_DEVICE` | L3 device | Operator | runtime/shell/src/camera-source.js | — | Camera device override. |
| `ODK_DATA_SOCKET` | Test | Test process | integrations/personal-bot/src/odk-data.mjs | Host Open DeskOS Data socket (Windows: `\\.\pipe\odk-data`) | Test override only. Production uses the host endpoint. A missing Unix runtime directory makes Open DeskOS Data unavailable; do not guess a listener path. |
| `ODK_LINK_SOCKET` | Internal | Shell | runtime/shell/src/odk-link-client.js | Host Open DeskOS Link socket | Shell client override for the local Open DeskOS Link socket. |
| `ODK_DISABLED_PLUGINS` | L3 device | Operator | runtime/shell/src/main.js | — | Additional disabled plugin IDs. Saved enable preferences cannot override this list. |
| `ODK_DISABLE_GPU` | L3 device | Operator | runtime/shell/src/main.js | — | Disable GPU acceleration. |
| `ODK_FUTU_SOCKET` | L3 device | runtime.env (Listener owner) | runtime/shell/src/plugins/desk-runtime.js, integrations/futu-poller/poller.py | — | Shared absolute socket path for the poller and local Shell. Historical form; ODK_FUTU_ENDPOINT takes priority. |
| `ODK_FUTU_ENDPOINT` | L3 device | runtime.env / `.env.local` (Listener owner) | runtime/shell/src/plugins/desk-runtime.js | — | Service Plugin listener: socket path, named pipe or tcp://host:port. Pipes and TCP require the channel token. The plugin declares remote targets in its own target file. |
| `ODK_FUTU_CONTROL` | L3 device | Optional poller environment | integrations/futu-poller/poller.py | Host default | Python management endpoint. Empty disables management. The [Python guide](../../../integrations/futu-poller/README.md#local-component-plugins) owns defaults and authentication. |
| `ODK_FUTU_PLUGIN_CONFIG` | L3 device | Optional poller environment | integrations/futu-poller/poller.py | — | Optional Python component preference file. No setting is required. CLI paths take priority. |
| `ODK_FUTU_TARGETS_FILE` | L3 device | futu-poller.env | integrations/futu-poller/poller.py | `~/.config/odk/futu-targets.json` | Desk targets with an endpoint and optional token file per entry. If absent, use the single ODK_FUTU_SOCKET endpoint. |
| `ODK_GPU_BACKEND` | L3 device | Operator | runtime/shell/src/main.js | Auto-detect | GPU backend selection. |
| `ODK_PI_REASONING` | L3 device | runtime.env | runtime/shell/src/main.js | Hidden (`hidden`) | Only shown displays reasoning bodies. All other values keep the hidden default. Do not restate that default in host configuration. |
| `ODK_REMOTE_BRIDGE_SOCKET` | Internal | Shell | runtime/shell/src/remote-bridge-client.js | Host Remote Bridge socket | Shell client override for the Remote Bridge socket. |
| `ODK_SHELL_HEIGHT` | Test | Smoke/acceptance | runtime/shell/src/main.js | — | Window height override. |
| `ODK_SHELL_KIOSK` | Test | Acceptance | runtime/shell/src/main.js | — | Kiosk mode switch. |
| `ODK_SHELL_TEST_MODE` | Test | Test process | runtime/shell/src/odk-link-client.js, runtime/shell/src/remote-bridge-client.js | — | Client test mode. |
| `ODK_OVERVIEW_LIVE_OUTPUT` | Test | Explicit live Overview harness | integrations/personal-bot/scripts/test-home-briefing-live.mjs | Private temporary directory | Evidence destination; model requests still require `--run`. |
| `ODK_OVERVIEW_LIVE_DEVICE_ONLY` | Test | Explicit live Overview harness | integrations/personal-bot/scripts/test-home-briefing-live.mjs | Unset | Set `1` to skip synthetic cases and read the configured device sources; requires `--run`. |
| `ODK_SHELL_WIDTH` | Test | Smoke/acceptance | runtime/shell/src/main.js | — | Window width override. |
| `ODK_SKIP_GPU_USERSPACE` | L2 install | Installer override | runtime/shell/scripts/cm5-install.sh | 0 | Skip the Mali userspace install. |
| `ODK_SMOKE_RESULT_FILE` | Test | Smoke run | runtime/shell/src/main.js | — | Smoke result file. |
| `ODK_TAILSCALE_BIN` | L3 device | Operator | runtime/shell/scripts/provision-tailscale.sh | /usr/bin/tailscale | Override a nonstandard Tailscale executable path. Reuse an existing host installation. |
| `ODK_TASK_CONFIG` | L2 install | pi-tasks unit | integrations/personal-bot/src/task-store.mjs | %h/.config/odk/pi-tasks.json | Private Hosted Pi daemon configuration. Only the daemon reads and checks ownership/mode. Clients read its published endpoint descriptor. |
| `ODK_TASK_TARGETS_FILE` | L3 device | Bot environment or drop-in | integrations/personal-bot/src/task-client.mjs | Unset | Personal Bot target list. If absent, report that configuration is required. |
| `ODK_PROACTIVE_CONFIG` | L3 device (sensitive) | personal-bot.env | integrations/personal-bot/src/main.mjs | Unset; no polling | Private owner rules: thresholds, combinations, quiet hours, rate limits and mute state. File mode 0600. See the Personal Bot CONTRACT.md proposal section. |
| `ODK_PERSONAL_BOT_CONFIG` | L3 device (sensitive) | personal-bot.env | integrations/personal-bot/src/personal-config.mjs | coding profile | Private profile, reviewed capability declarations, Skill paths, and fixed plugin selection. |
| `ODK_AGENT_CATALOG_DIR` | CLI | Operator | integrations/personal-bot/src/agent-catalog/cli.mjs | Unset | CLI catalog path. The resident uses its private state directory. |
| `ODK_AGENT_PACKAGE_CANDIDATES` | L3 device | personal-bot.env | integrations/personal-bot/src/agent.mjs | Unset | Private staged package candidates. Required only for candidate inspection and installation. |
| `ODK_AGENT_PLUGIN_TIMEOUT_MS` | L3 device | personal-bot.env | integrations/personal-bot/src/agent.mjs | 90000 | Completion and learning deadline. Accepts 1000 through 180000 milliseconds. |
| `ODK_PERSONAL_BOT_AUDIO_DEVICE` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | default | ALSA capture device. Windows requires the exact DirectShow device name. |
| `ODK_PERSONAL_BOT_CAPABILITIES` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Empty | Paths to trusted capability modules. |
| `ODK_PERSONAL_BOT_MODEL` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | — | Pi provider/id model selection. |
| `ODK_PERSONAL_BOT_STT_KEY_FILE` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Unset | Required only for a nonlocal transcription endpoint. |
| `ODK_PERSONAL_BOT_STT_LANGUAGE` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | zh | Two or three lowercase letters for a language code. |
| `ODK_PERSONAL_BOT_STT_MODEL` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | whisper-1 | The local bridge ignores this value. No setting is required. |
| `ODK_PERSONAL_BOT_STT_PROMPT` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Built-in Chinese context | Maximum 1024 UTF-16 code units. An empty value disables the context. |
| `ODK_PERSONAL_BOT_STT_PROVIDER` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | openai | Declared request shape: openai uses multipart audio; aliyun uses DashScope JSON with inline audio. Never infer the provider from the URL. |
| `ODK_PERSONAL_BOT_STT_URL` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Cloud OpenAI endpoint | Explicit endpoint. If absent, derive a loopback endpoint from ODK_STT_PORT. |
| `ODK_WORKSPACE` | L3 device | runtime.env | runtime/shell/src/main.js, runtime/shell/src/user-app-system.js, integrations/personal-bot/src/main.mjs | — | Writable checkout shared by Shell and Personal Bot. |
| `ODK_ELECTRON_HEADERS_URL` | L2 build | Builder | runtime/shell/scripts/build-native.mjs | https://electronjs.org/headers | Electron header source. Use a mirror if the build host cannot reach GitHub; npm_config_disturl also applies. Set this override for the remote Windows handheld build when required. |
| `ODK_CANDIDATE_RELEASE` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Absolute candidate release path for this activation transaction. |
| `ODK_CLIPROXY_MANAGEMENT_KEY` | L3 device (sensitive) | runtime.env | runtime/shell/src/opencode-go.js | — | Management key value. Prefer the file form. |
| `ODK_CLIPROXY_MANAGEMENT_KEY_FILE` | L3 device | runtime.env | runtime/shell/src/opencode-go.js | — | Management key file path. |
| `ODK_CLIPROXY_URL` | L3 device | runtime.env | runtime/shell/src/opencode-go.js | — | CLIProxyAPI management endpoint. Match the tunnel forwarding port. |
| `ODK_CM5_TARGET` | L2 build | cm5-stage-release.sh | runtime/shell/scripts/cm5-stage-release.sh | cm5 | SSH target alias. |
| `ODK_LINK_BIND` | L3 device | runtime.env | runtime/shell/src/odk-link-service.js | — | Listener address override. |
| `ODK_LINK_CONTROL_CREDENTIAL` | L3 device (sensitive, transitional) | runtime.env | runtime/shell/scripts/odk-link-service.js | Unset | Transitional environment credential. Use ODK_LINK_CONTROL_CREDENTIAL_FILE instead. If absent, the desk accepts reports only. |
| `ODK_LINK_CONTROL_CREDENTIAL_FILE` | L3 device (sensitive) | runtime.env | runtime/shell/scripts/odk-link-service.js | Unset | Preferred control credential file, mode 0600. Match the Console credential. It also authenticates a Personal Agent owner turn, in its own proof domain. |
| `ODK_LINK_PERSONAL_AGENT_DRIVER` | L3 device (development) | runtime.env | runtime/shell/scripts/odk-link-service.js | Unset | Absolute path to the shared Personal Agent fixture. Selecting it replaces the resident source with a labelled development frame source, so a phone can show every design state on request. |
| `ODK_LINK_PERSONAL_AGENT_INTERVAL_MS` | L3 device (development) | runtime.env | runtime/shell/scripts/odk-link-service.js | 0 | Interval for walking the development fixture when no selection file is set. |
| `ODK_LINK_PERSONAL_AGENT_SELECTED` | L3 device (development) | runtime.env | runtime/shell/scripts/odk-link-service.js | Unset | Absolute path to the file naming the state the development source publishes. |
| `ODK_LINK_PORT` | L3 device | runtime.env | runtime/shell/scripts/odk-link-service.js | 8765 | Listener port. Match the Console port. |
| `ODK_LINK_SOCKET` | L3 device | runtime.env | runtime/shell/scripts/odk-link-service.js | Host runtime default | Open DeskOS Link service IPC socket. |
| `ODK_LINK_TOKEN` | L3 device (sensitive, transitional) | runtime.env | runtime/shell/scripts/odk-link-service.js | Unset | Transitional environment reporting token. Other processes of the same user can read it. Prefer ODK_LINK_TOKEN_FILE; the file form takes priority. |
| `ODK_LINK_TOKEN_FILE` | L3 device (sensitive) | runtime.env | runtime/shell/scripts/odk-link-service.js | Unset | Preferred reporting token file, mode 0600. Match the reporting client token. |
| `ODK_HOSTED_PI_SOCKET` | Test | Test process | runtime/shell/src/odk-link-host-adapter.js | Read endpoint.json | Explicit override for isolated operation/tests. Production reads the daemon endpoint descriptor. |
| `ODK_HYDRA_MQTT_TOPIC` | L3 device | shell drop-in | runtime/shell/src/main.js | — | Hydra topic prefix. |
| `ODK_HYDRA_MQTT_URL` | L3 device | shell drop-in | runtime/shell/src/main.js | — | Hydra MQTT endpoint. |
| `ODK_KIOSK_BIN_DIR` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Directory for Corepack/pnpm shims. |
| `ODK_KIOSK_DISPLAY` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Graphical DISPLAY for post-activation smoke. |
| `ODK_KIOSK_HOME` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Kiosk user home directory. |
| `ODK_KIOSK_NODE_BIN` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Node directory for the kiosk session. |
| `ODK_KIOSK_UID` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Kiosk user UID. |
| `ODK_KIOSK_USER` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/migrate-runtime.js, runtime/shell/scripts/update-runtime.js | — | User that runs the graphical Shell session. |
| `ODK_KIOSK_XAUTHORITY` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Graphical session XAUTHORITY. |
| `ODK_LOCATION_REFRESH_MS` | L3 device | runtime.env | runtime/shell/src/device-location.js | 1800000 | Location cache lifetime in milliseconds. Refresh after expiry; zero queries on every weather refresh. |
| `ODK_LOCATION_URL` | L3 device | runtime.env | runtime/shell/src/device-location.js | https://ipwho.is/ | Keyless IP location endpoint. This asks a third party for the host location; see the privacy section. |
| `ODK_MODEL_FSTAB` | L3 device | SSD migration script | runtime/shell/scripts/cm5-migrate-models-to-ssd.sh | /etc/fstab | fstab path. |
| `ODK_MODEL_MIGRATION_LIBRARY` | L3 device | SSD migration script | runtime/shell/scripts/cm5-migrate-models-to-ssd.sh | — | Migration library path. |
| `ODK_MODEL_SSD_MOUNT` | L3 device | SSD migration script | runtime/shell/scripts/cm5-migrate-models-to-ssd.sh | — | SSD mount point. |
| `ODK_MODEL_SSD_ROOT` | L3 device | SSD migration script | runtime/shell/scripts/cm5-migrate-models-to-ssd.sh | — | Model storage root on the SSD. |
| `SSH_ORIGINAL_COMMAND` | L3 host | SSH forced command | runtime/shell/scripts/pi-sessions-snapshot.js | — | SSH supplies the original command. The collector accepts only its fixed snapshot or exact-session request. |
| `ODK_PI_SSH_MACHINE` | L3 device | runtime.env | runtime/shell/src/pi-session-backfill.js | — | Explicit reporting-machine binding for the configured read-only conclusion collector. |
| `ODK_PI_SSH_COLLECTOR` | L3 device | shell drop-in | runtime/shell/src/pi-sessions-source.js | — | Absolute collector path on the remote host. |
| `ODK_PI_SSH_HOST` | L3 device | shell drop-in | runtime/shell/src/pi-sessions-source.js | — | Remote Pi collection host. |
| `ODK_PI_SSH_NODE` | L3 device | shell drop-in | runtime/shell/src/pi-sessions-source.js | — | Absolute Node path on the remote host. |
| `ODK_RUNTIME_ROOT` | L2 install | cm5-install.sh | runtime/shell/src/user-app-context.js, runtime/shell/scripts/cm5-acceptance.sh, runtime/shell/scripts/cm5-install.sh, runtime/shell/scripts/cm5-stage-release.sh, runtime/shell/scripts/migrate-runtime.js, runtime/shell/scripts/start-kiosk.sh, runtime/shell/scripts/update-runtime.js | /opt/odk | Root for releases and mutable state. |
| `ODK_STAGING_ID` | L2 build | cm5-stage-release.sh | runtime/shell/scripts/cm5-stage-release.sh | timestamp-$-random | Isolated staging directory identifier. |
| `ODK_STT_PORT` | L3 device | stt-bridge unit (runtime.env override) | integrations/local-stt-bridge/scripts/provision-stt-bridge.sh, integrations/personal-bot/src/main.mjs | 17840 | Single declaration of the local STT port. The bot derives its endpoint from this value. |
| `ODK_WEATHER_LAT` | L3 device | runtime.env | runtime/shell/src/weather-source.js | — | Weather latitude. A valid latitude/longitude pair disables location lookup. |
| `ODK_WEATHER_LON` | L3 device | runtime.env | runtime/shell/src/weather-source.js | — | Weather longitude. A valid latitude/longitude pair disables location lookup. |
| `ODK_WEATHER_PLACE` | L3 device | runtime.env | runtime/shell/src/weather-source.js | — | Weather location name. |
| `ODK_CONFIG_DIR` | L3 device | Operator | runtime/shell/src/plugin-config.js | ~/.config/odk | Shared Plugin CLI and Shell configuration directory. |
| `ODK_NATIVE_KEYRING` | L3 device | Operator | runtime/shell/src/native-plugin-loader.js | — | External publisher policy file for signed Shell startup. See [native startup](NATIVE_PLUGINS.md#main-startup). |
| `USERPROFILE` | Environment | Windows user session | runtime/shell/src/plugin-config.js | — | Find the plugin configuration directory when HOME is absent. |
| `PATH` | Environment | Unit / installer | runtime/shell/scripts/cm5-install.sh | — | Units pin Node and shim directories. Do not depend on an interactive version manager PATH. |
| `PI_AGENT_DIR` | Environment | Pi runtime | runtime/shell/src/pi-sessions.js | ~/.pi/agent | Pi session and authentication directory. |
| `PI_CODING_AGENT_DIR` | Environment | Personal Bot verifier | integrations/personal-bot/scripts/test-proactive-docker-live.mjs | ~/.pi/agent | Pi settings and authentication directory for the isolated live verifier. |
| `ODK_FUTU_SERVICE_REVISION` | L3 device | runtime.env | runtime/shell/src/plugins/desk-runtime.js, integrations/futu-poller/poller.py | dev | Futu revision. The handshake and expected revision use this single declaration. |
| `SystemRoot` | Environment | Windows user session | integrations/personal-bot/src/candidate-checks.mjs | — | Pass through SystemRoot and WINDIR in the minimal Windows coding_check child environment. They are session values, not host configuration. |
| `WINDIR` | Environment | Windows user session | integrations/personal-bot/src/candidate-checks.mjs | — | Pass through with SystemRoot so Windows child processes can resolve system directories. |
| `SERVICE_ID` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | futu-poller | Service identity. The Shell registry uses this same protocol identity. |
| `WAYLAND_DISPLAY` | Environment | Graphical session | runtime/shell/src/main.js | — | Select the Ozone platform hint for a Wayland session. |
| `WEREAD_API_KEY` | L3 device (sensitive) | runtime.env | runtime/shell/src/weread-source.js | — | WeRead synchronization credential. |
| `XDG_RUNTIME_DIR` | Environment | Login session | runtime/shell/src/platform/index.js, runtime/shell/src/main.js, runtime/shell/src/remote-bridge-client.js, integrations/remote-bridge/lib/remote-bridge.js, integrations/personal-bot/src/runtime-channel.mjs, integrations/personal-bot/src/host-paths.mjs | — | Unix IPC/runtime root. The platform names local endpoints; Windows uses token-authenticated named pipes. |
| `XDG_STATE_HOME` | Environment | Login session | runtime/shell/src/platform/index.js, integrations/personal-bot/src/host-paths.mjs | ~/.local/state | Persistent state directory. |

## Weather location and privacy

Set `ODK_WEATHER_LAT`, `ODK_WEATHER_LON` and optional `ODK_WEATHER_PLACE` in `runtime.env` for a fixed location. Valid coordinates disable all location requests.

A host with no location asks a keyless IP location service during weather refresh. The default endpoint is `https://ipwho.is/`. It accepts `loc: "lat,lon"` or `latitude`/`longitude` with `city`. The response remains cached for `ODK_LOCATION_REFRESH_MS` (30 minutes by default). This sends a request to a third party. Configure coordinates to prevent it.

Requests have a three-second timeout. A failed lookup reports Unavailable with a reason. It never blocks rendering or invents a city. The renderer does not perform the lookup.

## Personal Bot capability configuration

The [unified architecture](../../../integrations/personal-bot/docs/UNIFIED_ARCHITECTURE.md) separates host tools, shared Shell, external Personal Bot, reviewed capabilities, and Skills.
On CM5, the resident runs as nonroot `orangepi`.
Host-installed tools and private state remain outside immutable releases.
`ODK_WORKSPACE` identifies a writable checkout, not the active release or the resident conversation directory.

`ODK_PERSONAL_BOT_CONFIG` selects a private profile configuration.
The personal profile uses the canonical `capabilities` map for reviewed `didi` and `browser` declarations.
The [profile contract](../../../integrations/personal-bot/docs/CONTRACT.md#profiles-and-memory) owns its example and file rules.
The host registry owns validation, factories, Skills, intents, workflows, tool prefixes, lifecycle hooks, and `childAllowed`.
Legacy top-level `didi` and `browser` declarations normalize into that map.
Duplicate declarations fail, including duplicates across legacy and canonical fields.
The `coding` profile rejects capability declarations.
Configuration cannot select arbitrary factories or native Pi plugins.

`agentPlugins.enabled` selects fixed `experience`, `completion`, `learning`, `catalog`, `mcp`, `subagents`, `intent`, and `remote_conversation` identities.
`learning` and `remote_conversation` require `completion`; `mcp` requires `catalog`.
The [remote conversation contract](../../../integrations/personal-bot/docs/CONTRACT.md#remote-pi-conversation) owns collection, history, and follow-up limits.
These selections identify reviewed DeskOS modules, not arbitrary Pi packages.
Runtime Skills and declarative MCP packages retain their catalog and workflow limits.
Repository `.agents/skills/` files guide coding agents and grant no resident authority.

After parent admission, the host selects fixed child `agent_execute` dispatch without a second Jev client.
Children cannot inherit DiDi, delegate recursively, change identities, alter packages, or invoke core lifecycle mutations.
A permitted browser uses a separate session under the child's private `stateDir`.
The [child contract](../../../integrations/personal-bot/docs/AGENT_TASKS.md) owns identity, storage, completion, and avatar rules.

## Personal Bot judgment and generation

| Variable | Layer | Default | Consumer | Kind | Note |
| --- | --- | --- | --- | --- | --- |
| `ODK_JEV_PROVIDER` | device | typesafe | integrations/personal-bot/src/jev-client.mjs | config | Select typesafe or opencode; disabled uses ordinary model judgment |
| `ODK_JEV_KEY_FILE` | device | none | integrations/personal-bot/src/provider-endpoints.mjs | config | Private TypeSafe credential path; never expose file contents |
| `ODK_OPENCODE_KEY_FILE` | device | none | integrations/personal-bot/src/provider-endpoints.mjs | config | Private OpenCode Zen credential path; separate from Go |
| `ODK_OPENCODE_GO_KEY_FILE` | device | none | integrations/personal-bot/src/provider-endpoints.mjs | config | Private OpenCode Go credential path; unavailable for Jev |
| `OPENCODE_API_KEY` | device | none | integrations/personal-bot/src/provider-endpoints.mjs | config | OpenCode Zen environment credential; never expose its value |
| `OPENCODE_GO_API_KEY` | device | none | integrations/personal-bot/src/provider-endpoints.mjs | config | Separate OpenCode Go environment credential; never expose its value |
| `ODK_PERSONAL_AGENT_MAIN_SSH` | device | none | integrations/personal-bot/src/display-client.mjs | config | Windows display requires the fixed odk-cm5-agent SSH alias |
| `ODK_JEV_MODEL` | device | provider default | integrations/personal-bot/src/jev-client.mjs | config | TypeSafe defaults to jev-latest; OpenCode Zen defaults to jev-1.13 |
| `ODK_JEV_INTENT_THRESHOLD` | device | 0.8 | integrations/personal-bot/src/intent-routing.mjs | config | Minimum selected probability and confidence; initially uncalibrated, must exceed 0.5 |
| `ODK_JEV_THRESHOLD` | device | 0.8 | integrations/personal-bot/src/proactive-jev.mjs | config | Minimum usefulness and factual support |
| `ODK_JEV_TIMEOUT_MS` | device | 10000 | integrations/personal-bot/src/jev-client.mjs | config | Judgment deadline, integer 1000 through 30000 milliseconds |
| `TYPESAFE_API_KEY` | device | none | integrations/personal-bot/src/provider-endpoints.mjs | config | Private TypeSafe environment credential; never expose its value |
| `ODK_PROACTIVE_GENERATION_TIMEOUT_MS` | device | 90000 | integrations/personal-bot/src/agent.mjs | config | Total generation deadline, integer 1000 through 180000 |

## Saved plugin preferences

### Explicit runtime management

Use `odk plugin disable <id> --runtime` to stop a registered Main plugin.
Use `odk plugin enable <id> --runtime` to start it through the existing dependency graph.
These commands do not change saved startup preferences.
The separate `plugin-control` channel uses local channel ownership and token authentication.
Unix hosts use `odk-plugins/control.sock` under `XDG_RUNTIME_DIR`.
Windows hosts use `\\.\pipe\odk-plugin-control`.
The control plugin cannot disable itself through this channel.
Unknown identities, failed cleanup, blocked starts, and invalid requests cause command failure.
An uncertain response reports an unknown operation outcome and does not trigger automatic replay.
Diagnosis remains read-only through its separate channel.
Runtime control also manages registered Bridge transports through their independent control channel.
The CLI first reads authenticated identity inventories from Main, Renderer, Bridge, resident, Hosted Pi, and Python management endpoints.
It selects the unique online owner of the requested identity instead of selecting a host from its prefix.
Duplicate ownership, invalid inventories, and oversized inventory responses prevent mutation.
An unavailable independent endpoint does not prevent management of a uniquely reported online plugin.
The Bridge refuses listener and control identities through this channel.
Its standard Unix endpoint is `odk-remote/bridge.sock.control` under `XDG_RUNTIME_DIR`.
Custom Bridge socket paths use a separate endpoint with the `.control` suffix.
The standard Windows control name follows the host's `remote-plugin-control` mapping.
Endpoint mapping checks do not establish native Windows Bridge operation.
Resident identities use the independent resident management channel selected through this inventory.
Its Unix endpoint is `odk-personal-bot/control.sock` under `XDG_RUNTIME_DIR`.
Windows uses the host's `personal-bot-control` named-pipe mapping and shared token.
Service and voice channel changes retain management access for recovery.
The resident refuses its control identity and unknown components.
Older service replacements without suspension support refuse partial service, channel, and runtime changes.
Hosted Pi uses `odk-hosted-pi/control.sock` under `XDG_RUNTIME_DIR` on Unix.
Its Windows endpoint follows the `hosted-pi-control` named-pipe mapping.
Its independent management remains available while task components stop or recover from startup failure.
Stopping its service disconnects existing Consoles while preserving the accepting task listener.
Renderer uses `odk-plugins/renderer-control.sock` under `XDG_RUNTIME_DIR` on Unix.
Windows uses `\\.\pipe\odk-renderer-plugin-control` with the shared channel token.
The Main control plugin sends commands only to one known Shell main frame.
Multiple frames refuse inventory instead of selecting an arbitrary frame.
Surface commands complete factory, placement, pager, and Remote coordination before returning a successful receipt.
Failed affected surface mounts prevent successful receipts even when their factories report `running`.
Foreign frames, subframes, mismatched receipts, and private report fields cannot certify management.
Timeout and stopped in-flight mutations report unknown outcomes without automatic replay.
Affected foreground Apps must close through the existing App platform before lifecycle changes.
Renderer runtime commands leave startup preferences unchanged.
The Renderer inventory also includes appearance identities from the theme Host.
Appearance commands use the theme lifecycle and retain the saved theme selection during fallback.
Duplicate identities across surface and appearance Hosts prevent mutation.
Failed appearance startup or cleanup prevents a successful receipt.
Firmware runtime control remains separate work.
Native Windows Renderer management and supported-device acceptance remain unverified.
An unavailable endpoint disables the control plugin during startup.

### Startup preferences

The Plugin CLI stores local enable preferences in `plugins.json` under `ODK_CONFIG_DIR`.
The default directory uses `HOME`, then Windows `USERPROFILE`, then the operating system home directory.
Main, Personal Bot, Hosted Pi, Remote Bridge, and Futu Python read this file during startup.
Main and renderer use the same disabled plugin snapshot.
The appearance Host reads this snapshot before body content.
Disabled themes fall back to Instrument without deleting the saved explicit theme.
The saved theme returns after re-enabling its plugin and restarting the Shell.
These preferences do not add an external appearance loading path.
Saved entries with `enabled: false` disable their plugins.
`ODK_DISABLED_PLUGINS` adds disabled identities, including plugins with saved enable preferences.
Preference changes take effect on the next startup of the applicable runtime.
They do not change a running runtime.
The explicit `activate <id> --runtime` command rereads signed selection settings for an existing Main plugin, Renderer surface, or Appearance factory.
[Main activation](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-main-activation) and [Renderer activation](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-signed-renderer-activation) own their separate authorization and lifecycle contracts.
The explicit `restore-default <id> --runtime` command restores a built-in Main factory or Renderer surface without reading or changing this file.
[Main restoration](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-main-restoration) and [Renderer restoration](RUNTIME_PLUGIN_REPLACEMENT.md#authenticated-built-in-renderer-restoration) own their recovery contracts.
Each runtime applies preferences only to its registered identities.
Disabled plugins do not execute default or external factories.
Required consumers remain blocked until their provider is available.
Personal Bot retains its resident channel when only the Agent runtime is disabled.
Hosted Pi retains listener diagnosis when its task service is disabled.
Remote Bridge retains its listener when only a transport is disabled.
Disabling a required listener prevents the runtime from serving its clients.
Python adds shared disables to its separate component preferences and explicit startup disables.
Its inspection command reads plugin preference settings without consuming provider configuration.
The [Python guide](../../../integrations/futu-poller/README.md#saved-component-preferences) owns standalone file rules and Python selection limits.
Firmware does not read this JavaScript configuration.
An absent file keeps the default composition.
Invalid or unreadable configuration produces a diagnostic and leaves only environment disables effective.
The CLI refuses to overwrite invalid or unreadable configuration.
These preferences grant no installation authority or additional capabilities.

Configuration mutations acquire a lock and read the current state before they apply a change.
They write complete bytes to a private candidate file before they replace the configuration file.
A failed write or replacement preserves the previous configuration.
A concurrent writer causes the command to fail without changing configuration.
An interrupted writer can leave a lock; commands do not reclaim that lock automatically.
Configuration file symlinks retain their links and update their existing targets.

### Native revision selection records

Signed revision storage and selection use the [native bundle contract](NATIVE_PLUGINS.md).
A plugin entry can contain `native` or `development`, but not both.
The native record has `revision`, `host`, `replace`, `grants`, and `trustAcknowledgedAt` fields.
The revision is a full 64-character lowercase SHA-256 identifier.
The host is `electron-main` or `electron-renderer`.
The replacement field is boolean; grants contain unique permission names.
The trust timestamp records independent operator authorization rather than package metadata.
An optional `previous` record retains the same fields without nested history.
Unknown native fields, invalid values, and nested histories invalidate the configuration.
Native selection changes preserve `enabled` and unrelated plugin entries.
Main loads selected signed revisions when `ODK_NATIVE_KEYRING` identifies an external publisher policy.
Renderer surface startup uses the same policy and captured signed assets.
Signed Appearance startup supports factories and palette declarations through the [Appearance startup contract](NATIVE_PLUGINS.md#appearance-startup).

## Plugin diagnosis

`odk plugin diagnose [id]` requests current lifecycle states from the Main plugin Host.
The response separates these states from saved enable preferences.
A running lifecycle state does not certify source freshness, renderer behavior, or hardware operation.
The command exits with failure for blocked plugins, lifecycle faults, unknown identities, or an unavailable channel.
Unix hosts require an absolute `XDG_RUNTIME_DIR`.
The Unix endpoint is `odk-plugins/diagnose.sock` under that directory.
Windows uses the `odk-plugin-diagnostics` named pipe with the existing local channel token.
The diagnosis plugin is disabled during smoke checks and when no endpoint exists.
It accepts read-only requests and releases its listener during plugin shutdown.
Main can also request renderer, resident Personal Bot, Hosted Pi, Remote Bridge, and Futu Python snapshots through declared runtime ports.
Firmware remains outside this channel's current scope.
The [Futu guide](../../../integrations/futu-poller/README.md#negotiated-runtime-diagnosis) owns its negotiated protocol, deadlines, and transport limits.

### Hosted Pi lifecycle snapshots

Hosted Pi reports its actual listener, service, and endpoint plugin states.
It uses the `personal-agent` host and the `hosted-pi` instance identity.
The resident composition retains its separate instance identity.
The Main provider declares `odk:plugin-runtime/personal-agent/hosted-pi/v1`.
Named runtime ports require a matching report instance.

Each probe resolves the current endpoint through the existing Hosted Pi endpoint resolver.
The resolver retains its environment override and published descriptor rules.
The probe opens a separate short connection and sends only a read-only diagnosis request.
It does not dispatch task commands or stop the task service.
Requests expire after 500 milliseconds, with at most 16 pending requests and 64 KiB of incoming data per request.
Provider shutdown cancels its pending probes.

An older service can refuse the request or remain silent until timeout.
Both outcomes report unavailable diagnosis without changing task control.
Reports exclude prompts, task history, endpoint paths, and private errors.
Lifecycle availability does not establish real Agent or host acceptance.
[Personal Bot contract](../../../integrations/personal-bot/docs/CONTRACT.md#hosted-pi-task-diagnosis) owns the request and response fields.

### Remote Bridge lifecycle snapshots

The `remote-bridge` runtime reports listener and transport plugin states with the `bridge` instance identity.
A separate diagnosis plugin consumes the existing Remote Link port and provides `odk:plugin-runtime/remote-bridge/v1`.
The functional Remote Link port contract remains unchanged.
Replacements without diagnosis support report unavailable.

Each probe uses a separate short connection and matches the response to its request identity.
The existing navigation connection retains its protocol and input limits.
The client permits 16 pending probes with a 500 ms deadline and 64 KiB of incoming data per probe.
Timeout, cancellation, invalid reports, and connection failure close only the probe connection.
Provider shutdown cancels its probes without stopping the Remote Link client.
Client shutdown cancels all of its probes.

Reports exclude private errors, device details, and retained Shell state.
Lifecycle states do not certify USB, wireless, or physical input.
Older bridges reach the probe timeout without losing the navigation connection.
[Remote Bridge](../../../integrations/remote-bridge/README.md#runtime-diagnosis) owns request and response fields.

### Personal Bot lifecycle snapshots

The `personal-agent` runtime reports the resident composition through the existing authenticated Personal Bot connection.
The response uses the `resident` instance identity.
The channel plugin retains its existing provided port contract.
A separate diagnosis plugin consumes that port and provides `odk:plugin-runtime/personal-agent/v1`.
Replacements without diagnosis support report unavailable without changing their functional port requirements.

The client negotiates support through its existing status request before sending diagnosis commands.
Older residents keep their voice connection and report `not-supported`.
Each response must match its request identity and declared runtime host.
The client permits 16 pending requests with a 500 ms response limit.
Disconnection and client shutdown finish pending requests immediately.
Provider shutdown cancels its pending requests without stopping the voice client.
The provider stops accepting requests after shutdown.

Reports exclude private errors, voice replies, readings, and Agent data.
Lifecycle failure can identify an Agent configuration failure while the resident channel remains available.
These states do not certify Agent output, transcription, suggestions, or microphone operation.
[Personal Bot contract](../../../integrations/personal-bot/docs/CONTRACT.md#resident-runtime-diagnosis) owns the protocol and capability negotiation.

### Renderer lifecycle snapshots

The response keeps `scope: electron-main` and the existing Main `plugins` array.
An additional `runtimes` array identifies each Shell renderer frame.
Each available frame reports surface, appearance, and diagnosis bridge lifecycle states.
Renderer plugin identities can be selected with the existing `diagnose <id>` command.
A request for a known Main identity does not wait for renderer snapshots.

Only the requested Shell main frame can return a snapshot with its request identity.
Each frame has a 500 ms response limit.
Main limits concurrent requests, frame count, report size, and plugin count.
Timeouts, invalid reports, missing frames, and unavailable providers report an unavailable runtime.
The CLI exits with failure for unavailable runtimes or reported plugin lifecycle faults.

Reports exclude private error text, reading values, and undeclared manifest fields.
Renderer health remains unknown.
A running lifecycle state does not prove mount success, visual correctness, or interaction behavior.
Stopping diagnosis cancels pending frame probes and removes its IPC subscription.

### Source health snapshots

Main discovers optional `odk:plugin-health/<plugin-id>/v1` ports from plugin manifests.
Each port provides a synchronous `snapshot()` method.
The diagnosis channel reports its result separately from the plugin lifecycle state.
The allowed health states are `healthy`, `degraded`, `failed`, and `unknown`.
The response includes only the state, a bounded reason code, and an optional source timestamp.
It excludes source reading values and probe exception text.
The channel does not refresh sources or start network requests.
An invalid or failed probe reports failure for that plugin.
Diagnosis continues for other plugins.

Hydra, Weather, WeRead, and Camera provide these snapshots from their existing source state.
`healthy` follows that provider's existing availability policy.
It does not certify measurement accuracy or freshness beyond that source's state policy.

Camera health describes its cached frame state and never starts capture or accesses its device.
Hydra health uses `cachedSnapshot()` when the source provides that operation.
Older Hydra adapters retain the existing `snapshot()` fallback and must preserve the health contract.
A healthy Camera cache includes `cached-frame` and its captured time.
This result does not certify that the camera is currently connected.

Hydra does not independently certify every node or gateway through this snapshot.
Loading, stale, or unconfigured sources report degraded health.
Unavailable sources report failed health.
An undeclared, missing, or unknown snapshot reports unknown health.

The CLI exits with failure for degraded or failed health.
Unknown health remains explicit and does not establish that a plugin is healthy.

Service health can include up to 64 component snapshots.
Each component has a unique bounded identity and the same state, reason, and timestamp fields.
Components cannot contain further component lists.
A healthy aggregate requires all reported components to be healthy.
The CLI also fails when a reported component is degraded or failed.
Futu reads its current service declarations and cached service snapshots through this contract.
It reports degraded health when no services are declared.
Authentication and synchronization states report degraded health.
Unavailable services report failed health.
Mixed healthy and failed services produce a degraded aggregate.
Health reads do not refresh declarations, open listeners, or expose holdings and authentication details.

## Plugin package management

`odk plugin list` reads Main plugin states, runtime snapshots, and the installed Widget/App catalog from their local services.
The response includes saved preferences separately.
An unavailable service causes the command to fail.
Runtime snapshots include negotiated Python and Hosted Pi reports when their channels are available.
This inventory excludes firmware states.

`odk plugin add <local-package-directory>` installs a local HTML Widget/App package through the application store.
The directory must contain `manifest.json` and `index.html`.
The store verifies their exact bytes before it installs a snapshot.
Adding the same identifier installs a verified replacement and retains the previous revision for rollback.
The source directory remains unchanged.
An imported package does not require a configured workspace.
Use `add` again to install changes from that directory.

`odk plugin update <installed-app-id>` verifies and installs the current workspace draft for an installed package.
The application store retains the previous revision for rollback.
An unknown identifier or failed verification leaves installed state unchanged.
`odk plugin rollback <installed-app-id>` verifies and restores the retained previous revision.
The store uses installed snapshots and does not require the workspace draft.
Missing history or failed verification leaves the current revision unchanged.
Rollback retains the replaced revision for another rollback.
`odk plugin remove <installed-app-id>` removes an installed package through the same application store.
Removal preserves workspace draft files.
These commands accept Widget/App identifiers, not trusted built-in plugin identities.
[USER_APPLICATIONS](USER_APPLICATIONS.md) defines draft locations, verification, and package permissions.

The existing local channel authenticates these requests.
Unix hosts require `XDG_RUNTIME_DIR`; Windows uses the application control named pipe and shared token.
A lost response leaves the operation outcome unknown.
Inspect installed state before you retry a mutation.
URL installation remains unavailable.
The separate [native CLI](NATIVE_PLUGINS.md#native-cli) stores signed local revision selections without executing entries during CLI operations.
Shell startup separately loads authorized selections through the external publisher policy.
The HTML package commands grant no new package capabilities.

### Development links

`odk plugin link <directory> --trust [--replace] [--grant <capability> ...]` records a local development link.
The directory must contain `manifest.json`.
Code links also require a relative `entry` file.
Development links support `electron-main` plugins and explicit `electron-renderer` replacements.
The manifest must stay inside the directory and must not exceed 16 KiB.
The entry must resolve to a file inside that directory.
The owner must grant each declared capability with a separate `--grant` option.
For code links, linking checks the declaration and entry path without executing the module.
The next normal Shell startup reads the directory and discovers its declarations.

Main entries use CommonJS and export `create(ctx)` for the existing Host lifecycle.
Development reading identities must start with the plugin identity and a period.
Development namespaces cannot overlap each other.
Ordinary additions cannot claim built-in identities or readings.

The `--replace` option selects the built-in plugin with the manifest identity.
Its host and kind must match the original declaration.
Its provided ports must match the current contract or an explicitly retained earlier contract.
Camera retains its previous source-only contract after adding optional health diagnosis.
A replacement that omits health continues to report unknown health.

Linking checks the Main replacement dependency graph without executing its module.
This graph includes other selected Main replacements and extensions.
A replacement can require an extension port while retaining its public port contract.
The owner must link that provider before linking the replacement.
Relinking replaces the selected identity during validation without reading its previous link.
Main checks its declaration and dependency graph again at startup.
Invalid replacements produce a diagnostic and restore the default composition.
If Main rejects extensions, it validates the remaining replacement graph before using that fallback.

A source replacement can retain the built-in readings owned by that source.
It cannot claim another built-in source reading.
A Futu replacement can retain its service reading identities.
Reading validation still applies to all declarations.
Removing a replacement link restores the original implementation on the next startup.
Saved disable preferences still apply to that identity.

Source readings cannot use the package kind; service readings must use the service kind.

The provider validates reading declarations before it publishes ports.
It validates dynamic service declarations on each read.
An invalid update retains the last valid service declarations and produces a diagnostic.

Smoke startup excludes development links.
Saved disable preferences and environment disables prevent module execution.

#### Appearance declarations

Appearance links use `link <directory> --trust --replace` for an existing `odk.theme.*` identity.
They contain declaration data without an `entry` or an external stylesheet.
The manifest retains host `electron-renderer`, kind `surface`, its single `odk:theme/<theme>/v1` port, and empty dependencies and permissions.
Its `appearance` object retains the packaged theme identifier, stylesheet path, font identifiers, and image-rendering rule.
The display name can change.
Its `tokens` object overrides only the existing palette tokens.
Values must use hexadecimal colors with three, four, six, or eight digits.
Font, geometry, timing, and derived Cell tokens cannot change through this declaration.

```json
{
  "schemaVersion": 1,
  "id": "odk.theme.pixel",
  "name": "Selected Pixel",
  "version": "2.0.0",
  "kind": "surface",
  "host": "electron-renderer",
  "provides": [{ "interface": "odk:theme/pixel/v1" }],
  "requires": [],
  "permissions": [],
  "appearance": {
    "theme": "pixel",
    "name": "Selected Pixel",
    "css": "themes/pixel.css",
    "faces": ["zpix"],
    "extra": "image-rendering:pixelated;",
    "tokens": { "--odk-primary": "#fafafa" }
  }
}
```

Main validates these declarations before creating the window or installed package context.
The renderer validates the same selection before body content and applies tokens through a constructed stylesheet.
The existing Content Security Policy remains unchanged.
The selected declaration supplies both Shell palette values and installed package context values.
Unchanged packaged tokens preserve fonts, geometry, and derived Cell behavior.
Runtime diagnosis reports the selected manifest version.
Invalid linked declarations restore their packaged appearance and produce an identity diagnostic.
Other valid linked appearance declarations remain selected.
Disable, enable, and removal operations take effect on the next startup.
Removal preserves the source directory.
This declaration path does not load external appearance code, fonts, assets, or native production revisions.
New capability requests require new explicit grants.
Startup discovery rejects each damaged link separately and retains other valid selections.
Its diagnostic identifies the plugin without exposing source paths or error content.
Strict discovery without a report callback still rejects invalid links.
The CLI also isolates damaged independent Main links when it validates a replacement link.
It reports their identities and preserves their saved preferences and source files.
A replacement that requires a damaged provider fails without changing configuration.
Dependency and port conflicts still require composition validation before startup.

Renderer links require `--replace`, a declared `surfaceKind`, and the selected surface identity port.
Their `.js` browser entries must not exceed 256 KiB.
Main returns renderer declarations and file URLs without executing their entries.
Only known Shell main frames can request those entries.
The renderer validates the complete declaration set before loading scripts under the existing Content Security Policy.
Each script must synchronously call `window.odkRendererDevelopment.define(definition)` once for its selected identity.
The renderer checks the resulting definitions again before factory execution.
An entry error or invalid definition restores the default composition with the existing disabled identities.
The loader accepts at most 32 entries and bounds each script load to two seconds.
This deadline does not interrupt synchronous JavaScript execution.
Use an IIFE to contain package variables.
A renderer manifest can declare one package-relative `css` file within 256 KiB.
Main checks that the stylesheet resolves inside the linked directory before returning its file URL.
The renderer loads this stylesheet with inactive media before executing any entry.
An unavailable stylesheet rejects the linked composition without executing its entries.
Each stylesheet check has the same two-second deadline.
Temporary stylesheet links are removed before entry execution and never style the default composition.
The registry resolves the selected definition's CSS through its validated package file URL.
Ordinary packaged definitions retain their existing Shell-relative `css` paths.
CSS resource URLs resolve from the stylesheet location under the existing Content Security Policy.
Additional resource declarations and recursive asset verification remain unfinished.

`--trust` authorizes live directory code with its selected Shell process authority.
This code is not sandboxed.
Directory changes remain trusted until the owner disables or replaces the link.
These links do not provide signatures, hot reload, or third-party isolation.

`odk plugin remove <development-plugin-id>` removes the saved development link.
Removal preserves source files and other saved preferences.
The running plugin remains active until the next Shell startup.
An unknown development identity causes the command to fail.
Installed Widget/App removal continues to use the application store.

## Plugin declaration validation

`odk plugin validate <path>` checks a trusted local plugin manifest with the Host declaration validator.
The checks cover schema version, identity, name, version, supported kind and host, ports, and capability names.
The validator returns a separate normalized declaration.
It does not load the entry module or change the input declaration.
Valid syntax does not establish dependency availability, granted capabilities, package trust, or compatibility with a specific machine.
The Host checks dependencies during startup and capabilities during activation.
Installed HTML packages use the separate manifest contract in [USER_APPLICATIONS](USER_APPLICATIONS.md).
