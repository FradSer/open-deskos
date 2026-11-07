# Personal Agent memory evaluation

Date: 2026-11-07.
The [contract](CONTRACT.md#profiles-and-memory) owns behavior and storage limits.
This report owns the comparison, evidence, and remaining verification boundaries.

## Design selection

| Candidate | Benefit | Cost or limitation | Decision |
| --- | --- | --- | --- |
| Complete injection | Complete small-store context; references work across languages | Context grows with stored content | Use for the saved-note workflow when the framed map fits 4096 bytes |
| Local ranked retrieval | No external index; exact source text; bounded context | Lexical search needs shared terms | Select for larger notes and procedural experience |
| External vector service | Semantic matching can find more paraphrases | New credential, privacy, latency, and lifecycle dependencies | Defer until a controlled comparison demonstrates added value |

The initial implementation preserves existing note, experience, and feedback storage formats.
It adds no dependency or automatic conversation extraction.
It uses the existing filesystem lock dependency for note mutations.

| Memory surface | Result |
| --- | --- |
| Durable conversation | Existing Pi history and compaction remain the session mechanism |
| Explicit notes | Exact current-turn grants, serialized writes, revisioned retrieval, and bounded context |
| Procedural experience | Ranked title/body search, relevant prompt index, and complete reads with evidence sources |
| Recommendation feedback | Existing topic/version scope, bounded signals, private projections, and retry gates remain separate |

The follow-up keeps automatic note and experience context outside conversation storage.
The saved-note workflow uses the current note store.
Other workflows use matching notes and optional pinned notes.
Learning uses a projection of verified host checks.
The [memory contract](CONTRACT.md#profiles-and-memory) defines these boundaries.

## Published retrieval benchmark

Source: [LongMemEval](https://github.com/xiaowu0162/LongMemEval) and its [cleaned dataset](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned).
The release contains constructed, timestamped conversation histories, rather than a natural production conversation sample.
The test uses all 500 records in `longmemeval_s_cleaned.json`.
Retrieval metrics cover 470 records with evidence locations.
The remaining 30 abstention records require answer evaluation.

The index receives only session dates, roles, and text.
It receives no question answers, evidence labels, or `has_answer` fields.
Twelve evaluated records contain repeated source identities.
The scorer counts each retrieved evidence identity once.
No model inference, private note import, or production write occurs in this benchmark.

Recall is the mean fraction of required evidence sessions retrieved per question.
Complete evidence is the fraction of questions with every required session retrieved.
First and recent baselines select sessions in dataset order.
Substring reproduces the previous tool search predicate.
These baselines measure retrieval; they do not reproduce a model's complete tool strategy.

| Arm | Recall at 5 | Complete evidence at 5 | Recall at 10 | Complete evidence at 10 |
| --- | ---: | ---: | ---: | ---: |
| Previous substring search | 0.11% | 0.00% | 0.11% | 0.00% |
| First sessions | 8.45% | 1.91% | 19.46% | 7.02% |
| Recent sessions | 13.74% | 5.74% | 26.32% | 12.98% |
| Local ranked retrieval | 91.69% | 83.40% | 94.87% | 90.43% |

| Question type | Cases | Recall at 5 | Complete evidence at 5 |
| --- | ---: | ---: | ---: |
| Knowledge update | 72 | 98.61% | 97.22% |
| Multiple sessions | 121 | 84.09% | 66.12% |
| Assistant information | 56 | 100.00% | 100.00% |
| Preference | 30 | 86.67% | 86.67% |
| User information | 64 | 100.00% | 100.00% |
| Temporal reasoning | 127 | 88.35% | 75.59% |

The local macOS run used Node v26.13.0.
Index construction had a 13.96 ms p95 across the 470 collections.
Indexed search had a 0.073 ms p95.
These host measurements are observational, without controlled load or device latency claims.

The adapter indexes complete benchmark sessions, which can exceed production note and experience quotas.
It validates the shared retrieval kernel, rather than complete transcript ingestion or answer quality.
At ten results, multiple-session questions still lack complete evidence in 18.18% of cases.

## Actual CM5 saved data

A read-only snapshot contained five saved notes and seven procedural entries.
The replay used private local copies and made zero external model calls.
Seven manually authored, reordered queries each retrieved their intended procedural entry first.
The previous substring search matched none of these seven queries.
These queries were authored from the snapshot, rather than held out before development.

Five Chinese owner questions retained all existing notes in the small-store context.
Each framed context used 1112 UTF-8 bytes.
Local copies retained identical hashes after replay.
The two production source files also retained their original hashes after the read-only checks.
The snapshot and its contents stay outside Git and external provider requests.
This evidence proves saved-data compatibility and the sampled retrieval behavior.
It does not prove installed candidate behavior or broad personal conversation quality.

## Initial real model comparison

Model: `cliproxyapi/gpt-6.1-sol`.
Both arms use isolated Pi Durable sessions and the actual private memory store and read tool.
All provider inputs contain public benchmark data or explicitly synthetic lifecycle notes.
The full arm provides the complete note map.
The bounded arm uses bounded note selection and the same complete-read fallback.
Arm execution order alternates across questions.

Eligibility uses the actual explicit-note storage gate before inference.
Of 500 oracle records, 376 exceed the evaluation's 15700-byte allowance.
The existing sensitive-content gate rejects another 15 records.
Selection takes two records per eligible type, ordered by the SHA-256 of the question identity.
The twelve selected records include two abstention questions.
No knowledge-update record fits this eligibility filter.
The separate lifecycle scenario tests correction and deletion.

The grader follows the [official task rules](https://github.com/xiaowu0162/LongMemEval/blob/main/src/evaluation/evaluate_qa.py).
Its separate request hides arm names and alternates answer order.
It uses the same model family, without independent human or external-model grading.
The initial strict grader incorrectly rejected extra details absent from short reference answers.
Its source receipt and answers were retained before task-specific regrading.
The final run uses the corrected grader from its start.
Raw receipts record actual results, model identity, source hashes, usage, and request counts.

| Final measurement | Complete map | Bounded context |
| --- | ---: | ---: |
| Correct answers | 12/12 | 12/12 |
| Total input tokens, including cache reads and writes | 105070 | 50368 |
| Output tokens | 747 | 759 |
| Initial memory context, UTF-8 bytes | 143714 | 7023 |

The paired run used 63 provider requests, including grading and lifecycle checks.
Total reported input tokens decreased by 52.06%, including complete-read fallback calls.
Initial memory context decreased by 95.11%.
These measurements establish input reduction for this sample, rather than billed savings.
All three same-session lifecycle answers matched the current saved state.
The receipt contains hashes of the runner and kernel used for that run.
The small sample can show regressions and input costs, but cannot establish general model superiority.
The oracle corpus supplies relevant sessions, so this test cannot establish end-to-end retrieval over complete histories.

## Resident workflow follow-up

The same configured model passed nine checks in 16 requests through the resident Durable workflow.
The test uses an isolated store, synthetic notes, and fixed workflow selection.
It checks save, read, correction, deletion, and read after restart.
It also checks irrelevant requests with and without a pinned note.
The current-note requests after deletion contain neither the original nor the corrected value.
None of the eight inspected Durable files contains the automatic note snapshot.
The test does not delete original conversation messages.

A fresh run on the public corpus confirms 94.87% mean recall at 10 on 470 questions with evidence.
The ranked arm returns all evidence for 90.43% of those questions.
These results measure retrieval, not answer accuracy or real conversation retention.

The Hosted integration executes a real scratch check through the SDK and task transport.
Scripted model responses check the projected learning input and the exact saved receipt locator.
The integration also checks cancellation and rejection of a citation to raw check output.
An isolated probe also uses the real model for the learning step.
One request produces one valid entry with the exact source locator.
The resident response and original task verification remain scripted in this probe.

## Initial retained conversation comparison

The resident keeps the original conversation as the source for history lookup.
The comparison tests a fixed ranked context and a preview with readback.
The fixed arm sends exact passages from up to ten ranked sessions in one model request.
The readback arm starts with up to five excerpts.
It permits two additional model requests for tool results and the final answer.
It uses the same ranking and tools as the resident.
The benchmark calls the tools directly with full benchmark sessions as sources.
The resident regression separately checks Durable retention, intent dispatch, and Code Mode.

Both arms have a 32 KiB evidence budget and use the same answer model.
The benchmark replaces dataset session IDs with sequential labels before retrieval.
Only the judge receives the reference answer.
The runner uses the [upstream prompts](https://github.com/xiaowu0162/LongMemEval/blob/main/src/evaluation/evaluate_qa.py) and records the configured judge model.
The run completed all 500 paired questions, including 30 abstention cases.
Both arms used `cliproxyapi/gpt-6.1-sol` to answer and grade.
The accuracy comparison applies to this model and judge configuration.

| Question type | Questions | Fixed context correct | Readback correct |
| --- | ---: | ---: | ---: |
| Multiple sessions | 121 | 37 | 77 |
| Temporal reasoning | 127 | 62 | 102 |
| Knowledge update | 72 | 59 | 61 |
| Assistant information | 56 | 51 | 53 |
| User information | 64 | 54 | 60 |
| Preference | 30 | 19 | 24 |
| Abstention | 30 | 28 | 27 |
| **All questions** | **500** | **310 (62.0%)** | **404 (80.8%)** |

Readback alone answered 107 questions correctly, and fixed context alone answered 13 correctly.
The paired gain was 18.8 percentage points, with a 95% paired bootstrap interval from 14.8 to 22.8 points.
One abstention error connected a conference poster to a different research event.

| Answer generation metric | Fixed context | Readback |
| --- | ---: | ---: |
| Model requests | 501 | 994 |
| Input tokens, including reported cache use | 2,889,944 | 2,239,642 |
| Output tokens | 24,200 | 51,074 |
| Median elapsed time | 4.09 s | 8.27 s |
| 95th-percentile elapsed time | 8.92 s | 17.96 s |

These costs cover answer stages with valid results.
The provider returned rate limits and HTTP 500 errors during the run.
Resumption kept each successful receipt and retried missing or failed stages with the same protocol.
Concurrency changed during recovery, so the elapsed times describe this run.
The final journal has one answer and one judgment per arm for each dataset question.
Its SHA-256 is `8ef874ad32a1ad4057be6947af96f37c239fd12902afa855bec88bca39d5545e`.

The local resident probe uses the configured ordinary intent model and synthetic Chinese owner input.
The model found the original answer after restart and read the separate current note.
It reported insufficient evidence for an unknown past fact.
The model reported a Code Mode error in the first probe and identified the preview as its source.
Two traced probes then returned the exact original text through `history_read` in Code Mode.
The inspected Durable files had no automatic preview.

## Expanded history preview comparison

The previous readback design often needed another model request to recover text near a match.
The expanded preview includes nearby original text in each of up to six excerpts.
The model can answer from the preview or get the missing evidence through the existing tools.
The prompt requires evidence for the requested event before it accepts a detail from a related exchange.

An offline comparison uses the marked answer messages of the 470 questions with evidence.
The previous preview contained every marked message in 89 questions.
The expanded preview contained every marked message in 183 questions.
The mean preview size increased from 3623 to 11588 bytes.
The markings are used only to score the previews after retrieval.

The live protocol pairs the readback code from `7e97830a` with the expanded preview.
Both arms use the same model through the same Chat Completions URL.
Both arms use the same corpus, date fields, evidence limit, and upstream judging prompts.
The runner assigns arm order from a hash of the question ID.
Elapsed time includes local evidence preparation, model requests, and tool handling for each answer.

The first expanded variant also used longer excerpts in later search results.
Its model was `auto/gpt-6-luna`.
Its live comparison saved 164 paired answers and judgments before the endpoint returned HTTP 404 for the model.
Both arms used a concurrency of eight for the saved pairs.
The initial curl adapter omitted the assistant role in tool continuations.

| First variant, partial run | Previous readback | Expanded preview and search |
| --- | ---: | ---: |
| Correct answers | 110/164 | 107/164 |
| Correct abstentions | 23/23 | 21/23 |
| Answer requests | 409 | 298 |
| Median answer time | 9.98 s | 7.19 s |
| 95th-percentile answer time | 17.10 s | 19.15 s |

One expanded answer assigned a duration to a master's degree without evidence for that stage.
Both arms gave similar fare estimates in another abstention case and received different judgments.
The revised candidate uses compact follow-up searches and binds each source reference to its original offset.
Its prompt requires support for every value before a total.
The partial result applies to the first variant.

The next comparison used `hunyuan-eval/hy4-dev` for both answers and judgments.
The corrected curl adapter preserves the assistant role in tool continuations.
The final request contains the exact evidence from the preview and successful lookups.
This format removes tool call markup from the answer stage.
The run reused 425 pairs that did not use the changed request.
It ran both arms again for the other 75 questions.

The six-excerpt expanded preview gave 263 correct answers against 276 for the previous readback.
Both arms passed all 30 abstention cases.
The 95th-percentile answer time decreased from 4.74 to 3.11 seconds.
The expanded preview lost correct answers on multiple sessions and temporal reasoning.

The selective candidate expands the first three excerpts and adds up to five compact excerpts.
Its offline replay contained every marked message in 185 of 470 questions.
It included all required evidence sessions in 416 questions, compared with 404 for the six-excerpt preview.
The mean preview size decreased from 11588 to 9406 bytes.
The prompt asks for a targeted search when the preview lacks a required part.

The three-excerpt variant gave 308 correct answers against 295 for the previous readback.
Its median answer time increased from 1.53 to 1.63 seconds.
Its 95th-percentile answer time decreased from 5.51 to 5.12 seconds.
It gave 29 correct abstentions against 30 for the previous readback.
One answer gave the frequency of a different activity before it explained the evidence gap.

The compact variant expands the first two excerpts and adds up to six compact excerpts.
The prompt requires an explicit statement of any missing fact before related context.
It uses a targeted lookup for missing named items and other gaps with a distinctive search term.
The mean preview size was 8201 bytes.
It kept all required evidence sessions in 416 of 470 questions.

### Compact preview results

The final run compares `7e97830a` and the compact variant on all 500 LongMemEval-S questions.
Both arms used `hunyuan-eval/hy4-dev` for answers and grading, with eight concurrent question workers.
The journal has 1000 answers and 1000 judgments, with no failed stages.

| Metric | Previous readback | Compact preview |
| --- | ---: | ---: |
| Correct answers | 284/500 (56.8%) | 285/500 (57.0%) |
| Correct abstentions | 29/30 | 29/30 |
| Model requests for answers | 682 | 553 |
| Answers from one model request | 398 | 468 |
| Answer input tokens, including reported cache use | 1,396,940 | 1,606,040 |
| Mean answer time | 2.22 s | 1.63 s |
| Median answer time | 1.54 s | 1.36 s |
| 95th-percentile answer time | 5.24 s | 3.14 s |

The compact variant was faster on 357 of the 500 paired questions.
The mean time decreased by 26.6%, and the 95th percentile decreased by 40.1%.
The paired accuracy difference was 0.2 percentage points.
The 95% paired bootstrap interval was from -3.2 to 3.8 points.

For an airport trip, the previous reader calculated savings from fare estimates in different contexts.
The compact reader said it lacked both prices for the same trip.
Both readers explicitly reported missing evidence for the iPad price in a different abstention case.
The judge marked only the previous answer correct in that case.
The compact reader still gave the tennis frequency before it stated that the table tennis frequency was unknown.

A separate model probe used four synthetic evidence gaps and two supported controls.
The compact reader kept the events separate and answered all six cases as expected.
This probe supplied the same exact excerpts to both arms.

The final journal SHA-256 is `184eadb48add386683f5a4a9da314186925da3ee36129cde5400c4efec086b07`.

## Reproduction

The commands run from `integrations/personal-agent/`.
The output paths must be new files inside a private directory.
The published corpus stays outside the checkout.

```sh
pnpm test:memory:evaluate --dataset=/private/path/longmemeval_s_cleaned.json --output=/private/path/retrieval.json
pnpm test:memory:evaluate --dataset=/private/path/longmemeval_s_cleaned.json --output=/private/path/retrieval-10.json --top-k=10
pnpm test:memory:live
pnpm test:memory:live --live --dataset=/private/path/longmemeval_oracle.json --output=/private/path/answers.json --provider=cliproxyapi --model=gpt-6.1-sol
pnpm test:memory:history --live --dataset=/private/path/longmemeval_s_cleaned.json --judge-source=/private/path/evaluate_qa.py --output=/private/path/history.jsonl --provider=cliproxyapi --model=gpt-6.1-sol --concurrency=4
PI_ODK_PACKAGE=/path/to/pi-packages/packages/open-deskos pnpm test
pnpm typecheck
```

The plan command makes no provider request.
The live runner limits generation to 80 requests and 1536 output tokens per request.
Each request has a 45-second timeout.
Optional `--regrade=/private/path/answers.json` reuses saved answers with at most 16 grading requests.
It records the source receipt and original generation provenance.
Optional `--lifecycle-only` tests the resident saved-note workflow with a limit of 20 requests.
For the retained conversation runner, add `--resume` to continue missing or failed stages in an existing journal.
The manifest must match the dataset, judge prompts, models, and source files.
The runner keeps earlier errors and successful stage receipts in the journal.

For the expanded preview comparison, use `curl` 8.3 or later.
Set `ODK_HISTORY_CURL_KEY` from the approved credential source.
Set `ODK_HISTORY_CURL_URL` to the Chat Completions URL.
Set `ODK_HISTORY_EVAL_MODEL` to the model identifier.
Use one worker process per output journal.

The curl runner sends `reasoning_effort` as `none` for both answer generation and grading.

```sh
reference=$(mktemp -d)
git -C ../.. archive 7e97830a integrations/personal-agent/src | tar -x -C "$reference"
ln -s "$PWD/node_modules" "$reference/integrations/personal-agent/node_modules"
pnpm test:memory:history --live \
  --dataset=/private/path/longmemeval_s_cleaned.json \
  --judge-source=/private/path/evaluate_qa.py \
  --output=/private/path/expanded-history.jsonl \
  --curl-url="$ODK_HISTORY_CURL_URL" --model="$ODK_HISTORY_EVAL_MODEL" \
  --reference-history="$reference/integrations/personal-agent/src/history-evidence.mjs" \
  --concurrency=8
```

## Verification and acceptance boundary

Regression coverage includes private-data isolation, lock contention, expired grants, Unicode identifiers, replacement, deletion, and retrieval after restart.
The full package suite requires the existing Pi extension checkout through `PI_ODK_PACKAGE` in an isolated worktree.
The initial run exposed an unsafe-file error-message regression, which was repaired.
Its remaining checkout-path failure passed with the explicit extension path.
The latest package run passed 1715 tests, skipped 11 platform-dependent tests, and failed zero tests.
The history regressions also check source expiration, compaction, and reset.

Typecheck retains the pre-existing `src/main.mjs:249` source-admission type error.
The same error reproduces against the unchanged main checkout.
No Shell UI, deployment, activation, microphone capture, or Windows execution was tested.
The candidate remains a local, reviewed memory improvement, with the limits stated above.

## References

- [OpenAI session memory](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory): context budgets and explicit retention trade-offs.
- [OpenAI memory and compaction](https://developers.openai.com/cookbook/examples/agents_sdk/building_reliable_agents_memory_compaction): separate continuation, reusable memory, and factual evidence.
- [LangMem](https://github.com/langchain-ai/langmem): memory search and lifecycle primitives; its automatic personal extraction was not adopted.
- [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf): project prose rules and terminology review.
