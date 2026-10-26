# Gmail plugin

This independent MCP package gives Personal Agent read-only Gmail access.
It provides connection status, message search, and bounded message text.
It cannot send, draft, delete, archive, change labels, or read attachments.
CM5/Linux runs the connector; macOS can run the OAuth CLI.
Credentials require POSIX ownership and permissions.
Windows credential protection is not implemented.

## Supervised Docker service

CM5 can run Gmail through the separately installed external service runtime.
Use a checkout that contains `integrations/service-runtime/` for the supervisor commands below.
The service owns Google access and listens on a private Unix socket.
The Agent connector bridges that socket through stdio MCP.
The bridge receives no credential path or token.
The existing direct stdio mode remains available for separately supervised installations.

Run these commands from the repository root:

```sh
docker build --platform linux/arm64 -t odk-gmail:local integrations/gmail
docker image inspect --format '{{.Id}}' odk-gmail:local
node integrations/gmail/scripts/service-package.mjs /absolute/new/gmail-service sha256:REPLACE_WITH_ACTUAL_IMAGE_ID
```

Use the actual image ID from inspection.
The builder accepts only immutable image references and a new package directory.
It hashes a fixed source inventory and excludes credentials, tests, caches, and installed dependencies.
The image pins Node, the base image digest, pnpm, and locked production dependencies.
The container runs as UID 1000 and GID 1000.
Its credential and socket directories have mode `0700`.
Use the generic runtime's read-only filesystem, resource limits, and non-root execution.
Publish no TCP port.

Keep operator files in a private directory, for example `/home/orangepi/.config/odk/services/gmail/`.
Set directory permissions to `0700` and configuration file permissions to `0600`.
The service environment file contains paths, never credential values:

```dotenv
ODK_GMAIL_SERVICE_SOCKET=/run/odk-gmail/query.sock
ODK_MCP_GMAIL_CREDENTIALS_FILE=/credentials/credentials.json
```

Use a dedicated grant directory for the private credential file.
This directory can remain empty before authorization.
Mount it read-only so later authorization does not require different revision bindings:

```json
{
  "envFile": "/home/orangepi/.config/odk/services/gmail/service.env",
  "uid": 1000,
  "gid": 1000,
  "mounts": [
    {
      "source": "/home/orangepi/.config/odk/services/gmail/grant",
      "target": "/credentials",
      "readOnly": true
    },
    {
      "source": "/run/user/1000/odk-gmail",
      "target": "/run/odk-gmail",
      "readOnly": false
    }
  ]
}
```

Create the host socket directory with owner UID 1000 and mode `0700` before installation.
Keep the grant directory private and separate from operator configuration.
Provision only `credentials.json` into that directory after authorization.
Do not put the Desktop client export or other service secrets there.
The service can start without credentials and reports Gmail as unconfigured.
Its local readiness probe never contacts Google.
Readiness confirms the listener, not account authorization or mailbox availability.

Install the reviewed package with its private bindings:

```sh
python3 integrations/service-runtime/service_runtime.py install /absolute/new/gmail-service --config /home/orangepi/.config/odk/services/gmail/bindings.json --trust
python3 integrations/service-runtime/service_runtime.py enable odk.gmail.reader
```

Use the runtime's `disable`, `update`, and `rollback` commands for subsequent lifecycle changes.
Stopping closes active MCP sessions and removes only the service's socket.
The runtime retains source revisions and external credential files.
Atomic changes to `credentials.json` inside the mounted grant directory are visible without a service restart.
The connector reads the current credential file for each operation.

Install the connector files in an immutable host directory.
The socket bridge needs Node and its adjacent `socket-path.mjs`; it needs no installed dependencies.
Generate a socket connector manifest from that version:

```sh
node integrations/gmail/src/manifest.mjs /absolute/immutable/gmail-version socket
```

