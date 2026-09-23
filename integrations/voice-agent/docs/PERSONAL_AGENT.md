# Personal voice assistant

The personal profile reuses the resident MIC, STT, Pi SDK and Markdown feedback. It does not enable native shell/filesystem tools, extensions, project instructions or coding capability modules. The default remains the existing coding profile when no config is set. TTS is not included.

## Configuration

Set `ODESK_VOICE_AGENT_CONFIG` in the private `voice-agent.env` to a canonical absolute JSON file path. Example (replace paths, never put literal credentials here):

```json
{
  "profile": "personal",
  "skillPaths": [],
  "memoryFile": "/home/orangepi/.local/state/open-deskos-voice/personal/MEMORY.md",
  "didi": {
    "environment": "sandbox",
    "keyFile": "/home/orangepi/.config/open-deskos/didi.key"
  }
}
```

Create the memory parent with mode 0700 and service-user ownership. The key is a separately provisioned 0600 file. Start with sandbox; production is explicitly selected by the operator. Sandbox and production ride state are separate. The built-in DiDi skill is included automatically when DiDi is configured. Add reviewed absolute SKILL.md files to `skillPaths`, then restart the service. The `skill_read` tool reads only startup snapshots of these files. Installing a skill does not grant executable scripts or additional tools.

The personal profile does not need a writable Git workspace. Model authentication and STT configuration remain unchanged; missing configuration gives a safe startup error, not a fake ready state.

## Memory

Say an explicit command, for example:

- `记住：我喜欢简短回答` (default note)
- `记住 回答偏好：请使用简体中文，简短回答`
- `查看你的记忆`
- `忘记 回答偏好`

A named note replaces that name's previous value. Only verbatim content in the current user command can authorize a write, once. Memory is bounded to 16 KiB and stored atomically as a JSON note map in the private file named `MEMORY.md`; tools expose the notes as data. It is not arbitrary Markdown parsing. It is not a permission store and cannot authorize purchases or supply an unasked current location. Known credential patterns are rejected, but secret detection is heuristic: do not ask it to remember passwords, tokens or sensitive account data. Forget removes the long-term note, not historical conversation entries. Private session retention/deletion is an operator responsibility.

## Calling a ride

1. Give the full city, current pickup place and destination. Ambiguous POIs require clarification.
2. The assistant searches both endpoints live and requests a quote.
3. Select a quoted product. The assistant presents the exact route, product, estimated price and confirmation phrase.
4. In a **subsequent user turn**, repeat the exact phrase `确认叫车 <车型名称> <六位代码>`. Whitespace and ordinary punctuation are tolerated; vague agreement is not.
5. Only then can the restricted submit tool create one order. A quoted price is an estimate, not a fixed final fare. Quote expiration requires fresh estimation and confirmation.
6. Ask for order status or driver location. Polling continues independently of a model turn. Cancellation requires its own subsequent `确认取消订单 <六位代码>` phrase.

The screen shows driver updates; pending updates are deferred while another request is being answered. No automatic real-order creation happens at startup, after a crash or from memory. A PID/state lock rejects a second controller. Intent is durably written before mutation; ambiguous delivery prevents a second order. Never manually delete state just to bypass an uncertain order—first reconcile in the DiDi app.

## API compatibility and truthful limitations

Source: https://mcp.didichuxing.com/api . The adapter uses the maintained MCP SDK with Streamable HTTP, HTTPS host pinning, redirects disabled, deadlines and response limits. Credentials and remote exception bodies are never returned as tool errors.

Live sandbox acceptance on 2026-09-17 confirmed searches, structured quotes, the explicit confirmation gate and simulated creation. The sandbox query endpoint returned **text-only** messages despite documentation promising `structuredContent`. Such messages are informational, not proof of a terminal state. The adapter retains order identity, displays the bounded text and blocks another mutation while continuing conservative polling. Use the DiDi app to verify when no structured state is available. Mocked tests exercise the documented structured lifecycle; this is not a claim that all live endpoint variants have passed.

Production read-only POI access was verified. No real order, charge, cancellation or payment was performed during development. Real order acceptance still requires a user-confirmed trip. The CM5 personal profile is configured for production after these checks; its initial order state was verified `idle` with no order. This integration does not implement payment authorization or resolve unpaid-account restrictions; follow DiDi's app/account prompts.

## Deployment and rollback

The personal profile ships inside the runtime release and is selected by configuration, not by a
second installation: `ODESK_VOICE_AGENT_CONFIG` in `voice-agent.env` points at
`~/.config/open-deskos/personal-agent.json`, and `open-deskos-voice-agent.service` keeps running the
active release's own `src/main.mjs`. Nothing outside `/opt/open-deskos` is part of the running voice
agent, so release activation and rollback cover it like any other runtime change.

The 2026-09-17 acceptance staged a separate bundle under
`~/.local/share/open-deskos/voice-releases/` and overrode the voice `ExecStart` through a systemd
drop-in. That path is superseded and must not be recreated: it bypasses release rollback and the
unit's read-only view of `/opt/open-deskos`, and a disabled drop-in left in
`open-deskos-voice-agent.service.d/` is one rename away from being active again. Stage the profile by
configuration instead.

Before activation: run `pnpm test`, `pnpm typecheck`, isolated sandbox acceptance and an independent
transaction/security review. Restart only `open-deskos-voice-agent.service`. Verify both systemd
activity and the private voice status socket. A text-only model probe does not validate physical
MIC/STT.

Rollback clears or repoints `ODESK_VOICE_AGENT_CONFIG` in `voice-agent.env`, runs
`systemctl --user daemon-reload`, and restarts the voice service. Retain private ride state for
reconciliation. Never roll back state to before a possibly accepted order.
