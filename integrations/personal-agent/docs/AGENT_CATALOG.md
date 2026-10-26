# Personal Agent package catalog

The catalog keeps local Skill snapshots and declarative MCP manifests under an explicit private directory.
It does not import Pi extension packages.
Fixed DeskOS tools expose installed packages to the resident when the catalog plugin is enabled.
The optional MCP plugin connects installed servers through the maintained MCP SDK.

## Resident configuration

The existing personal configuration selects the fixed `catalog` and `mcp` plugins.
The `mcp` plugin requires the `catalog` plugin.

```json
{
  "profile": "personal",
  "skillPaths": [],
  "memoryFile": "/absolute/private/notes.json",
  "agentPlugins": { "enabled": ["catalog", "mcp"] }
}
```

The resident uses `<stateDir>/personal-agent/packages` as its catalog directory.
The `ODK_AGENT_PACKAGE_CANDIDATES` variable selects an explicit source directory for conversational installation.
Each named candidate occupies one directory below that source directory.
Its directory name must match its Skill or MCP package ID.
A Skill candidate contains `SKILL.md`.
An MCP candidate contains `manifest.json`.
The resident rejects candidates that contain both entry files.

The `package_query` workflow reads installed packages and candidate metadata.
The `package_manage` workflow applies explicitly requested lifecycle changes.
The `extension` workflow can use an installed MCP connector for the current task.
Conversation and inventory-only workflows cannot invoke MCP tools.

The resident inspects a candidate before installation.
Installation requires the inspected candidate revision.
A changed candidate requires another inspection.
Installed Skill reads use fixed tools and retained snapshots.
They do not grant filesystem access, shell commands, or native extension loading.

## Operator commands

Run the commands from `integrations/personal-agent`.
Replace the absolute example paths with the intended local paths.
Replace `REVISION_SHA256` with an existing revision from the package list.

```sh
pnpm agent:packages --directory /absolute/private/catalog list
pnpm agent:packages --directory /absolute/private/catalog install-skill /absolute/skill
pnpm agent:packages --directory /absolute/private/catalog read-skill report-helper
pnpm agent:packages --directory /absolute/private/catalog read-skill report-helper references/checks.md
pnpm agent:packages --directory /absolute/private/catalog install-mcp /absolute/mcp.json
pnpm agent:packages --directory /absolute/private/catalog remove report-helper
pnpm agent:packages --directory /absolute/private/catalog rollback report-helper REVISION_SHA256
```

The `ODK_AGENT_CATALOG_DIR` environment variable can supply the directory instead of `--directory`.
The CLI never selects a default user directory.

## Skills

A Skill directory contains `SKILL.md` with `name` and `description` frontmatter fields.
The name uses lowercase words separated by hyphens.
The snapshot includes bounded UTF-8 text resources.
It rejects filesystem links, special files, repository directories, dependency directories, and binary resources.
The catalog never executes Skill scripts.

Each resource has a 256 KiB limit.
Each Skill permits 128 files and 256 total directory entries.
Source text has a 1 MiB total limit.
Resource reads use the snapshot index instead of filesystem path resolution.

## MCP manifests

MCP packages declare `stdio` or `streamable-http` transport configuration.
The stdio command must use an absolute executable path.
Environment variables and HTTP headers contain references to host variables with the `ODK_MCP_` prefix.
Only the connector resolves those references at connection time.
Credentials do not belong in command arguments, addresses, or package content.

```json
{
  "schemaVersion": 1,
  "kind": "mcp",
  "id": "report-source",
  "name": "Report source",
  "transport": {
    "type": "streamable-http",
    "url": "https://example.invalid/mcp",
    "headers": {
      "Authorization": { "fromEnv": "ODK_MCP_REPORT_AUTH" }
    }
  }
}
```

Remote HTTP addresses require HTTPS.
Loopback HTTP addresses support local test servers.
Addresses cannot contain user information, query parameters, or fragments.
The manifest does not accept native extension declarations.
Installation does not start a process or contact a server.

## MCP execution

The `agent_mcp_tools` tool discovers schemas from an installed server.
The `agent_mcp_call` tool requires that discovery's installed revision and schema-valid arguments.
A replacement revision requires new discovery before invocation.
The connector validates successful structured results against each tool's output schema.
It retains output validation across discovery pages.
Tool-list change notifications invalidate cached schemas.

