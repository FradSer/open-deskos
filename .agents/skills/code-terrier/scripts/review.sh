#!/usr/bin/env bash
# codeterrier-review: submit a direct review (no PR) and poll for findings.
#
# Local mode (default): compute the git diff (uncommitted + staged) and upload it.
#   bash review.sh --local [--base <ref>] [--range <base>...<head>]
# Remote mode: submit owner/repo + head ref (Worker diffs server-side).
#   bash review.sh --remote <owner/repo> --head <ref> [--base <ref>]
#
# Model selection (optional):
#   bash review.sh --list-models        # print the shared models your account may use
#   bash review.sh --model <model> ...  # review with one named model (no fan-out)
#
# Prints findings as tagged lines; exits 0 on success (even with findings), 1 on
# an errored review. Auth: CODETERRIER_TOKEN env or ~/.codeterrier/token.
#
# Env:
#   CODETERRIER_BASE_URL  API base (default https://codeterrier.com)
#   CODETERRIER_TOKEN     API token (preferred over the token file)

set -u

BASE_URL="${CODETERRIER_BASE_URL:-https://codeterrier.com}"
TOKEN_FILE="${CODETERRIER_TOKEN_FILE:-$HOME/.codeterrier/token}"
POLL_INTERVAL=10
MAX_POLLS=360 # up to 60 min for a deep review

MODE=""
REPO=""
HEAD=""
LOCAL_RANGE=""
LOCAL_BASE=""
MODEL=""
LIST_MODELS=""

while [ $# -gt 0 ]; do
  case "$1" in
    --local) MODE="local"; shift ;;
    --remote) MODE="remote"; shift; [ $# -ge 1 ] && REPO="$1" && shift ;;
    --head) [ $# -ge 2 ] && HEAD="$2" && shift 2 ;;
    --base) [ $# -ge 2 ] && LOCAL_BASE="$2" && shift 2 ;;
    --range) [ $# -ge 2 ] && LOCAL_RANGE="$2" && shift 2 ;;
    --model) [ $# -ge 2 ] && MODEL="$2" && shift 2 ;;
    --list-models) LIST_MODELS=1; shift ;;
    --base-url) [ $# -ge 2 ] && BASE_URL="$2" && shift 2 ;;
    -h|--help)
      sed -n '1,20p' "$0" | sed 's/^#//'
      exit 0
      ;;
    *) shift ;;
  esac
done

# --- auth ---
if [ -n "${CODETERRIER_TOKEN:-}" ]; then
  TOKEN="$CODETERRIER_TOKEN"
elif [ -f "$TOKEN_FILE" ] && [ -s "$TOKEN_FILE" ]; then
  TOKEN=$(cat "$TOKEN_FILE")
else
  echo "review: authorization required — run the login command first:" >&2
  echo "  bash scripts/login.sh" >&2
  echo "review: login.sh prints a one-click authorization URL, waits for GitHub authorization, saves the token, and then this command can be rerun." >&2
  exit 1
fi

auth_header="authorization: Bearer $TOKEN"

# --- list models (no review submitted) ---
if [ -n "$LIST_MODELS" ]; then
  list_res=$(curl -sS "$BASE_URL/api/models" -H "$auth_header") || {
    echo "review: could not reach $BASE_URL/api/models" >&2
    exit 1
  }
  plan=$(printf '%s' "$list_res" | jq -r '.plan // "unknown"' 2>/dev/null)
  err=$(printf '%s' "$list_res" | jq -r '.error // empty' 2>/dev/null)
  if [ -n "$err" ]; then
    echo "review: $err" >&2
    exit 1
  fi
  echo "plan: $plan"
  printf '%s' "$list_res" | jq -r '.models[]? // empty' 2>/dev/null
  exit 0
fi

# --- resolve the review target ---
if [ -z "$MODE" ]; then
  MODE="local"
fi

PAYLOAD=""
if [ "$MODE" = "local" ]; then
  # Local mode: compute the diff. Default = uncommitted (unstaged + staged).
  # --range <base>...<head> overrides; --base <ref> diffs against that base.
  if [ -n "$LOCAL_RANGE" ]; then
    diff_text=$(git diff "$LOCAL_RANGE" 2>/dev/null) || {
      echo "review: git diff $LOCAL_RANGE failed" >&2
      exit 1
    }
    head_sha=$(git rev-parse HEAD 2>/dev/null || echo "")
  elif [ -n "$LOCAL_BASE" ]; then
    diff_text=$(git diff "$LOCAL_BASE" 2>/dev/null) || {
      echo "review: git diff $LOCAL_BASE failed" >&2
      exit 1
    }
    head_sha=$(git rev-parse HEAD 2>/dev/null || echo "")
  else
    # Uncommitted: git diff HEAD covers staged + unstaged together. NEVER pipe a
    # unified diff through a line-dedup (awk '!seen[$0]++'): identical added
    # lines across files and repeated --- /@@ headers are legitimate, and a
    # dropped @@ header makes the server's parseUnifiedDiff silently lose that
    # file's hunks (Code Terrier 9biwu3).
    #
    # git diff HEAD excludes UNTRACKED (new, not-yet-added) files, so review
    # them too: for each untracked file, emit its standard unified diff via
    # git diff --no-index /dev/null (pi review #4). The server parses new-file
    # diffs correctly (--- /dev/null + +++ b/path).
    diff_text=$(git diff HEAD 2>/dev/null)
    # git diff --no-index emits a `diff --git a/<f> b/<f>` header first. KEEP it:
    # stripping it (tail -n +2) makes the untracked fragment merge into the last
    # tracked file's parsed block (parseUnifiedDiff needs the `diff --git` line
    # as the file separator) — Code Terrier 3741536966 / pi review.
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      untracked_diff=$(git diff --no-index /dev/null "$f" 2>/dev/null) || true
      [ -n "$untracked_diff" ] && diff_text="$diff_text
