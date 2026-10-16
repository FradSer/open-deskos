'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { validatePluginManifest } = require('./plugin-host')
const { createOdkDataRegistry } = require('./odk-data-registry')
const { createMainPlugins, validateMainReplacement } = require('./plugins/main-composition')
const { createDefaultSourceReadings } = require('./plugins/desk-readings')
const { validateAppearanceReplacement, selectAppearancePlugins, selectAppearanceFactories, createAppearancePlugins } = require('./renderer/core/appearance-plugins')
const desktopContract = require('./renderer/core/user-app-desktop-plugins')

const declarationSource = { refresh() {}, scan() {}, read() {}, snapshot() {} }
const reservedReadings = new Set(['odk.plugins.installed', ...createDefaultSourceReadings({ hydra: declarationSource, weather: declarationSource, weread: declarationSource, piSessions: declarationSource, quota: declarationSource }).map(entry => entry.id)])

function validateDevelopmentReadings(manifest, instance, replacement = false) {
  const sourceName = manifest.id.replace(/^odk\.source\./, '').replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())
  const ownedReadings = replacement ? new Set(createDefaultSourceReadings({ [sourceName]: declarationSource }).map(entry => entry.id)) : new Set()
  const registry = createOdkDataRegistry()
  const ids = new Set()
  const check = (entries, service = false) => {
    if (typeof entries?.then === 'function') {
      void Promise.resolve(entries).catch(() => {})
      throw Error('development reading declarations must be synchronous')
    }
    if (!Array.isArray(entries)) throw Error('invalid development reading port')
    for (const entry of entries) {
      const owned = ownedReadings.has(entry?.id)
      const serviceAlias = replacement && manifest.id === 'odk.service.futu' && service && typeof entry?.id === 'string'
      if (typeof entry?.id !== 'string' || (!owned && !serviceAlias && !entry.id.startsWith(`${manifest.id}.`)) || ids.has(entry.id) || (reservedReadings.has(entry.id) && !owned)) throw Error('development readings require unique identities under their plugin identity')
      if (service ? entry.kind !== 'service' : entry.kind === 'package') throw Error('invalid development reading kind')
      registry.register(entry)
      ids.add(entry.id)
    }
  }
  for (const port of manifest.provides) {
    const provider = instance.ports?.[port.interface]
    if (/^odk:desk-reading\/.+\/v1$/.test(port.interface)) check(provider)
    if (/^odk:desk-service-readings\/.+\/v1$/.test(port.interface)) {
      if (typeof provider?.readings !== 'function') throw Error('invalid development service reading port')
      check(provider.readings(), true)
    }
  }
}

