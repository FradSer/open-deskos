# Polling the review

Code Terrier reviews on its own schedule. The machine-readable signal is the **check run named `Code Terrier Review`** on the head commit — one in-place check that starts `in_progress` (animated spinner in the PR Checks tab) and settles on a terminal conclusion. Check runs are non-blocking, so they never block a merge.

## Check-run lifecycle

| Status | Conclusion | Output title | Meaning |
|---|---|---|---|
| `in_progress` | — | `Analyzing your changes…` | Review in progress. Keep polling. |
| `completed` | `success` | `No issues found` | Review complete and clean. |
| `completed` | `success` | `No substantive changes` | Review complete — nothing reviewable (formatting-only diff). Treat as clean. |
| `completed` | `success` | `3 issues · 1 security, 2 bugs` | Review complete; findings exist. Read them. |
| `completed` | `neutral` | `Review unavailable - usage limit reached, see comment` | Quota exhausted; a comment explains. Report to the user. |
| `completed` | `neutral` | `Review unavailable - infra failure, see comment` | Infrastructure problem; a comment explains. Report to the user. |
| `completed` | `failure` | `Review failed to complete` | The review failed. Report the state to the user. |

### Re-run

The check run exposes a **Re-run** button in the PR Checks tab. Clicking it triggers a fresh review (same as `@code-terrier review`). The webhook event `check_run.rerequested` maps to the same review-command job.

## Timing

- `in_progress` typically lasts 60–90 seconds; large PRs take longer.
- A check run that never leaves `in_progress` means the review is still queued or running. Keep polling; surface it to the user only if it is stuck for many minutes.

## The clean review body

A clean review also gets a review body of exactly:

```
**Code Terrier** reviewed the changes — no issues found. ✅
```

If you see that body, the PR is done. If the check run and body disagree about state, trust the **check run** — it is the machine-readable signal.

## Manual trigger

`@code-terrier review` forces a review in every trigger mode (`auto`, `on-creation`, `manual`). Use it when no check run appears, or when the change is one the install's trigger mode does not cover:

```bash
gh pr comment "$PR" --repo OWNER/REPO --body "@code-terrier review"
```

The mention must start a line and be followed by the literal word `review`.
