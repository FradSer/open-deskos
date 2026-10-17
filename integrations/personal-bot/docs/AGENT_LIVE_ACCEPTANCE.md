# Live Personal Agent acceptance

This runner checks real-model behavior against synthetic reports and a local MCP server.
It does not establish production behavior or physical device acceptance.
The [implementation status](PERSONAL_AGENT_IMPLEMENTATION.md) owns the current verification state.

## Inspect the plan

Run this command from `integrations/personal-bot`.

```sh
pnpm test:agent:live --plan
```

Plan inspection makes no external requests.
It does not read provider credentials or require Docker.

The plan covers these scenarios:

1. Install a staged Skill through a natural-language request.
2. Install a staged MCP connector through a natural-language request.
3. Create a saved identity with a name, role, and built-in avatar.
4. Delegate a report to that identity.
5. Check the actual report answer, completion result, and learned experience.
6. Restart the resident and reuse the saved identity.
7. Run a separate temporary child.
8. Compare three fresh-conversation pairs with identical packages and roles.

Each comparison pair differs only in accepted learned experience.
The baseline receives no learned experience.
The candidate receives the saved child's accepted experience without its conversation history.
Both receive the same current synthetic report directly in the task.
The shared task states that the training procedure applies without disclosing that procedure.
Both have MCP access and automatic learning disabled.
They cannot obtain the method by reading another report.
These pairs check supplied-data analysis and experience transfer; they do not establish MCP execution.
The host grades numerical results independently of the model's completion judgment.
The report records actual full-entry retrieval separately.
Saved-child activity must carry the expected avatar metadata.
Rendered avatar acceptance remains a separate check.

## Limits and isolation

The default per-run limit is 80 shared generation and Jev requests, including format corrections.
The operator must also retain any authorized aggregate limit across attempts.
The transport counts HTTP requests before dispatch.
It refuses redirects and disables SDK request retries.
By default, each generation request permits at most 2048 output tokens.
Use `--max-output-tokens=N` to select an explicit limit from 1 to 16384 tokens.
The configured model can reduce this limit.
The limit includes reasoning tokens.
The transport checks the final HTTP payload and refuses larger sampling overrides before dispatch.
The run has a 15-minute deadline.
Budget exhaustion stops dependent stages without retry.
The limit counts requests; it is not a monetary cost limit.

The runner uses a read-only candidate mount and private temporary state inside Docker.
Only the new evidence directory is writable on the host.
MCP executes the local synthetic report server.
The run creates no production task, deployment, service, order, or capture.

The runner uses the configured custom model and an explicit Jev credential.
The SDK supplies missing model defaults without a credential lookup or network refresh.
The report identifies explicitly configured prices with `pricingKnown`.
Default zero prices do not prove free service.
The report retains `actualCharge: not_established`; token counts do not establish actual charges.
Supported model APIs are `openai-responses`, `openai-completions`, and `anthropic-messages`.
It refuses unsupported model configuration instead of selecting another provider.
Credentials enter the container through standard input.
Credentials and provider responses do not enter host logs or evidence.
The report retains request counts, token counts, stage outcomes, scores, and source fingerprints.
It retains reported reasoning counts and counts generation calls that reach the output limit.
Missing reasoning counts remain unknown.
Plugin diagnostics retain bounded statuses, receipt-match facts, and counts without generated explanations or receipt text.
Fixed host validation categories identify rejected structure, scope, citations, and lesson text.
Report grading identifies missing, multiple, invalid, or valid result markers without retaining answer text.
Tool diagnostics retain fixed capability identities and failure categories without source, arguments, or error text.
The controller compares source fingerprints before and after the run.
A changed source sample prevents a passed result.
Container results remain provisional until the host completes source validation.
Source validation failure preserves a failed result.
Dependency bytes remain outside those source samples.

## Run after authorization

This command makes external model calls and can incur charges.
Use a new private output directory.