function readDevelopmentPlugin(directory, { replacement = false, nativeAppearance = false } = {}) {
  const root = fs.realpathSync(directory)
  const file = path.join(root, 'manifest.json')
  if (fs.realpathSync(file) !== file) throw Error('development manifest must stay inside its directory')
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 16384) throw Error('development manifest must be a file within 16 KiB')
  const manifest = validatePluginManifest(JSON.parse(fs.readFileSync(file, 'utf8')))
  if (manifest.id.startsWith('odk.theme.')) {
    if (!replacement) throw Error('appearance linking requires explicit --replace')
    if (!nativeAppearance || manifest.entry === undefined) return { root, manifest: validateAppearanceReplacement(manifest) }
    const { entry, ...declaration } = manifest
    validateAppearanceReplacement(declaration)
    const selected = selectAppearancePlugins([declaration]).find(plugin => plugin.manifest.id === manifest.id)
    selectAppearanceFactories(createAppearancePlugins(), [{ manifest, appearance: selected.appearance, create() {} }])
  }
  if (manifest.host === 'electron-renderer' && !manifest.id.startsWith('odk.theme.')) {
    if (!replacement) throw Error('renderer development linking requires explicit --replace')
    if (manifest.id === desktopContract.manifest.id) desktopContract.validate(manifest)
    else if (!['tile', 'page', 'status', 'app'].includes(manifest.surfaceKind)
      || manifest.kind !== (manifest.surfaceKind === 'app' ? 'application' : 'surface')
      || !manifest.provides.some(port => port.interface === `odk:surface/${manifest.id}/v1`)) throw Error('renderer replacement requires its surface kind and identity port')
  } else if (manifest.host !== 'electron-renderer') {
    if (manifest.host !== 'electron-main') throw Error('development linking requires a Shell plugin')
    if (replacement) validateMainReplacement(manifest)
    else if (createMainPlugins().some(plugin => plugin.manifest.id === manifest.id)) throw Error('built-in identity requires explicit --replace')
  }
  if (typeof manifest.entry !== 'string' || !manifest.entry || manifest.entry.includes('\0')
    || path.isAbsolute(manifest.entry) || manifest.entry.split(/[\\/]/).includes('..')
    || !/\.(cjs|js)$/.test(manifest.entry)) throw Error('development entry must be a relative CommonJS file')
  const entry = fs.realpathSync(path.resolve(root, manifest.entry))
  const relative = path.relative(root, entry)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) || !fs.statSync(entry).isFile()) throw Error('development entry must stay inside its directory')
  if (manifest.host === 'electron-renderer' && (!manifest.entry.endsWith('.js') || fs.statSync(entry).size > 262144)) throw Error('renderer entry requires a browser script within 256 KiB')
  let css
  if (manifest.host === 'electron-renderer' && manifest.css !== undefined) {
    if (typeof manifest.css !== 'string' || !manifest.css || manifest.css.includes('\0')
      || path.isAbsolute(manifest.css) || manifest.css.split(/[\\/]/).includes('..')
      || !manifest.css.endsWith('.css')) throw Error('renderer stylesheet must be a relative CSS file')
    css = fs.realpathSync(path.resolve(root, manifest.css))
    const cssRelative = path.relative(root, css)
    if (cssRelative === '..' || cssRelative.startsWith(`..${path.sep}`) || path.isAbsolute(cssRelative)) throw Error('renderer stylesheet must stay inside its directory')
    if (!fs.statSync(css).isFile() || fs.statSync(css).size > 262144) throw Error('renderer stylesheet requires a file within 256 KiB')
  }
  return { root, entry, manifest, ...(css ? { css } : {}) }
}

function discoverLinks(config, discover, report) {
  return Object.entries(config.plugins).flatMap(([id, preference]) => {
    try { return discover(id, preference) } catch (error) {
      if (!report) throw error
      try { report(id, error) } catch { /* Diagnostics cannot block independent discovery. */ }
      return []
    }
  })
}

function loadDevelopmentPlugins(config, { disabled = [], host = 'electron-main', report } = {}) {
  const excluded = new Set(disabled)
  const namespaces = []
  return discoverLinks(config, (id, preference) => {
    if (id.startsWith('odk.theme.')) return []
    if (!preference.development || preference.enabled === false || excluded.has(id)) return []
    if ((preference.development.host || 'electron-main') !== host) return []
    const { path: directory, grants, trustAcknowledgedAt } = preference.development
    if (!trustAcknowledgedAt) throw Error('development plugin requires explicit trust')
    const replacement = preference.development.replace === true
    const plugin = readDevelopmentPlugin(directory, { replacement })
    if (plugin.manifest.id !== id) throw Error('development plugin identity changed; link it again')
    if (plugin.manifest.host !== host) throw Error('development plugin host changed; link it again')
    if (namespaces.some(other => id.startsWith(`${other}.`) || other.startsWith(`${id}.`))) throw Error('development plugin reading namespaces overlap')
    if (plugin.manifest.permissions.some(name => !grants.includes(name))) throw Error('development plugin requires explicit capability grants')
    namespaces.push(id)
    if (host === 'electron-renderer') {
      const { pathToFileURL } = require('node:url')
      return [{ manifest: plugin.manifest, entryUrl: pathToFileURL(plugin.entry).href,
        ...(plugin.css ? { cssUrl: pathToFileURL(plugin.css).href } : {}) }]
    }
    return [createTrustedPluginDefinition(plugin, { replacement })]
  }, report)
}

