# Repository Guidelines

## Project Structure & Module Organization
- `runtime/linux/` is the active Electron CM5 (RK3588S) runtime. `peripherals/esp32-s3-remote/` and `peripherals/esp32-p4-camera/` have independent hardware acceptance gates; neither may block base-shell touch or keyboard use. `integrations/remote-bridge/` connects the Remote.
- `research/esp32-p4-c6-deskos/` preserves the prior P4+C6 device OS, simulator, docs, and Apple USB companion; it is not active product authority.
- For product scope, consult @PRODUCT.md; for runtime terminology or architecture, consult @runtime/linux/CONTEXT.md and the relevant record in `runtime/linux/docs/adr/`.
- Root only supplies UnoCSS, not a package workspace. Install runtime dependencies with pnpm in `runtime/linux/`.

## Verification & Operational Boundaries
- Start behavior work with Given/When/Then scenarios in the affected scope's `.feature` files, then a failing regression test before the implementation.
- Completion requires affected checks to pass after fixing change-caused failures; report blocked checks, unrelated failures, and hardware not exercised. Documentation-only changes need path and content checks, not firmware or Electron runs.
- Deployment, release activation/rollback, service installation, firmware flashing, and live camera/microphone capture are operational actions, not ordinary local tests. Obtain authorization for those actions; a host-test pass is not device acceptance.
- Keep credentials, tokens, diagnostic dumps, and temporary build outputs out of commits.

## Commit & Pull Request Guidelines
- Use `git-agent commit` or the `/git:commit` skill for commits; never run raw `git add` or `git commit`.
- Use focused Conventional Commits (`fix(cm5):`, `feat(hw):`, `refactor(link):`, `feat(vision):`, `fix(p4):`, `refactor(mac):`). State validation commands and scope in commit messages.
