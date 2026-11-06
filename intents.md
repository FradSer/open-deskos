# Development intents

This file records every owner request in this engagement. Read it before starting
work. A later intent can amend or supersede an earlier one. The `Supersedes`
field names the earlier intent. Do not treat an amended item as still open.

Work starts from the current repository state, not from this document alone.
Use `AGENTS.md` for repository rules and `PRODUCT.md` for product scope.

## Intent register

### I1. Merge all branches except three into main

Requested: "除了 cm5-mac-pi-tasks、openui-integration、paper-authority 之外其他分支合并进入 main".

Result: done. `main` received `fix/cm5-preflight` and `overview-meaningful`
through two merge commits. Four other target branches were already ancestors of
main. The three named branches stayed out. The owner's 17 in-flight edits were
preserved.

### I2. Deploy to Windows and CM5

Amends: none. Related to I1.

Result: done. Both hosts ran the same `d9102db5` content. CM5 used the release
pipeline with a host receipt, an immutable release, and a controlled activation
smoke. Windows used a hash-gated staged package, then activation with a prepared
state, task XML backups, and a rollback script.

### I3. Activate Windows

Amends: I2. I2 left Windows staged but not active.

Result: done. `OdkDesk`, `OdkDeskLink`, and `OdkPersonalAgent` were re-registered
against the new release. The panel measured `0,0 1280x800` in the interactive
session.

### I4. Fix the status bar branch feature

Requested: "fix staus bar 的分支的功能没有被合并，功能有问题".

Result: partly done, see I10. Investigation found `status-bar-handle-display`
was already an ancestor of main and its implementation was deployed. The real
defect was that commit `c34acd43` split one of its BDD scenarios:
`And no gamepad glyph appears in the State Bar` moved into an unrelated renderer
baseline scenario. Commit `ba6dda46` restored the scenario and added a
regression test.

Open: the owner has not confirmed that this matches the reported visual problem.

### I5. Optimize Liquid Glass: remove one capsule

Requested: "优化液体玻璃的设计，不需要有一个胶囊。fix all，然后给我集中主题的截图".

Result: done. Compared three designs. Chose frameless plain text under the
avatar. Removed the enclosing border, glass material, blur, and radius from the
Agent identity in Liquid Glass only. Kept the accessible group, its 44-pixel
target, its animation, and the framed capsule in other themes. Updated
`DESIGN.md`, the `.feature` scenario, and the affected renderer tests.
Produced `/tmp/odk-lg-theme-sheet-final.png`.

### I6. Systematic Overview fixes

Requested: "系统性 fix overview 是生成给人读的，现在的时间戳是不合适的，并且 and 的这个灰色不够灰色".

Clarified: the timestamp means text inside the generated sentence, not the
date stamp in the top right corner. The connector should use
`--odk-secondary`.

Result: done in the working tree.
- ISO timestamps and common timestamp field names became analysis context.
  They still inform attention scoring but never enter prose.
- `.dash-context` changed from `--odk-secondary-strong` to `--odk-secondary`.

### I7. Fix long decimal tails in Overview numbers

Requested: "overview 的数字也是，目前会有小数点后面很多位".

First result: numbers were limited to two decimal places. That preserved the
existing `2.75` contract.

Status: superseded by I8. Do not restore two-decimal display.

### I8. Remove all decimal places from Overview numbers

Superseded by the later Overview-number decision: values now keep up to two decimal places, and integers stay clean. See the current `home-template.mjs` formatter and `home-briefing.mjs` grounding check.

Supersedes: I7. Requested: "小数点后面不用保留".

Result: done in the working tree. Numbers are whole numbers only, rounded to
the nearest integer with ties away from zero. `+1%`, `-1%`, `0%`, `55%`, and
`26°C` are representative outputs. Signs and units survive so the renderer's
`dash-change` direction coloring still matches. The portfolio grounding
validator now proves an integer equals the current reading instead of a
two-decimal string; its strength is unchanged. Updated the BDD scenario, the
generation tests, the briefing tests, the preference tests, and
`docs/CONTRACT.md`. Verification: personal-agent full suite 1703 pass / 0 fail,
fast tier 2668 pass / 0 fail.

### I9. Update AGENTS.md on subagents and worktrees

Requested: "有限使用 sub agent 进行优化，必要时候可以使用新的 git worktree 进行隔离".

Result: done. Added `## Optimization work` to `AGENTS.md`.

### I10. Remove the peripheral icon capsule in every theme

Requested: "不管是哪一个主题，都需要去掉 status bar 里面 icon 外面的胶囊。你把两个 icon 放在一个胶囊里面没有意义。但是那个 π 是需要有个胶囊的，这个是设计".

Result: done in the working tree. `.sb-devices` lost its radius and was excluded
from the Liquid Glass blanket control rule. The Pi status keeps its framed
capsule. Added a BDD scenario and a four-theme renderer assertion.
Verification: `status-bar-style.cjs` passes 4 themes x 4 sizes;
`input-scroll-polish.cjs` passes 4 themes x 3 sizes; related Node contracts
28/28. Screenshot: `/tmp/odk-sb-captures/liquid-glass.png`.

### I11. Check and restore Overview generation preferences

