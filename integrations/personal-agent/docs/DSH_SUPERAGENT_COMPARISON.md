# dsh-superagent prototype and Personal Agent design comparison

Compared on 2026-11-03. This note compares documented designs. It does not compare running systems.

## Scope and sources

Upstream means `deepseek-ai/dsh-superagent-prototype` at `8c32a9d` (2026-10-31). Paths such as `docs/001-domain.md` refer to that clone. Downstream means this repository working tree. Paths such as `integrations/personal-agent/docs/CONTRACT.md` refer to the repository root.

Both sides are primary sources. The upstream README calls the code a research prototype for reference only (`README.md:3`). It says the published code differs from the internal version and from the article. Some article designs remain unimplemented (`README.md:5`). Downstream documents say that live models, physical input, target-device acceptance, and deployment remain unverified (`integrations/personal-agent/docs/PERSONAL_AGENT_IMPLEMENTATION.md:69`).

I read documents and source entry points. An independent second read of the upstream clone checked the same primary sources. I did not build either system. I did not run a device, a provider, or a live acceptance.

## Purpose

| | dsh-superagent | Open DeskOS Personal Agent |
| --- | --- | --- |
| Who it serves | One team on one GitHub repository | One owner on a fixed desk display |
| Input | GitHub and Feishu events | Voice, text, Open DeskOS Data, connectors |
| Output | Pull requests and messages in the source conversation | Displayed answers, suggestions, and controlled Pi work |
| Main cost | Team attention | Owner attention and private state |
| Runtime host | DeepSeek Harness profile | CM5 resident service with a shared Electron Shell |

Sources: `README.md:7-9`; `PRODUCT.md:9-35`; `integrations/personal-agent/README.md:1-8`; `integrations/personal-agent/docs/UNIFIED_ARCHITECTURE.md:9-20`.

Upstream states the shared principle: take as little human attention as possible and give as much value as possible (`docs/000-philosophy.md:5`). It acts only when a person asks or a written rule allows it. It speaks only when a person must act or can use a result (`docs/000-philosophy.md:11-12`). Downstream applies the same cost model to one owner. Its watch applies quiet hours, attention cooldowns, presentation limits, and deduplication (`integrations/personal-agent/docs/CONTRACT.md:714-750`).

## Domain model

Upstream defines a short chain: Source, Trigger, Thread, Eval, Decision, Mandate, Ticket, Assignment, Report, and Channel (`docs/001-domain.md:5-12`). A person is not a domain concept. Actor identity stays in Trigger metadata (`docs/001-domain.md:39`). The document lists rejected concepts, including cross-Source identity mapping and Ticket state that follows a Session (`docs/001-domain.md:45-60`). The design says a business need becomes an attribute of an existing concept or prompt text (`docs/000-philosophy.md:19`).

Downstream names more concepts: profile, intent, workflow, reviewed capability, plugin, child task, saved identity, package, connector, proposal, occurrence, and Intent wish. The five-layer model assigns each concept an owner (`integrations/personal-agent/docs/UNIFIED_ARCHITECTURE.md:9-20`). The intent table names 22 workflows (`integrations/personal-agent/docs/CONTRACT.md:318-340`).

The difference follows the product boundary. Upstream serves one repository through two event streams. Downstream serves one device with voice, private data, cross-host transport, and reviewed extensions.

## Authorization and routing

Both designs use a closed, typed decision set. Code owns dispatch.

Upstream runs a deterministic gate and a model assessment. The gate checks the sender, the receiving scope, and whether the message addresses the agent (`docs/002-authorization.md:7-20`). An admission table has three cells per scope (`docs/002-authorization.md:63-85`). Accept modes are `off`, `observe`, and `auto`. The default mode records a positive inferred assessment as "would accept" and accepts nothing (`docs/002-authorization.md:95-101`). An accept creates an immutable Mandate. The Mandate records the Policy version, scope, strength, matched rules, and admission basis (`docs/001-domain.md:34`). Revalidation can revoke a Mandate before an ended Ticket resumes (`docs/002-authorization.md:129-141`).