Set `ODK_MCP_GMAIL_SOCKET=/run/user/1000/odk-gmail/query.sock` in the Agent's operator environment.
The manifest refers only to that environment name.
Install it through the existing Agent package catalog.
Removing the connector closes Agent sessions without deleting Gmail credentials.
No mailbox snapshot enters the Shell's data cache.
Responses remain private, untrusted tool data.

The service allows eight sessions and four pending requests per session.
Request frames are limited to 8192 bytes; response frames are limited to 65536 bytes.
Initial and incomplete frames have a three-second deadline.
Malformed frames close their session without logging their contents.

## Build and package

Use Node.js 22.19.0 or later and the pinned pnpm version.
Run these commands from `integrations/gmail`:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm package /absolute/output
```

The package command produces a self-contained archive with `src/`, `skills/`, and `pnpm-lock.yaml`.
It refuses to replace an existing archive.
Provision this package separately from the Shell release.
Keep installed versions outside `/opt/odk/current`.
For example, use `~/.local/share/odk/agent-plugins/gmail/0.1.1-<archive-digest>`.
Replace `<archive-digest>` with the packaged archive's SHA-256 digest.
Extract each archive into a new version directory.
Run this command inside that directory:

```sh
pnpm install --prod --frozen-lockfile --ignore-scripts
```

Do not modify an installed version directory.
Keep previous versions for rollback.
Use canonical absolute paths for the installed directory and Node executable.
Resolve filesystem links before manifest generation.

## Authorize an account

Use a Google Cloud project with the Gmail API enabled.
Configure its OAuth consent screen.
For external testing, add the intended account as a test user.
Create a Desktop app OAuth client.
Download its client JSON file to a private path.
The [Google Gmail quickstart](https://developers.google.com/workspace/gmail/api/quickstart/nodejs) describes these console steps.

Run these commands from this package on a machine with a system browser:

```sh
pnpm auth login --client /absolute/private/google-desktop-client.json --credentials /absolute/private/gmail/credentials.json
pnpm auth status --credentials /absolute/private/gmail/credentials.json
```

Complete consent in that machine's system browser.
The callback uses its loopback address through [Google's Desktop OAuth flow](https://developers.google.com/identity/protocols/oauth2/native-app).
For CM5, securely provision the resulting credentials file to the service user.
The service user must own the credentials file and its private parent directory.
Use directory mode `0700` and file mode `0600`.
Keep credentials outside release and plugin version directories.
Keep the Desktop client file private.
Do not put credentials in Git, chat, memory, manifest arguments, or package content.

The CLI refuses to replace an existing credentials file.
CLI `status` checks local credentials; it does not test online access.
Invalid or revoked grants require renewed consent.
External projects in Testing normally receive refresh tokens that expire after seven days for this scope.
See [Google's token expiration rules](https://developers.google.com/identity/protocols/oauth2#expiration).

## Connect Personal Agent

The initial CM5 host release must include the generic MCP policy support introduced with this plugin.
Earlier hosts reject its policy fields.
Apply that host update through an authorized deployment workflow.
Enable `catalog` and `mcp` in the personal profile's `agentPlugins.enabled` list.
Keep any other required plugin selections.
For the supervised Docker service, set this variable in the Personal Agent service environment:

```sh
ODK_MCP_GMAIL_SOCKET=/run/user/1000/odk-gmail/query.sock
```

Apply initial configuration through an authorized service restart.
Generate a socket manifest with the canonical installed Node executable:

```sh
/absolute/canonical/node /absolute/installed/gmail/src/manifest.mjs /absolute/installed/gmail socket > /absolute/private/gmail-manifest.json
```

The manifest selects package ID `gmail` and stdio transport to the socket bridge.
It references only the host's `ODK_MCP_GMAIL_SOCKET` variable.
The Agent receives no Gmail credential path or token.
It declares `policy.ownerOnly` and `policy.privateData`.
The matching host's [catalog contract](../personal-agent/docs/AGENT_CATALOG.md) defines policy enforcement and limits.

For a separately supervised direct stdio installation, set `ODK_MCP_GMAIL_CREDENTIALS_FILE` to the private credentials path instead.
Omit the final `socket` argument during manifest generation for that mode.
Direct stdio mode runs the provider in the Agent's transport process.
Use this alternate mode only when its credential boundary matches the installation requirements.

Manifest generation records the running executable's `process.execPath`.
The command fails if that path or the version directory is not canonical.
Package installation and later version changes use the existing catalog lifecycle.
After the initial host update, Gmail version changes do not require a Personal Agent or Shell release rebuild.

Run these commands from `integrations/personal-agent`:

```sh
pnpm agent:packages --directory /actual/stateDir/personal-agent/packages install-mcp /absolute/private/gmail-manifest.json
pnpm agent:packages --directory /actual/stateDir/personal-agent/packages install-skill /absolute/installed/gmail/skills/gmail-reading
pnpm agent:packages --directory /actual/stateDir/personal-agent/packages list
```

Replace `/actual/stateDir` with the resident's actual state directory.
Do not create a separate unused catalog.
Skill installation is optional; it supplies the [reading workflow](skills/gmail-reading/SKILL.md).
Ask Personal Agent to check Gmail status, search messages, or read a selected message.
An online status result establishes the current connection.
No Gmail-specific intent or built-in capability declaration is required.

Private recommendation observers use the optional `expectedAccountKey` argument on search and read.
The key identifies an account; it is not a credential.
The provider checks the account with the same grant used for each requested data operation.
A different account fails before message access.
Observers require this schema support and cannot use an older service without it.
An ordinary interactive read can omit this optional argument.
The connector still exposes only the three read-only tools.
The host's [private recommendation contract](../personal-agent/docs/AGENT_CATALOG.md#private-recommendations) defines source selection and feedback boundaries.

## Update, rollback, and remove

Install each update into a new immutable version directory.
Generate its manifest, then install that manifest into the same catalog.
The catalog retains manifest snapshots; it does not copy the connector's code.
Retain every code directory referenced by a rollback revision.
Use the exact revision from the package list:

```sh
pnpm agent:packages --directory /actual/stateDir/personal-agent/packages rollback gmail REVISION_SHA256
pnpm agent:packages --directory /actual/stateDir/personal-agent/packages remove gmail
pnpm agent:packages --directory /actual/stateDir/personal-agent/packages remove gmail-reading
```

Removal deactivates the package at the next inventory refresh or connector call.
It does not revoke the Google grant or remove credentials.
Read that host contract for connection cleanup and retained snapshots.
Run this command from the Gmail package to revoke access and remove local credentials:

```sh
pnpm auth disconnect --credentials /absolute/private/gmail/credentials.json
```

Successful revocation removes the local credentials file.
If revocation cannot be confirmed, remove only the local credentials with:

```sh
pnpm auth forget --credentials /absolute/private/gmail/credentials.json
```

`forget` does not revoke Google access.
Revoke remaining access through the Google account's connections settings when necessary.
Use `login` again to connect another account.

## Data boundaries and verification

OAuth requests only `https://www.googleapis.com/auth/gmail.readonly`.
Google classifies this as a restricted scope.
External distribution can require verification and a security assessment when restricted data passes through a server.
See [Google's Gmail scope requirements](https://developers.google.com/workspace/gmail/api/auth/scopes) before distribution.

Tokens stay in connector-owned private storage and do not enter model tool results.
Requested email content reaches the selected conversation model and can persist in the private Durable session.
Gmail calls prevent automatic learning for that owner turn through the installed manifest policy.
The host does not automatically save that turn as experience.
Headers, message text, snippets, and links are untrusted data.
They cannot authorize actions or change the owner's instructions.
The connector does not fetch remote images or attachment contents.
Search results can require more pages; message text can be truncated.

Offline tests cover OAuth, private files, API behavior, and a real local MCP transport.
They do not establish real Google consent, live mailbox access, or CM5 acceptance.
