'use strict'

const fs = require('node:fs')
const { execFileSync } = require('node:child_process')

// Where each host keeps Tailscale, and what its background service is called. A
// host that already has it keeps its own installation, its own login, and its own
// configuration — the desk only fills the gap when there is no installation.
const HOSTS = {
  win32: { command: 'C:\\Program Files\\Tailscale\\tailscale.exe', service: 'Tailscale', candidates: ['C:\\Program Files\\Tailscale\\tailscale.exe'] },
  linux: { command: '/usr/bin/tailscale', service: 'tailscaled', candidates: ['/usr/bin/tailscale', '/usr/local/bin/tailscale'] },
  // The macOS application bundles its own command, and a machine that has only
  // the application has no `tailscale` on PATH at all.
  darwin: {
    command: '/usr/local/bin/tailscale',
    service: null,
    candidates: ['/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale', '/Applications/Tailscale.app/Contents/MacOS/Tailscale'],
  },
}

function resolveTailscaleHost({ platform = process.platform } = {}) {
  const host = HOSTS[platform]
  if (!host) return { platform, supported: false, command: null, service: null, candidates: [] }
  return { platform, supported: true, command: host.command, service: host.service, candidates: [...host.candidates] }
}

/**
 * The reuse rule. A host with an installation of its own is never replaced: the
 * desk reports where it found the command and leaves the login and the tailnet
 * configuration alone. Every location its platform uses is tried, so a host that
 * keeps the command outside the canonical path is still reused.
 */
function detectTailscale({ host = resolveTailscaleHost(), exists } = {}) {
  const located = exists || ((candidate) => {
    try { return fs.existsSync(candidate) } catch { return false }
  })
  if (!host.supported || !host.command) {
    return { installed: false, source: 'unsupported', command: null }
  }
  const candidates = Array.isArray(host.candidates) && host.candidates.length > 0 ? host.candidates : [host.command]
  const found = candidates.find((candidate) => located(candidate))
  return found
    ? { installed: true, source: 'host', command: found }
    : { installed: false, source: 'absent', command: host.command }
}

function provisionDecision(detection) {
  if (!detection || detection.source === 'unsupported') return 'unsupported'
  return detection.installed ? 'reuse' : 'install'
}

/**
 * `tailscale status --json` reduced to the few facts the desk states. Anything the
 * CLI did not report stays absent rather than guessed, and a payload the desk
 * cannot read is not a state.
 */
function parseTailscaleStatus(payload) {
  if (!payload || typeof payload !== 'string') return null
  let status
  try {
    status = JSON.parse(payload)
  } catch {
    return null
  }
  if (!status || typeof status !== 'object' || Array.isArray(status)) return null
  const backend = typeof status.BackendState === 'string' ? status.BackendState : ''
  if (!backend) return null
  const state = backend === 'Running' ? 'connected'
    : backend === 'NeedsLogin' ? 'needs-login'
    : backend === 'Stopped' ? 'stopped'
    : 'other'

  const rawSelf = status.Self && typeof status.Self === 'object' ? status.Self : null
  const self = rawSelf
    ? {
      hostname: typeof rawSelf.HostName === 'string' ? rawSelf.HostName : '',
      dnsName: typeof rawSelf.DNSName === 'string' ? rawSelf.DNSName : '',
      // The desk states a tailnet address, and an IPv4 one is the one a reader
      // can act on; the IPv6 address and the key stay out of the snapshot.
      ipv4: Array.isArray(rawSelf.TailscaleIPs)
        ? (rawSelf.TailscaleIPs.find((address) => typeof address === 'string' && address.includes('.')) || '')
        : '',
      online: rawSelf.Online === true,
    }
    : null

  const peerMap = status.Peer && typeof status.Peer === 'object' && !Array.isArray(status.Peer) ? status.Peer : null
  return {
    backendState: backend,
    state,
    self,
    peers: peerMap ? Object.keys(peerMap).length : null,
    peersOnline: peerMap ? Object.values(peerMap).filter((peer) => peer && peer.Online === true).length : null,
  }
}

/**
 * Read the status through the host's own CLI. Every failure is a reason, never a
 * state: a desk that cannot reach the daemon says so instead of showing a tailnet
 * it cannot see.
 */
function readTailscaleStatus({ command, execFile = execFileSync } = {}) {
  if (!command) return { ok: false, reason: 'tailscale-not-found' }
  let output
  try {
    output = execFile(command, ['status', '--json'], { encoding: 'utf8', timeout: 5000, windowsHide: true })
  } catch (error) {
    return { ok: false, reason: 'tailscale-unreachable', detail: String(error?.message || error) }
  }
  const status = parseTailscaleStatus(output)
  return status ? { ok: true, status } : { ok: false, reason: 'tailscale-status-unreadable' }
}

module.exports = {
  resolveTailscaleHost,
  detectTailscale,
  provisionDecision,
  parseTailscaleStatus,
  readTailscaleStatus,
  HOSTS,
}