Requested as part of: "之前 overview 的生成里应该有个功能要求，就是用户可以定义 overview 的生成偏好，比如我的偏好是'必须要增加持仓信息'。你先检查一下，这个功能好像被你干掉了。并且现在的版本里，比如持仓的数字应该是带颜色的，你好像也没用上带颜色这个能力。我想在这个基础上扩展一下：用户给的 overview 建议或偏好，应该放在一个用户级别的 MD 文件里，你可以参考 OpenClaw 的定义，然后选择一个合适的".

Finding: the feature is NOT removed. Proven end to end with the local API:
with five competing facts, an empty `mustShow` drops a low-score holding
(`Failed task is failed, Unread count is 42 and Remaining percentage is 2%`),
while `mustShow: ['futu']` reserves its slot
(`Today change is 0%, Failed task is failed and Unread count is 42`).
The module, CLI, `main.mjs` wiring, and `agent.mjs` pass-through all exist.

The real gaps: (1) the local `~/.config/odk/overview-preferences.json` is
missing, so the default empty `mustShow` applies; (2) `mustShow` accepts source
IDs only, not owner prose such as "必须要增加持仓信息". A workflow is researching
the OpenClaw convention and the user-level Markdown design.

Status: resolved as a diagnosis. I13 now makes the owner Markdown file the
authoritative preference source, so an owner can state the wish in prose.

### I12. Use the existing holding color capability

Requested in the same message as I11.

Finding: the color capability works. A live briefing with `+1.25%` renders a
`dash-change[data-direction="up"]` span in the healthy green. `shell.css` maps
up to `--odk-status-healthy` and down to `--odk-status-critical`. After I8 the
generator emits signed integers: `+1%`, `-1%`, `0%`. Integer direction cases
were added to the renderer test and pass. The likely reason the owner sees no
color is that no portfolio fact is selected: the local preference file is
missing, so `mustShow` is empty. This shares a root cause with I11.

Status: done. I13 lets the owner state `Always show: holdings`, which reserves
a portfolio slot, and the signed integer keeps the color direction. Verified
end to end: the renderer emits `dash-change[data-direction="up"]` for `+1%`
and `down` for `-1%`. No device-side preference file was created yet; the
owner must supply one or authorize its creation.

### I13. Put owner Overview preferences in a user-level Markdown file

Requested in the same message as I11. Reference OpenClaw, then choose a suitable
convention.

Result: done in the working tree. Two independent research lenses confirmed
OpenClaw is a real product (Peter Steinberger's self-hosted personal Agent
Gateway, formerly Clawdbot/Moltbot) whose user-level preference file is
`USER.md`: dated imperative directives with a 4,000-character bootstrap cap.

Chosen design: `~/.config/odk/overview-preferences.md` (override with
`ODK_OVERVIEW_PREFERENCES_MD`; Windows uses the `%LOCALAPPDATA%\odk` mirror),
owner-owned, mode `0600`, 8,192-byte cap. The host compiles a CLOSED directive
vocabulary (`Always show: holdings`, `Never disclose: Pi sessions`) into the
existing validated `mustShow` / `privateSources` ID sets. Prose is untrusted
data: it never enters a model prompt, never selects a tool, and unknown or
superseded directives are reported as unapplied. The retired JSON path,
`ODK_OVERVIEW_PREFERENCES_FILE`, and the JSON writer were removed; the CLI now
writes Markdown. Updated `CONTRACT.md`, `CONFIGURATION.md`, and
`PERSONAL_AGENT_DEPLOYMENT.md`.

Verification: `overview-preferences.test.mjs` 9/9, personal-agent full suite
1707 pass / 0 fail / 10 skipped, `config-inventory.test.js` 4/4.

Status: implemented. Device-side preference files were not created; that needs
separate owner authorization.

### I14. Create intents.md and develop from it

Requested: "整理一个本项目 intents.md。作用是记录我每次给你提的诉求，有些诉求可能是针对之前的诉求进行修改。后续你就用这个 intents.md 去进行开发，并且满足我所有的诉求".

Result: this file. Keep it current. Add each new request. Mark an item as done
only with verification evidence.

### I15. CM5 lightweight sandbox capability in a new git worktree

Requested: "在新的 Git worktree 里面去做一件事：我希望在 CM5 上运行的版本能够利用 Linux 的特性，使用类似于沙盒之类、比 Docker 更轻量的环境来运行。比如我现在的持仓服务用的是富途的 OpenD，目前跑在 Docker 上。我希望把这个迁移到 Linux CM5 上，但这是一套系统范式，我希望你能提供一个类似于沙盒的能力，让整个服务完全跑在这台 CM5 上".

Status: in progress. Created branch `feat/cm5-linux-sandbox` in the new
worktree `.pi/worktrees/cm5-linux-sandbox`, based on main `50565421`.
Measured CM5 host facts: kernel 6.1.43-rockchip-rk3588, cgroup v2 with
cpuset/cpu/io/memory/hugetlb/pids/rdma, all namespaces including user and
time, `unshare` and `systemd-run` present, systemd 252. Docker IS installed:
`/usr/bin/docker`, `docker` and `containerd` are active, with images including
`odk-gmail-cm5:20261024-v1` and `odk-futu-cm5:acceptance-final-v2`. No
bubblewrap, firejail, nspawn, or podman. An earlier note wrongly said "no
Docker"; that came from `docker ps` showing no running container, not from an
absent daemon.

