# Repository Guidelines

## Project Structure & Module Organization
- `runtime/linux/` is the active Electron Shell runtime. Its reference Shell Host is the CM5 (RK3588S, Linux arm64); 64-bit Windows is a supported host with its own runbook at `runtime/linux/docs/WINDOWS_HOST.md`. `peripherals/esp32-s3-remote/` and `peripherals/esp32-p4-camera/` have independent hardware acceptance gates; neither may block base-shell touch or keyboard use. `integrations/remote-bridge/` connects the Remote.
- `research/esp32-p4-c6-deskos/` preserves the prior P4+C6 device OS, simulator, docs, and Apple USB companion; it is not active product authority.
- For product scope, consult @PRODUCT.md; for runtime terminology or architecture, consult @runtime/linux/CONTEXT.md and the relevant record in `runtime/linux/docs/adr/`.
- Root only supplies UnoCSS, not a package workspace. Install runtime dependencies with pnpm in `runtime/linux/`.

## Verification & Operational Boundaries
- Start behavior work with Given/When/Then scenarios in the affected scope's `.feature` files, then a failing regression test before the implementation.
- Completion requires affected checks to pass after fixing change-caused failures; report blocked checks, unrelated failures, and hardware not exercised. Documentation-only changes need path and content checks, not firmware or Electron runs.
- Deployment, release activation/rollback, service installation, firmware flashing, and live camera/microphone capture are operational actions, not ordinary local tests. Obtain authorization for those actions; a host-test pass is not device acceptance.
- Keep credentials, tokens, diagnostic dumps, and temporary build outputs out of commits.

## Commit & Pull Request Guidelines
- Commits go through the project's commit workflow, never a raw `git add` or `git commit`: a commit that bypasses it is not atomic with the changes it claims, and the scope taxonomy in `.git-agent/config.yml` is the project's.
- Do not hand-stage paths or manipulate the index to work around a tree that carries another task's or another author's uncommitted work. The fix is isolation: give a concurrent task its own worktree with a non-overlapping scope. If a tree cannot be isolated, stop and settle ownership before committing.
- A commit is not finished when it exists: before committing, check what the tree actually carries and leave another author's in-flight work exactly as it was found.
- Use focused Conventional Commits (`fix(shell):`, `feat(hw):`, `refactor(link):`, `feat(vision):`, `fix(p4):`, `refactor(mac):`). The `shell` scope covers the Shell runtime and is named for the Shell, not for a host device, so it applies on every Shell Host. State validation commands and scope in commit messages.
