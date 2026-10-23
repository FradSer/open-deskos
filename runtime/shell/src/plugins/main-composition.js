'use strict'

const { createPluginHost, validatePluginManifest } = require('../plugin-host')
const { createRendererDiagnosticsPlugin } = require('../renderer-diagnostics')
const { createRendererControlPlugin } = require('../renderer-management')
const { createHostedPiDiagnosticsPlugin } = require('./hosted-pi-diagnostics')
const { createFutuRuntimeDiagnosticsPlugin } = require('./futu-runtime-diagnostics')
const { createRendererDevelopmentPlugin } = require('./renderer-development')
const { createDiagnosticsPlugin } = require('../plugin-diagnostics')
const { createPluginControlPlugin } = require('../plugin-control')
const { createDataSourcePlugins } = require('./data-sources')
const { createPersonalAgentReadingsPlugin } = require('./personal-agent-readings')
const { createSystemChannelPlugins } = require('./system-channels')
const { createDeskRuntimePlugins } = require('./desk-runtime')

function validateMainReplacement(raw, original) {
  const manifest = validatePluginManifest(raw)
  original ||= createMainPlugins().find(plugin => plugin.manifest.id === manifest.id)?.manifest
  if (!original) throw Error(`invalid replacement identity: ${manifest.id}`)
  const ports = declaration => declaration.provides.map(port => port.interface).sort()
  const accepted = [ports(original), ...(original.compatibleProvides || []).map(interfaces => [...interfaces].sort())]
  if (manifest.host !== original.host || manifest.kind !== original.kind
    || !accepted.some(interfaces => JSON.stringify(ports(manifest)) === JSON.stringify(interfaces))) {
    throw Error(`replacement changes external contract: ${manifest.id}`)
  }
  return manifest
}

function createMainPlugins({ developmentPlugins = [], replacementPlugins = [], onDefaults = () => {}, report = error => console.error(`development composition unavailable: ${error.message}`) } = {}) {
  const sources = [...createDataSourcePlugins(), createPersonalAgentReadingsPlugin()]
  const systems = [...createSystemChannelPlugins(), createPluginControlPlugin(), createRendererControlPlugin(), createRendererDiagnosticsPlugin(), createHostedPiDiagnosticsPlugin(), createFutuRuntimeDiagnosticsPlugin(), createRendererDevelopmentPlugin()]
  const build = extensions => {
    const providers = [...sources, ...extensions]
    const readingPorts = providers.flatMap(plugin => plugin.manifest.provides.filter(port => /^odk:desk-reading\/.+\/v1$/.test(port.interface)).map(port => port.interface))
    const serviceReadingPorts = providers.flatMap(plugin => plugin.manifest.provides.filter(port => /^odk:desk-service-readings\/.+\/v1$/.test(port.interface)).map(port => port.interface))
    const plugins = [...systems, ...providers, ...createDeskRuntimePlugins({ readingPorts, serviceReadingPorts })]
    const healthPorts = plugins.flatMap(plugin => plugin.manifest.provides.filter(port => /^odk:plugin-health\/.+\/v1$/.test(port.interface)).map(port => port.interface))
    const runtimePorts = plugins.flatMap(plugin => plugin.manifest.provides.filter(port => /^odk:plugin-runtime\/.+\/v1$/.test(port.interface)).map(port => port.interface))
    return [createDiagnosticsPlugin({ healthPorts, runtimePorts }), ...plugins]
  }
  const baseline = build([])
  const builtins = new Map(baseline.map(plugin => [plugin.manifest.id, plugin.manifest]))
  const replacements = new Map()
  for (const plugin of replacementPlugins) {
    const manifest = validatePluginManifest(plugin.manifest)
    const original = builtins.get(manifest.id)
    if (!original || replacements.has(manifest.id)) throw Error(`invalid replacement identity: ${manifest.id}`)
    validateMainReplacement(manifest, original)
    replacements.set(manifest.id, plugin)
  }
  const select = plugins => plugins.map(plugin => replacements.get(plugin.manifest.id) || plugin)
  const validate = plugins => {
    const preflight = createPluginHost()
    plugins.forEach(plugin => preflight.register(plugin))
    preflight.validate()
  }
  const fallback = select(baseline)
  if (!developmentPlugins.length) {
    if (replacementPlugins.length) validate(fallback)
    onDefaults(baseline)
    return fallback
  }
  try {
    const defaults = build(developmentPlugins)
    const plugins = select(defaults)
    validate(plugins)
    onDefaults(defaults.filter(plugin => builtins.has(plugin.manifest.id)))
    return plugins
  } catch (error) {
    report(error)
    // A rejected extension cannot leave replacements with unresolved dependencies.
    if (replacementPlugins.length) validate(fallback)
    onDefaults(baseline)
    return fallback
  }
}

module.exports = { createMainPlugins, validateMainReplacement }