Downstream classifies every owner turn before memory reads, inference, or capabilities (`integrations/personal-agent/docs/CONTRACT.md:311`). It activates only the selected intent's tool allowlist. Inactive tools cannot be discovered or executed (`integrations/personal-agent/docs/CONTRACT.md:355-375`). Mutations get one reservation per owner turn. An uncertain result never replays automatically (`integrations/personal-agent/docs/CONTRACT.md:365-371`). Jev is optional. A failed judgment stops dispatch (`integrations/personal-agent/docs/CONTRACT.md:377-379`, `404-405`).

The routing decision differs in kind. Upstream decides whether work may start and how far a Ticket may go. Downstream decides which tools may run in the current turn. Both refuse authority from external text. Upstream says outside text never changes rules or authorization (`docs/004-prompts.md:71`). Downstream says generated text never supplies action authority (`integrations/personal-agent/features/proactive-suggestions.feature:3`).

## Proactivity

Upstream treats proactive work as an inferred candidate. A matching written rule is required. Explicit requests work in every accept mode (`docs/002-authorization.md:95-105`). The main Session asks one concrete question at a time (`docs/000-philosophy.md:13`). The panel shows healthy states without extra space (`docs/005-panel.md:50-58`). Its proactive assessment is typed too. The `orchestrator_eval_decide` schema requires one judgment per enabled rule, a `direction` object, and `intent_evidence` for an accept (`src/app/assessment.ts:20-34`). An Eval defaults to 120 seconds. The clock starts when the candidate reaches the main Session (`src/policy.ts:83-87`; `docs/002-authorization.md:149`).

Downstream runs a ProactiveWatch. The watch reads owner-selected Open DeskOS Data and configured Hosted Pi sessions (`integrations/personal-agent/docs/CONTRACT.md:656`). An isolated Durable conversation generates candidates with no action authority. The host binds each action ID to an owner-approved tool and exact parameters (`integrations/personal-agent/docs/CONTRACT.md:666-686`). Delivery supports `immediate`, `routine`, and `silent` modes, quiet hours, and attention cooldowns (`integrations/personal-agent/docs/CONTRACT.md:714-735`). The Shell acknowledges a suggestion only after its advice enters the visible viewport (`integrations/personal-agent/docs/CONTRACT.md:874`).

Downstream implements quietness as explicit state machines. Upstream implements it as a small policy plus prompt discipline. Neither design lets a model broaden its own authority.

## Execution

Upstream gives each Ticket one Executor Session and one directory (`docs/003-execution.md:25`). A prepare command commonly creates a git worktree (`docs/003-execution.md:51-53`). Worker slots bound concurrency. Background jobs and subagents can wake a worker (`docs/003-execution.md:27-60`). Reports use `progress`, `waiting`, `ready`, `blocked`, `failed`, and `dropped` (`docs/001-domain.md:109-112`). Both presets run with `danger-full-access` as the operator's OS user. Account wrappers are defaults, not a security boundary (`docs/006-deployment.md:19`; `docs/003-execution.md:80-84`).

Downstream splits the coordinator from the worker. The resident coordinator has no generic shell or source mutation tools. Hosted Pi handles source work on an explicit target and project (`integrations/personal-agent/docs/UNIFIED_ARCHITECTURE.md:65-73`). Child tasks receive a fixed internal workflow. Task text and role text cannot select child mode or expand tools (`integrations/personal-agent/docs/AGENT_TASKS.md:57-71`). Each child gets a private home. Saved identities keep their own conversation, notes, and experience (`integrations/personal-agent/docs/AGENT_TASKS.md:29-44`).

Upstream trusts a strong coding agent with OS-level access. Downstream treats the same capability as a separately admitted, explicitly targeted operation.

## Prompts, settings, and authority

Upstream keeps few settings. Behaviour described in words becomes prompt text (`docs/000-philosophy.md:20`). Teams edit three sections, add Skills, and override built-in prompt parts (`docs/004-prompts.md:5-16`). Prompt versions are immutable. Sessions read the latest version on every model request (`docs/004-prompts.md:91-96`). Precedence runs from host-enforced facts down to outside text (`docs/004-prompts.md:65-71`).

Upstream still guards some settings in code. Only a panel-origin save can change execution paths or account CLI fields. The code calls this a guardrail against prompt-injected tool calls, not an OS security boundary (`src/app/settings.ts:44-51`; `src/app/settings.ts:143`). Auto-merge has no host decision logic. The Delivery requirements prompt governs it (`docs/003-execution.md:82-90`).