Correction from three independent research lenses: FutuOpenD 10.2.6208 has no
native arm64 build, so the claim "the whole service runs entirely on CM5" is
not achievable today through a native port. Do not retire the NAS. The
reusable sandbox capability IS achievable: extend the existing
`integrations/service-runtime/` with a declarative systemd-native sandbox
profile, with no image, no daemon, and no new package.

Implemented in the new worktree: a BDD scenario in
`features/systemd-runtime.feature`, a failing regression test, and a sandbox
profile in `odk_service_runtime/systemd_controller.py`. The generated unit now
adds `ProtectSystem=strict`, `ProtectHome=read-only`, `PrivateTmp`,
`ProtectKernelTunables/Modules/ControlGroups`, `RestrictSUIDSGID`,
`LockPersonality`, `MemoryDenyWriteExecute`, `RestrictAddressFamilies`, and
`ReadWritePaths` for the owned roots. `ProtectHome=true` was rejected because
CM5 managed services live under `/home/orangepi`; it would hide their launcher
and state. Verification: 76 service-runtime tests OK (1 skipped). Two
pytest-based files could not run because pytest is not installed in this
worktree; that is an environment limit, not a code failure.

Not done: no deployment, no service installation, no activation, no NAS
retirement, and no physical CM5 acceptance. These need separate owner
authorization. A workflow is still finishing the full design.

### I16. X11 virtual environment runs in parallel with the sandbox

Requested: "记得沙盒和我之前要做的虚拟环境（那个叫 X11 ）是可以并行，你检查一下".

Identification: the X11 virtual environment is `integrations/xfce-agent/`, an
isolated KVM/QEMU guest on CM5 with Debian 13 ARM64, XFCE, X11, and Chromium.
Its README states that scope. It was added in commits `73c9ad47` and
`32cd3355`. TODO.md separately lists "设计 Personal Agent 虚拟机接入方案" as
"Not Started" with "No commits found"; that tracking note is now stale, but it
names a real remaining design task: how the resident Personal Agent connects
to a VM. Keep both layers: the implemented XFCE guest, and the unpublished
integration design. The separate Xvfb usage in `runtime/shell/README.md` is a
headless test display, not this virtual environment.

Parallelism with I15: verified safe at the file and host layers.
- No shared file: `xfce-agent/` and `service-runtime/` have zero common paths
  and no cross-imports.
- No shared systemd scope: the sandbox edits host user units named
  `odk-service-*.service`; `xfce-agent` uses `odk-fixture.service` INSIDE the
  guest.
- No shared port: the VM uses 18022/18081/18082 and QMP/VNC sockets under
  `/run/user/1000/odk-xfce-lab/`; service-runtime uses none of them.
- No shared credential or release path: the VM pool is
  `/mnt/ssd/open-deskos/vm-lab/xfce-fixture-v1`; the sandbox uses the managed
  service root and state directory.
- Measured CM5 state: no QEMU process, no lab sockets, no 180xx listener, and
  no running Docker container. The VM is stopped. 12,116 MiB memory is
  available, 8 CPU cores exist, cgroup v2 exposes cpuset/cpu/io/memory/pids,
  and the SSD pool has 421 GiB free. Both efforts are development-only; neither
  is deployed or activated.

Resource caution: the root filesystem has only 727 MiB free at 98 percent.
The VM disk pool is on the SSD, and the sandbox adds no image. Any new release
or image on the root filesystem needs space review first. A running VM uses
2 vCPUs, 4096 MiB RAM, and A76 host cores 4 through 7.

Conditions: keep I15 in its own `feat/cm5-linux-sandbox` worktree and give the
X11 work a separate worktree with non-overlapping file scope. Do not activate
both CM5 workloads at once without a resource budget. Device acceptance for
either remains separate and needs authorization.

Status: checked. No code change was needed for parallelism. Update the stale
`TODO.md` note when its owner resolves it.

### I17. Clean CM5 and prevent root disk exhaustion

Requested: "清理CM5，并且优化部署的脚本，避免根分区只剩 727 MiB（98%）的问题".

Root cause: each deploy appends one immutable ~869 MiB release with its own
217 MiB Electron binary. Ten retained releases used 8.5 GiB. Historical
state backups used 2.9 GiB. Activation returns `pruned: []` by ADR-0018, so
nothing ever removed old releases.

Device cleanup, done with the owner's authorization:
- Kept `current` (`20261104T130608Z-1281163`) and `previous`
  (`20261104T084519Z-1231660`), plus `runtime-state.json` and `migrations/`.
- Removed eight unreferenced releases after verifying symlinks, runtime state,
  process executable paths, unit fragments, service-runtime handles, an absent
  update lock, and no deployment in flight. Manifest:
  `/tmp/odk-cm5-cleanup-manifest.txt`.
- Removed 43 historical `.tar.gz` / `.tgz` backups under `/opt/odk/state`
  (1.49 GiB). Kept the containing directories and their JSON evidence.
  Manifest: `/tmp/odk-cm5-state-archives.txt`.
