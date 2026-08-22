# Reading findings

Findings are **inline review comments** from `code-terrier[bot]`, each anchored to a changed line. Fetch them:

```bash
gh api "repos/OWNER/REPO/pulls/$PR/comments" \
  --jq '.[] | select(.user.login == "code-terrier[bot]") | {comment_id: .id, path, line, body}'
```

`comment_id` is GitHub's per-comment id and changes on every re-post. The **stable** finding identity is the `"id"` **inside the anchor** below.

## The anchor

Every finding ends with a stable hidden anchor you can use to identify and dedupe it:

```html
<!-- codeterrier {"id":"…","category":"bug","severity":"high"} -->
```

- `id` is a stable hash of the file and title — **not the line**. A finding that moved to a different line is the *same* finding; dedupe by `id`, never by line number.
- `category` and `severity` come from the anchor, not the prose.

## Categories

- **Security** — a security hole. Treat seriously; do not apply a blind fix.
- **Bug** — a defect that breaks an existing caller, contract, or runtime path the reviewer verified in the code.
- **Flag** — a verification request, not an assertion. It names a latent contract risk; verify the premise, do not assume a defect.
- **Slop** — provably-removable pre-existing dead code (lowest priority). Dead code new in the PR is a bug, not slop.

## Suggestion blocks

A finding on a changed line may carry a one-click `suggestion` block — a ```` ```suggestion ```` code block with the replacement. You may apply it directly to the file.

## Cross-file findings

Some findings are defects in a file the PR did not touch, activated by the changes. These ride in the review **body** under a collapsible *Cross-file impact* section, not as inline comments, and carry **no suggestion block**. Address them in code as a normal fix.
