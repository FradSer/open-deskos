# OpenDeskOS Agent Guidelines

## CRITICAL: Git Commits

NEVER use raw `git add`/`git commit` via Bash. When asked to commit, ALWAYS use git-agent.

## CRITICAL: Asking the User

ALWAYS interact with the user via user input prompts or confirmation UI when clarification is needed.

## Core Principles

- BDD-driven TDD: ALWAYS start from BDD — define Given/When/Then scenarios in `.feature` files first
- Clean Architecture (4 layers, dependencies point inward only)
- Challenge the premise before implementing
- Choose the simplest implementation that fully meets current requirements
- Do not preserve backward compatibility
- Grow the system in layers
- Keep components modular with concerns clearly separated
- Prefer established, well-maintained libraries
- Make architectural decisions for the long term
- Web search selectively
- Verify your own work: run tests and typecheck after completing changes

## Code Quality

- No AI code slop (extra comments, unnecessary defensive checks, casts to `any`)
- Match surrounding style
- Never hardcode credentials
- Keep functions modular (~50 lines max)
- Clean up temporary files

## Testing

- Formal tests in `tests/`, `__tests__/`, or `spec/`
- Run quick validations with bash

## Style

- MUST NOT use emojis unless explicitly requested
- Biome with 2-space indentation for JS/TS
- ESP-IDF C conventions for firmware (4-space, `snake_case`)
- Standard Swift naming for macOS client

## Project Structure

- `firmware/open-deskos/` — 设备固件（ESP-IDF）
- `app/apple/` — macOS SwiftUI 客户端
- `docs/open-deskos/` — 产品规格（`OPEN-DESKOS.md` 是顶层权威）
- `docs/reference/` — 硬件参考资料

## Firmware Subtree

`firmware/open-deskos/` 有自己的 `AGENTS.md`，在固件子树内工作时优先遵循。
