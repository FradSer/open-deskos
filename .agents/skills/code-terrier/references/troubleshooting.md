# Troubleshooting

- **No check run appears after several minutes** — the App may not be installed on the owner, or the trigger mode is `manual`/`on-creation` for this change. Comment `@code-terrier review` to force a review.
- **Check run `in_progress` for a long time** — the review is queued or running (large PRs take longer). Keep polling; do not assume failure.
- **Check run `failure`** — the review infrastructure failed. Report it; there is no agent-side fix.
- **Check run `neutral` with an "unavailable" description** — quota or infra skip; the bot left a comment on the PR explaining. Report it to the user.
- **A finding's line number has changed** — match by the `id` in the anchor, not the line; the finding likely moved with the code.
- **You cannot apply a `suggestion` to a cross-file finding** — cross-file findings ride in the review body, not as inline comments, and carry no suggestion block. Address them in code as a normal bug fix.

## Credentials rule

Never paste the user's GitHub App token, API keys, or secrets into prompts, source files, or committed configuration. Code Terrier only reads; it never asks you to add credentials anywhere. It posts `COMMENT` reviews only — it never `APPROVE`s, never `REQUEST_CHANGES`, never auto-merges, and never pushes or commits code itself.
