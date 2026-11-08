# Personal Agent plugins

The resident Personal Agent can select fixed Open DeskOS plugins for packages, task experience, and completion checks.
Pi Durable 1.2 owns execution and conversation state.
The selection cannot import package names, JavaScript paths, or arbitrary Pi extensions.

## Configuration

The `agentPlugins` field belongs to the existing `ODK_PERSONAL_AGENT_CONFIG` file.
An absent field preserves the existing resident behavior.

```json
{
  "profile": "personal",
  "skillPaths": [],
  "agentPlugins": {
    "enabled": ["experience", "completion", "learning", "catalog", "mcp", "subagents"],
    "autoLearn": true
  }
}
```

The `learning` plugin requires the `completion` plugin.
The `mcp` plugin requires the `catalog` plugin.
The `autoLearn: false` setting stops new lessons without removing experience retrieval.
Configuration changes require a new resident instance.
The [package catalog contract](AGENT_CATALOG.md) owns Skill installation, installed resource reads, and MCP execution.
The [child task contract](AGENT_TASKS.md) owns temporary tasks, saved identities, lifecycle, and conversation avatars.

## Intent wishes

Add the fixed `intent` identity to `agentPlugins.enabled` to enable conversational Intent wishes.
It does not require a Pi extension, an arbitrary package, or a separate profile field.
The plugin requires the personal profile.
Children cannot inherit this plugin.
The [Intent contract](INTENTS.md) owns natural-language editing, condition judgment, occurrence history, and ride preview limits.

## Experience

Mem0 stores experience in a separate scope from explicit notes.
The `experience` plugin adds a bounded list of matching titles to the model request.
The `experience_list` tool searches with Mem0 or lists a page.
The `experience_read` tool returns a complete entry by ID.
Both tools give reference data to Durable Code Mode.

## Completion checks

The `completion` plugin receives the current request, answer, and bounded host-observed tool receipts.
The host distinguishes conversation, source queries, admission, and direct execution.
Ordinary conversation without receipts skips execution verification and automatic learning.
Actual conversation computations still require derivation evidence.
Direct coding-profile work retains execution checks.
A separate temporary model conversation checks the requested outcomes.
That conversation has no tools, Skills, project context, execution environment, or owner conversation history.
It uses the configured resident model.

A passed check cites exact successful receipt text.
Receipts retain literal output text and separate structured JSON to support exact citations.
Section labels aid reading; they do not define authority or authenticated parsing boundaries.
Missing, failed, invalid, or truncated evidence requires review.
A requested execution task without tool receipts also requires review.
This includes content-only tasks until separate content checks exist.

Admission checks cover explicitly requested task launches or prompt delivery.
An admission receipt cannot prove downstream completion.
The final answer identifies admission checks and states that downstream results remain unverified.
The plugin never repeats a tool call or mutation.

Model checks do not replace independent tests or physical device acceptance.
The observer covers resident custom capabilities and coding-profile `read`, `grep`, `find`, and `ls` tools.
It also observes actual Durable Code Mode execution through the SDK task lifecycle.
Each computation receipt retains bounded executed source, output, status, and diagnostics.
The host binds that receipt to one owner request and rejects cancelled or recovered work without current authority.
Repeated callbacks cannot replace accepted evidence.

The `derivation` scope checks calculations or transformations of supplied data.
It requires successful, complete computation evidence and compares the requested inputs, applicable method, executed source, and result.
Executed source and printed output remain untrusted data.
They cannot establish external facts, admission, or effects.
Printing an email, order, deployment, or child-completion claim cannot satisfy an external completion check.
Computation receipts cannot provide independent learning sources.
Missing output, binary output, search limits, and truncated lines require review.
Each DeskOS child runs its own enabled completion and learning plugins.

## Hosted Pi results

The completion plugin adds the read-only `coding_task_verify` tool.
A later result query uses the exact configured target, project, and task ID.
The tool reads status and complete bounded history.
It compares task records before collection, before inference, and after inference.
It never runs a command, prompts the worker, or repeats a mutation.

The isolated verifier receives the original request, later user instructions, final answer, and host check records.
The host validates check identities, command digests, project paths, process outcomes, and matching source samples.
Checks must follow the latest user instruction.
Later mutations invalidate earlier checks.
Missing tool results and incomplete nested calls require review.
Older histories without the required metadata also require review.
Native session endpoints without history support cannot pass this check.

Collection permits 32 pages, 256 KiB of event data, and 30 seconds.
At most 16 final checks can enter the verifier.
Each check permits 32 KiB of evidence.
The host records at most 8 KiB of nested check output.
Truncated evidence cannot establish completion.

These checks describe historical task evidence.
They do not establish the current checkout, immutable source, test adequacy, deployed behavior, or physical acceptance.
The Hosted Pi execution receipt retains its separate `verification: not_run` field.

## Automatic lessons

The `learning` plugin sends verified host check facts to Mem0.
The host check supplies the source locator for the extracted method.
Admission receipts and ordinary tool results cannot supply learning facts.
The host keeps the original check limits with its evidence.
A cancellation prevents a queued Mem0 write.
A failed extraction preserves existing experience and reports that learning is incomplete.

Each model stage has a 90-second default deadline and permits one format correction.
Correction feedback uses fixed host validation categories without provider errors or private receipt content.
The correction shares the original deadline and cannot execute tools.
The `ODK_AGENT_PLUGIN_TIMEOUT_MS` variable accepts 1000 through 180000 milliseconds.
These stages can add model calls and response time.

## Verification

Run these commands from `integrations/personal-agent`.

```sh
node --test tests/agent-plugin-runtime.test.mjs tests/agent-plugin-integration.test.mjs
node --test tests/agent-inspection-completion.test.mjs tests/hosted-completion*.test.mjs tests/check-history.test.mjs
pnpm typecheck
pnpm test
pnpm test:proactive:evaluate
```

The [feature scenarios](../features/agent-plugins.feature) retain the full requested capability scope.
The [implementation status](PERSONAL_AGENT_IMPLEMENTATION.md) identifies unfinished requirements.