function createTrustedPluginDefinition(plugin, { replacement = false, load = () => require(plugin.entry) } = {}) {
  return { manifest: plugin.manifest, replacement, async create(ctx) {
    // Trusted code loads only after the Host has checked dependencies and grants.
    const implementation = load(ctx)
    if (typeof implementation.create !== 'function') throw Error('development module must export create')
    const instance = await implementation.create(ctx)
    if (!instance || typeof instance !== 'object' || Array.isArray(instance)) throw Error('invalid development plugin instance')
    const ports = {}
    const wrappers = new Map()
    const identities = new Map()
    const synchronizePorts = () => {
      const supplied = instance.ports || {}
      for (const name of Object.keys(ports)) delete ports[name]
      Object.assign(ports, supplied)
      for (const port of plugin.manifest.provides) {
        if (/^odk:desk-reading\/.+\/v1$/.test(port.interface) && Array.isArray(supplied[port.interface])) {
          identities.set(port.interface, new Set(supplied[port.interface].map(entry => entry?.id)))
        }
      }
      for (const port of plugin.manifest.provides) {
        if (!/^odk:desk-service-readings\/.+\/v1$/.test(port.interface)) continue
        const provider = supplied[port.interface]
        if (typeof provider?.readings !== 'function') continue
        const cached = wrappers.get(port.interface)
        if (cached?.provider === provider) { ports[port.interface] = cached.wrapped; continue }
        let previous
        const wrapped = { ...provider,
          readings() {
            try {
              const entries = provider.readings()
              validateDevelopmentReadings({ ...plugin.manifest, provides: [port] }, { ports: { [port.interface]: { readings: () => entries } } }, replacement)
              for (const [name, claimed] of identities) {
                if (name !== port.interface && entries.some(entry => claimed.has(entry.id))) throw Error('conflicting development reading identities')
              }
              previous = entries.map(entry => ({ ...entry }))
              identities.set(port.interface, new Set(previous.map(entry => entry.id)))
              return previous
            } catch (error) {
              if (previous === undefined) throw error
              console.error(`development service declarations unavailable: ${plugin.manifest.id}`)
              return previous
            }
          },
          ...(typeof provider.refresh === 'function' ? { refresh: provider.refresh.bind(provider) } : {}),
        }
        wrappers.set(port.interface, { provider, wrapped })
        ports[port.interface] = wrapped
      }
    }
    return { get ports() { synchronizePorts(); return ports },
      get handoff() { return instance.handoff },
      async start() {
        validateDevelopmentReadings(plugin.manifest, { ports }, replacement)
        await instance.start?.()
        synchronizePorts()
        validateDevelopmentReadings(plugin.manifest, { ports }, replacement)
      },
      stop: () => instance.stop?.(),
      destroy: () => instance.destroy?.(),
    }
  } }
}

function loadAppearanceReplacements(config, { disabled = [], report } = {}) {
  const excluded = new Set(disabled)
  return discoverLinks(config, (id, preference) => {
    if (!id.startsWith('odk.theme.') || !preference.development || preference.enabled === false || excluded.has(id)) return []
    const development = preference.development
    if (!development.trustAcknowledgedAt || development.replace !== true || development.host !== 'electron-renderer'
      || !Array.isArray(development.grants) || development.grants.length) throw Error('appearance selection requires explicit trust and replacement')
    const { manifest } = readDevelopmentPlugin(development.path, { replacement: true })
    if (manifest.id !== id) throw Error('appearance identity changed; link it again')
    return [manifest]
  }, report)
}

module.exports = { createTrustedPluginDefinition, readDevelopmentPlugin, loadDevelopmentPlugins, loadAppearanceReplacements }
