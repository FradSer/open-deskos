# Task Status

> Generated from git commit history review.

## Completed (merged to main)

- [x] **接入 Gmail 到 Personal Agent**
  - `a16276e5` feat(link): integrate pluggable Gmail recommendations

- [x] **优化 Personal Agent 语音输入**
  - `b31d069e` feat(shell): update agent voice and keyboard input
  - `352adad7` feat(link): add voice and keyboard input design
  - PR #143 `codex/personal-agent-input`

- [x] **反思整个 overview 生成逻辑**
  - `1a9aed97` feat(shell): support all-source overview & facts
  - `a31991d2` fix(link): enforce 15-min overview cooldown
  - `1fb4e7a8` fix(link): throttle overview gen and retries
  - PR #145 `codex/overview-fifteen-minute-cadence`

- [x] **扩展 Nano C6 可插拔设备系统**
  - `a52bd9b8` feat(hw): add nanoc6 esp-now gateway firmware
  - `775d9aa1` docs(hw): document nanoc6 parser regression tests
  - `920fedee` feat(hw): add nanoc6 gateway and parser fix

## In Progress

- [ ] **打通真机 E2E 闭环**
  - Multiple E2E PRs merged: #131 (cm5-network-widget-e2e), #135 (split-agent-device-e2e), #136 (windows-local-apps-e2e)
  - CM5 deployment and acceptance tests passed
  - Remaining: Uncommitted fixes in `integrations/personal-agent/src/agent.mjs` and `main.mjs` (model binding and home selection serialization)

- [ ] **反思 Personal Agent 推荐逻辑**
  - Recommendation features landed: `b5c09dfb` (proactive), `dfe19342` (feedback), `4395919d` (learn from feedback)
  - Remaining: Active session fixing "Personal Agent has no new desk briefing" — uncommitted changes to recommendation selection logic in `agent.mjs`

- [ ] **等待任务完成后合并分支**
  - PRs #128–#147 all merged to main; no remote branches remain
  - Remaining: Current working tree has uncommitted changes that need to be committed and merged

## Not Started

- [ ] **设计 Personal Agent 虚拟机接入方案**
  - No commits found related to VM/sandbox/container isolation
  - Likely still in design phase
