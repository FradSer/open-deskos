# Jev intent routing

Every user text/transcribed turn in both `coding` and `personal` profiles goes
through Jev before turn state, private memory reads, suggestion queries, the Pi
conversation model, or capability execution. The former suggestion regex shortcut
has been removed. A touch-accepted proposal action also classifies its actual
confirmation through Jev before execution.

The router uses the [TypeSafe HTTP API](https://docs.typesafe.ai/api) and a
[Choice question](https://docs.typesafe.ai/primitives/choice), following the
[function dispatch pattern](https://docs.typesafe.ai/cookbooks/function_calling).
Jev selects a closed intent; code owns dispatch and execution. The original user
text is passed unchanged, with bounded previous-turn context, available tool
names and the currently displayed proposal confirmation phrases. Private memory
files, credentials and live desk readings are not router state.

| Intent | Workflow |
| --- | --- |
| `session_continue` | Resolve targets/list, then prompt the existing session with its own project/task identity; no replacement start |
| `task_query` | Read target/task list, status and history; no mutations |
| `session_control` | Explicitly cancel a turn or end a resolved session |
| `coding_work` | Delegate a new task to an explicit configured target/project |
| `widget_create`, `app_create` | Delegate draft/checks; use verified lifecycle installation only when requested |
| `app_query` | Read-only installed application inventory and desktop placement |
| `app_manage` | Explicit existing application lifecycle and placement changes |
| `suggestions` | Read current private proposals directly without a conversation-model answer |
| `proposal_response` | Existing exact displayed-phrase and subsequent-turn validation |
| `desk_data` | Fresh measurements with state and measurement time |
| `memory` | Existing explicit-current-turn remember/forget policy |
| `ride` | Reviewed DiDi quote/order/confirmation transaction |
| `extension` | Reviewed operator-added capabilities outside the core workflows |
| `conversation` | Conversation without specialized task/application mutations |
| `clarify` | Ask to resolve the intent; no downstream model or capabilities |

Custom capabilities are restricted to the selected workflow at execution time.
Operator-added capabilities retain a separate Jev-selected `extension` handler;
the router receives the registered capability names and bounded descriptions. It cannot use core mutations
as a substitute, and non-extension workflows cannot invoke these tools. This restriction does not
change the full tool set available to a delegated Hosted Pi worker. The personal
profile gains the reviewed core coordination tools, while generic shell and file
implementation tools remain excluded. The coding profile retains inspection tools.

The conversation session registers each reviewed capability once as a direct
SDK tool, initially inactive. After Jev selects an intent, the same allowlist
used by the execution guard activates that turn's tools. Pi's Code Mode `only`
mode hides their separate schemas and presents `codemode` as the model-facing
entry. The active SDK registry still accepts an exact historical direct call,
with the same original parameter validation and executor as a nested call.
This fixes wrong-entry calls for every workflow without generated wrappers,
name substitution or automatic replay. Inactive tools cannot be discovered or
executed through Code Mode. Turn completion, failure and cancellation deactivate
the selected entries. No prior intent is active at startup or after failed Jev
inference. Proposal actions retain their separate exact-confirmation checks.

Identical non-read-only attempts are reserved before execution, once per actual
user turn, across both entries. A repeat is refused even if the first attempt
failed after a side effect, is still pending, or succeeded before the surrounding
script failed. Keys use canonical argument digests rather than retaining private
arguments. Reviewed `readOnlyHint: true` queries remain fresh and repeatable;
capabilities without that hint are conservatively treated as mutations. A new
explicit user turn resets reservations but retains each tool's own authorization
and unknown-outcome gates. Ride status reconciliation is a read, while submission
and cancellation remain mutations with exact subsequent-turn confirmations.

Every dispatched workflow receives the current allowed names and the same
discovery/error-handling contract. Unknown names and invalid arguments are call
errors; they do not establish service unavailability. Actual execution errors
keep their original meaning. Failed or uncertain mutations are never retried
because the model used the wrong entry. Historical readings do not establish
current conditions, and raw metrics do not establish assessments or recommendations
without applicable thresholds or source assessments.

Both profiles now require `TYPESAFE_API_KEY` in the private service environment or
`ODESK_JEV_KEY_FILE` pointing to a protected file, regardless of whether proactive
suggestions are enabled. `ODESK_JEV_MODEL` defaults to `jev-latest` and accepts only
Jev models. `ODESK_JEV_TIMEOUT_MS` defaults to 10000 (1000–30000 allowed).
`ODESK_JEV_INTENT_THRESHOLD` defaults to 0.8 (greater than 0.5 and at most 1).
Selected probability and confidence must both meet it. This is an initial policy,
not a demonstrated accuracy guarantee; evaluate it on representative owner inputs
before production activation. Proactive usefulness keeps its separate
`ODESK_JEV_THRESHOLD` setting.

Missing credentials stop initialization with an actionable configuration message.
Failed/malformed/oversized inference does not fall back to regexes or Pi routing.
The service reports a request failure without exposing provider details. Ambiguity
asks for clarification. Cancel/close abort in-flight Jev requests and suppress late
results. Intent classification is never execution authorization: exact confirmation,
current identity, installation requests and unknown-outcome protections still apply.

Local tests use an offline TypeSafe HTTP fixture and the real Pi SDK with an offline
conversation model. These validate request/response contracts, dispatch, tool gates,
cancellation and transaction behavior; they do not measure live Jev classification
accuracy, deployment, microphone input or execution on CM5/Windows.

## Explicit live inference check

Run `pnpm test:intents:live` manually with the private Jev credential configured.
This sends only synthetic examples from `tests/fixtures/intent-cases.mjs`; it never
starts a Bot, coding task, application, order or device service. Optional case IDs
select a subset (for example `pnpm test:intents:live app-move app-grid-resize`).
Unknown IDs fail before inference, and any mismatched route or provider failure
makes the command exit nonzero. Default `pnpm test` remains offline.

The 2026-10-03 live check used `jev-1.13.0`. The first 20-case run passed 19;
moving an installed Widget fell below the unchanged 0.8 confidence/probability
gate. A second boundary check also reproduced ambiguity for desktop grid resizing.
The overlapping creation/lifecycle descriptions were corrected: source/design
changes are drafting, while an existing Widget's page/cell/grid span is lifecycle
management. Initial placement with a new Widget remains part of creation.

After correction, all 22 synthetic cases matched their expected routed behavior,
including ambiguous/multiple-intent inputs reaching clarification. That run used
26,526 input and 2,990 output tokens; median latency was 392 ms and p95 was 631 ms.
These are observations from a small synthetic run, not a general accuracy or
latency guarantee. No task mutation, installation, order, microphone capture or
device deployment was exercised by this live check.

## Plant-query regression

The Windows report on 2026-10-03 was traced to an actual direct `desk_data`
call returning `Tool desk_data not found`, while an authenticated read of the
same host's plant channel returned live measurements. In Pi v1 these capabilities
are normally called through `codemode` as `tools.desk_data`. The generic routed
registry above also accepts exact direct calls without exposing separate schemas.
The shared workflow contract distinguishes
a historical wrong-entry error from a fresh channel failure. Failed current reads
must not substitute remembered numbers. Connectivity and soil moisture alone do
not establish plant health or watering needs without a plant-specific assessment.

The casual question “今天花怎么样” separately reproduced a Jev routing failure
(conversation, below the unchanged 0.8 gate). The desk-data criterion now includes
casual questions about the owner's plants and excludes general gardening advice,
flower identification and Widget creation. All 27 synthetic cases passed the
subsequent live check, including the actual transcribed phrasing
“花今天活得怎么样了？”. Both profiles also exercise the actual SDK codemode
pipeline against an isolated channel, with historical direct-call errors present
and two successive fresh list/read cycles. Production activation remains a
separate operational step.

The subsequent generalization removes the literal plant-query example from the
classification criterion and supplies the registered capability descriptions to
Jev. Regression tests use the real SDK for exact direct and Code Mode calls,
invalid arguments, unknown names, forbidden intents, fresh queries, cancellation
and mutations that fail after a side effect. They check that such effects occur
once and that failed inference cannot retain the previous turn's capabilities.

Final generalization verification on 2026-10-03 passed 452 offline tests, with
one Windows ACL test skipped on macOS (453 total), plus typecheck and an
independent boundary review. All 33 synthetic live cases passed the final Jev
rerun. The preceding run passed 32: one response to an ambiguous input failed
validation and was safely rejected. The validator and 0.8 gate were retained;
these runs do not establish that invalid responses cannot recur.

An isolated Bot on the Windows handheld also completed three real read-only
queries through the configured conversation model and Jev: plant measurements,
weather, and installed Widget/App inventory. Task-owned test files were removed
afterward. The installed Shell and Personal Bot services were not replaced or
restarted; this verifies the isolated path, not production activation, UI input,
physical microphone capture, or CM5 execution.