The runtime keeps one session for each connected installed revision.
It permits eight simultaneous server connections.
The `agent_mcp_disconnect` tool closes a selected connection.
Removal, replacement, and resident shutdown close affected connections.
HTTP cleanup attempts bounded session termination before local close.
Unsupported or unavailable remote termination does not prevent local cleanup.

Discovery permits eight pages, 64 tools, and 256 KiB of tool metadata.
Each incoming transport message or HTTP response has a 1 MiB limit.
Each returned tool result has a 64 KiB limit after credential redaction.
Requests have a 20-second default deadline.
The deadline covers the complete initialization flow.

The connector does not inherit provider credentials from the resident environment.
It supplies only the MCP SDK's default environment and declared MCP variables to stdio servers.
It redacts known credential values and standard Authorization credential fragments from returned data.
Server descriptions, annotations, and results remain untrusted data.
Server read-only hints do not bypass mutation replay reservations.
An interrupted call reports an unknown outcome and never repeats automatically.

## Revisions

Each package identity retains its kind independently of installation state.
Removing a package clears its active revision without removing its snapshots.
Rollback selects an existing validated revision of the same identity and kind.
Invalid updates preserve the active revision.

A root lock serializes inventory admission and revision changes across processes.
The catalog permits 128 package identities, including removed identities with retained snapshots.
Unknown reads and removals do not create identities.
Failed installation preconditions do not consume capacity.
Revision digests detect changed snapshot content.
Private reads reject linked or shared files.

## Private recommendations

An MCP manifest can declare `policy.ownerOnly` and `policy.privateData` as boolean values.
Child agents cannot discover or call an owner-only connector.
Private connector admission marks the interactive turn before execution, including failed calls.
That turn cannot enter automatic experience learning.
Connector results remain untrusted data.

Set `ODK_PRIVATE_RECOMMENDATIONS_FILE` to a private owner file to enable background recommendations.
Use an absolute canonical path and owner-only file permissions.
Apply configuration changes through an authorized service restart.
An absent setting enables no private source.

```json
{
  "version": 1,
  "sources": [
    {
      "id": "gmail",
      "goal": "Identify messages that need attention and recommend a useful next step. Confirm reported account operations with the owner.",
      "query": "in:inbox",
      "maxMessages": 3
    }
  ]
}
```

The host currently provides one reviewed source profile, `gmail`.
The connector must be independently installed with both privacy policies enabled.
The profile requires the account-bound search and read schemas from Gmail 0.1.1.
Missing or disabled optional connectors produce no private recommendations.
Configuration cannot load arbitrary source code or install a connector.

Each background source owns an independent, cancellable MCP session.
It cannot cancel an interactive connector request or change another turn's privacy state.
Private observations use the existing recommendation generation, judgment, presentation, action, and feedback pipeline.
They never register public Desk Data readings or Home content.
The host removes execution bindings from generation and judgment inputs.

Stable account and message identities control handled-event deduplication.
Connector revisions, account changes, semantic content, and lifecycle epochs control action freshness.
Changed bindings revoke earlier confirmations.
Unchanged observation timestamps do not create another recommendation.
The review button performs an actual, account-bound, read-only connector call.
It does not confirm who performed a reported operation or authorize subsequent work.

Explicit feedback uses the existing asynchronous Pi outbox.
Private feedback supplies only the owner's decision and a fixed, abstract review stage.
Mail, derived advice, account identities, message identifiers, and private links cannot enter that refinement input.
Unbound private feedback remains unavailable.
Pending safe feedback survives source hydration without authorizing an action.
Derived preference memory remains separate from saved owner facts and automatic experience learning.

## Verification

```sh
node --test tests/agent-catalog.test.mjs tests/agent-catalog-cli.test.mjs tests/agent-mcp.test.mjs tests/agent-package-tools.test.mjs
pnpm typecheck
```

These tests cover local installation and real disposable stdio and Streamable HTTP servers.
The runtime worktree also checks resident integration in `tests/agent-catalog-resident.test.mjs`.
These checks do not establish live-provider quality, Windows acceptance, or CM5 acceptance.