- Removed one stale `/tmp/odk-merge-e2e-FpEwk2ol` test snapshot (1.3 GiB).
- Result: root filesystem from 727 MiB free (98%) to 9202 MiB free (66%).
  `/opt/odk/releases` fell from 8.5 GiB to 1.7 GiB; `state` from 2.9 GiB
  to 1.4 GiB. All four user services stayed active, the kiosk kept running
  from `current`, and the renderer answered on the debug port.

Correction: `/tmp`, `/run`, `/dev/shm`, and `/var/log` are tmpfs or zram, and
`/boot` and `/mnt/ssd` are separate filesystems. They do not consume the root
ext4 partition. Only the releases and state archives reclaimed root bytes.
`deployment-backups/` (424 MiB), `deployment-inputs/`, the `*.plan.json`
files, and `/opt/rkllama` (6.0 GiB) plus `/opt/qwen3-asr-1.7b` (4.9 GiB)
were deliberately kept. The two model directories had no process or unit
reference but remain owner assets, not garbage.

Deployment script changes, done in the main worktree:
- `cm5-stage-release.sh`: a device disk preflight with
  `ODK_STAGE_MIN_FREE_MB` (default 2500 MiB) runs before any SSH directory
  or rsync work. It fails closed and reports measured and required space.
- `cm5-install.sh`: the same floor is rechecked before `pnpm install`. A
  `cleanup_partial_release` trap removes only an unactivated candidate on
  failure; `RELEASE_ACTIVATED=1` protects the release after activation.
- `cm5-acceptance.sh`: a new informational `root-disk-headroom` check reports
  free MiB, the reserve, the release count, and state size.
- `CONFIGURATION.md` documents `ODK_STAGE_MIN_FREE_MB`.
- Added BDD scenarios in `runtime-release.feature` and regression tests in
  `cm5-acceptance.test.js`. ADR-0018 stays intact: no historical release is
  deleted by the activation transaction, and the planner stays read-only.

Verification: affected release/deployment Node contracts 196 tests / 195
pass / 0 fail / 1 skipped; fast tier 2677 tests / 2674 pass / 0 fail /
3 skipped; `bash -n` on all three scripts; a fixture acceptance run includes
`root-disk-headroom`; the device `df -Pk` command used by the preflight
returns 9202 MiB, above the 2500 MiB floor. A fake-SSH fixture in
`service-runtime-packaging.test.js` now answers the `df -Pk` probe.

Limits: the script changes are in the working tree and are NOT deployed. The
device still runs the old `cm5-acceptance.sh` without the new check; a device
run reports the previously known eleven headless-Session-0 display failures,
which are unrelated to this change. Deploying the new scripts needs separate
authorization. A separate retention tool for old releases and state backups
is not built; the read-only planner and the new preflight cover the risk.
Any future bulk deletion needs a fresh reference check.

Status: done.

### I18. Merge openui-integration and deploy to CM5 and Windows

Requested: "合并 openui-integration 分支，部署到 cm5 和 win".

Clarified: include this session's in-flight changes in the commit before
deploying. Concurrent work in the shared tree was NOT staged. Other agents'
renderer plugin comment removals, `.memory/` notes, `TODO.md`, and the
`DSH_SUPERAGENT_COMPARISON.md` draft remain uncommitted in the main worktree.

Result: done. `main` is merge commit `fff7918` with parents `6b1e97c5`
(previous main) and `c0a5d2a2` (openui-integration). The merge kept both
proactive judge imports, both test helpers, and the OpenUI test bodies. It
resolved five conflicts, updated the frozen `index.html` fixture pin, and
added a precise exception to `renderer-localization.test.js` for the two
Chinese Personal Agent protocol phrases that `intents.mjs` matches exactly.
`@openuidev/lang-core` 1.0.2 was already declared in the branch's
`package.json` and lockfile.

Verification before deployment: fast tier 2689 tests / 2685 pass / 0 fail /
4 skipped; personal-agent full suite 1742 tests / 1731 pass / 0 fail /
11 skipped with `PI_ODK_PACKAGE` set to the external fixture checkout;
`node --check` on every changed JS file; `pnpm install --frozen-lockfile`
resolved `@openuidev/lang-core` and both modules imported successfully. A
workflow independently confirmed the four-block test conflict resolution.

CM5: release `20261105T033232Z-1334485` is active. The previous release
`20261104T130608Z-1281163` is the rollback target. Host receipt
`9628e20f...` passed. Activation returned `ok:true`, `pruned: []`, and a
passing smoke. Four user services are active, the kiosk runs from the new
release, the renderer answers on the debug port, `@openuidev/lang-core` is
present, and the root filesystem has 8.2 GiB free at 69 percent.

Windows: release `20261105-main-fff7918` is active with
`sourceCommit: fff7918`. Hash-gated staging verified 1669 files. Prepare,
validate, and activation all passed. Three tasks are running. The new
personal-agent dependency was installed, the pnpm symlink repair restored
`markdown-it`, and the Electron binary was restored after pnpm removed its
dist directory. The `openui-contract.mjs` module loaded successfully on the
device.

