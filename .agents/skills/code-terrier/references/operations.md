# Code Terrier operations

Read only the section needed by the selected review flow.
External messages and global registration require explicit authorization.

## Polling the review

Code Terrier reviews on its own schedule.
The machine-readable signal is the **check run named `Code Terrier Review`** on the head commit.
It starts `in_progress` and settles on a terminal conclusion.
Check runs are non-blocking, so they never block a merge.

### Check-run lifecycle

| Status | Conclusion | Output title | Meaning |
|---|---|---|---|
| `in_progress` | — | `Analyzing your changes…` | Review in progress. Keep polling. |
| `completed` | `success` | `No issues found` | Review complete and clean. |
| `completed` | `success` | `No substantive changes` | Review complete — nothing reviewable (formatting-only diff). Treat as clean. |
| `completed` | `success` | `3 issues · 1 security, 2 bugs` | Review complete; findings exist. Read them. |
| `completed` | `neutral` | `Review unavailable - usage limit reached, see comment` | Quota exhausted; a comment explains. Report to the user. |
| `completed` | `neutral` | `Review unavailable - infra failure, see comment` | Infrastructure problem; a comment explains. Report to the user. |
| `completed` | `failure` | `Review failed to complete` | The review failed. Report the state to the user. |

#### Re-run

The check run exposes a **Re-run** button in the PR Checks tab.
Clicking it triggers a fresh review (same as `@code-terrier review`).
The webhook event `check_run.rerequested` maps to the same review-command job.

### Timing

- `in_progress` typically lasts 60–90 seconds; large PRs take longer.
- A check run that never leaves `in_progress` means the review is still queued or running. Keep polling; surface it to the user only if it is stuck for many minutes.

### The clean review body

A clean review also gets a review body of exactly:

```
**Code Terrier** reviewed the changes — no issues found. ✅
```

If you see that body, the PR is done.
If the check run and body disagree about state, trust the **check run** — it is the machine-readable signal.

### Manual trigger

`@code-terrier review` forces a review in every trigger mode (`auto`, `on-creation`, `manual`).
Use it when no check run appears, or when the change is one the install's trigger mode does not cover:

```bash
gh pr comment "$PR" --repo OWNER/REPO --body "@code-terrier review"
```

The mention must start a line and be followed by the literal word `review`.

## Reading findings

Findings are **inline review comments** from `code-terrier[bot]`, each anchored to a changed line.
Fetch them:

```bash
gh api "repos/OWNER/REPO/pulls/$PR/comments" \
  --jq '.[] | select(.user.login == "code-terrier[bot]") | {comment_id: .id, path, line, body}'
```

`comment_id` is GitHub's per-comment id and changes on every re-post.
The **stable** finding identity is the `"id"` **inside the anchor** below.

### The anchor

Every finding ends with a stable hidden anchor you can use to identify and dedupe it:

```html
<!-- codeterrier {"id":"…","category":"bug","severity":"high"} -->
```

- `id` is a stable hash of the file and title — **not the line**. A finding that moved to a different line is the *same* finding; dedupe by `id`, never by line number.
- `category` and `severity` come from the anchor, not the prose.

### Categories

- **Security** — a security hole. Treat seriously; do not apply a blind fix.
- **Bug** — a defect that breaks an existing caller, contract, or runtime path the reviewer verified in the code.
- **Flag** — a verification request, not an assertion. It names a latent contract risk; verify the premise, do not assume a defect.
- **Slop** — provably-removable pre-existing dead code (lowest priority). Dead code new in the PR is a bug, not slop.

### Suggestion blocks

A finding on a changed line may carry a one-click `suggestion` block — a ```` ```suggestion ```` code block with the replacement.
You may apply it directly to the file.

### Cross-file findings

Some findings are defects in a file the PR did not touch, activated by the changes.
These ride in the review **body** under a collapsible *Cross-file impact* section, not as inline comments, and carry **no suggestion block**.
Address them in code as a normal fix.

## Responding and the close condition

Code Terrier does **not** read chat replies and does not run a conversation.
Instead, the **next review** — triggered by the next commit — reads your disposition on each finding as bounded, untrusted context, and settles the thread.
So settle each thread explicitly with a one-word reply.

### Dispositions

For each finding you decide to address, reply to its inline thread with one word:

- **`Adopted`** — you fixed it. The finding stays resolved.
- **`Skipped`** — you deliberately chose not to fix it. It is dismissed.
- **`Escalate`** — you want a human to decide. It stays visible for the human.

```bash
## $COMMENT_ID is the id from the inline comment you are settling.
gh api "repos/OWNER/REPO/pulls/$PR/comments/$COMMENT_ID/replies" -f body="Adopted"
```

### Push and re-poll

1. Apply the fix to the changed line (or commit the `suggestion`).
2. Reply the disposition word.
3. Commit and push. A new commit starts the **next** Code Terrier review automatically (in `auto` mode).

Then repeat the poll from `references/operations.md#polling-the-review` until the head SHA carries `success` with `No issues found`.

### The close condition

**A clean review on the latest head commit.** That is the loop's end state — you do not need to wait for a human.
A clean follow-up reposts "No issues found" on the new head.
The clean review is keyed by head and run.
Use the `Code Terrier Review` conclusion as the machine-readable signal.

## Register Code Terrier with an agent

Read only when global registration is explicitly requested.
Editing project skill docs does not authorize global configuration changes.

Choose the requested destination: Claude Code `~/.claude/CLAUDE.md`, Codex `~/.codex/AGENTS.md`, or Cursor `~/.cursor/AGENTS.md`.
Preserve existing content and add one section:

```markdown
### Code Terrier (PR review)

On an authorized PR review, poll the latest head's `Code Terrier Review` check. Read inline `code-terrier[bot]` findings and cross-file impact in the review body. Dedupe by the stable `codeterrier` anchor ID. Verify each finding; reply `Adopted`, `Skipped` or `Escalate` when messaging is authorized. Push authorized fixes through the project commit workflow and recheck the new head until the completed success check reports no issues.

The check is authoritative. A success conclusion may still contain findings. Manual trigger is `@code-terrier review`, only when a PR comment is authorized. Security/bug findings need verification; flag is a verification request, slop is pre-existing dead code.
```

## Troubleshooting

- **No check run appears:** check App installation and `manual`/`on-creation` trigger settings. An authorized `@code-terrier review` comment requests a review.
- **Check run `in_progress` for a long time** — the review is queued or running (large PRs take longer). Keep polling; do not assume failure.
- **Check run `failure`** — the review infrastructure failed. Report it; there is no agent-side fix.
- **Check run `neutral` with an "unavailable" description** — quota or infra skip; the bot left a comment on the PR explaining. Report it to the user.
- **A finding's line number has changed** — match by the `id` in the anchor, not the line; the finding likely moved with the code.
- **Cross-file findings:** read the review body. They have no inline suggestion block; apply a verified correction as a normal bug fix.

### Credentials rule

Never paste the user's GitHub App token, API keys, or secrets into prompts, source files, or committed configuration.
Code Terrier only reads; it never asks you to add credentials anywhere.
It posts `COMMENT` reviews only — it never `APPROVE`s, never `REQUEST_CHANGES`, never auto-merges, and never pushes or commits code itself.
