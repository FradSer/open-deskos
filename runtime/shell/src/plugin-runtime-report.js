'use strict'

const { validatePluginManifest } = require('./plugin-host')

const STATES = new Set(['registered', 'starting', 'running', 'disabled', 'blocked', 'failed', 'stopped', 'cleanup-failed', 'cleanup-blocked'])

function sanitizeRuntimePlugins(report, expectedHost) {
  if (Buffer.byteLength(JSON.stringify(report), 'utf8') > 65536 || !Array.isArray(report.plugins)
    || report.plugins.length === 0 || report.plugins.length > 128) throw Error('invalid runtime report')
  const ids = new Set()
  const plugins = report.plugins.map(plugin => {
    const raw = plugin?.manifest
    const manifest = validatePluginManifest({ schemaVersion: raw?.schemaVersion, id: raw?.id, name: raw?.name,
      version: raw?.version, kind: raw?.kind, host: raw?.host, provides: raw?.provides,
      requires: raw?.requires, permissions: raw?.permissions })
    if (manifest.host !== expectedHost || !STATES.has(plugin.state) || typeof plugin.enabled !== 'boolean'
      || ids.has(manifest.id)) throw Error('invalid runtime report')
    ids.add(manifest.id)
    return { manifest, state: plugin.state, enabled: plugin.enabled, health: { state: 'unknown', reason: 'not-declared' } }
  })
  if (Buffer.byteLength(JSON.stringify(plugins), 'utf8') > 16384) throw Error('runtime report exceeds limit')
  return plugins
}


module.exports = { sanitizeRuntimePlugins }
