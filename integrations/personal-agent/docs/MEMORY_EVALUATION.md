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
The package suite passes 1712 tests and skips 11 tests.

## Reproduction

The commands run from `integrations/personal-agent/`.
The output paths must be new files inside a private directory.
The published corpus stays outside the checkout.

```sh
pnpm test:memory:evaluate --dataset=/private/path/longmemeval_s_cleaned.json --output=/private/path/retrieval.json
pnpm test:memory:evaluate --dataset=/private/path/longmemeval_s_cleaned.json --output=/private/path/retrieval-10.json --top-k=10
pnpm test:memory:live
pnpm test:memory:live --live --dataset=/private/path/longmemeval_oracle.json --output=/private/path/answers.json --provider=cliproxyapi --model=gpt-6.1-sol
PI_ODK_PACKAGE=/path/to/pi-packages/packages/open-deskos pnpm test
pnpm typecheck
```

The plan command makes no provider request.
The live runner limits generation to 80 requests and 1536 output tokens per request.
Each request has a 45-second timeout.
Optional `--regrade=/private/path/answers.json` reuses saved answers with at most 16 grading requests.
It records the source receipt and original generation provenance.
Optional `--lifecycle-only` tests the resident saved-note workflow with a limit of 20 requests.

## Verification and acceptance boundary

Regression coverage includes private-data isolation, lock contention, expired grants, Unicode identifiers, replacement, deletion, and retrieval after restart.
The full package suite requires the existing Pi extension checkout through `PI_ODK_PACKAGE` in an isolated worktree.
The initial run exposed an unsafe-file error-message regression, which was repaired.
Its remaining checkout-path failure passed with the explicit extension path.
The final package run passed 1711 tests, skipped 11 platform-dependent tests, and failed zero tests.
The affected memory checks passed 122 tests, skipped five platform-dependent tests, and failed zero tests.

Typecheck retains the pre-existing `src/main.mjs:249` source-admission type error.
The same error reproduces against the unchanged main checkout.
No Shell UI, deployment, activation, microphone capture, or Windows execution was tested.
The candidate remains a local, reviewed memory improvement, with the limits stated above.

## References

- [OpenAI session memory](https://developers.openai.com/cookbook/examples/agents_sdk/session_memory): context budgets and explicit retention trade-offs.
- [OpenAI memory and compaction](https://developers.openai.com/cookbook/examples/agents_sdk/building_reliable_agents_memory_compaction): separate continuation, reusable memory, and factual evidence.
- [LangMem](https://github.com/langchain-ai/langmem): memory search and lifecycle primitives; its automatic personal extraction was not adopted.
- [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf): project prose rules and terminology review.
