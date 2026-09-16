# Voice-managed Pi tasks: research and narrow implementation plan

## Decision

Use an Open DeskOS-owned, per-host task daemon embedding the installed Pi SDK. Run one daemon as the development user on CM5 and one on Mac. The voice agent is the coordinator; a short local/SSH stdin-JSON helper submits or queries work, then exits. The daemon, not the SSH connection, owns execution.

Remove the obsolete `pi-session-control` integration rather than adding a compatibility fallback. Current Pi live-session control is not a task launcher. Keep ordinary live-session delivery out of this first managed-task slice.

Confirmed scope: explicitly select CM5 or Mac and an existing project inside operator-configured development roots; ask in Chinese when host/project/application target is ambiguous; understand mixed Chinese and project names; modify existing Widgets/Apps; edit and test by default, without automatic commit, push, installation, activation, or deployment. Chinese replies are text: this does not add speech synthesis.

This is research, not an implementation or hardware acceptance report. Only this document was written. No provider requests, credentials, service restarts, installations, or device mutations were performed.

## Evidence inventory

Paths below are primary sources inspected for this report. `PI` abbreviates `/Users/FradSer/.local/share/fnm/node-versions/v24.16.0/installation/lib/node_modules/@earendil-works/pi-coding-agent`; `UTILS` abbreviates `/Users/FradSer/Developer/FradSer/pi-packages/packages/utils`.

- @integrations/voice-agent/README.md and @integrations/voice-agent/package.json.
- @integrations/voice-agent/src/agent.mjs, @integrations/voice-agent/src/capabilities.mjs, @integrations/voice-agent/src/main.mjs, @integrations/voice-agent/src/service.mjs, @integrations/voice-agent/src/socket.mjs, @integrations/voice-agent/src/transcribe.mjs.
- @integrations/voice-agent/systemd/open-deskos-voice-agent.service.
- @integrations/local-stt-bridge/README.md and @integrations/local-stt-bridge/scripts/provision-stt-bridge.sh.
- @.agents/skills/open-deskos-widget/SKILL.md.
- `PI/README.md`, `PI/docs/sdk.md`, `PI/docs/rpc.md`, `PI/docs/session-format.md`, `PI/docs/settings.md`, and `PI/docs/skills.md`, read in full.
- `PI/examples/sdk/03-custom-prompt.ts` and `PI/examples/sdk/11-sessions.ts`.
- `PI/dist/core/agent-session.js`, `PI/dist/core/session-manager.js`, `PI/dist/core/sdk.js`, `PI/dist/core/resource-loader.js`, `PI/dist/core/resource-loader.d.ts`, `PI/dist/core/settings-manager.js`, and `PI/dist/core/tools/bash.js` (relevant implementation sections).
- `UTILS/README.md`, `UTILS/package.json`, `UTILS/extensions/live-sessions.ts`, and all four files under `UTILS/extensions/live-sessions/` (`protocol.ts`, `transport.ts`, `client.ts`, `server.ts`).

Both the installed global Pi and the voice integration's resolved Pi dependency report **0.85.1**. The inspected utils package reports **0.4.2**. Version-specific observations below should be covered by tests when upgrading Pi.

A bounded, read-only `ssh cm5` inspection printed only allowlisted workspace/control configuration fields. The alias connects as root, not as the kiosk user. `/home/orangepi/.config/open-deskos/runtime.env` contains `ODESK_WORKSPACE=/home/orangepi/Developer/open-deskos`; that directory exists and resolves to itself. Neither `PI_SESSION_CONTROL_COMMAND` nor `PI_SESSION_CONTROL_SSH_HOST` was present in the inspected kiosk-user voice env file. This does not prove absence of overrides elsewhere. No Mac target service, roots configuration, helper installation, SSH authorization from the kiosk user, or remote Pi auth was verified. Do not use the root SSH identity for the proposed coding service.

## Current integration and gaps