Status: done. Both hosts run the same merged content. A Windows panel
geometry check in the interactive session was not repeated. Physical touch,
microphone, GPU, and screen-reader acceptance remain separate.

### I19. Windows shows no OpenUI effect after the deployment

Reported: "win 上的版本没有看到 openui 的效果！".

Diagnosis: the deployed code was correct. `openui-dom.js` is present in the
active release, `index.html` loads it, and an isolated Electron window on the
device confirmed `odkOpenUIDOM.renderOpenUI` exists and renders
(`ok:true, rendered:true`). The local merged tree also passed 91 OpenUI
contract tests.

The real cause was TWO stale processes from the previous release
`20261104-main-d9102db5` that the activation task failed to stop:
- Its `display-client.mjs` (PID 9000) kept the `\\.\pipe\odk-personal-agent`
  named pipe. The new display client failed every 10 seconds with
  `another service is already listening`, so the Personal Agent relay and its
  proposal cards never appeared. OpenUI cards are driven by that relay.
- Its `odk-link-service.js` (PID 25116) kept TCP `100.82.50.70:8765`. The new
  Link service failed with `EADDRINUSE` on the same restart loop.

Fix: stopped `OdkPersonalAgent` and `OdkDeskLink`, killed only the two stale
process trees that named the old release path, and restarted both tasks.
The display client (PID 20924), Link service (PID 9464), and kiosk now run
from `20261105-main-fff7918`. Link logs `listening on 100.82.50.70:8765`;
personal-agent logs show no further startup failure. Zero old-release node
processes remain, and all three production tasks are running. Diagnostic
scheduled tasks and probe files were removed.

Cause of the stale processes: the activation script captured 0 old processes
because it matched only the immediately previous release path. A service
wrapper can respawn its child from an older release path. Any future Windows
activation must capture the whole owned process tree by pipe/port ownership,
not by one release path.

Status: fixed on the device. The activation script itself was not changed;
that remains a follow-up. Physical touch, microphone, GPU, and screen-reader
acceptance remain separate.

### I20. Reduce the Reply button right padding

Requested: "fix：reply 按钮的距离右边的 padding 需要减小一点，和下方的 padding 保持一致。"

Result: done in the release worktree. `.agent-session-reply` used
`padding: 10px 14px`; the 14px horizontal padding is now `10px`, so the right
padding equals the bottom padding. Added a BDD step in
`personal-agent.feature` and two symmetric measurements in `agent-radius.cjs`
(`replyPaddingRight` / `replyPaddingBottom`) that fail before the change.
Verification: `agent-radius.cjs` PASS across four themes,
`agent-type-scale.cjs` PASS, fast tier 2689 tests / 2685 pass / 0 fail /
4 skipped.

Version note: the active Windows release and `main` are byte-identical for all
three renderer files (`personal-agent.js`, `personal-agent-status.css`,
`home-desk.css`). The earlier "Reply radius is not the latest version" report
was caused by stale kiosk processes, not by stale CSS; see I19. This padding
change is NOT deployed yet.

### I21. Windows desktop should fill the screen like a game

Requested: "这个服务在 Windows 应该是类似游戏的那样的全屏".

Finding: the panel already covers the full 1280x800 display, and `panel.js`
calls `setFullScreen(true)` on Windows. A captured screenshot shows a separate
Windows Terminal window covering the panel and the taskbar visible at the
bottom. That was ADR-0034 behavior: the panel was not topmost, did not hide
the taskbar, and another foreground application regained host control because
the machine runs other applications.

Superseded by I22. The owner clarified "「类似游戏的全屏」是底部不要看到Windows
任务栏，并且也不能用触控触发", which overturned ADR-0034's "not topmost,
taskbar visible" clause. Status: decided and implemented in `10abe398`.

### I22. Windows game-like fullscreen: hide the taskbar, block touch edges

Decides I21. Requested: "「类似游戏的全屏」是底部不要看到Windows 任务栏，并且也不能用触控触发".

Product decision: overturn the ADR-0034 "not topmost, taskbar visible"
clause. Once the panel geometry covers the display, `enterPanel` asks for
kiosk mode on every attempt and sets `setAlwaysOnTop(true, 'screen-saver')`.
Kiosk hides the taskbar, owns the display and suppresses Windows touch edge
gestures; taps on the desk's own controls still reach the desk. Updated
ADR-0034, `WINDOWS_HOST.md`, `DESIGN.md`, `windows-kiosk.ps1`,
`windows-shell-host.feature`, `kiosk-panel.test.js`,
`kiosk-window-order.test.js` and `windows-host.test.js`. BDD scenario and a
failing regression came first.

Verification: fast tier 2690 tests / 2686 pass / 0 fail / 4 skipped;
kiosk-related Node contracts 24 pass / 0 fail; `agent-radius.cjs`,
`agent-home.cjs`, `input-scroll-polish.cjs` all PASS.

### I23. Restore the Agent capsule and lift the header

Requested: "fix：现在 win 上的版本，personal agent 的名称的外面的胶囊消失了。注意还原之前的样式。implement：personal agnet 的 avatar 以及名称应该向上一些，可以顶到 status bar 的下方。"

