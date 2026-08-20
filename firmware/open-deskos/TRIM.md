# TRIM — vendored fork trim candidates (record only; nothing deleted in v1)

This file records subtrees of the vendored `esp-claw` fork that are candidates
for removal later. v1 deletes nothing: the fork is kept whole so the build stays
reproducible and diffs against upstream stay legible. Deletion, if it ever
happens, is a separate reviewed change that appends its rationale here.

## Candidates (not removed)

| Subtree | Why it is a candidate | Status |
|---|---|---|
| `application/mcp_server_point/` | Separate MCP server application, not part of the Open DeskOS edge-agent product surface. | Retained (v1) |
| Non-Open DeskOS board directories under `application/edge_agent/boards/` (e.g. `dfrobot/`, `m5stack/`, `lilygo/`, `waveshare/`, `movecall/`, `lceda-course-examples/`, and the non-headless `espressif/` entries) | Open DeskOS ships only `boards/open-deskos/open_deskos_p4_headless`. The others are reference/demo boards. Kept for now as schema references and to keep the board manager's board list intact. | Retained (v1) |
| `emote` partition dependencies | The `emote` on-screen avatar subsystem targets a display Open DeskOS does not drive on the headless bring-up. | Retained (v1) |

## Explicitly RETAINED (do not trim)

- **Runtime LLM HTTP backend** — `components/claw_modules/claw_core/src/llm/`
  (`claw_llm_http_transport.c` and the `backends/` for anthropic /
  openai_compatible / custom). **Retained as a first-class product feature.**
  Open DeskOS-OS §6.2 reverses the original design's FR-11 ("no runtime LLM
  backend"): under Open DeskOS-OS the runtime LLM backend is a shipped capability,
  not a stripped one. This subtree must remain in the build. Task 001's second
  BDD scenario asserts `claw_llm_http_transport` stays in the build artifact.