| Concern | Current evidence | Consequence |
| --- | --- | --- |
| Coordinator execution | `agent.mjs` uses real coding tools and `SessionManager.continueRecent(cwd, stateDir/sessions)` | Useful conversational coordinator, but not isolated task identity or task supervision. Each managed task needs a fresh session. |
| Workspace | `validateWorkspace()` requires an absolute writable Git checkout, widget skill, and exclusion of `/opt/open-deskos` before/after realpath | Do not reuse this Open DeskOS-specific validator as a general project-root validator. |
| Headless resources | `createResourceLoader()` disables extension/skill/template discovery, explicitly adds the widget skill, appends coding instructions | Retain deliberate resource policy; general managed projects need their own AGENTS and relevant skills, not a mandatory Open DeskOS skill. |
| Blocking voice flow | `VoiceService.submit()` waits for coordinator prompt; busy toggles are ignored | Coordinator should return after accepted start, enabling later spoken status/cancel requests rather than waiting for coding completion. |
| Legacy delivery | `capabilities.mjs` spawns `pi-session-control` by default and generates a fresh request ID per call | This executable is no longer supplied by the current package; old README setup is stale. Replace, do not silently fall back. |
| Language | Multipart transcription currently includes model/file, not language; coordinator instructions do not require Chinese | Add explicit Chinese configuration and Chinese task/reply instructions. Preserve transcript Unicode unchanged. |
| Application lifecycle | Core capability tools expose install/rollback/remove; old prompt says install after writing a draft | For the new default edit/test policy, remove automatic installation from instructions. Tool availability does not grant implicit user authorization. |
| Error recovery | Voice generic failure currently says “try again” | An uncertain remote start must preserve its task ID and request reconciliation, not invite a duplicate submission. |
| Output | Voice response is capped at 1024 characters | Keep task status separate and bounded; do not dump transcripts into voice status. |

The existing voice service's `/opt/open-deskos` read-only restriction is Linux service configuration, not a universal Pi sandbox. Existing capture/STT bounds, private socket, and audio cleanup remain useful and should not be redesigned for this work.

## Why current live sessions cannot launch managed tasks

`UTILS/README.md` explicitly calls live sessions an internal capability with **no separate executable or package**. `package.json` has no `bin`. `protocol.ts` accepts only `list`, `status`, and `send`: there is no start, cancel, persistent job receipt, or task-result API.

