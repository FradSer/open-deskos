# Mem0 OSS verification

Use the [Mem0 configuration procedure](CONTRACT.md#mem0-setup) to prepare the worker.
Get `longmemeval_s_cleaned.json` from the [LongMemEval dataset release](https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned).
Use approved test model endpoints.
The test uses a new local Qdrant store and removes its test state after the run.

```sh
pnpm test:memory:live --dataset=/absolute/longmemeval_s_cleaned.json --question=aae3761f
```

The test imports a legacy note.
It checks search, replacement, deletion, and restart.
It then writes one full public LongMemEval-S question bank through Mem0.
It reports the source count, extracted facts, recall time, and reference source coverage.
The test selects all original sessions for that question.
It uses the labels only after retrieval.

To test answer generation, set `ODK_HISTORY_CURL_KEY` for the approved model endpoint.
Pass `--answer-url` and `--answer-model`.
The output includes the answer, reference answer, and measured reply time.

## Benchmark basis

The earlier LongMemEval-S run tested all 500 questions with Mem0 OSS 2.2.1 and `hy4-dev`.
Mem0 scored 403 of 500. The local reader scored 268 of 500.
The Mem0 run passed 28 of 30 abstention questions.
It used a separate evaluation runner and a common evidence budget.
This result measures the benchmark configuration. It does not measure resident or device latency.

The resident integration test uses the product worker and its context formatter.
One public question tests the path from native writes through recall and answer generation.
It does not establish accuracy across all 500 questions.
