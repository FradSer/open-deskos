# Personal Agent implementation status

The current runtime integration candidate defines implemented behavior.
The [unified architecture](UNIFIED_ARCHITECTURE.md) owns the five-layer model and authority boundaries.
This ledger distinguishes previous checks, live results, and work that remains unverified.
This work includes reviewed commits, pull requests, and merges into `main`.
Production deployment and physical acceptance require separate host evidence.

## Native Pi configuration verification, 2026-10-22

The candidate starts from upstream `main` at `eb3e5a49`.
Pi AI, Coding Agent, Durable, env, Code Mode, and Chord use version 1.4.0.
Native Pi owns models, authentication, and classifier requests.
The Electron composer exposes `/login`, `/model`, and `/thinking`.
Explicit login can restore Jev after failed startup authentication.
The rename procedure preserves state and rejects retired service variable prefixes.

Local verification passed:

- Agent: 1,231 passed, nine skipped; type checking passed.
- Shell: 2,478 passed, three skipped.
- Complete E2E, geometry, and Pi configuration interaction checks passed.
- Android: 31 unit tests passed.
- Independent review found no remaining blocking issue on the reviewed paths.

Code Terrier submission failed because its local script exceeded the argument size limit.
Android has no Pi configuration bridge; its configuration controls report unavailable.
Real OAuth, target-host migration, and physical-device acceptance remain unverified.
No deployment or activation occurred.

## Current design implementation

The implementation branch is `codex/personal-agent-design`.
Its upstream baseline is `75ee6abf574997f526ff1faf0cb8386e5e9ef962`.
Overview commit `1a9aed97` supplies the reviewed selection reference.
This section tracks current work; the evidence sections below retain their original candidate boundaries.

| Work | Owner boundary | Current result |
| --- | --- | --- |
| Source projections | Producer plugins, existing registry, authenticated transport | Implemented; replacement, cancellation, and malformed inventory isolation checks pass |
| Independent Home and Watch | Versioned composition and compatible replacements | Implemented; legacy Watch contracts remain supported |
| Complete fact selection | Source identity, time, units, verification, bounded batches | Implemented; four-theme all-source rendering passes |
| Continuing work | Existing task and session references; no second task store | Implemented; fresh references and bounded owner history |
| Proposal needs and feedback | Durable occurrence, candidate feedback, separate presentation | Implemented; restart, recurrence, capacity, and feedback checks pass |
| Completion applicability | Conversation, query, admission, and execution remain distinct | Implemented; query learning accepts independent host checks only |
| Interface clarity | Existing surfaces, disclosed evidence, visible presentation receipts | Implemented; keyboard, simulated touch, and long-body checks pass |
| Cross-host capabilities | Public projections and explicit supported operations | Implemented; Android projection remains read-only |
| Quality and cost | Offline behavior evaluation, semantic reuse, bounded generation | Implemented; eight offline replay scenarios pass |

Independent reviews verified ownership, cancellation, capacity, batch isolation, feedback identity, recurrence, learning evidence, provider withdrawal, stale acknowledgements, and malformed inventory isolation.
Checks use isolated state and controlled provider responses.
The full Personal suite passed 1295 tests, skipped eight gated cases, and had no failures.
This run includes final capacity, stale acknowledgement, and producer isolation regressions.
Type checking passes.
The affected Shell run passes all 74 checks.
Earlier full-suite fixture failures were repaired and verified at their affected boundaries.
Hydra's fixture now uses the actual Shell display-only frame.
All 168 matrix cases and four-theme capture checks pass with unchanged size, font, and density thresholds.
The complete Electron E2E run passes; all driver, motion, geometry, composition, density, and theme gates return zero.
Android projection tests pass: 9 tests, zero failures.
The recommendation panel passes four themes, three sizes, five states, keyboard input, simulated touch, and visible-body acknowledgement.
All-source Overview synthesis passes four renderer themes.
Shared Widget styles and density checks pass without profile changes.
One native fade capture failed during parallel checks; the unchanged strict gate passed in E2E and a separate rerun.
Offline replay measures host behavior; it does not establish model quality, calibration, user benefit, or disk durability.
The store retains 64 full proposals and 1024 compact handled receipts.
Capacity recovery requires an obsolete topic update or removal and restart; unknown actions remain protected.
The branch is prepared for pull-request review.
Live models, physical input, target-device acceptance, and deployment remain unverified.

Personal Agent commands: `node --test --test-timeout=120000 --test-concurrency=4 tests/*.test.mjs`, `pnpm typecheck`, and `pnpm test:proactive:evaluate`.
Shell commands: `pnpm e2e` and `pnpm exec electron tests/hydra-style.cjs --capture-dir=/tmp/odk-hydra-shared-frame-preview`.
Android command: `./gradlew testDebugUnitTest --tests com.odk.shell.link.PersonalAgentFrameTest`.