Root cause of the missing capsule: I5 removed the Liquid Glass capsule frame.
The device uses Liquid Glass, so the name appeared as bare text. Restored:
deleted the Liquid Glass override and put `.agent-capsule` back in the
blanket glass control rule, so every theme uses the shared framed capsule.
Set `--agent-top-inset: 0px` so the avatar and identity sit directly below
the State Bar. Updated `DESIGN.md`, `liquid-glass-theme.feature`,
`liquid-glass-theme.test.js`, `agent-home.cjs` and
`input-scroll-polish.cjs`. BDD scenario and failing gates came first.

Result: done on both hosts. `main` is `c209ade1`. CM5 active release
`20261105T102237Z-1345880` (`pruned: []`, four services active, Electron
43.8.1). Windows release `20261105-main-c209ade1` is active:
`VALIDATE_OK` with `SOURCE_STABLE_OK changed=0`, `ACTIVATE_OK` with
`CAPTURED 9` / `NEW_PROCESSES 9` and no old-release process left. All three
OdkDesk/OdkDeskLink/OdkPersonalAgent tasks are Running from the new release;
`kiosk.log`, `personal-agent.log` and `odk-link.log` show one clean start each
at 19:49:28-29, and Link listens on 8765 in its expected report-only mode.

The Windows host went offline after prepare, before validate. The owner later
asked to deploy again; `100.82.50.70:22` answered, so validate and activate
resumed from the existing staged candidate. No package was rebuilt.

An interactive-session screenshot (`/tmp/odk-shots/c209ade1-panel.png`) shows
the framed "Personal Agent" capsule restored, the avatar and identity directly
under the State Bar, colored holdings (-0.09% red, +0.40% green), the Reply
buttons with the tightened padding, and the panel covering the full
`0,0 1280x800` display with no visible taskbar or terminal window. That proves
presentation, not native window state: a separate probe found the foreground
window could still be ChatGPT or WindowsTerminal and `Shell_TrayWnd` still
`visible=True`. `setAlwaysOnTop(true, 'screen-saver')` keeps the panel above
those windows in the captured frame; Windows taskbar auto-hide and foreground
ownership were not independently asserted. Physical touch edge gestures,
microphone, GPU color and screen-reader acceptance remain separate gates.

Status: complete for this release. One-time screenshot and probe tasks
OdkC2Shot/OdkC2Kiosk/OdkC2Clean were deleted; the three production tasks
remain.

### Device-side runtime faults diagnosed during the paging and Agent polish batch

These three faults are configuration or device state, not Shell source defects.
They need separate operator authorization before a production change.

**Gmail proactive generation and proactive suggestions.** The CM5
resident agent starts `createWatch` only when `ODK_PROACTIVE_CONFIG`,
`ODK_PRIVATE_RECOMMENDATIONS_FILE`, or the `intent` plugin is selected. The
`intent` plugin is enabled, but with no owner rule file the watch runs on an
empty `rules: []` and produces no `proactive_generation` events. The Gmail
private source additionally requires `mcp` plus a private recommendations
file. None of these two environment variables is present in
`~/.config/odk/perosnal-agent.env`. A valid version-2 owner rule file with
four rules still exists at
`~/.config/open-deskos/proactive/owner-20261002.json`; the current release
loads it successfully as the `orangepi` user. The old systemd drop-in used the
retired `ODESK_` prefix and now sits in `systemd/user.disabled-backup`. The
Gmail MCP service is `inactive` and no private recommendations file exists.
Restoring proactive work therefore needs an authorized production change: wire
the two `ODK_` variables into the private env, create the Gmail source
selection file, and start the Gmail service. No credentials were read or
written.

**Windows microphone.** `ODK_PERSONAL_AGENT_AUDIO_DEVICE` in
`%LOCALAPPDATA%\odk\perosnal-agent.env` is present but empty. The launch
contract refuses an empty or `default` device name, so the display client
reports "Microphone unavailable". ffmpeg is installed. The fix needs the exact
DirectShow device name from the operator, then a private env update and an
interactive-session check. Live capture remains a separate gate.

**Renderer capsule change.** The renderer change that stopped terminal proposal words
from becoming the capsule caption does not touch proposal rendering, the
visible set, or the backend. It cannot cause the Gmail or proactive-suggestion faults.

### CM5 deployment of the paging, Agent polish, and decimal batch

Deployed 2026-11-06 from the detached worktree `/tmp/odk-release-merge` at
`554f6025`. The operator authorized "部署到 CM5" and asked to remember the
commits. Six commits from `c209ade1` to `554f6025` were made in that worktree,
which kept the main checkout's in-flight files byte-for-byte untouched.

`node runtime/shell/scripts/release-host-preflight.js --run` produced the
content-addressed receipt `a5514f4e221b9093fb30d7c7b35ef1308fd3ee660705bba247f241384d3b885a`
(808 files, 0 failures). `bash runtime/shell/scripts/cm5-stage-release.sh`
then staged, installed, and activated release `20261105T164224Z-1356285`:
`pruned: []`, rollback `20261105T102237Z-1345880`, `lastUpdate.ok: true`,
activation smoke `{"ok":true,"width":1919,"height":1279}`. Three user services
are active; the device keeps six releases and 5.6 GiB free.

