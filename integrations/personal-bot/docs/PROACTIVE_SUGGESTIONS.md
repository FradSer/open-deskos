# Proactive Personal Bot proposals

The personal bot service observes owner-selected Desk Data readings and configured Hosted Pi
sessions. A Jev judgment of current relevance creates read-only proposals; the existing private voice
status channel presents one Personal Bot panel. This is agent state, not a Widget or a new
Desk Data reading. There is no TTS, wake word, microphone capture, provider connector,
Desk Data write verb, or automatic action in the watch.

## Owner configuration

`ODESK_PROACTIVE_CONFIG` is an opt-in absolute path to a reviewed JSON file, mode 0600,
owned by the service user, with no symlink components. Keep it outside the checkout in
a private directory. With the variable absent, no polling or proactive model request
occurs. Jev is mandatory: set `TYPESAFE_API_KEY` in the private service environment
or `ODESK_JEV_KEY_FILE` to a protected credential file. No Jev credential or failed
inference means no new proposal, never a threshold-only fallback. `ODESK_JEV_MODEL`
defaults to `jev-latest`; `ODESK_JEV_THRESHOLD` defaults to 0.8 and is an initial
operating choice, not a calibrated accuracy guarantee. `ODESK_JEV_TIMEOUT_MS`
defaults to 10000. Credentials remain service-side and provider responses are bounded. Invalid configuration disables suggestions and reports an actionable message;
ordinary voice remains available. The service reads the file once. Restart after editing
rules; concurrent edits make suppression writes refuse rather than overwrite the owner.
Service restart or deployment is a separately authorized operational action.

## Generated suggestions (version 2)

Use [proactive-goals.example.json](proactive-goals.example.json) for the current
contract. Owners select goals and observation fields, not prewritten advice. An
isolated generation session uses the configured voice model to propose zero or
multiple candidates. It has no tools, skills, extensions, private memory or durable
conversation history. The full isolated generation lifecycle has a default 90-second
budget, configurable through `ODESK_PROACTIVE_GENERATION_TIMEOUT_MS` (1000–180000).
Timeout and owner cancellation end waiting even if the provider ignores abort;
late-created sessions are disposed. A malformed JSON/schema response gets at most
one format correction in the same private session and total deadline; provider
errors are not retried. Both the agent and watch validate all candidates and
citations. Persistent invalid output remains unavailable. Its JSON must contain known topic IDs, stable semantic keys,
bounded advice/reason strings and references to host-issued evidence IDs.

Each candidate receives three independent typed Jev judgments in one request:
current usefulness, factual support of its advice/reason, and whether it adds any
concrete assertion absent from the cited observations. Effective support is the
minimum of factual support and one minus the unsupported-assertion probability.
Usefulness and effective support must both meet the configured threshold. The
closed-world check forbids attributes inferred from a label/symbol or outside knowledge,
and uncited rankings, causes or aggregates. Owner preferences do not add facts. Code orders qualifying candidates by usefulness and selects
at most `maxPush` per batch; Jev may reject all candidates. Missing credentials,
invalid JSON, invented references or failed inference produce an unavailable state,
never fixed advice or automatic actions. Thresholds are operational settings rather
than calibrated accuracy guarantees.

Version 2 retains `pollMs`, freshness, quiet hours, delivery, cooldown, suppression
and routine presentation settings below. It adds `maxCandidates` (1–16) and
`maxPush` (1–`maxCandidates`). Each rule contains `id`, `goal` (up to 1000 characters),
`delivery`, `urgent`, optional routine `at`, and either:

- `observations`: 1–8 reading selections with `readingId`, 1–8 dotted `fields`,
  optional `measuredAtField` and boolean `liveWhen: {field, value}`. Only these
  bounded scalar values and their timestamps leave the host. A source ID event
  only requests an authoritative reread; it cannot supply candidate text.
- `coding`: the existing explicit target/project/optional task scope. A task must
  have been observed working before its finished turn is considered; generated
  text cannot invent successful verification.

New generated proposals are read-only (`action: null`). Multiple distinct proposals
can share a topic. Stable keys and normalized exact advice/evidence duplicates reuse
pending records; Jev also considers overlapping candidates and recently handled
advice. This is not a guarantee of perfect semantic deduplication. Updated advice is
judged before display. A newer service update invalidates earlier inference results.
Only heartbeat and service push initiate generation followed by judgment.