$untracked_diff"
    done < <(git ls-files --others --exclude-standard 2>/dev/null)
    head_sha=$(git rev-parse HEAD 2>/dev/null || echo "")
  fi
  if [ -z "$head_sha" ]; then
    echo "review: repository has no commits yet — make an initial commit first, then re-run." >&2
    exit 1
  fi
  if [ -z "$diff_text" ]; then
    echo "review: nothing to review — no uncommitted changes (and no --range/--base given)." >&2
    exit 1
  fi
  # Resolve the repo from the git remote. Without an origin (a local repo), use
  # a synthetic owner/name so the API's repoFrom() (which requires a slash) does
  # not reject the submission with 400 (pi review #5).
  remote_url=$(git remote get-url origin 2>/dev/null || echo "")
  if [[ "$remote_url" =~ github\.com[:/]([^/]+)/([^/]+)(\.git)?$ ]]; then
    REPO="${BASH_REMATCH[1]}/${BASH_REMATCH[2]%.git}"
  else
    REPO="local/$(basename "$(pwd)")"
  fi
  PAYLOAD=$(jq -n \
    --arg repo "$REPO" \
    --arg headSha "$head_sha" \
    --arg diff "$diff_text" \
    --arg model "$MODEL" \
    '{repo: $repo, headSha: $headSha, diff: $diff} + (if $model == "" then {} else {model: $model} end)')
else
  # Remote mode.
  if [ -z "$REPO" ] || [ -z "$HEAD" ]; then
    echo "review: remote mode needs --remote <owner/repo> --head <ref>" >&2
    exit 1
  fi
  if [ -n "$LOCAL_BASE" ]; then
    PAYLOAD=$(jq -n --arg repo "$REPO" --arg head "$HEAD" --arg base "$LOCAL_BASE" --arg model "$MODEL" \
      '{repo: $repo, head: $head, base: $base} + (if $model == "" then {} else {model: $model} end)')
  else
    PAYLOAD=$(jq -n --arg repo "$REPO" --arg head "$HEAD" --arg model "$MODEL" \
      '{repo: $repo, head: $head} + (if $model == "" then {} else {model: $model} end)')
  fi
fi

# --- submit ---
echo "Submitting review to $BASE_URL ..." >&2
submit_res=$(curl -sS -X POST "$BASE_URL/api/review" \
  -H "$auth_header" -H "content-type: application/json" \
  -d "$PAYLOAD") || {
  echo "review: could not reach $BASE_URL/api/review" >&2
  exit 1
}

review_id=$(printf '%s' "$submit_res" | jq -r '.reviewId // empty' 2>/dev/null)
if [ -z "$review_id" ]; then
  err=$(printf '%s' "$submit_res" | jq -r '.error // empty' 2>/dev/null)
  echo "review: submission failed: ${err:-$submit_res}" >&2
  exit 1
fi
echo "Review submitted: $review_id (polling ...)" >&2

# --- poll ---
polls=0
while [ "$polls" -lt "$MAX_POLLS" ]; do
  polls=$((polls + 1))
  poll_res=$(curl -sS "$BASE_URL/api/review/$review_id" -H "$auth_header") || {
    sleep "$POLL_INTERVAL"
    continue
  }
  status=$(printf '%s' "$poll_res" | jq -r '.status // empty' 2>/dev/null)
  if [ "$status" = "running" ]; then
    sleep "$POLL_INTERVAL"
    continue
  fi
  if [ "$status" = "error" ]; then
    err=$(printf '%s' "$poll_res" | jq -r '.error // "unknown error"' 2>/dev/null)
    echo "review: failed: $err" >&2
    exit 1
  fi
  if [ "$status" = "done" ]; then
    # Print findings as tagged lines.
    printf '%s' "$poll_res" | jq -r '.findings[]? | "[\(.category)] \(.file):\(.line) — \(.title // .comment)"' 2>/dev/null
    count=$(printf '%s' "$poll_res" | jq '[.findings[]?] | length' 2>/dev/null)
    echo "(done — $count findings)" >&2
    exit 0
  fi
  sleep "$POLL_INTERVAL"
done

echo "review: timed out polling $review_id." >&2
exit 1
