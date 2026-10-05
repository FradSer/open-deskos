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
- Installers generate personal-bot, pi-tasks, remote-bridge and desk-link units from release templates.
- Use one source per setting. Keep permanent settings in environment files. A temporary systemd drop-in overrides `EnvironmentFile=`; remove it after use.
- Use `ODESK_` for new variables. Keep existing `ODK_` names unchanged.

## Inventory

A `sensitive` value is a credential or credential path. Keep it in a mode-`0600` file. Do not put it in units, source or logs. Consumers are repository-relative paths. External tools run outside the bundled runtime.

| Variable | Layer | Owner | Consumer | Default | Purpose |
| --- | --- | --- | --- | --- | --- |
| `ALIYUNCS_TOKEN` | L3 device (sensitive) | personal-bot.env | integrations/personal-bot/src/transcribe.mjs | — | DashScope bearer credential. Only the aliyun provider reads it. OpenAI uses ODESK_PERSONAL_BOT_STT_KEY_FILE. |
| `DISPLAY` | Environment | Graphical session | runtime/shell/src/main.js | — | The graphical session imports this value into the user systemd environment. |
| `FUTU_HOST` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 10.10.0.195 | Futu gateway address. |
| `FUTU_INTERVAL` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 60 | Poll interval in seconds. |
| `FUTU_PORT` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | 11111 | Futu gateway port. |
| `FUTU_RSA_FILE` | External tool (sensitive) | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | — | Path to the gateway RSA private key copy. |
| `FUTU_TRADE_PWD` | External tool (sensitive) | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | — | Trade unlock password. |
| `ODK_CHANNEL_TOKEN_FILE` | L3 device (sensitive) | Plugin and Personal Bot clients | integrations/futu-poller/poller.py, integrations/personal-bot/src/runtime-channel.mjs | — | Read-only client token file for TCP or named-pipe channels. The bot uses it for app control and Desk Data. Unix socket ownership supplies authentication without a token. |
| `HOME` | Environment | Login session | runtime/shell/src/opencode-go.js, runtime/shell/scripts/open-deskos-plugin-cli.js | — | Find host configuration and credentials. |
| `LIBGL_ALWAYS_SOFTWARE` | Environment | Operator | runtime/shell/src/main.js | — | Force software rendering for diagnosis. |
| `LOCALAPPDATA` | Environment | Windows user session | runtime/shell/src/platform/index.js | — | Windows persistent state root. If absent, use AppData/Local under the user directory. |
| `ODESK_APPS_CONTROL_SOCKET` | Test | Test process | integrations/personal-bot/src/apps-control.mjs | Host app control socket (Windows: `\\.\pipe\open-deskos-user-app-control`) | Test override only. Production uses the host endpoint. A missing Unix runtime directory makes the channel unavailable; do not guess a path. |
| `ODESK_CAMERA_DEVICE` | L3 device | Operator | runtime/shell/src/camera-source.js | — | Camera device override. |
| `ODESK_DESK_DATA_SOCKET` | Test | Test process | integrations/personal-bot/src/desk-data.mjs | Host Desk Data socket (Windows: `\\.\pipe\open-deskos-desk-data`) | Test override only. Production uses the host endpoint. A missing Unix runtime directory makes Desk Data unavailable; do not guess a listener path. |
| `ODESK_DESK_LINK_SOCKET` | Internal | Shell | runtime/shell/src/desk-link-client.js | Host Desk Link socket | Shell client override for the local Desk Link socket. |
| `ODESK_DISABLED_PLUGINS` | L3 device | Operator | runtime/shell/src/main.js | — | List of disabled plugin IDs. |
| `ODESK_DISABLE_GPU` | L3 device | Operator | runtime/shell/src/main.js | — | Disable GPU acceleration. |
| `ODESK_FUTU_SOCKET` | L3 device | runtime.env (Listener owner) | runtime/shell/src/main.js, integrations/futu-poller/poller.py | — | Shared absolute socket path for the poller and local Shell. Historical form; ODK_FUTU_ENDPOINT takes priority. |
| `ODK_FUTU_ENDPOINT` | L3 device | runtime.env / `.env.local` (Listener owner) | runtime/shell/src/main.js | — | Service Plugin listener: socket path, named pipe or tcp://host:port. Pipes and TCP require the channel token. The plugin declares remote targets in its own target file. |
| `ODESK_FUTU_TARGETS_FILE` | L3 device | futu-poller.env | integrations/futu-poller/poller.py | `~/.config/open-deskos/futu-targets.json` | Desk targets with an endpoint and optional token file per entry. If absent, use the single ODESK_FUTU_SOCKET endpoint. |
| `ODESK_GPU_BACKEND` | L3 device | Operator | runtime/shell/src/main.js | Auto-detect | GPU backend selection. |
| `ODESK_PI_REASONING` | L3 device | runtime.env | runtime/shell/src/main.js | Hidden (`hidden`) | Only shown displays reasoning bodies. All other values keep the hidden default. Do not restate that default in host configuration. |
| `ODESK_REMOTE_BRIDGE_SOCKET` | Internal | Shell | runtime/shell/src/remote-bridge-client.js | Host Remote Bridge socket | Shell client override for the Remote Bridge socket. |
| `ODESK_SHELL_HEIGHT` | Test | Smoke/acceptance | runtime/shell/src/main.js | — | Window height override. |
| `ODESK_SHELL_KIOSK` | Test | Acceptance | runtime/shell/src/main.js | — | Kiosk mode switch. |
| `ODESK_SHELL_TEST_MODE` | Test | Test process | runtime/shell/src/desk-link-client.js, runtime/shell/src/remote-bridge-client.js | — | Client test mode. |
| `ODESK_SHELL_WIDTH` | Test | Smoke/acceptance | runtime/shell/src/main.js | — | Window width override. |
| `ODESK_SKIP_GPU_USERSPACE` | L2 install | Installer override | runtime/shell/scripts/cm5-install.sh | 0 | Skip the Mali userspace install. |
| `ODESK_SMOKE_RESULT_FILE` | Test | Smoke run | runtime/shell/src/main.js | — | Smoke result file. |
| `ODESK_TAILSCALE_BIN` | L3 device | Operator | runtime/shell/scripts/provision-tailscale.sh | /usr/bin/tailscale | Override a nonstandard Tailscale executable path. Reuse an existing host installation. |
| `ODESK_TASK_CONFIG` | L2 install | pi-tasks unit | integrations/personal-bot/src/task-store.mjs | %h/.config/open-deskos/pi-tasks.json | Private Hosted Pi daemon configuration. Only the daemon reads and checks ownership/mode. Clients read its published endpoint descriptor. |
| `ODESK_TASK_TARGETS_FILE` | L3 device | Bot environment or drop-in | integrations/personal-bot/src/task-client.mjs | Unset | Personal Bot target list. If absent, report that configuration is required. |
| `ODESK_PROACTIVE_CONFIG` | L3 device (sensitive) | personal-bot.env | integrations/personal-bot/src/main.mjs | Unset; no polling | Private owner rules: thresholds, combinations, quiet hours, rate limits and mute state. File mode 0600. See the Personal Bot CONTRACT.md proposal section. |
| `ODESK_PERSONAL_BOT_CONFIG` | L3 device (sensitive) | personal-bot.env | integrations/personal-bot/src/personal-config.mjs | coding profile | Personal profile with skill and credential paths. |
| `ODESK_PERSONAL_BOT_AUDIO_DEVICE` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | default | ALSA capture device. Windows requires the exact DirectShow device name. |
| `ODESK_PERSONAL_BOT_CAPABILITIES` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Empty | Paths to trusted capability modules. |
| `ODESK_PERSONAL_BOT_MODEL` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | — | Pi provider/id model selection. |
| `ODESK_PERSONAL_BOT_STT_KEY_FILE` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Unset | Required only for a nonlocal transcription endpoint. |
| `ODESK_PERSONAL_BOT_STT_LANGUAGE` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | zh | Two or three lowercase letters for a language code. |
| `ODESK_PERSONAL_BOT_STT_MODEL` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | whisper-1 | The local bridge ignores this value. No setting is required. |
| `ODESK_PERSONAL_BOT_STT_PROMPT` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Built-in Chinese context | Maximum 1024 UTF-16 code units. An empty value disables the context. |
| `ODESK_PERSONAL_BOT_STT_PROVIDER` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | openai | Declared request shape: openai uses multipart audio; aliyun uses DashScope JSON with inline audio. Never infer the provider from the URL. |
| `ODESK_PERSONAL_BOT_STT_URL` | L3 device | personal-bot.env | integrations/personal-bot/src/main.mjs | Cloud OpenAI endpoint | Explicit endpoint. If absent, derive a loopback endpoint from ODK_STT_PORT. |
| `ODESK_WORKSPACE` | L3 device | runtime.env | runtime/shell/src/main.js, runtime/shell/src/user-app-system.js, integrations/personal-bot/src/main.mjs | — | Writable checkout shared by Shell and Personal Bot. |
| `ODK_ELECTRON_HEADERS_URL` | L2 build | Builder | runtime/shell/scripts/build-native.mjs | https://electronjs.org/headers | Electron header source. Use a mirror if the build host cannot reach GitHub; npm_config_disturl also applies. Set this override for the remote Windows handheld build when required. |
| `ODK_CANDIDATE_RELEASE` | L2 install | cm5-install.sh → update-runtime.js | runtime/shell/scripts/update-runtime.js | — | Absolute candidate release path for this activation transaction. |
| `ODK_CLIPROXY_MANAGEMENT_KEY` | L3 device (sensitive) | runtime.env | runtime/shell/src/opencode-go.js | — | Management key value. Prefer the file form. |
| `ODK_CLIPROXY_MANAGEMENT_KEY_FILE` | L3 device | runtime.env | runtime/shell/src/opencode-go.js | — | Management key file path. |
| `ODK_CLIPROXY_URL` | L3 device | runtime.env | runtime/shell/src/opencode-go.js | — | CLIProxyAPI management endpoint. Match the tunnel forwarding port. |
| `ODK_CM5_TARGET` | L2 build | cm5-stage-release.sh | runtime/shell/scripts/cm5-stage-release.sh | cm5 | SSH target alias. |
| `ODK_DESK_LINK_BIND` | L3 device | runtime.env | runtime/shell/src/desk-link-service.js | — | Listener address override. |
| `ODK_DESK_LINK_CONTROL_CREDENTIAL` | L3 device (sensitive, transitional) | runtime.env | runtime/shell/scripts/desk-link-service.js | Unset | Transitional environment credential. Use ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE instead. If absent, the desk accepts reports only. |
| `ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE` | L3 device (sensitive) | runtime.env | runtime/shell/scripts/desk-link-service.js | Unset | Preferred control credential file, mode 0600. Match the Console credential. |
| `ODK_DESK_LINK_PORT` | L3 device | runtime.env | runtime/shell/scripts/desk-link-service.js | 8765 | Listener port. Match the Console port. |
| `ODK_DESK_LINK_SOCKET` | L3 device | runtime.env | runtime/shell/scripts/desk-link-service.js | Host runtime default | Desk Link service IPC socket. |
| `ODK_DESK_LINK_TOKEN` | L3 device (sensitive, transitional) | runtime.env | runtime/shell/scripts/desk-link-service.js | Unset | Transitional environment reporting token. Other processes of the same user can read it. Prefer ODK_DESK_LINK_TOKEN_FILE; the file form takes priority. |
| `ODK_DESK_LINK_TOKEN_FILE` | L3 device (sensitive) | runtime.env | runtime/shell/scripts/desk-link-service.js | Unset | Preferred reporting token file, mode 0600. Match the reporting client token. |
| `ODK_HOSTED_PI_SOCKET` | Test | Test process | runtime/shell/src/desk-link-host-adapter.js | Read endpoint.json | Explicit override for isolated operation/tests. Production reads the daemon endpoint descriptor. |
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
| `ODK_PI_SSH_COLLECTOR` | L3 device | shell drop-in | runtime/shell/src/pi-sessions-source.js | — | Absolute collector path on the remote host. |
| `ODK_PI_SSH_HOST` | L3 device | shell drop-in | runtime/shell/src/pi-sessions-source.js | — | Remote Pi collection host. |
| `ODK_PI_SSH_NODE` | L3 device | shell drop-in | runtime/shell/src/pi-sessions-source.js | — | Absolute Node path on the remote host. |
| `ODK_RUNTIME_ROOT` | L2 install | cm5-install.sh | runtime/shell/src/user-app-context.js, runtime/shell/scripts/cm5-acceptance.sh, runtime/shell/scripts/cm5-install.sh, runtime/shell/scripts/cm5-stage-release.sh, runtime/shell/scripts/migrate-runtime.js, runtime/shell/scripts/start-kiosk.sh, runtime/shell/scripts/update-runtime.js | /opt/open-deskos | Root for releases and mutable state. |
| `ODK_STAGING_ID` | L2 build | cm5-stage-release.sh | runtime/shell/scripts/cm5-stage-release.sh | timestamp-$-random | Isolated staging directory identifier. |
| `ODK_STT_PORT` | L3 device | stt-bridge unit (runtime.env override) | integrations/local-stt-bridge/scripts/provision-stt-bridge.sh, integrations/personal-bot/src/main.mjs | 17840 | Single declaration of the local STT port. The bot derives its endpoint from this value. |
| `ODK_WEATHER_LAT` | L3 device | runtime.env | runtime/shell/src/weather-source.js | — | Weather latitude. A valid latitude/longitude pair disables location lookup. |
| `ODK_WEATHER_LON` | L3 device | runtime.env | runtime/shell/src/weather-source.js | — | Weather longitude. A valid latitude/longitude pair disables location lookup. |
| `ODK_WEATHER_PLACE` | L3 device | runtime.env | runtime/shell/src/weather-source.js | — | Weather location name. |
| `OPEN_DESKOS_CONFIG_DIR` | L3 device | Plugin CLI | runtime/shell/scripts/open-deskos-plugin-cli.js | ~/.config/open-deskos | Plugin CLI configuration directory. |
| `PATH` | Environment | Unit / installer | runtime/shell/scripts/cm5-install.sh | — | Units pin Node and shim directories. Do not depend on an interactive version manager PATH. |
| `PI_AGENT_DIR` | Environment | Pi runtime | runtime/shell/src/pi-sessions.js | ~/.pi/agent | Pi session and authentication directory. |
| `ODESK_FUTU_SERVICE_REVISION` | L3 device | runtime.env | runtime/shell/src/main.js, integrations/futu-poller/poller.py | dev | Futu revision. The handshake and expected revision use this single declaration. |
| `SystemRoot` | Environment | Windows user session | integrations/personal-bot/src/candidate-checks.mjs | — | Pass through SystemRoot and WINDIR in the minimal Windows coding_check child environment. They are session values, not host configuration. |
| `WINDIR` | Environment | Windows user session | integrations/personal-bot/src/candidate-checks.mjs | — | Pass through with SystemRoot so Windows child processes can resolve system directories. |
| `SERVICE_ID` | External tool | External consumer integrations/futu-poller/poller.py | integrations/futu-poller/poller.py | futu-poller | Service identity. The Shell registry uses this same protocol identity. |
| `WAYLAND_DISPLAY` | Environment | Graphical session | runtime/shell/src/main.js | — | Select the Ozone platform hint for a Wayland session. |
| `WEREAD_API_KEY` | L3 device (sensitive) | runtime.env | runtime/shell/src/weread-source.js | — | WeRead synchronization credential. |
| `XDG_RUNTIME_DIR` | Environment | Login session | runtime/shell/src/platform/index.js, runtime/shell/src/main.js, runtime/shell/src/remote-bridge-client.js, integrations/remote-bridge/lib/remote-bridge.js, integrations/personal-bot/src/runtime-channel.mjs, integrations/personal-bot/src/host-paths.mjs | — | Unix IPC/runtime root. The platform names local endpoints; Windows uses token-authenticated named pipes. |
| `XDG_STATE_HOME` | Environment | Login session | runtime/shell/src/main.js, runtime/shell/src/platform/index.js, integrations/personal-bot/src/host-paths.mjs | ~/.local/state | Persistent state directory. |