## Implemented scope

| Requirement | Implementation | Remaining acceptance |
| --- | --- | --- |
| General tasks | Asynchronous admission, exact handles, continuation, cancellation, and separate completion state | Broader live task families |
| Install Skills | Declarative candidate inspection, exact revisions, snapshots, and restart | Selected target-host installations |
| Install MCP | Declarative packages, stdio and Streamable HTTP adapters, current schema discovery | Selected real connectors and target hosts |
| Reviewed runtime modules | Fixed experience, completion, learning, catalog, MCP, and subagent identities | Installed host configuration |
| Memory context | Durable requests reflect saved notes; accepted experience supports later synthetic tasks | General benefit beyond the measured cases |
| Completion harness | Zero-tool receipt checks; derived answers retain actual computation evidence | Model judgments do not replace independent grading |
| Automatic procedural learning | Validated private lessons; three later synthetic cases improve with accepted experience | General learning benefit remains unestablished |
| Temporary children | Separate Durable sessions and homes; controlled live execution passes | Broader live workloads |
| Saved identities | Revision checks, persistent homes, and one active task per identity; controlled live restart passes | Broader live workloads and physical interaction |
| Conversation avatars | Bounded activity through service, client, Main, preload, and renderer | Physical-input acceptance |
| Reviewed capabilities | Canonical registry and isolated browser lifecycle; all seven browser command kinds run on CM5 | Live model-driven browser tasks |

## Integrated pull requests