Two Electron contracts needed updates for the 3x2 grid before the receipt
could pass: the installed-App bootstrap now seeds two App pages instead of a
free cell in the retired three-row Desk grid, and the WeRead Electron hit test
scrolls a below-the-fold Widget into view. Hydra and WeRead own the first row
of the 3x2 canvas, which preserves the measured wide-short Hydra composition.
The signed WeRead stylesheet snapshot was synchronized. These are contract
updates, not relaxations.

Windows stays on `20261105-main-8f1949fc` and therefore still shows the
earlier two-row-spanning Widget layout. It was not part of this authorization.

A host receipt proves the contract suite passed once for that `runtime/shell`
content. It does not prove CM5 device presentation, touch, Remote, GPU color,
microphone, or provider accuracy. Those gates stay open.

### State Bar, avatar, Widget canvas, and the second openui-integration merge

Owner reported that the State Bar top and bottom padding was too tall and
clipped the Agent avatar, that the gap below the Page Controller was too large,
and that Widgets were clipped. A live geometry probe at 1280 by 800 showed the
causes: a 76px `--status-h` with a 64px visible band left a 12px dead strip;
the `--agent-head-lift: -8px` pushed the onee avatar (which already overflows
its frame upward) above the clipped pane; a fixed 48px empty grid row sat below
the Page Controller while the paging viewport was 11px too short for the second
Widget row.

The fix gives the State Bar one short band that ends exactly where the desk
begins, reserves 24px at the top of the Agent header instead of lifting it,
removes the empty row so the Widget canvas fits, and keeps the narrow desk tall
enough to scroll to its last Widget. Measured after: `statusBar.bottom` equals
`homeDesk.top`, `avatarClip` is inside the pane, `tileOverflow` is negative at
1920 by 1280 and 1280 by 776, and `gapBelowDots` is 0. Jump to latest also
became a real pill under Liquid Glass, which the earlier capsule change missed.

The Electron geometry, density, paging, and radius contracts were synchronized
with the fixed Overview and the two-row canvas. These are contract updates, not
relaxations: `agent-home.cjs` now asserts that the fixed Overview does not move
when the Widget area is swiped.

The owner then asked to merge `openui-integration` again. It carried one commit
(`60c145bc`, bounded reply projection). Merge commit `165f2b08` has both
parents. The only conflict, `agent.test.mjs`, was resolved by keeping both the
current Overview selection tests and the two reply-projection tests. A follow-up
commit `62991f8f` updated the startup wiring test for the multiline projected
prompt wrapper. The merged content is in `main`: both merge parents
(`60c145bc`, `0c243bff`) and the merge commit `165f2b08` are ancestors of
`62991f8f`. The local `openui-integration` ref was later advanced to
`b942fe63` by another task, so that branch tip is no longer an ancestor;
this does not remove the already-merged content.

Validation: fast tier 2706/2702 pass/0 fail/4 skipped; `agent-home.cjs` 6 sizes
by 4 themes PASS; `status-bar-style.cjs`, `page-indicator.cjs`,
`agent-radius.cjs`, `input-scroll-polish.cjs`, and both new reply Electron
fixtures PASS. The personal-agent suite has one environment-only failure:
`native-pi-handoff.test.mjs` needs `pi-packages`, absent from this worktree.

The owner then authorized "部署到 cm5". A fresh host preflight receipt
`7fe1ef95387d50ab04538b8ef329df7ecd4a874b09bd90af6a4af257bd05325d` (812 files,
0 failures) was produced and `--require` passed. `cm5-stage-release.sh`
activated release `20261106T002855Z-1363179`: `pruned: []`, rollback
`20261105T164224Z-1356285`, `lastUpdate.ok: true`, smoke
`{"ok":true,"width":1919,"height":1279}`. Three user services are active and
`odk-personal-agent.service` restarted at 08:29:47 so the merged `main.mjs`
takes effect. The device keeps seven releases and 4.8 GiB free.

A physical CM5 screenshot at 1920 by 1280 confirms the full onee avatar, the
complete second Widget row, and no empty band below the Page Controller. The
device release carries `reply-projection.mjs`, the projected prompt wrapper,
and all geometry fixes. Electron test fixtures are intentionally absent from
the immutable release; `cm5-install.sh` packs only runtime files.

An independent workflow precheck confirmed the deployed bytes match the merge
tree and flagged two boundaries worth keeping. First, the host receipt covers
only `runtime/shell/{src,tests,scripts}` plus three root files; it does not
certify `integrations/personal-agent/` (including `reply-projection.mjs`) even
though the stage rsync transfers those files. The personal-agent suite was run
separately. Second, the primary checkout has its own in-flight edits and
staged deletions, and its digest has no receipt: deployment commands must run
from `/tmp/odk-release-merge`, never from the primary checkout. The workflow
also confirmed `cm5-stage-release.sh` does not call `cm5-acceptance.sh`; that
is a separate manual device step. The screenshot and service checks here are
deployment evidence, not full hardware acceptance.

