# TRIM — Open DeskOS firmware boundary

The production firmware is intentionally smaller than the upstream ESP-Claw
repository. Only the Open DeskOS application and Guition JC4880P443C board
configuration remain in this firmware tree.

## Removed

- The standalone upstream MCP sample application.
- All non-Guition board definitions from the production application.
- The upstream application identity, renamed to `open_deskos`.

## Explicitly RETAINED (do not trim)

- **Runtime LLM HTTP backend** — `components/claw_modules/claw_core/src/llm/`
  (`claw_llm_http_transport.c` and the `backends/` for anthropic /
  openai_compatible / custom). **Retained as a first-class product feature.**
  Open DeskOS-OS §6.2 reverses the original design's FR-11 ("no runtime LLM
  backend"): under Open DeskOS-OS the runtime LLM backend is a shipped
  capability, not a stripped one. This subtree must remain in the build.