Structured generation receipts record the actual model, trigger, count and topic IDs.
Judgment receipts use host candidate labels and probabilities; generated text, source
values and semantic keys are not logged. The UI displays original host observations
and times. Version 1 records remain readable; owner migration expires incompatible
pending proposals while preserving processed history and owner suppression data.

## Legacy owner rules (version 1)

See [proactive-owner.example.json](proactive-owner.example.json). Replace the coding
project with an explicit configured development scope and select the plant index you
intend to observe. The example is a draft, never installed or enabled by tests.
Its weather and combined soil/weather rules deliver automatically when their live
observations are fresh and Jev judges their advice useful now, outside quiet hours and while the personal bot service is idle. No question
is required. The historical `morning-weather` ID remains for compatibility; its default
delivery is now immediate. An offered pending proposal is updated in place without
repeated popups. Owners may explicitly select routine delivery with `at` for a daily
schedule, or silent delivery for advice available only through interaction.

Configuration version 1:

- `pollMs`: 1 second–1 hour; production examples use 60 seconds. Polling invokes the
  registry's read verb, so sources retain their own refresh/cache policy.
- `maxAgeMs`: 1 second–24 hours. Missing, invalid, future, unavailable or stale measurements
  cannot trigger. Hydra additionally requires the selected plant not be offline/stale.
- `cooldownMs`: 1 minute–7 days; ignore, mute and completed actions save a rule-level deadline
  in `snoozed`. `suppressed` stores muted rule IDs; `routineDays` records the last locally presented day, persisted on the Shell acknowledgement. Both are owner data, never package data.
- `quietHours`: optional local `start`, `end` (`HH:mm`) and IANA `timeZone`. Overnight
  ranges work; equal boundaries disable quiet hours. Nonurgent proposals queue during
  quiet hours; owner-marked urgent rules may present immediately.
- `rules`: at most 32 owner-authored rules. A reading never supplies rules or advice.
  `conditions` names at most 8 observation fields and expresses owner relevance criteria for Jev: `readingId`, dotted `field`, `op`
  (`lt`, `lte`, `gt`, `gte`, `eq`), typed `value`, optional `measuredAtField`.
  Numeric comparisons no longer trigger proposals in code. Missing fields fail closed.
  Exact owner comparisons are still checked before executing a configured action.
  There is no evaluation of plugin code or string expressions.
- Measurement paths default to package `measured_at` or built-in `asOf`; Hydra plant
  rules explicitly name `plants.<index>.measuredAt`.
- `delivery`: `immediate`, `routine` with `at`, or `silent`. Routine proposals become
  eligible at/after the configured local time (UTC without quietHours), once per local day, including after handling or restart.
  A pending rule deduplicates updates. Silent proposals wait for an interaction or a
  suggestions question. A recording or working Spoken Turn always defers presentation.
- `advice`: reviewed owner text. An ephemeral model session with no tools, skills,
  extensions, memory or durable history may order its approved sentences. Model output
  must be an exact permutation of sentence indices; arbitrary generated claims are
  rejected. No plugin values are sent to this phrasing session. Measurement text is
  assembled directly from evidence, never generated. Model failure uses approved text.
- `action`: optional existing `memory_update`, `user_app_install`, `coding_task_start`
  or `coding_task_history`, with reviewed static `params`. Availability depends on the
  active profile. No plugin field can become an action parameter. DiDi remains its
  existing multi-turn flow: a suggestion can recommend opening it, but never confirm
  an order; its quote-specific confirmation phrase must come from the existing tool.
- `coding`: alternative to reading predicates, with configured `target` (`mac`/`cm5`)
  and absolute `project`, optionally exact `taskId`. Scope rules discover sessions with
  `coding_tasks_list` and poll `coding_task_status` with each session's own project.
  A session must have been observed working before its finished idle turn triggers.
  Startup history, absent targets, failed/cancelled turns and unreachable services
  do not become successful completion proposals. Completion is separate from
  `verification`; `not_run` remains not independently verified. The coordinator also observes real launch/prompt receipts, so tasks that finish between
  polls are still tracked. The proposed action is
  the existing `coding_task_history` read, retaining target/project/taskId.

