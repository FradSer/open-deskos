# Repository Guidelines

## Project structure

- `runtime/shell/` is the active Electron Shell. CM5 (RK3588S, Linux arm64) is the reference host. Windows and macOS use the same Shell.
- Read @runtime/shell/docs/WINDOWS_HOST.md for 64-bit Windows operations.
- `peripherals/esp32-s3-remote/` and `peripherals/esp32-p4-camera/` have separate hardware acceptance gates. Neither may block touch or keyboard input.
- `integrations/remote-bridge/` connects the Remote. `research/esp32-p4-c6-deskos/` preserves the previous device OS; it does not define active product requirements.
- Read @PRODUCT.md for scope. Read @runtime/shell/CONTEXT.md for terms. Read @runtime/shell/docs/ARCHITECTURE.md for an applicable architecture decision.
- The root provides UnoCSS; it is not a package workspace. Install runtime dependencies with pnpm in `runtime/shell/`.

## Verification and operations

- Define Given/When/Then scenarios in the applicable `.feature` file before behavior changes. Reproduce a bug with a failing regression test before implementation.
- Run affected checks. Repair change-caused failures. Report unrelated failures, blocked checks, and hardware not tested.
- Documentation changes require content and reference checks; they do not require firmware or Electron runs.
- Obtain authorization for deployment, activation, rollback, service installation, firmware flashing, and live camera or microphone capture.
- A host-test pass does not prove device acceptance. Exclude credentials, tokens, diagnostic dumps, and temporary builds from commits.

## Commits

- Use the project commit workflow. Do not use raw `git add` or `git commit`. Use the scopes in `.git-agent/config.yml`.
- Do not stage another task's work. Do not change the index to bypass shared-tree ownership.
- Give concurrent tasks separate worktrees with non-overlapping scopes. If isolation is unavailable, resolve ownership before a commit.
- Before a commit, inspect the actual tree. Preserve another author's in-flight work.
- Use focused Conventional Commits: `fix(shell):`, `feat(hw):`, `refactor(link):`, `feat(vision):`, `fix(p4):`, and `refactor(mac):`.
- The `shell` scope applies to every Shell Host. Include validation commands and scope in the commit message.

## Documentation

- Write project Markdown in English. Apply ASD-STE100 Issue 9; read the [standard](https://www.asd-ste100.org/) when you edit prose.
- Use approved dictionary meanings and project technical terms from @runtime/shell/CONTEXT.md. Use the same term for the same concept.
- Use active voice in procedures. Put one instruction in each sentence. Limit procedural sentences to 20 words and descriptive sentences to 25 words.
- Keep exact identifiers, commands, UI strings, licenses, and upstream source text. Do not translate an execution or confirmation token.
- Keep one owner for each fact. Move current facts before you remove completed plans or old reviews. Use Git history for past versions.
- Validate links, language, and document consumers. Full STE conformance also requires dictionary, word-meaning, and technical-term review; a length check alone is insufficient.
