#!/usr/bin/env node
// The Open DeskOS Desk Link Service: accepts package-initiated Desk Links on the
// local network and serves the runtime's snapshot over its own Unix socket.
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createDeskLinkService } = require('../src/desk-link-service')
const { createHostedPiSocketAdapter } = require('../src/desk-link-host-adapter')
const { resolveShellHost } = require('../src/platform')
const { isNamedPipe, readOrCreateToken } = require('../src/local-channel')

// The token is a shared secret. A value in the unit's environment is readable by anything that can
// read this user's process environment, while a mode-0600 file is readable only by its owner, so the
// file is the carrier to provision. The environment form still works for the migration window and is
// refused as soon as the file form is set, so the two can never disagree about which token is in use.
function requiredToken(env, readFile = file => fs.readFileSync(file, 'utf8')) {
  const file = (env.ODK_DESK_LINK_TOKEN_FILE ?? '').trim()
  if (file.length > 0) {
    if (!path.isAbsolute(file)) throw new Error('ODK_DESK_LINK_TOKEN_FILE must be absolute')
    const token = readFile(file).trim()
    if (token.length === 0) throw new Error('ODK_DESK_LINK_TOKEN_FILE holds no token')
    return token
  }
  const token = (env.ODK_DESK_LINK_TOKEN ?? '').trim()
  if (token.length === 0) throw new Error('ODK_DESK_LINK_TOKEN_FILE (preferred) or ODK_DESK_LINK_TOKEN is required to accept Desk Links')
  return token
}

function controlCredential(env, readFile = file => fs.readFileSync(file, 'utf8')) {
  const file = (env.ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE ?? '').trim()
  if (file.length > 0) {
    if (!path.isAbsolute(file)) throw new Error('ODK_DESK_LINK_CONTROL_CREDENTIAL_FILE must be absolute')
    const credential = readFile(file).trim()
    if (credential.length === 0) {
      // An empty credential is the documented report-only desk, which is not a failure, but it is
      // never what an operator who created the file meant, so it is stated where the journal can show it.
      process.stderr.write('Desktop Link Control Credential file holds no value; this desk accepts reporting only\n')
    }
    return credential
  }
  return (env.ODK_DESK_LINK_CONTROL_CREDENTIAL ?? '').trim()
}

function socketPath(env, host) {
  const explicit = (env.ODK_DESK_LINK_SOCKET ?? '').trim()
  if (explicit.length > 0) {
    if (!path.isAbsolute(explicit) && !isNamedPipe(explicit)) throw new Error('ODK_DESK_LINK_SOCKET must be absolute or a named pipe')
    return explicit
  }
  // The platform names the endpoint: a Unix socket in the runtime directory, or
  // the named pipe a Windows host has instead of one.
  const endpoint = host.endpoint('desk-link')
  if (endpoint) return endpoint
  return path.join(os.tmpdir(), `open-deskos-desk-link-${process.getuid?.() ?? 0}`, 'service.sock')
}

async function main() {
  const env = process.env
  const host = resolveShellHost({ env })
  // The runtime channel's token is created on first use, so an operator never
  // provisions it by hand, and it is what authenticates the channel on a host
  // whose endpoint has no owner to check.
  const channelToken = await readOrCreateToken({ stateDir: host.stateDir })
  const service = createDeskLinkService({
    token: requiredToken(env),
    controlCredential: controlCredential(env),
    socketPath: socketPath(env, host),
    channelToken,
    platform: host.platform,
    hostAdapter: createHostedPiSocketAdapter({ env }),
    port: Number.parseInt(env.ODK_DESK_LINK_PORT ?? '8765', 10),
    env,
  })
  const bound = await service.start()
  process.stdout.write(`desk link service listening on ${bound.host}:${bound.port}\n`)

  const shutdown = () => {
    service.stop().then(() => process.exit(0), () => process.exit(1))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGHUP', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((error) => {
  process.stderr.write(`desk link service failed: ${error.message}\n`)
  process.exit(1)
})