## Two Jev judgment triggers

1. **Heartbeat:** startup and every `pollMs` refresh owner-selected observations and
   generate candidates (version 2), then send one batched Jev request with usefulness
   and grounding Nouls per generated candidate. Version 1 judges owner-authored advice.
2. **Service push:** trusted services notify the private voice channel with
   `{ "v": 1, "type": "proactive_event", "readingIds": ["odk.tile.hydra"] }`.
   The Shell forwards accepted Hydra messages, Service Plugin snapshots, weather
   refreshes and declared package publications. Configured coding sources can use
   `pi-tasks.<target>`. Tool receipts track working tasks but do not create another
   judgment entry point. Extra payload
   fields, unknown reading identifiers and unauthenticated callers cannot supply
   observations, advice or actions. The agent rereads authoritative Desk Data or
   configured task status, then calls Jev with `service_push` context.

Pushes are coalesced for one second and processed in batches of at most 32 source
IDs without dropping the bounded remainder. A push evaluates dependent rules; a
combined rule still rereads all its required sources. An update arriving during inference invalidates
that earlier result and queues another refresh. Independent candidate questions share
one bounded state containing selected evidence, owner advice/criteria, local time and
recent suggestions. Action parameters, credentials, memory and plugin instruction
fields are not sent. Jev returns typed probabilities, never generated advice or tool
commands; code creates only affirmative proposals and applies quiet hours, deduplication,
owner cooldown/suppression and confirmation. Structured `proactive_jev` receipts record
trigger, returned model, rule probabilities and threshold without raw measurements or
secrets. Missing, malformed, timed-out or failed judgments report unavailability.

## Proposal and interaction contract

Direct requests such as `最近有什么建议`, `有什么建议吗` and `Any suggestions?`
are handled by the host before the conversation model. The host joins any active
watch refresh without causing a third Jev trigger type, reads current proposal state, and returns pending owner advice with
its actual measurement values and times. It never answers with a capability menu
or old session tasks. No pending proposal, disabled suggestions and an unavailable
store have distinct truthful responses. Reading suggestions never accepts an action;
the existing separate confirmation and presented-acknowledgement gates still apply.
Task-specific advice requests keep their ordinary model route. Proposal capabilities
used by that model remain accessible only through codemode, not as direct tools.

Each proposal contains a durable `id`, owner `ruleId`, subject, state,
creation time, advice, static action/confirmation and evidence entries:
`{readingId, field, value, state, measuredAt, ruleId}`. `pi-tasks:<target>:<taskId>`
explicitly marks the second data plane. Pending proposals recheck fresh observations and Jev relevance
on every heartbeat or selected source push; owner action predicates are rechecked before an action. Invalidated evidence expires the proposal; original
measurement times remain available and the UI labels it stale/expired. An expired
proposal cannot execute.

States are `pending`, `ignored`, `expired`, `executing`, `completed`, `unknown`.
The bounded private store retains up to 64 proposals; processed history is evicted
first. Pending/unknown work is preserved rather than displaced by newer work. On POSIX, a synchronous 0600 checkpoint in the service state's `proactive/state.json` persists
proposal history and scheduling. The private directory is 0700; invalid or unsafe state
disables suggestions instead of silently clearing action receipts. An action is reserved
as executing before any tool call; restored executing records become unknown. Unknown
records block another proposal for the same rule/subject until an operator reconciles
the outcome using the original tool and repairs the private record. Completed timestamps
preserve cooldown even if the owner suppression file could not be saved. Routine offers
are checkpointed before sending, so a lost Shell acknowledgement cannot repeat the
same day's scheduled popup after restart. Owner file `routineDays` additionally records
acknowledged presentation. Presentation acknowledgements are checkpointed before updating the owner routine day. A failed owner write retains the primary acknowledgement and exact confirmation. Explicit suggestions queries can reopen acknowledged pending proposals, while ordinary interactions retain automatic deduplication. Routine display still respects the due time and acknowledged owner day; the read-only tool can report queued or previously acknowledged state without a popup. Unacknowledged immediate offers can retry after restart; unacknowledged routine offers remain available through explicit interaction without repeating the scheduled popup. Restored actions must match the current owner rule; state cannot grant new actions. Changing a rule expires its saved pending proposals. Unknown action
results require reconciliation through the original tool and never automatic retry.

