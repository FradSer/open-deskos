'use strict'

const os = require('node:os')
const path = require('node:path')
const { tokenFile } = require('../local-channel')

// The endpoint a logical link name owns, as the Unix runtime directory lays it
// out. A Windows host keeps the same logical names and maps each to a named
// pipe, so a ported link inherits the naming instead of inventing a transport.
const LINK_ENDPOINTS = {
  'user-app-control': ['open-deskos-apps', 'control.sock'],
  'remote-bridge': ['open-deskos-remote', 'bridge.sock'],
  'voice-agent': ['open-deskos-voice', 'agent.sock'],
  'desk-link': ['open-deskos-desk-link', 'service.sock'],
  // The Desk Data Link the Voice Agent reads through: one name, one transport
  // decision per host, no second copy of any reading.
  'desk-data': ['open-deskos-desk-data', 'service.sock'],
}

const WINDOWS_PIPE_PREFIX = '\\\\.\\pipe\\open-deskos-'

function windowsEndpoints() {
  const endpoints = {}
  for (const name of Object.keys(LINK_ENDPOINTS)) endpoints[name] = `${WINDOWS_PIPE_PREFIX}${name}`
  return endpoints
}

const WINDOWS_LINK_ENDPOINTS = windowsEndpoints()

/**
 * Resolve the Shell Host: the machine and operating system the Display Shell is
 * running on, and the host facts the shell is not allowed to guess at.
 *
 * The reference host is the CM5 (Linux arm64). A 64-bit Windows host is
 * supported. Anything else keeps the Unix shape and reports `supported: false`
 * rather than presenting itself as a host whose platform half exists.
 */
function resolveShellHost({ platform = process.platform, arch = process.arch, env = process.env, homedir = os.homedir() } = {}) {
  const isWindows = platform === 'win32'
  const isReference = platform === 'linux' && arch === 'arm64'
  const supported = platform === 'linux' || (isWindows && arch === 'x64')

  const stateDir = isWindows
    ? path.win32.join(env.LOCALAPPDATA || path.win32.join(homedir, 'AppData', 'Local'), 'open-deskos')
    : path.join(env.XDG_STATE_HOME || path.join(homedir, '.local/state'), 'open-deskos')

  const runtimeDir = !isWindows && typeof env.XDG_RUNTIME_DIR === 'string' && path.isAbsolute(env.XDG_RUNTIME_DIR)
    ? env.XDG_RUNTIME_DIR
    : null

  function endpoint(name) {
    if (!LINK_ENDPOINTS[name]) return null
    if (isWindows) return WINDOWS_LINK_ENDPOINTS[name]
    if (!runtimeDir) return null
    return path.join(runtimeDir, ...LINK_ENDPOINTS[name])
  }

  return {
    platform,
    arch,
    id: `${platform}-${arch}`,
    isWindows,
    isReference,
    supported,
    stateDir,
    runtimeDir,
    endpoint,
    // The token every runtime channel on this host shares. A Unix host
    // authenticates a channel by ownership and carries this only as a second
    // layer; a Windows host has no owner on a named pipe, so this file is what
    // authenticates there. Either way the file is readable only by this user.
    localChannelTokenFile: tokenFile(stateDir, isWindows ? path.win32.join : path.join),
    // The external user-application control endpoint exists for an external
    // agent, and it is provisioned wherever the endpoint itself exists: a Unix
    // socket owned by this user, or a named pipe gated by the channel token.
    // Widget and App control through the shell itself never needs it.
    provisionsUserAppControl: endpoint('user-app-control') !== null,
    // The Desk Data Link is the same arrangement for a reading: the Voice Agent
    // reads through it, and it exists wherever the endpoint itself exists.
    provisionsDeskData: endpoint('desk-data') !== null,
    deskDataEndpoint: endpoint('desk-data'),
  }
}

module.exports = {
  resolveShellHost,
  LINK_ENDPOINTS,
}