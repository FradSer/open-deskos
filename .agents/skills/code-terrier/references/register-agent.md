# Register Code Terrier with your agent's global config

So your agent knows to use Code Terrier on every PR it touches, add usage instructions to the agent's global configuration file. Choose the file that matches your agent.

## Claude Code (`~/.claude/CLAUDE.md`)

If the file does not exist, create it. Append a section:

```markdown
## Code Terrier (PR review)

Code Terrier is a GitHub App (`code-terrier[bot]`) that reviews pull requests. When working on a PR:

1. Open the PR and poll the `Code Terrier Review` check run until it leaves `in_progress`
2. Read inline findings (anchored by `<!-- codeterrier {id,category,severity} -->`)
3. Reply `Adopted` / `Skipped` / `Escalate` on each finding's thread
4. Push fixes and re-poll until the check run is `completed` + `success` + `No issues found`

The check run is the machine-readable signal, not the review body. Trigger manually by commenting `@code-terrier review` on the PR.
```

## Codex (`~/.codex/AGENTS.md`)

Append a section:

```markdown
## Code Terrier (PR review)

Code Terrier is a GitHub App (`code-terrier[bot]`) that reviews pull requests. It posts findings as line-anchored comments on the PR and creates a non-blocking check run named `Code Terrier Review` on the head commit.

When working on a PR:
1. Open the PR and poll the `Code Terrier Review` check run until it leaves `in_progress`
2. Read inline findings — each ends with a stable anchor `<!-- codeterrier {id,category,severity} -->`
3. Reply `Adopted` (fixed) / `Skipped` (wont-fix) / `Escalate` (needs human) on each finding's thread
4. Push fixes and re-poll until the check run is `completed` + `success` + `No issues found`

The check run is the machine-readable signal, not the review body. Trigger manually with `@code-terrier review` in a PR comment. Categories: `security` / `bug` / `flag` (verification request) / `slop` (pre-existing dead code).
```

## Cursor (`~/.cursor/AGENTS.md`)

If the file does not exist, create it. Append the same content as the Codex section above.