The capability, browser, routing, catalog, child, and resident changes are merged into `main`.
Pull requests [#26](https://github.com/FradSer/open-deskos/pull/26) through [#31](https://github.com/FradSer/open-deskos/pull/31) retain their reviews.
Source and acceptance evidence identify the exact candidate they checked.

Review corrections retain cleanup failures across concurrent close calls.
New owner requests clear previous completion results, including routed shortcut answers.
Browser output checks observed locations and uses fresh host delimiters.
Refused page sessions retire before later actions, including when cleanup remains unconfirmed.
Host downloads require pinned digests before installation.
The installer no longer contains the unused user-switch helper.
Worker learning states use the stored enum; unknown states require review.
Pending microphone frames retain current child activity and voice metadata.

## Offline evidence

Current gates check the corrected integration candidate.
Rows marked previous retain their original evidence boundary.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Personal Agent suite | 815 total; 809 passed; six skipped | Published integration with review regressions; concurrency four; original deadlines retained |
| Typecheck | Passed | Current Personal Agent candidate |
| Shell Node gate | Previous: 2295 total; 2293 passed; two skipped | Shared host contracts before this integration |
| Affected Shell contracts | 32 passed | Current installer, activity frame, socket client, Main channel, microphone routing, and preload |
| Focused CM5 gate | Previous: 54 passed | Nonroot isolated candidate before the Windows permission changes |
| Complete child activity pipeline | Three checks passed locally; previous Windows and CM5 runs passed | Durable, service, Main, preload, renderer, restart, and cleanup pipeline |
| Live acceptance contract | 48 passed; previous readability sample: 49 passed | Safe feedback, privacy, and complete zero-call runner checks |
| Independent module review | 59 passed; three findings corrected | Browser lifecycle, uncertain mutations, installer symlink safety, declarations, and routing |
| Final lifecycle review | 35 passed | Scoped cleanup, failed close receipts, unused sessions, and concurrent disposal |
| Explicit notes integration | Five checks passed | Actual Durable memory block after save, restart, update, and deletion |
| Actual browser commands | All seven command kinds passed | CM5 `orangepi`, real CLI and Chrome, private local HTTP fixture |

The pipeline uses disposable state, offline model responses, and isolated display resources.
A concurrent run exceeded the unchanged cleanup-test deadline; the isolated rerun passed.
It retains the original saved identity and completed task after a new resident process starts.
It rejects missing identities and unsuccessful private-process cleanup.
These results do not prove physical input, production activation, or live-model quality.
The previous 2026-10-16 source sample matched all 71 local and CM5 files, including bundled Skills.
Its recorded source digest is `dc406565b06d78d4a3223015e0473ce354e3e51c5ea31cce9c934b84f27a5f06`.
The isolated CM5 candidate passed 54 focused checks and three activity pipeline checks with that sample.
Target checks exposed a real CLI close response that preceded daemon exit.
The runtime now rotates host-owned page epochs before the next command, without replaying an operation.
Tool closure reports uncertainty when no success receipt arrives.
Final disposal rejects incomplete cleanup after it attempts all owned resources.
Actual target checks cover `open`, `read`, `snapshot`, `click`, `fill`, `press`, and `close` commands.
They confirm click, input, and Enter effects, immediate reopening, content boundaries, and successful scoped cleanup.
These checks use local fixtures and make no model or website requests.

## Live evidence ledger

Each attempt retains its request, output, and deadline safeguards.
Failed reports remain unchanged.
No live acceptance process or container remains active.

The fresh `full-10` run passed all seven original scenarios with 84 actual requests on CM5.
Its exact candidate was `9b21983fc3ebd2b33a78c0f8ab45231122835f84`.
Its 213 source fingerprints remained unchanged, and its 204 runtime files matched the active release.
The run used the configured `bailian/deepseek-v4.1-flash` model and real Jev judgments.
All requests returned HTTP 200, and cleanup passed.
The run completed in approximately 18 minutes and 29 seconds.
It retained explicit limits of 160 requests, 16384 output tokens, and 30 minutes.
Plugin validation used the actual 180000-millisecond runtime setting.

Natural-language Skill installation, MCP installation, and saved identity creation passed.
The saved training result was 6, equal to the expected value 6; this is a numeric comparison, not six scored checks.
Training completion and accepted learning passed.
Saved restart returned 9, and the temporary child returned 3; both passed completion.
The saved child retained its exact handle, next turn, identity revision, and active avatar metadata.

The three paired expected values were 4, 13, and 3.
The baseline produced zero correct results, and the candidate produced all three correct results.
Each candidate completion passed and recorded four actual experience reads.
Both arms used fresh conversations, identical supplied data and roles, disabled MCP access, and disabled automatic learning.
Only the candidate received accepted experience.
This demonstrates improvement on these three synthetic cases only.
General learning benefit remains `not_established`.

The report retained 166775 generation input tokens and 124630 generation output tokens.
The reported 110646 reasoning tokens are included in output tokens, not additional tokens.
Jev usage was 28984 input tokens and 1104 output tokens.
Configured prices and actual charges remain unknown.
No generation reached its output limit, and no timeout or SDK error was recorded.
Intermediate invalid judgments remain in the evidence; the final pass does not mean every model judgment was valid.

Earlier failed runs remain failed.
Their recorded boundaries include operator assembly errors, output or time limits, invalid citations, unresolved checks, and an upstream HTTP 451 response.
No earlier phase was combined with `full-10` to obtain its pass.
The new core, targeted, and separate learning modes have offline contract coverage.
They have not received a new live evaluation merely because the original full run passed.
The [live acceptance plan](AGENT_LIVE_ACCEPTANCE.md) owns isolation, grading, and continuation rules.

## Windows isolated acceptance

The operator resumed this gate on 2026-10-16.
Candidate `20261016-agent-033dbea9` ran in interactive Session 1 with a Limited user token.
It used private dependencies, state, environment variables, and offline model responses.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| Personal Agent contracts | 77 total; 73 passed; four skipped | Actual Durable sessions, packages, MCP, memory, learning, and child restart |
| Shell contracts | One passed; one Unix-socket check skipped | Actual named-pipe behavior is covered by the complete pipeline |
| Complete avatar pipeline | Three passed | Positive restart, missing-identity rejection, and bounded failed cleanup |
| Avatar render | Passed; PNG inspected | Hidden renderer; saved avatar, Unicode name, and running state |
| Linux compatibility | 112 passed; five skipped; final private-path check: seven passed, four skipped | Node 24, disabled network, read-only source, and temporary state |
| Independent security review | Passed after one correction | Native ACL memory ownership, fresh permissions, directory creation, and unavailable roots |

The Windows skips cover three file-symlink fixtures without creation privileges and one POSIX mode check.
Real directory junctions and hard links retain their rejection checks.
Native ACL calls replace repeated PowerShell startup without caching permission judgments.
A 100-check sample, including reads, completed in approximately 114 milliseconds.
Private modules now protect each new ancestor before creating its children.
They still refuse unsafe existing directories and do not migrate old permissions.
The final gate made no external model calls and did not activate a production release.
These results establish isolated Windows behavior, not physical input or visible desktop interaction.

## Acceptance boundaries

Implementation and this bounded isolated acceptance are complete.
Model output can still fail structure, scope, citation, or semantic checks.
Such failures retain review status and never replay a tool mutation.
Content-only tasks without independent evidence also retain review status.
Selected real connectors, wider task families, and model quality require their own acceptance evidence.
The operator resumed Windows acceptance on 2026-10-16.
The isolated Windows results above replace the previous deferral.
Physical input and production activation remain outside these checks.

[AGENT_PLUGINS](AGENT_PLUGINS.md), [AGENT_TASKS](AGENT_TASKS.md), and [AGENT_CATALOG](AGENT_CATALOG.md) own their detailed runtime contracts.
