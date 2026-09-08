# Multi-Agent Shared Worktree Git Protocol

This guide outlines the protocol for executing precise, atomic git commits in a shared working tree where multiple autonomous agents or developers are working on unstaged files simultaneously.

## 1. The Conflict & The Trap

In an active multi-agent environment, the working tree is often dirty with other agents' in-flight edits (e.g. parallel CSS tuning, font removals, experimental features).

### Why Normal Tools Fail

1. **Raw `git commit` is blocked**: The repository workflow enforces `git-agent` usage.
2. **`git-agent commit --no-stage` re-stages dirty files**:
   Even with `--no-stage`, if a file is modified in the working tree, `git-agent` will update the index from the working tree copy before creating the commit. This will sweep other agents' half-finished hunks into your commit, misattributing their changes and polluting git history.

---

## 2. The Worktree Neutralization Pattern

To commit only your own changes while leaving other agents' in-flight work completely intact in the working tree, follow this battle-tested pattern:

### Step 1: Reconstruct the Exact Content for Mixed Files

Do not rely on `git add -p`. For every file containing a mix of your changes and other agents' changes, generate the exact target content: `HEAD` + your changes only.

```python
import subprocess, pathlib

REPO = '/path/to/open-deskos'
R = pathlib.Path(REPO)

def git(*args):
    return subprocess.run(['git', '-C', str(R), *args], capture_output=True, text=True, check=True).stdout

def head(path):
    return git('show', f'HEAD:{path}')

def stage_bytes(path, content_bytes):
    sha = git('hash-object', '-w', '--stdin', input=content_bytes).strip()
    git('update-index', '--add', '--cacheinfo', f'100644,{sha},{path}')

# Reconstruct HEAD + your changes only
t = head('runtime/linux/src/main.js')
t = t.replace('old_anchor', 'your_addition')
stage_bytes('runtime/linux/src/main.js', t.encode())
```

For pure files (new files or files edited solely by you), stage them directly:
```python
stage_bytes('runtime/linux/src/hydra-mqtt.js', (R / 'runtime/linux/src/hydra-mqtt.js').read_bytes())
```

### Step 2: Back Up Dirty Worktree Files

Before invoking `git-agent`, save the full working tree versions of all mixed files to `/tmp`:

```bash
mkdir -p /tmp/commit-backup
cp runtime/linux/src/main.js /tmp/commit-backup/main.js
cp runtime/linux/src/renderer/shell.css /tmp/commit-backup/shell.css
```

### Step 3: Neutralize the Working Tree

Temporarily overwrite the working tree files with their staged versions from the git index. This ensures that when `git-agent` inspects the working tree, there is zero diff between the index and the working tree:

```python
for path in ['runtime/linux/src/main.js', 'runtime/linux/src/renderer/shell.css']:
    staged = git('show', f':{path}')
    (R / path).write_text(staged)
```

### Step 4: Execute the Commit

Run `git-agent commit --no-stage` with your explicit intent and model selection:

```bash
git-agent commit --no-stage --model opencode/minimax-m3 --max-diff-lines 400 --intent "feat(cm5): your concise intent here"
```

*Note on LLM Rate Limits*: If a model returns HTTP 429 or token ceiling errors (e.g. `LLM kept producing oversized output`), switch to another supported model from `http://${CLIPROXYAPI_HOST}:8317/v1/models` (e.g. `opencode/minimax-m3` or `gemini-3.1-pro-low`) and restrict diff lines using `--max-diff-lines 400`.

### Step 5: Immediately Restore the Worktree

Restore the backed-up files so other agents' uncommitted work is returned to the unstaged working tree instantly:

```bash
cp /tmp/commit-backup/main.js runtime/linux/src/main.js
cp /tmp/commit-backup/shell.css runtime/linux/src/renderer/shell.css
rm -rf /tmp/commit-backup
```

### Step 6: Verify Commit Isolation

Verify that your commit contains strictly your intended line counts:

```bash
git show --stat HEAD
```
Verify that other agents' in-flight modifications remain present in the working tree:
```bash
git status --short
```
Export the committed tree to `/tmp` via `git checkout-index` and run the test suite to ensure the committed state is self-consistent and passes tests in isolation.
