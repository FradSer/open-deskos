# Responding and the close condition

Code Terrier does **not** read chat replies and does not run a conversation. Instead, the **next review** — triggered by the next commit — reads your disposition on each finding as bounded, untrusted context, and settles the thread. So settle each thread explicitly with a one-word reply.

## Dispositions

For each finding you decide to address, reply to its inline thread with one word:

- **`Adopted`** — you fixed it. The finding stays resolved.
- **`Skipped`** — you deliberately chose not to fix it. It is dismissed.
- **`Escalate`** — you want a human to decide. It stays visible for the human.

```bash
# $COMMENT_ID is the id from the inline comment you are settling.
gh api "repos/OWNER/REPO/pulls/$PR/comments/$COMMENT_ID/replies" -f body="Adopted"
```

## Push and re-poll

1. Apply the fix to the changed line (or commit the `suggestion`).
2. Reply the disposition word.
3. Commit and push. A new commit starts the **next** Code Terrier review automatically (in `auto` mode).

Then repeat the poll from `references/poll.md` until the head SHA carries `success` with `No issues found`.

## The close condition

**A clean review on the latest head commit.** That is the loop's end state — you do not need to wait for a human. A clean follow-up **re-posts** the "No issues found" review body on the new head (the clean review is keyed per head + run), so expect that body — treat the `Code Terrier Review` check run conclusion as the machine-readable signal either way.