The extension opens a user-owned 0700 directory and 0600 sockets under `~/.pi/live-sessions`, overridable by `PI_UTILS_LIVE_SESSIONS_DIR` (not the removed package's old variable). It registers a new opaque live ID per session start; `piSessionId` is a separate durable transcript identity. `send` invokes `pi.sendUserMessage`, returning `accepted` or `queued`, neither of which means completion.

Its in-memory receipt map deduplicates identical request IDs/payloads only during that live instance. It caps receipts at 10,000; discovery caps socket entries at 128; transport caps frames at 65,536 bytes with a two-second deadline. These are useful protocol precedents, not a durable task store. Deep-importing this internal client or rebuilding the removed CLI would not solve task creation or supervision.

## Supported SDK lifecycle, with caveats

### Creation and resources

- `createAgentSession({cwd, modelRuntime, resourceLoader, settingsManager, tools, sessionManager})` is supported. Built-in tools are rebound to `cwd`; do not change process cwd to switch projects.
- `SessionManager.create(cwd, sessionDir)` creates a new persistent-session manager. `continueRecent` is inappropriate for independent jobs. Keep `taskId`, `sessionId`, and `sessionFile` distinct.
- `DefaultResourceLoader({cwd, agentDir, noExtensions: true, noPromptTemplates: true, ...})`, `await loader.reload()`, and `appendSystemPrompt`/`appendSystemPromptOverride` are supported. AGENTS context and skills remain relevant. Disable arbitrary extension loading for predictable headless behavior and avoid TUI-only confirmation tools.
- `ModelRuntime.create()` uses host-local Pi auth/config. Select an optional configured provider/model; do not transport credentials from CM5 to Mac or expose auth errors/provider bodies in task status. Auth availability at startup is not a guarantee of subsequent provider success. Bound runtime initialization using supported signals/deadlines.
- No `AgentSessionRuntime` session-replacement layer is needed when every task gets one fresh `AgentSession`.

**Resource safety detail:** SDK settings are not the CLI's interactive project-trust flow. `SettingsManager.create()` defaults `projectTrusted` to true (`dist/core/settings-manager.js:154–179`). `DefaultResourceLoader.reload()` resolves package sources before `noExtensions` filters extension loading (`dist/core/resource-loader.js:275–330`). Therefore `noExtensions` is not a guarantee of “no package resolution/install/network.” Choose an explicit operator-approved settings/resource policy; test that unapproved project/global packages do not cause automatic installation. Do not weaken this to an undocumented trust assumption.

### Acceptance, settlement, and success

`session.prompt(text, {expandPromptTemplates: false, preflightResult})` supports acceptance notification. Pass transcript as data, not an extension command. `preflightResult(true)` means accepted/handled/queued, not completed.

For a fresh idle session without command interception, awaiting `prompt()` spans the complete session-level run, including retries and compaction continuations. Source: `dist/core/agent-session.js:772–814`, `_runAgentPrompt()` and `_handlePostAgentRun()`. `agent_end` is only a low-level boundary. Use `agent_settled` for event-driven final settlement, or the awaited initial prompt plus final state inspection. `docs/rpc.md` explicitly distinguishes these events; its illustrative Python example stopping at `agent_end` is not a robust completion recipe.

The settled prompt promise alone is not proof of success: final assistant `stopReason` may be `error`, `aborted`, or `length`. Missing final assistant text/message and unresolved tool-only termination must not become successful completion. Inspect the final assistant message from this task and retain a bounded plain-text result. Do not expose thinking blocks, raw tool arguments, provider error bodies, or the full transcript.

A clean model turn is **finished**, not independently **verified**. The first implementation should explicitly report verification as `not_run`/not independently established unless it actually captures and evaluates test evidence. A model saying “tests passed” is not a service-side proof.

### Persistence

Pi transcripts are not durable start receipts. `SessionManager._persist()` postpones file creation until there is an assistant message (`dist/core/session-manager.js:739–765`). A returned `sessionFile` can therefore name a file that does not exist yet. SDK transcript appends are not a documented fsync durability contract.

Persist the task's accepted intent, stable ID, canonical project, payload fingerprint, timestamps and lifecycle separately **before** acknowledging or starting SDK work. On daemon restart, any formerly nonterminal record becomes `interrupted`; never infer completion from a transcript or automatically replay the prompt. Retain existing transcript for operator inspection or a later explicit resume feature.

### Cancellation

`session.abort()` aborts retry, compaction, branch-summary and agent execution, then waits for session-level idle (`dist/core/agent-session.js:1222`). It does not clear queued messages; `clearQueue()` is separate. Keep the first slice one prompt/no queue per job; defensively clear managed queues before abort if introduced.

Persist `cancelling` before requesting abort; report `cancelled` only after the run has actually settled. A short control deadline must not force a false cancellation claim. Cancellation during SDK initialization/preflight needs its own regression: an abort before a run starts is not a persistent prohibition against later `prompt()` execution. Recheck cancellation after initialization and arrange cancellation at acceptance if preflight raced it.

The built-in Bash implementation propagates abort to a process-tree kill, but cancellation does not roll back writes, Git changes, network requests, or escaped background work. A hung adapter may remain `cancelling`; forced daemon termination is `interrupted`, not proof that all external effects were stopped.

## Minimal proposed protocol and storage

This is an application protocol, **not** the Pi RPC protocol. Preserve one LF-delimited JSON request and response per helper invocation:

- Envelope: `{version:1, requestId, command}`.
- `start`: stable UUID `taskId`, absolute `project`, bounded nonempty `prompt`.
- `status` and `cancel`: UUID `taskId`.
- `list`: bounded recent task summaries.
- Response: `{version:1, requestId, ok, task? , tasks? , error?}`; validate correlation and complete shape.

Host and executable are operator configuration, never model-supplied command text. A target list can contain fixed `cm5`/`mac` IDs, human names, helper executable paths, optional SSH host, and advertised development roots. Advertised configuration is not proof the host is reachable or that its daemon authorizes the path. The daemon's own roots are authoritative.

Recommended lifecycle:

`accepted → running → finished | failed`

`accepted/running → cancelling → cancelled`

`nonterminal from prior daemon lifetime → interrupted`

Start acceptance means the durable task record exists, not that Pi/provider preflight succeeded. Failed initialization transitions to failed. Status transport failure means host unavailable/outcome unknown, not task failed. Persist terminal state before reporting it. Cancel a terminal task idempotently without changing its outcome.

For the small expected workload, private atomic JSON task records are sufficient; no distributed queue or database is needed. Use one daemon writer, 0700 state directories, 0600 files, exclusive temporary files, fsync/rename durability boundaries, and a singleton socket/ownership protocol. Serialize mutation admission: two concurrent starts must not bypass duplicate or capacity checks. Do not unlink a reachable daemon's socket. Reject symlinked/foreign-owned control locations and fail closed on corrupted state or failed persistence.

Bound initial execution to one active managed task per canonical project and a small host-wide cap (four is sufficient). Reject busy/capacity rather than adding a scheduling subsystem. This prevents managed jobs colliding with each other, not with an unrelated TUI editing the same checkout. Do not discard pre-existing changes or create/reset branches automatically.

### Duplicate protection and unknown outcomes

The coordinator generates `taskId` once **before transport**, and keeps it with the target even if SSH times out. The daemon persists a fingerprint of the exact semantic start payload with that ID. Identical ID/payload returns the original record; ID with different payload is a conflict. Check durable duplicate identity before busy rejection so an accepted task can be reconciled.

After an ambiguous start, return a Chinese warning containing target and task ID, then query status. Never automatically create a new UUID or resend a mutation as though nothing happened. Request IDs correlate individual control exchanges; task IDs are durable execution identity. Content-based deduplication alone would incorrectly suppress a later intentional identical request. If receipts have a finite retention limit, do not silently delete their deduplication protection: retain tombstones or reject new starts at capacity until explicit maintenance defines an expiry contract.

### Bounds and SSH

- Suggested request cap: 64 KiB in UTF-8 bytes; response cap: 256 KiB; task text summary cap: 16 KiB; bounded list count and history capacity. Voice receives its existing shorter summary.
- Reject oversized input before JSON parsing/SDK work; validate per-field byte lengths too. Bound helper stdin wait, socket connect/read, total command duration, pending clients and slow consumers.
- Split on LF only, decode UTF-8 across chunk boundaries, and preserve Chinese and U+2028/U+2029 inside JSON strings. Pi RPC documentation explains why generic line readers are unsuitable.
- Use `spawn` argv locally; SSH `-T`, batch mode, strict host-key checking, bounded connect time, and a shell-quoted **fixed absolute** helper executable. JSON goes only to stdin. The existing `sessionCommand()` has these useful safeguards.
- No `nohup pi`, `ssh ... pi --mode rpc` lasting for the whole job, remote command interpolation, shell parsing of transcripts, or client-side cancellation by killing SSH.
- Helper stdout contains exactly protocol JSON; diagnostics go to bounded/sanitized stderr. Validate response version, request ID, task ID and state. Transport failure cannot fabricate a successful mutation.

## Root and trust boundaries

Canonicalize every configured existing development root and requested existing directory using `realpath`. Accept only equality or component-boundary containment (`relative`/separator-aware logic), not a raw string prefix. Reject symlink escapes, nonexistent/non-directory paths, relative paths and `/opt/open-deskos` or descendants after resolution. Recheck canonical project immediately before starting work. Reject overly broad filesystem roots as configuration mistakes.

Select projects explicitly. A Chinese request such as “改一下那个天气 Widget” must not default silently to whichever host or checkout happens to be configured first. Ask “在 CM5 还是 Mac？要修改哪个项目中的哪个 Widget？” and start nothing until resolved. Confirm a single unambiguous target from the conversational context rather than repeatedly asking when it is already explicit.

Root validation scopes **task admission**, not every filesystem operation. Stock read/write/edit/bash tools run with the host user's permissions and can access paths outside cwd. Existing symlinks inside a checkout, tool subprocesses, network access and concurrent filesystem changes are not contained by a realpath start check. State this limitation openly; stronger enforcement would require a separately designed OS sandbox. Same-user local control is the current trust model.

## Chinese and Widget/App behavior

Add an operator STT language option defaulting to `zh`; `auto` should omit multipart language. Validate configured language tokens and test `zh`, auto, invalid configuration and mixed Chinese/ASCII input. The local bridge provision script already sends `language=zh` for its sample transcription; live voice transcription currently omits it. This is local-source evidence of intended integration, not a claim that every third-party compatible endpoint accepts every locale.

Append coordinator and managed-task instructions to preserve the original request, answer in concise Chinese unless the user requests otherwise, ask before ambiguous targets, and report distinct accepted/running/finished/cancelled/interrupted states. Do not translate identifiers, paths or package names. Example acceptance: “已在 Mac 接收任务；尚未完成。任务编号：…”。 Example interrupted result: “服务重启，任务已中断；已有修改可能保留，未自动重试。”

For an existing built-in Widget/App, inspect its actual plugin and use the widget skill and runtime guides. For an existing installable app, edit its draft under the configured checkout and verify without automatic installation. Do not implement “modify” by creating an unrelated duplicate. Keep app ID and built-in plugin ID distinct; ask if names collide. Feature-first tests, scoped verification, generated UnoCSS rules and no automatic commit/deploy remain required.

## Implementation sequence and verification gates

1. **BDD contract first.** Add Given/When/Then scenarios for explicit CM5/Mac start; ambiguity asks with no writes; Chinese transcript/reply preservation; modify-existing target; accepted is not completed; cancel; restart interruption; duplicates/conflicts; symlink escape; bounds; unavailable host; edit/test without installation/commit/deploy.
2. **Host service with fake SDK runner.** Implement private protocol, canonical admission, serialized durable receipts, bounded listing, independent execution and cancellation. Prove RED then GREEN for concurrent identical start, conflicting payload, per-project busy, host capacity, disk failure, restart before first assistant message, lost response, malformed frames and slow clients.
3. **Real SDK adapter.** Fresh `SessionManager.create` per task; deliberately configured resources/auth/model; Chinese policy; awaited prompt with final stop-reason inspection; bounded result; dispose in cleanup. Unit-test retries/compaction boundaries, errors, length truncation, cancel during startup/preflight and shutdown; use actual installed SDK resource loading without contacting providers where possible.
4. **Short helper and target client.** Test fixed-path SSH quoting, no shell interpolation, UTF-8 chunking, ten-second control deadline, response caps, task-ID preservation on unknown start, and status reconciliation. Remove obsolete live-session tools/config references/tests; do not alias their names to different semantics.
5. **Coordinator integration.** Expose narrow `coding_targets`, `coding_task_start`, `coding_task_status`, `coding_task_list`, `coding_task_cancel` tools. Keep host/project explicit and no implicit activation. Preserve unrelated existing user-app tools, but correct the old automatic-install instruction.
6. **Verification before provisioning.** Run `cd integrations/voice-agent && pnpm test && pnpm typecheck`. Have a fresh reviewer audit lifecycle, durability, cancellation races and target boundaries. Add service/launch configuration only after these gates; the service uses absolute Node/helper paths, not an interactive shell's version-manager PATH.
7. **Operator-authorized acceptance later.** Provision as the normal development user on each host, with host-local Pi auth and private configuration. Check benign start/status/cancel; disconnect SSH while running; restart with an active task; then perform an explicitly authorized Chinese edit/test on an existing Widget/App. Record host-specific results and verify no commit, push, installation or deployment occurred. Do not claim CM5 microphone quality or Mac launchd acceptance from host unit tests.

### Non-goals for this slice

No task scheduler, automatic resume, arbitrary live-session takeover, terminal injection, cross-host credential sharing, worktree orchestration, autonomous deployment, TTS, or transcript browser. Persistent truthful records and independent host-owned execution are the product; these omissions keep the first implementation small enough to verify.
