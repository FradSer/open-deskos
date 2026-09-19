#!/usr/bin/env node
// The Open DeskOS Desk Link Service: accepts package-initiated Desk Links on the
// local network and serves the runtime's snapshot over its own Unix socket.
const os = require('node:os')
const path = require('node:path')
const { createDeskLinkService } = require('../src/desk-link-service')

function requiredToken(env) {
  const token = (env.ODK_DESK_LINK_TOKEN ?? '').trim()
  if (token.length === 0) throw new Error('ODK_DESK_LINK_TOKEN is required to accept Desk Links')
  return token
}

function socketPath(env) {
  const explicit = (env.ODK_DESK_LINK_SOCKET ?? '').trim()
  if (explicit.length > 0) {
    if (!path.isAbsolute(explicit)) throw new Error('ODK_DESK_LINK_SOCKET must be absolute')
    return explicit
  }
  const runtimeDir = env.XDG_RUNTIME_DIR
  if (!runtimeDir || !path.isAbsolute(runtimeDir)) {
    return path.join(os.tmpdir(), `open-deskos-desk-link-${process.getuid?.() ?? 0}`, 'service.sock')
  }
  return path.join(runtimeDir, 'open-deskos-desk-link', 'service.sock')
}

async function main() {
  const env = process.env
  const service = createDeskLinkService({
    token: requiredToken(env),
    socketPath: socketPath(env),
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
