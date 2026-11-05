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

## Rules for using this file

- Start from the newest intent. Follow the `Supersedes` and `Amends` links.
- Keep completed items. Add a new item for a change of direction.
- Preserve the owner's in-flight files. Do not stage another task's work.
- Record verification commands with each completed item.