The owner then authorized "部署到 win 上". The package carried 1680 files
(1674 from the prior release plus 6 new openui and geometry-contract files),
passed the SHA256 gate and every per-file MD5 check, and activated release
`20261105-main-62991f8f`. `VALIDATE_OK` reported `SOURCE_STABLE_OK changed=0`;
`ACTIVATE_OK` reported `CAPTURED 0` / `NEW_PROCESSES 9` after an explicit old
process preclear (6 to 0). All three production tasks are Running from the new
release. As with earlier Windows deployments, the dependency validator first
failed on the pnpm symlink `mdurl`; `odk-shell-deps.ps1` restored it and the
electron binary before validate passed.

An interactive-session screenshot at 1280 by 800 confirms the full onee avatar,
the framed identity capsule, the tighter State Bar, the complete 3x2 Widget
rows, no empty band below the Page Controller, the Jump-to-latest pill, and
two-decimal Overview values. CM5 and Windows now run the same `62991f8f`
content. These are deployment and presentation checks, not physical touch,
microphone, GPU color, or screen-reader acceptance.

### WeRead 3x2 and the tightened paging gap on Windows

The owner then asked to give WeRead the full 3x2 page and to remove the wasted
band above the Page Controller. A geometry probe found 36px of spare height in
the paging viewport: the square Widget Cell is width-bound, so a `1fr` viewport
row could not fill it. The Overview row now absorbs that spare height while the
paging track and controller take only their content height. Measured at
1280x800, 1920x1280, and 1280x776 the gap below the Widgets is the single 16px
page padding and the controller sits flush below the viewport. WeRead spans
`1 / 4` by `1 / 3` and measured 632 by 416 in the renderer, with no overflow.
Hydra keeps its one-row Desk placement. The Overview briefing stays
top-aligned: centering it made the refresh spinner move between states.

The layout harness golden values were updated for the shorter State Bar band,
and the placement, density, and BDD contracts follow the two-row WeRead span.
Validation: fast tier 2708/2704 pass/0 fail/4 skipped; layout-harness PASS 8
sizes; agent-home.cjs 6 sizes by 4 themes PASS; weread-surface-electron 2/2
PASS. Commit `4424ab85`.

The owner authorized "部署到 win 上!". The 1681-file package passed the SHA256
gate and every per-file MD5 check, then activated release
`20261105-main-4424ab85` with `DEPLOY_OK`, `PREPARE_OK`, `VALIDATE_OK`
(`SOURCE_STABLE_OK changed=0`), and `ACTIVATE_OK` (`CAPTURED 0` /
`NEW_PROCESSES 9` after a 6-to-0 process preclear). The pnpm `mdurl` symlink
needed the usual `odk-shell-deps.ps1` repair before validate. All three
production tasks are Running from the new release.

An interactive 1280x800 home-page screenshot confirms the tightened gap and all
prior fixes. A pointer attempt to open the Reading page did not switch pages in
the kiosk session, so the WeRead 3x2 composition was verified in the renderer
and the deployed `desktop_layout.js`, not in a device screenshot. Physical
touch, microphone, GPU color, and screen-reader gates stay open.

CM5 remains on `20261106T002855Z-1363179` (`62991f8f`) and was not part of this
authorization. The Widget expansion animation remains a TODO-only item.

### Hydra showed Unconfigured on Windows despite live resident data

The owner reported that the Hydra Widget showed no readings. A Desk-page
screenshot on Windows showed `Unconfigured` and empty `--` values. Evidence
gathered on the device: the `odk-personal-agent` briefing frame carried a full
live Hydra projection (humidity about 70, two plants about 59 and 52); an
independent `personal-agent-client` connected to the same pipe had that
projection in `snapshot().hydra`; and a mock of the `odk-hydra-status` handler
returned the projection correctly. So the data, normalization, and renderer
were all healthy.

Root cause: `plugin-host.js` throws `undeclared port` when a plugin calls
`ctx.get()` for a port absent from its manifest. The Hydra source declared only
`DATA_PORTS.deviceGateway` as an optional dependency, but its IPC handler reads
`SYSTEM_PORTS.personalAgent`. That read threw inside a try/catch and was
swallowed, so the status projection was always null. The handler then fell
through to the producer channel, which has no Hydra reading on a display-only
host, and returned the unconfigured local snapshot.

Fix `8f0769cf`: declare `SYSTEM_PORTS.personalAgent` as an optional dependency
of the Hydra source. Add a BDD scenario and two regression tests, including a
strict host that reproduces the undeclared-port throw. Validation: fast tier
2710/2706 pass/0 fail/4 skipped; `hydra-central-projection.test.js` 5/5;
`plugin-composition.test.js` 15/15.

This commit is NOT deployed. Windows remains on `20261105-main-4424ab85` and
CM5 on `20261106T002855Z-1363179`. Deployment needs a fresh authorization.
CM5 has local Hydra hardware, so it was never affected by this projection bug;
only display-only hosts such as Windows need the fix.

A concurrent task advanced `main` with documentation and memory commits while
this fix was being prepared. The fix was rebased onto that tip
(`110ece1d`) rather than overwriting it; `110ece1d` is an ancestor of
`8f0769cf`.

## Rules for using this file

- Start from the newest intent. Follow the `Supersedes` and `Amends` links.
- Keep completed items. Add a new item for a change of direction.
- Preserve the owner's in-flight files. Do not stage another task's work.
- Record verification commands with each completed item.