On Windows, private owner rules and proposal checkpoints use ACLs instead of POSIX
mode/uid checks. Only the current user, SYSTEM and Administrators may have allowed
access; unsafe existing ACLs are rejected without silently modifying them. New private
directories are protected explicitly, and an exclusive empty temporary file is protected
before any content is written through its held descriptor. Windows fsyncs the file;
directory fsync is a POSIX-only step. The PowerShell 5.1 helper ships inside `src/`,
so it is included in the existing runtime-input packaging contract.

The panel is nonmodal for proactive delivery. It preserves background focus and direct
Shell input, uses a single scrollable surface, and displays literal untrusted strings
with textContent. Back/Close dismiss presentation. Ignore writes cooldown; Never suggest
this category writes owner suppression. Neither is an action-tool call. Accept reveals
an action and exact phrase; a separate confirmation click sends that phrase through the
same authenticated socket. Merely accepting or saying vague agreement does nothing.

The Shell acknowledges presented proposal IDs. The host refuses confirmation before
presentation. Voice `personal_bot_proposal_respond` uses the actual current transcript, never
model-supplied authorization. Memory proposals display the existing exact `记住 名称：内容`
phrase and retain the memory tool's single-use current-turn gate. Other actions require
`确认执行 <proposal-id>`. Actions are reserved before awaited execution and are sequential;
any execution failure retains `unknown`, never invites retry. Returned tool results are
bounded and shown in the same panel. A suggestions question reads the host proposal store; model-originated reads use
the codemode-only `personal_bot_proposals` capability.

Status frames retain the existing v1 protocol. They add `proposals`, `proposalPopup`,
`proposalInteraction`, `proposalHiddenCount`, and optional `proposalError`. Commands are
`proposal_list`, `proposal_presented` (bounded IDs) and `proposal_respond` (ID, decision,
optional exact confirmation). Existing directory/socket permissions or Windows channel
token still authenticate the link. Display payloads fit a 48 KB budget; the panel states
when more are in the store. Proposal-bearing replies use an 8192-character response
bound to preserve the existing 131072-byte escaped-frame limit.

## Evidence and acceptance

[../features/proactive-suggestions.feature](../features/proactive-suggestions.feature)
defines the acceptance contract. Node tests exercise injected Jev decisions, both trigger types, freshness,
owner writes, subsequent confirmation, uncertain outcomes and coding transitions.
`runtime/linux/tests/proactive-panel.test.js` exercises renderer control behavior through
a local DOM fixture. `runtime/linux/tests/proactive-panel.cjs` loads the real Shell with
only fixture IPC, a temporary profile, blocked HTTP requests, GPU disabled and Electron
headless or a dedicated temporary Xvfb display (`--fixture-x11 --ozone-platform=x11`). Run it on CM5 over SSH in a disposable checkout; it never loads main.js,
connects to production sockets, displays on the physical screen, captures audio or installs a service.

Local fixture checks do not establish live provider, microphone, deployed service,
physical touch or assistive-technology acceptance. P7 Gmail and other connectors remain
independent plugin work: publish declared signal fields and `measured_at`, then configure
owner rules. OAuth scopes and private credential files require separate authorization.

## Personal Bot naming migration

The resident product is **Personal Bot**. Microphone capture and speech recognition
are input adapters; suggestions are bot state and use the `personal_bot` tool
namespace. Shell IPC, DOM, host channels, launchers and service identifiers use
`personal-bot`, with `OdkPersonalBot` on Windows.

Existing `ODESK_VOICE_*` settings and `voice-agent.env` are accepted only at the
upgrade boundary. Canonical `ODESK_PERSONAL_BOT_*` settings take precedence.
Startup moves the previous state directory once, retaining checkpoint/history
bytes. Linux requires a private directory; Windows restricts state ACLs before
moving. Two existing histories or unsafe links fail rather than being merged.
Deployment retires the old service before starting the new one. Old immutable
releases and deployment backups remain available for rollback.
