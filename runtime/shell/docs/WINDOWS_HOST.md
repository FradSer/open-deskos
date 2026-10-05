# Windows Shell Host runbook

Windows 10/11 x64 is a supported Shell Host. Windows on ARM is not supported. CM5/Linux arm64 remains the reference host. Both use the same Shell. See [ADR-0023](ARCHITECTURE.md#adr-0023) and [Windows scenarios](../tests/features/windows-shell-host.feature).

Run deployment, service installation, firewall changes and live microphone checks only after operator authorization. Local tests do not establish device acceptance.

## Install and start

Use Node 22 or later and the pnpm version declared by `packageManager`. Bash, WSL and Git Bash are not required. The optional native reader also needs Visual Studio Build Tools with C++ and Python.

```powershell
cd runtime\shell
pnpm install
pnpm start
pwsh -File run.ps1
pwsh -File run.ps1 -Kiosk
```

`run.ps1` reads `.env.local`. Its format is one `KEY=VALUE` per line with `#` comments. Keep the file out of Git and release artifacts. The default content size is 1920×1280. To set another development size:

```powershell
$env:ODESK_SHELL_WIDTH = '1280'; $env:ODESK_SHELL_HEIGHT = '800'; pwsh -File run.ps1
```

## Native process reader

```powershell
pnpm run build:native
```

The artifact is `native\odk-process\build\Release\odk_process.node`. The build uses Electron headers and ABI. Non-Windows builds are a no-op. Build or load failure never blocks the Shell. It uses the managed process source and reports unreadable working directories as unknown.

The build script loads the artifact in Electron with `ELECTRON_RUN_AS_NODE=1`. Keep `win_delay_load_hook=true` in `binding.gyp`: Windows exports symbols from `electron.exe`, not `node.dll`. A missing hook can cause `Module did not self-register`. The probe uses a temporary file and calls Electron directly, without a command shell. See [native reader](WINDOWS_HOST.md#native-reader-implementation).

Stop the `OdkDesk` task before a rebuild. Killing Electron alone is insufficient because the task restarts it and holds the native artifact open. Start the task again after the build. Git and the release tool do not carry this artifact.

## Acceptance

```powershell
node tests\smoke.mjs
node --test tests\*.test.js
pnpm run build:native
```

`tests/smoke.sh` delegates to `tests/smoke.mjs`. A window check requires a graphical session. It fails if that session is absent. Run GUI tests in the interactive task described below.

## Capabilities and limits

| Surface | Windows contract |
| --- | --- |
| Remote Control / Remote Bridge | Not ported. The Unix link and service are absent. Report unavailable/disconnected. |
| Voice Agent / Personal Bot | Ported. Use ffmpeg DirectShow and the token-authenticated `\\.\pipe\open-deskos-personal-bot` channel. A stopped service reports unavailable. |
| Desk Link | Ported. TCP reporting listener defaults to 8765. The runtime channel is `\\.\pipe\open-deskos-desk-link`. |
| Desk Data | Ported on both sides. Shell and bot use `\\.\pipe\open-deskos-desk-data` with the host channel token. |
| External package control | Ported on both sides. Use `\\.\pipe\open-deskos-user-app-control` with the host channel token. Install/update/rollback/remove remain available. |
| P4 camera tile | Unavailable. Windows has neither `v4l2-ctl` nor `/dev/open-deskos-p4-camera`. |
| Futu Service Plugin | Ported. Use the declared socket, pipe or TCP endpoint. A remote plugin requires the host channel token. |
| CM5 GPU/HDMI/touch gates | Not applicable to this host. Windows needs its own device evidence. |

`src/platform/` owns state paths, endpoint names, executable-name rules and process sources. Other Shell and Widget/App contracts are shared.

## Runtime authentication

Unix sockets use ownership: private directory mode `0700`, socket mode `0600`, UID checks and refusal to delete a foreign or live socket. Keep that contract unchanged.

A Windows named pipe cannot use these ownership checks. The channel uses a 32-byte random token in `%LOCALAPPDATA%\open-deskos\local-channel.token`. The first connection line is `{"v":1,"token":"…"}\n`. The listener checks it in constant time and removes it before the channel protocol reads data. A missing or wrong token closes the connection. The token file is restricted to the user profile. Administrators can still read it, as they can read the process.

Unix clients that predate the token remain valid where ownership authenticates them. A presented but invalid token is always refused. See [ADR-0025](ARCHITECTURE.md#adr-0025).

## Desk Link service

Set these values in `runtime\shell\.env.local`. `run.ps1` loads the file; other launchers must load it explicitly.

| Setting | Purpose |
| --- | --- |
| `ODK_DESK_LINK_TOKEN_FILE` | Absolute path to a nonempty reporting token file |
| `ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE` | Separate control credential file. Leave unset for report-only operation. |
| `ODK_DESK_LINK_PORT` | TCP port, default 8765 |

The service runs as interactive task `OdkDeskLink` with a restart loop. Its wrapper loads `.env.local` and runs `scripts/desk-link-service.js`. Use the provisioning script:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-desk-link.ps1 -Report
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-desk-link.ps1 -Start
```

Register tasks from SSH or the login session. A scheduled task cannot register another task. Logs are in `%LOCALAPPDATA%\open-deskos\desk-link.log`. The wrapper separates native diagnostic output from crashes so an informational stderr line does not stop its restart loop.

Allow the listener port once from an elevated session:

```powershell
New-NetFirewallRule -DisplayName 'Open DeskOS Desk Link' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8765 -Profile Any
```

Read a snapshot from the running service:

```powershell
node -e "require('./src/desk-link-client').createDeskLinkClient().snapshot().then(s => console.log(s.ok, (s.sessions||[]).length))"
```

`ok true` proves that the pipe token was accepted and the protocol answered. It does not prove Hosted Pi or physical input acceptance.

## Futu Service Plugin

The plugin connects to the desk and pushes readings. The desk does not acquire gateway credentials. Example local listener configuration:

```ini
ODK_FUTU_ENDPOINT=tcp://100.82.50.70:8790
ODESK_FUTU_SERVICE_REVISION=dev
```

Allow the port from an elevated session:

```powershell
New-NetFirewallRule -DisplayName 'Open DeskOS Futu Plugin' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8790 -Profile Any
```

For a pipe/TCP target, give the plugin the destination host token through a private mode-`0600` file. Never put it on a command line. Unix socket clients can use ownership without a token. One plugin can feed multiple desks; one failed target does not stop the others. Keep RSA keys and trade passwords on the gateway/poller machine.

The following device check reads but does not print the token:

```powershell
node -e "const n=require('node:net');const fs=require('node:fs');const t=fs.readFileSync(process.env.LOCALAPPDATA+'\\open-deskos\\local-channel.token','utf8').trim();const s=n.connect(8790,'100.82.50.70',()=>{s.write(JSON.stringify({v:1,token:t})+'\n');s.write(JSON.stringify({v:1,type:'hello',service:'futu-poller',revision:'dev',proto:1})+'\n')});s.on('data',(d)=>{console.log('ack: '+d.toString().trim());s.end()})"
```

An `ack` with `ok:true` proves the token and service handshake were accepted.

## Personal Bot

The same `integrations/personal-bot` runs on Windows. Capture uses DirectShow instead of ALSA. Configure `%LOCALAPPDATA%\open-deskos\runtime.env` for the shared `ODESK_WORKSPACE`. Put bot/provider settings in `%LOCALAPPDATA%\open-deskos\personal-bot.env`:

```ini
# %LOCALAPPDATA%\open-deskos\personal-bot.env
ODESK_PERSONAL_BOT_STT_PROVIDER=aliyun
ODESK_PERSONAL_BOT_STT_MODEL=qwen3-asr-flash
ODESK_PERSONAL_BOT_STT_URL=https://maas.qianwenaiapi.com/api/v1/services/aigc/multimodal-generation/generation
ALIYUNCS_TOKEN=<host-local-credential>
ODESK_PERSONAL_BOT_AUDIO_DEVICE=麦克风 (Realtek High Definition Audio)
```

The microphone value must be the exact name that ffmpeg lists. Do not add the `audio=` prefix; ffmpeg adds it. The quoted device name above is an example of a real device label. The Unix `default` value does not identify a DirectShow input. A missing device or invalid name reports microphone unavailable without inventing a recording. ffmpeg stderr does not enter the public status.

The `aliyun` provider uses a multimodal JSON request. With no URL override it uses DashScope. A gateway needs its full endpoint URL. Provider selection is explicit; the bot does not infer it from the URL.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-bot.ps1 -Report
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\provision-personal-bot.ps1 -InstallFfmpeg -Start
```

`-Report` makes no changes. `-InstallFfmpeg` explicitly permits the dependency install. The bot runs in a logged-on interactive task with a restart loop. Session 0 has no audio endpoint. Logs are in `%LOCALAPPDATA%\open-deskos\personal-bot.log`.

Use the published protocol for acceptance:

```powershell
node scripts\personal-bot-acceptance.mjs
node scripts\personal-bot-acceptance.mjs --status
```

The first command performs live capture/provider work. `--status` only reads state. The bot needs its own host-local Pi model authentication. STT credentials do not authenticate the model. Configure an OpenAI-compatible provider in `~\.pi\agent\models.json`; the Shell does not log in on the bot's behalf.

Both `desk-data` and `user-app-control` resolve through the host platform and present its token. Production needs no `ODESK_*_SOCKET` override. Those overrides are for tests. `didi` in the personal profile remains unported; the default coding profile does not need it.

## State and private configuration

Persistent state is under `%LOCALAPPDATA%\open-deskos`. Pi sessions and authentication use `~\.pi\agent` or `PI_AGENT_DIR`. Use `.env.local` for Shell settings and the two host environment files for the bot. See [CONFIGURATION](CONFIGURATION.md) for the complete inventory and location privacy rules.

- Keep `ALIYUNCS_TOKEN` in `personal-bot.env`, never `.env.local` or a command line.
- `WEREAD_API_KEY` is the operator-provisioned WeRead credential. Historical handheld acceptance used the same authorized credential as CM5 and produced a live cache.
- `ODK_HYDRA_MQTT_URL` declares the local MQTT endpoint. Provision authentication separately if the broker requires it.
- Fixed weather coordinates disable third-party location lookup. An unconfigured mobile desk uses device location.
- CLIProxyAPI uses this host's forwarding-only SSH identity/tunnel and management key file.
- Desk Link and SSH collection use this host's own credentials. Do not copy a reference-host control token to a report-only desk.
- Do not move gateway RSA keys, trade passwords or unrelated personal-profile keys to this host. The local bot still needs its own Pi authentication.

## Interactive GUI checks

An SSH session runs in Session 0 and cannot display Electron windows. Register the check from SSH or the login session, then run it in the logged-on desktop:

```powershell
$settings  = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$action    = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\path\check.ps1'
Register-ScheduledTask -TaskName OdkCheck -Action $action -Trigger (New-ScheduledTaskTrigger -AtLogOn) -Principal $principal -Settings $settings -Force
Start-ScheduledTask -TaskName OdkCheck
```

Use the bare username in the principal. `USERDOMAIN\USER` failed for the observed Microsoft account. Task stdout is discarded. Write a log or use `Start-Transcript`, then copy the log back over SSH.

Use ASCII in remote `.ps1` scripts. PowerShell 5.1 reads BOM-less UTF-8 in the system code page; non-ASCII text can cause syntax errors before logging starts. If a script must contain non-ASCII text, save it with a UTF-8 BOM. Upload the file and invoke it with `-File`. Do not pass complex quoted PowerShell through SSH/cmd.

## Panel operation

Run in the interactive session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\windows-kiosk.ps1
```

The kiosk wrapper restarts the Shell after three seconds and writes `%LOCALAPPDATA%\open-deskos\kiosk.log` without a console window.

The panel covers the display, not the work area. It is not topmost and does not hide the host taskbar. Another foreground application regains its window and taskbar. Apply geometry after the Shell window is shown. Request fullscreen and display-bound `setBounds`; compare bounds every 400 ms and retry at most eight times. Stop once coverage is correct.

Do not use `isFullScreen()` as acceptance. On the measured frameless window it stayed false when bounds were already `0,0 1280x800`. A logon race had previously left the panel at `1280x728`. A new display-sized window also initially returned the `1280x776` work area.

The panel is not movable, resizable, maximizable or minimizable. Accepted device probes had no `WS_THICKFRAME`, `WS_MAXIMIZEBOX` or `WS_MINIMIZEBOX`; dragging and `Win+Down` left geometry unchanged. [ADR-0034](ARCHITECTURE.md#adr-0034) records the reason. `tests/kiosk-panel.test.js` covers retries; `tests/kiosk-window-order.test.js` covers order and host-shell availability.

Check the real window in an interactive session:

```powershell
Add-Type -Namespace Odk -Name W -MemberDefinition @'
[System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)]
public struct RECT { public int L, T, R, B; }
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool GetWindowRect(IntPtr h, out RECT r);
'@
$h = (Get-Process electron | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1).MainWindowHandle
$r = New-Object Odk.W+RECT; [void][Odk.W]::GetWindowRect($h, [ref]$r)
"panel {0},{1} {2}x{3}" -f $r.L, $r.T, ($r.R - $r.L), ($r.B - $r.T)
```

On the recorded 1280×800 handheld the expected bounds are `0,0 1280x800`. Verify drag/minimize with `SendInput`. Capture full-screen PNG with `Graphics.CopyFromScreen` and copy it back for inspection.

Stop the panel task before stopping its process:

```powershell
Stop-ScheduledTask -TaskName OdkDesk
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process
```

## Transfer changes with hash checks

The development checkout is the source. A transfer must match every selected file and exclude `.env.local` and device state.

1. Archive paths relative to the repository root: `tar czf change.tgz runtime/shell/src/…`.
2. Use `md5 -q` to create `change.hashes`. Each line is `<md5> <repository-relative-path>`. Include every archived file.
3. Copy both files with `scp` to `C:\Users\<user>\`.
4. Upload an ASCII `.ps1`. It calls the deploy script, extracts under `ODESK_WORKSPACE`, checks each hash, builds styles and restarts the desk. Any mismatch fails. Only full agreement may print `DEPLOY_OK`.
5. Register/start an interactive task from SSH. Poll a marker unique to this run. Copy the log back and read it before accepting the result.

PowerShell 5.1 `Join-Path` joins rather than resolves an absolute child. Pass relative archive names. SSH/cmd can consume quotes, pipes and redirects; put complex logic in the uploaded file. Old `DONE` markers are not completion evidence. Check task state with `schtasks /query`; use `/end` if a previous instance prevents the new run.

## Tailscale and SSH

Tailscale is provisioned during deployment. Reuse `C:\Program Files\Tailscale\tailscale.exe` if it exists. Never overwrite its configuration or log in for its owner. See [ADR-0024](ARCHITECTURE.md#adr-0024).

```powershell
powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1
powershell -ExecutionPolicy Bypass -File scripts\provision-tailscale.ps1 -Report
```

Installation needs elevation and is not part of Shell startup. Login remains the owner's action through `tailscale up` or the tray. Never store login credentials. Report the CLI state or failure reason.

Historical connection examples for the accepted handheld:

```sh
ssh -i ~/.ssh/id_ed25519 frads@100.82.50.70
ssh -i ~/.ssh/id_ed25519 frads@desktop-qlqd17f.tail27726.ts.net
ssh -i ~/.ssh/id_ed25519 frads@192.168.50.225
```

These are recorded addresses, not current reachability evidence. The development machine had no SSH alias for this device. The `frads` account was an administrator with high integrity over SSH. Its authorized keys file was `C:\ProgramData\ssh\administrators_authorized_keys`, not a file in the user profile. Changes require elevation. The recorded public key fingerprint was `SHA256:RNMyWZCU294srI7D8Eu5mUeD5KVnttqVKHKxZV5E/+I`.

Password authentication used the default at that inspection. If authorized to disable it, use a new session to verify key access after the restart:

```powershell
Add-Content C:\ProgramData\ssh\sshd_config "`nPasswordAuthentication no"
Restart-Service sshd
```

An owner can open `AuthURL` on another machine that reaches the identity provider. Read it from `tailscale status --json`; it enrolls the requesting host. Node key expiry is an owner-managed policy. A headless host needs a renewal plan before expiry. Use MagicDNS or `tailscale ip -4`; LAN access remains independent.

## Long operations and power

Connect external power before a long build/install. Disable sleep while plugged in, or run an approved keep-awake process:

```powershell
Add-Type -Namespace Odk -Name Power -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll")]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
while ($true) { [Odk.Power]::SetThreadExecutionState(0x80000001) | Out-Null; Start-Sleep -Seconds 30 }
```

Put long commands in a background task with a log so an SSH disconnect does not discard the result:

```powershell
Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', "$env:USERPROFILE\step.cmd" -PassThru -NoNewWindow
```

Task settings must allow battery start and must not stop on a battery transition. `pnpm install --ignore-scripts` skips the Electron download for Node-only checks; install Electron before GUI checks. If the normal download is blocked, an approved mirror can supply the binary. Extract it to `node_modules/electron/dist` and write `path.txt` as `electron.exe`.

## Remaining device limits

- The working directory can be unknown for higher-integrity, protected or WOW64 processes. Never infer it from executable/command text.
- Native enumeration can be denied by policy. Fall back to PowerShell; if that also fails, report process-source failure without fake sessions.
- `process.kill(pid, 0)` against a higher-integrity Pi process needs acceptance on the target host.
- The inherited process matcher can over-identify scripts named `pi`, such as `notepad.exe C:\tools\pi.js` or `cmd /c "echo pi"`. A long-lived false parent can hide a child as a worker. Changing the interpreter rule also changes CM5 behavior and needs its own change.
- Installer/portable packaging, boot autostart and physical touch/display-topology acceptance remain unverified by the cited fixture gates.
- Historical 2026-09 checks established pipe token handshakes, Desk Link listener behavior, device weather location and panel geometry on one 1280×800 handheld. They do not establish current device state, a different display, microphone quality or a complete release acceptance.

## Native reader implementation

An optional native addon for the Windows Shell Host. It is the only place the
desk reads another process's working directory, because Windows exposes it only
through the target's PEB.

### What it exposes

```js
const reader = require('./odk_process.node')

reader.listProcesses()
// [{ pid, ppid, exe, command, startedAtMs, cwd }]
// cwd and command are empty strings when the target cannot be read.

reader.processCwd(pid)
// '' when the target cannot be read.
```

A target at a higher integrity level, a protected process, and a 32-bit (WOW64)
target all answer with an empty directory. That is deliberate: the desk states a
session's work directory as unknown rather than decoding it with a layout that
does not apply.

### Build

```sh
pnpm run build:native
```

On a non-Windows host the script is a no-op. On Windows it builds against
Electron's headers, so the module matches the process that loads it:

```sh
node-gyp rebuild --directory=native/odk-process \
  --runtime=electron --target=<electron version> --arch=x64 \
  --dist-url=https://electronjs.org/headers
```

It needs a C++ toolchain (Visual Studio Build Tools with the C++ workload and
Python). Without it, the desk still starts: the shell falls back to a managed
process-table read and every session work directory reads as unknown.

### Loading

After a successful build the script loads the artifact inside Electron's own Node
(`ELECTRON_RUN_AS_NODE=1`). That step exists because compiling is not loading:
on Windows the symbols a native module needs are exported by `electron.exe`
rather than by a `node.dll`, so a module built without Electron's delay-load hook
compiles and then refuses to load with `Module did not self-register` or `The
specified procedure could not be found`. `binding.gyp` therefore keeps
`win_delay_load_hook` set to `true` at both the top level and the target; if the
load check ever fails, that variable is the first thing to inspect.

### Artifact

`build/Release/odk_process.node`, which Git ignores and the release tooling does
not stage. A Windows host builds it once after installing.