## Weather location and privacy

Set `ODK_WEATHER_LAT`, `ODK_WEATHER_LON` and optional `ODK_WEATHER_PLACE` in `runtime.env` for a fixed location. Valid coordinates disable all location requests.

A host with no location asks a keyless IP location service during weather refresh. The default endpoint is `https://ipwho.is/`. It accepts `loc: "lat,lon"` or `latitude`/`longitude` with `city`. The response remains cached for `ODK_LOCATION_REFRESH_MS` (30 minutes by default). This sends a request to a third party. Configure coordinates to prevent it.

Requests have a three-second timeout. A failed lookup reports Unavailable with a reason. It never blocks rendering or invents a city. The renderer does not perform the lookup.

## Personal Bot judgment and generation

| Variable | Layer | Default | Consumer | Kind | Note |
| --- | --- | --- | --- | --- | --- |
| `ODESK_JEV_KEY_FILE` | device | none | integrations/personal-bot/src/jev-client.mjs | config | Private credential path; never expose file contents |
| `ODESK_JEV_MODEL` | device | jev-latest | integrations/personal-bot/src/jev-client.mjs | config | Mandatory typed intent and proactive judgments |
| `ODESK_JEV_INTENT_THRESHOLD` | device | 0.8 | integrations/personal-bot/src/intent-routing.mjs | config | Minimum selected probability and confidence; initially uncalibrated, must exceed 0.5 |
| `ODESK_JEV_THRESHOLD` | device | 0.8 | integrations/personal-bot/src/proactive-jev.mjs | config | Minimum usefulness and factual support |
| `ODESK_JEV_TIMEOUT_MS` | device | 10000 | integrations/personal-bot/src/jev-client.mjs | config | Judgment deadline, integer 1000 through 30000 milliseconds |
| `TYPESAFE_API_KEY` | device | none | integrations/personal-bot/src/jev-client.mjs | config | Private environment credential fallback |
| `ODESK_PROACTIVE_GENERATION_TIMEOUT_MS` | device | 90000 | integrations/personal-bot/src/agent.mjs | config | Total generation deadline, integer 1000 through 180000 |