```sh
pnpm test:agent:live --live --output=/absolute/new/evidence-directory
```

The command requires Docker and `TYPESAFE_API_KEY`.
The selected custom model must exist in the current Pi agent configuration.
The evidence directory contains `report.json`.
A training stage with correct host grading, passed completion, and applied learning also writes `accepted-experience.json`.
This private artifact contains validated accepted experience without conversation history or raw provider responses.
The report records its entry count and SHA-256 digest before later stages begin.
The artifact alone does not prove later retrieval or learning benefit.
A failed run preserves partial counts and outcomes.
It does not retry a failed task automatically.

Use `--max-requests=N` and `--deadline-ms=N` to retain the remaining authorization budget after a failed attempt.
Both options can reduce the original limits.
They cannot increase them.
Include consumed requests and active execution time from all earlier attempts.
An unlimited aggregate authorization does not remove the runner's per-attempt safeguards.

Use `--task-evaluation` to check tasks after separate natural-language setup checks have passed.
This mode prepares the same synthetic packages and saved identity through host APIs.
It reports that setup as `host_fixture`, with `naturalLanguageVerified: false`.
It does not mark installation or identity-creation scenarios as passed.
Task execution, restart, completion, learning, and paired comparisons retain their original checks.
Retain the earlier setup report when interpreting combined coverage.

Use `--continue-from=CANONICAL_EVIDENCE_DIRECTORY` to resume independent checks from accepted synthetic learning.
Do not combine this option with `--task-evaluation`.
The source must contain private, owner-held `report.json` and `accepted-experience.json` files.
The loader requires real inference, correct training grading, passed completion, applied learning, source validation, and successful cleanup.
It checks the experience schema, entry count, and SHA-256 digest before model calls.
It restores only accepted experience into new private homes.
It retains the source report path and content digests.
The source report remains unchanged.

Continuation runs the three supplied-data pairs before saved and temporary child checks.
These children also receive current synthetic report data and have MCP access and automatic learning disabled.
Their host API admissions have `fixtureAdmission: true` and `coordinatorInference: false`.
The saved identity and restored experience are prepared before the resident closes and reopens.
This proves persistence of prepared state; it does not prove new natural-language identity creation or complete conversation restoration.
Current results, actual experience reads, completion, and active avatar metadata remain separate checks.
The report labels this coverage `isolated_continuation`.
Protocol `shared_method_supplied_data_v2` identifies the clarified task contract.
Earlier results retain their original source and fixture fingerprints.

Use `--host-relay` when Docker cannot reach a configured HTTP provider that the host can reach.
The container must resolve `host.docker.internal` to the host.
The temporary relay binds only to `127.0.0.1` and requires a random per-run key.
It forwards authenticated POST requests only to the configured provider path.
It preserves the provider authority and strips its private access key before forwarding.
The key remains in memory and enters the container through standard input.
The controller closes relay connections after the attempt.
HTTPS providers use the direct path.

## Interpret evidence

`realModel` and `realJev` identify actual inference.
These flags come from recorded requests, not the requested test mode.
Host-admitted continuation children use fixed execution dispatch and make no second Jev request.
An isolated continuation can therefore record `realModel: true` and `realJev: false`.
It does not verify the external owner-routing entry.
`offlineFixture: true` identifies the runner's scripted contract test.
That contract test cannot establish model quality or learning benefit.

The report separates correct answers, verification status, experience retrieval, and paired score differences.
A tie does not establish improvement.
An improvement on three synthetic cases does not establish general learning benefit.
The `generalLearningBenefit` field therefore remains `not_established`.

Run the zero-call contract checks with this command.

```sh
node --test tests/agent-live-contract.test.mjs tests/agent-live-provider-bound.test.mjs tests/agent-live-relay.test.mjs tests/agent-live-plugin-evidence.test.mjs tests/agent-live-continuation.test.mjs
```
