'use strict'

const os = require('node:os')
const path = require('node:path')

// The endpoint a logical link name owns, as the Unix runtime directory lays it
// out. A Windows host keeps the same logical names and maps each to a named
// pipe, so a ported link inherits the naming instead of inventing a transport.
const LINK_ENDPOINTS = {
  'user-app-control': ['open-deskos-apps', 'control.sock'],
  'remote-bridge': ['open-deskos-remote', 'bridge.sock'],
  'voice-agent': ['open-deskos-voice', 'agent.sock'],
  'desk-link': ['open-deskos-desk-link', 'service.sock'],
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
    // The external user-application control endpoint exists for an external
    // agent. No such agent is ported to Windows, so a Windows host states the
    // endpoint is absent rather than binding a pipe nothing connects to.
    // Widget and App control through the shell itself is unaffected.
    provisionsUserAppControl: !isWindows && runtimeDir !== null,
  }
}

module.exports = {
  resolveShellHost,
  LINK_ENDPOINTS,
}