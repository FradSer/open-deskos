import { accessSync, constants, lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, normalize, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const canonical = value => typeof value === 'string' && isAbsolute(value) && normalize(value) === value && !/[\x00-\x1f\x7f]/.test(value) && realpathSync(value) === value

/** Select a separately provisioned immutable plugin version for the catalog revision. */
export function createGmailManifest({ directory, nodePath = process.execPath, mode = 'stdio' }) {
  if (!canonical(directory) || !lstatSync(directory).isDirectory() || !canonical(nodePath) || !lstatSync(nodePath).isFile()) throw Error('Use canonical absolute plugin and Node paths.')
  accessSync(nodePath, constants.X_OK)
  if (!['stdio', 'socket'].includes(mode)) throw Error('Invalid Gmail connector mode.')
  const entry = join(directory, mode === 'socket' ? 'src/socket-bridge.mjs' : 'src/server.mjs')
  if (!canonical(entry) || !lstatSync(entry).isFile()) throw Error('Gmail plugin entry is unavailable.')
  return { schemaVersion: 1, kind: 'mcp', id: 'gmail', name: 'Gmail read-only',
    policy: { privateData: true, ownerOnly: true },
    transport: { type: 'stdio', command: nodePath, args: [entry], env: {
      ...(mode === 'socket' ? { ODK_MCP_GMAIL_SOCKET: { fromEnv: 'ODK_MCP_GMAIL_SOCKET' } } : {
        ODK_MCP_GMAIL_CREDENTIALS_FILE: { fromEnv: 'ODK_MCP_GMAIL_CREDENTIALS_FILE' },
      }),
    } } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length < 3 || process.argv.length > 4) throw Error('arguments')
    process.stdout.write(`${JSON.stringify(createGmailManifest({ directory: process.argv[2], mode: process.argv[3] ?? 'stdio' }), null, 2)}\n`)
  } catch { process.stderr.write('Use manifest <absolute immutable plugin version directory> [stdio|socket].\n'); process.exitCode = 1 }
}