Downstream keeps policy in host code and typed configuration. A profile selects fixed plugin identities. Configuration cannot select arbitrary executable factories (`integrations/personal-agent/docs/UNIFIED_ARCHITECTURE.md:46-60`). Each setting has an explicit bound (`integrations/personal-agent/docs/CONTRACT.md:714-735`). The catalog installs declarative Skill and MCP revisions only after an explicit request and validated candidate selection (`integrations/personal-agent/docs/UNIFIED_ARCHITECTURE.md:116-133`).

This is the largest design difference. Upstream puts team policy in editable text. Downstream puts owner policy in code and validation. Upstream gains operator flexibility. Downstream gains a fixed trust boundary.

## Memory, learning, and completion

Upstream defines no persistent owner memory entity. `src/core/memory.ts` supplies in-memory repositories for domain tests (`docs/007-architecture.md:314`). Cross-Source identity mapping is prompt text (`docs/001-domain.md:39`). Completion relies on structured worker Reports, Ticket stages, and human review. The prompt says a draft is unfinished and a UI change without a real screenshot is not ready (`docs/004-prompts.md:85`).

See the [memory contract](CONTRACT.md#mem0-setup) for current Personal Agent storage.
A zero-tool verifier checks bounded tool receipts from the host.
Automatic learning requires a passed completion check and validated receipt citations.
The [plugin contract](AGENT_PLUGINS.md) defines the completion and learning rules.

Downstream adds a second verification layer. It also adds model calls, deadlines, and explicit uncertainty states.

## Panel and generated content

Upstream exposes a Web panel with six tabs that follow the domain stages (`docs/005-panel.md:13-24`). The panel uses domain terms. It answers three questions in order: what needs me, is the system healthy, and what happened (`docs/005-panel.md:5-8`). Its principles require honest state and quiet defaults (`docs/005-panel.md:50-58`).

Downstream shows a nonmodal panel in the Electron Shell (`integrations/personal-agent/docs/CONTRACT.md:855`). The card puts advice and the next step before its controls. Sources and technical evidence stay collapsed. The renderer uses `textContent` for untrusted strings (`integrations/personal-agent/docs/CONTRACT.md:856-862`). Project rules require generated content to use shared primitives and forbid bespoke domain cards (`AGENTS.md:12-17`).

Both surfaces hide healthy state and technical detail. Upstream still teaches the domain vocabulary. Downstream hides technical evidence behind a disclosure.

## Durability and recovery

Both designs persist admission before they report acceptance.

Upstream uses one SQLite Store, a transactional Engine, and a durable effect queue. All Engine methods are synchronous and commit one aggregate per transaction (`docs/007-architecture.md:48`). Effects run only after commit (`docs/007-architecture.md:162-170`). An Outbox keeps reply receipts and preserves message order (`docs/007-architecture.md:41`; `docs/007-architecture.md:159`; `docs/003-execution.md:175-191`). A restart reports interrupted Assignments with a recovery note (`docs/003-execution.md:144-157`). Policy changes discard running Evals and requeue their Triggers (`docs/002-authorization.md:109-117`).

Downstream uses private JSONL Durable state, a writer lease, and per-action reservations. A stopped process leaves a lease that expires after 120 seconds (`integrations/personal-agent/docs/CONTRACT.md:409-420`). Recovered work cannot use a later request's authorization (`integrations/personal-agent/docs/CONTRACT.md:425-435`). A restarted executing action becomes `unknown` and cannot replay (`integrations/personal-agent/docs/CONTRACT.md:829`). A proposal checkpoint uses mode 0600 and fsync (`integrations/personal-agent/docs/CONTRACT.md:822-827`).

Upstream IDs are content-derived SHA-256 values (`src/core/ids.ts:1-5`). Downstream uses UUID handles and private checkpoints with occurrence watermarks (`integrations/personal-agent/docs/AGENT_TASKS.md:10`; `integrations/personal-agent/docs/INTENTS.md:49-54`).

Upstream deletes no old records. Trigger, disposition, decision, ended Ticket, outbox receipt, settings version, and per-Thread Source rows grow without bound (`docs/007-architecture.md:484-486`). Downstream caps these workflow stores.

- 64 full proposals plus 1024 compact receipts (`integrations/personal-agent/docs/CONTRACT.md:812`).
- 128 retained task records and a 4 MiB registry (`integrations/personal-agent/docs/AGENT_TASKS.md:101-102`).
- 128 package identities (`integrations/personal-agent/docs/AGENT_CATALOG.md:140`).
- 256 Intent occurrences (`integrations/personal-agent/docs/INTENTS.md:52`).

Upstream generalises recovery into one effect queue with one writer per state (`docs/007-architecture.md:259`). Downstream repeats reservations and receipts inside each domain. The principles match. The mechanisms differ.

## Deployment and trust

Upstream installs as a DeepSeek Harness bundle in a dedicated profile. It uses an agent GitHub account and CLI wrappers (`docs/006-deployment.md:5-16`; `cordis.patch.yml:1-20`). It recommends a dedicated OS account for isolation (`docs/006-deployment.md:19-22`).

Upstream lists Trust and deployment isolation as open questions (`docs/007-architecture.md:614-617`). Its generic modules still name GitHub and Feishu directly (`docs/007-architecture.md:275-286`).

Downstream runs a nonroot systemd user service on CM5. Windows runs a display client and a restricted SSH link. The release tree stays read-only. Private sockets and 0600 state files restrict access (`integrations/personal-agent/docs/UNIFIED_ARCHITECTURE.md:23-33`; `integrations/personal-agent/README.md:85-88`; `integrations/personal-agent/docs/CONTRACT.md:886`). Three Shell Hosts share the Shell. Each host keeps separate acceptance evidence (`PRODUCT.md:9-14`).

Upstream trusts accounts and process-level conventions. Downstream treats the host boundary as a product requirement.

## Distinctive decisions worth keeping in view

1. Upstream makes attention cost the single design test (`docs/000-philosophy.md:5-12`).
2. Upstream limits concepts and settings, then delegates behaviour to versioned prompt text (`docs/000-philosophy.md:19-20`; `docs/004-prompts.md:91-96`).
3. Upstream defaults proactive work to `observe` before `auto` (`docs/002-authorization.md:95-101`).
4. Upstream separates authorization from context through Subscriptions and Mandates (`docs/001-domain.md:29-31`).
5. Downstream routes every turn through a typed intent and a per-turn tool allowlist (`integrations/personal-agent/docs/CONTRACT.md:311-375`).
6. Downstream separates a finished answer from verified completion (`integrations/personal-agent/docs/AGENT_TASKS.md:14-16`).
7. Downstream records unknown outcomes and refuses automatic replay (`integrations/personal-agent/docs/CONTRACT.md:829`).
8. Both designs require a person to confirm consequential actions with an exact current phrase or decision (`integrations/personal-agent/docs/CONTRACT.md:865-874`; `docs/005-panel.md:58`).
9. Downstream bounds task, proposal, package, and Intent state. Upstream retains its workflow records (`docs/007-architecture.md:484-486`).

## Candidate borrowings

These are observations, not approved changes.

From upstream to downstream:

- Use fewer named concepts.
- Prefer fewer settings.
- Keep one general stored-work queue.
- Publish prompt versions with explicit precedence.
- Show healthy state without space.
- Record "would accept" before automatic acceptance.
- Use a typed assessment with one judgment per enabled rule.

From downstream to upstream:

- Use a closed per-turn tool allowlist.
- Verify completion with a zero-tool observer.
- Record unknown mutation outcomes without replay.
- Acknowledge presentation only after visibility.
- Enforce a reviewed capability registry instead of OS-level full access.
- Keep connector output as untrusted data.
- Bound every private store and define its eviction policy.

Do not transplant either list as a whole. Upstream serves a team through chat and code review. Downstream serves one owner through a device with private state and hardware gates.

## Verification

This note changes no runtime behaviour. I checked every cited path and line number against both working trees. An independent second read of the upstream clone cross-checked the primary sources. I did not run tests, builds, or device acceptance. Full ASD-STE100 conformance needs dictionary, word-meaning, and technical-term review.
