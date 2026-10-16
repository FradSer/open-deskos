#!/usr/bin/env node
'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { resolveShellHost } = require('../src/platform')
const { requestDiagnostics } = require('../src/plugin-diagnostics')
const { requestLocalControl } = require('../src/local-control-client')
const { resolveRuntimeManagement } = require('../src/plugin-runtime-management')
const { validatePluginManifest } = require('../src/plugin-host')
const { readDevelopmentPlugin, loadDevelopmentPlugins } = require('../src/development-plugins')
const { createMainPlugins } = require('../src/plugins/main-composition')

function showHelp() {
  console.log(`Open DeskOS Plugin CLI

Usage:
  odk plugin list
  odk plugin validate <path>
  odk plugin enable <id> [--runtime]
  odk plugin disable <id> [--runtime]
  odk plugin activate <id> --runtime
  odk plugin restore-default <id> --runtime
  odk plugin diagnose [id]
  odk plugin link <path> --trust [--replace] [--grant <capability> ...]
  odk plugin add <local-package-directory>
  odk plugin remove <installed-app-id-or-development-plugin-id>
  odk plugin update <installed-app-id>
  odk plugin rollback <installed-app-id>
  odk plugin native install <path> --keyring <file> --trust [--grant <capability> ...]
  odk plugin native update <id> <path> --keyring <file> --trust [--grant <capability> ...]
  odk plugin native rollback <id> --keyring <file>
  odk plugin native inspect <id> --keyring <file>
  odk plugin native list --keyring <file>
  odk plugin native remove <id>

list includes Main plugins and installed Widget/App packages.
Runtime snapshots are reported separately when their channels are available.
enable and disable save next-startup preferences for Shell, Personal Bot, Hosted Pi, Remote Bridge, and Futu Python.
--runtime changes components on an available Main, Renderer, Bridge, Personal Bot, Hosted Pi, or Python management endpoint without saving preferences.
remove manages installed Widget/App packages and development links.
update manages installed Widget/App packages.
rollback verifies and restores the previous installed Widget/App revision.
add installs verified local HTML Widget/App packages.
link selects trusted local Main code, renderer entries, or appearance declarations on the next startup.
Trusted development code has process authority and is not sandboxed.
native manages signed local revision selections without executing plugin entries.
activate applies a selected signed revision to an existing Main or Renderer plugin without saving preferences.
restore-default applies a captured built-in Main or Renderer implementation without changing the saved selection.
URL installation is not available.
`)
}

async function requestApps(env, command, appId, sourcePath) {
  const host = resolveShellHost({ env })
  const response = await requestLocalControl({ endpoint: host.endpoint('user-app-control'), tokenFile: host.localChannelTokenFile,
    platform: host.platform, label: 'application control', timeoutMs: command === 'list' ? 2000 : 35000, maxResponseBytes: 1024 * 1024,
    request: { command, ...(appId ? { appId } : {}), ...(sourcePath ? { sourcePath } : {}) } })
  if (command === 'list' && !Array.isArray(response.apps)) throw Error('invalid application catalog response')
  return response
}

async function manageApp(args, { env }) {
  const id = args[1]
  if (args.length !== 2 || typeof id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(id)) {
    console.error(`Error: ${args[0]} requires an installed Widget/App identifier`)
    return 1
  }
  try {
    console.log(JSON.stringify(await requestApps(env, args[0], id), null, 2))
    return 0
  } catch (error) {
    console.error(`Application command failed: ${error.message}`)
    return 1
  }
}

const { resolveConfigPath, readConfig, updateConfig, writeConfig } = require('../src/plugin-config')

async function manageRuntime(args, env) {
  const host = resolveShellHost({ env })
  const { scope, endpoint } = await resolveRuntimeManagement(host, args[1])
  const replacement = ['activate', 'restore-default'].includes(args[0])
  if (replacement && !['electron-main', 'electron-renderer'].includes(scope)) {
    throw Error('implementation replacement is unavailable for this runtime')
  }
  const response = await requestLocalControl({ endpoint, tokenFile: host.localChannelTokenFile,
    platform: host.platform, label: 'plugin runtime control', timeoutMs: 30000,
    request: { command: args[0], pluginId: args[1] } })
  if (replacement) {
    if (response.scope !== scope || response.pluginId !== args[1] || response.state !== 'running'
      || typeof response.version !== 'string' || !response.version
      || (args[0] === 'restore-default' ? response.implementation !== 'built-in' : !/^[a-f0-9]{64}$/.test(response.revision))) {
      throw Error('invalid plugin activation response; operation outcome unknown')
    }
  } else if (response.scope !== scope || response.pluginId !== args[1] || response.enabled !== (args[0] === 'enable')
    || response.state !== (response.enabled ? 'running' : 'disabled')) throw Error('invalid plugin runtime control response; operation outcome unknown')
  console.log(JSON.stringify(response, null, 2))
  return 0
}

function validateManifest(manifestPath) {
  const content = fs.readFileSync(manifestPath, 'utf8')
  return validatePluginManifest(JSON.parse(content))
}

function manageImplementation(args, { env }) {
  if (args.length !== 3 || args[2] !== '--runtime' || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(args[1] || '')) {
    throw Error(`${args[0]} requires a valid Open DeskOS plugin id and --runtime`)
  }
  return manageRuntime(args, env)
}

const COMMAND_HANDLERS = {
  activate: manageImplementation,
  'restore-default': manageImplementation,
  native(args, context) { return require('../src/native-plugin-cli').manageNative(args, context) },
  link(args, { configPath, config }) {
    if (!args[1] || args[1].startsWith('-') || !args.includes('--trust')) throw Error('link requires a local directory and explicit --trust')
    const grants = []
    for (let index = 2; index < args.length; index++) {
      if (['--trust', '--replace'].includes(args[index])) continue
      if (args[index] !== '--grant' || !args[index + 1]) throw Error('link accepts --trust, --replace, and repeated --grant capability')
      grants.push(args[++index])
    }
    const replace = args.includes('--replace')
    const { root, manifest } = readDevelopmentPlugin(path.resolve(args[1]), { replacement: replace })
    if (replace && manifest.host === 'electron-main') {
      const selected = { ...config, plugins: Object.fromEntries(Object.entries(config.plugins).filter(([id]) => id !== manifest.id)) }
      const linked = loadDevelopmentPlugins(selected, { report: id => console.error(`Development plugin unavailable: ${id}`) })
      createMainPlugins({ developmentPlugins: linked.filter(plugin => !plugin.replacement),
        replacementPlugins: [...linked.filter(plugin => plugin.replacement), { manifest, create() {} }] })
    }
    if (new Set(grants).size !== grants.length || grants.length !== manifest.permissions.length
      || manifest.permissions.some(name => !grants.includes(name))) throw Error('link requires explicit grants matching declared capabilities')
    updateConfig(configPath, config => {
      config.plugins[manifest.id] = { ...(config.plugins[manifest.id] || {}), development: { path: root, host: manifest.host, grants, trustAcknowledgedAt: new Date().toISOString(), ...(replace ? { replace: true } : {}) } }
    })
    console.log(`Development plugin "${manifest.id}" linked for the next Shell startup. ${manifest.appearance
      ? 'Appearance declaration changes apply on the next startup.' : 'Live directory changes are trusted process code.'}`)
    return 0
  },
  async list(args, { config, env }) {
    const host = resolveShellHost({ env })
    try {
      const [diagnosis, catalog] = await Promise.all([
        requestDiagnostics({ endpoint: host.endpoint('plugin-diagnostics'), tokenFile: host.localChannelTokenFile, platform: host.platform }),
        requestApps(env, 'list'),
      ])
      console.log(JSON.stringify({ scope: 'electron-main-and-installed-packages', plugins: diagnosis.plugins, runtimes: diagnosis.runtimes || [], apps: catalog.apps, preferences: config.plugins }, null, 2))
      return 0
    } catch (error) {
      console.error(`Plugin inventory unavailable: ${error.message}`)
      return 1
    }
  },

  remove(args, context) {
    const id = args[1]
    if (!id?.startsWith('odk.')) return manageApp(args, context)
    if (args.length !== 2 || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) throw Error('remove requires a development plugin identity')
    updateConfig(context.configPath, config => {
      if (!config.plugins[id]?.development) throw Error('development plugin is not linked')
      delete config.plugins[id].development
    })
    console.log(`Development plugin "${id}" unlinked for the next Shell startup. Source files remain unchanged.`)
    return 0
  },
  update: manageApp,
  rollback: manageApp,

  async add(args, { env }) {
    if (args.length !== 2 || !args[1] || args[1].includes('\0')) {
      console.error('Error: add requires a local Widget/App package directory')
      return 1
    }
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(args[1])) {
      console.error('URL installation is not available')
      return 1
    }
    try {
      console.log(JSON.stringify(await requestApps(env, 'add', undefined, path.resolve(args[1])), null, 2))
      return 0
    } catch (error) {
      console.error(`Application installation failed: ${error.message}`)
      return 1
    }
  },

  validate(args) {
    const target = args[1]
    if (!target) {
      console.error('Error: validate requires path to manifest.json')
      return 1
    }
    try {
      const manifest = validateManifest(target)
      console.log(`Plugin "${manifest.id}" (v${manifest.version}) declaration is valid. Dependency availability, capabilities, and trust are not checked.`)
      return 0
    } catch (e) {
      console.error(`Validation failed: ${e.message}`)
      return 1
    }
  },

  enable(args, { configPath, env }) {
    const id = args[1]
    if (!id || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) {
      console.error('Error: enable requires a valid Open DeskOS plugin id')
      return 1
    }
    if (args.length > 2) {
      if (args.length !== 3 || args[2] !== '--runtime') throw Error('enable accepts only an identity and optional --runtime')
      return manageRuntime(args, env)
    }
    updateConfig(configPath, config => { config.plugins[id] = { ...(config.plugins[id] || {}), enabled: true } })
    console.log(`Plugin "${id}" enabled for the next runtime startup.`)
    return 0
  },

  disable(args, { configPath, env }) {
    const id = args[1]
    if (!id || !/^odk\.[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) {
      console.error('Error: disable requires a valid Open DeskOS plugin id')
      return 1
    }
    if (args.length > 2) {
      if (args.length !== 3 || args[2] !== '--runtime') throw Error('disable accepts only an identity and optional --runtime')
      return manageRuntime(args, env)
    }
    updateConfig(configPath, config => { config.plugins[id] = { ...(config.plugins[id] || {}), enabled: false } })
    console.log(`Plugin "${id}" disabled for the next runtime startup.`)
    return 0
  },

  async diagnose(args, { config, env }) {
    const host = resolveShellHost({ env })
    try {
      const response = await requestDiagnostics({ endpoint: host.endpoint('plugin-diagnostics'), tokenFile: host.localChannelTokenFile, platform: host.platform, pluginId: args[1] })
      console.log(JSON.stringify({ ...response, preferences: config.plugins }, null, 2))
      const runtimes = args[1] ? (response.runtimes || []).filter(runtime => runtime.plugins.some(plugin => plugin.manifest.id === args[1])) : (response.runtimes || [])
      return runtimes.some(runtime => runtime.state !== 'available') || [...response.plugins, ...runtimes.flatMap(runtime => runtime.plugins)].some(plugin => ['failed', 'cleanup-failed', 'cleanup-blocked', 'blocked'].includes(plugin.state)
        || ['failed', 'degraded'].includes(plugin.health?.state)
        || plugin.health?.components?.some(component => ['failed', 'degraded'].includes(component.state))) ? 1 : 0
    } catch (error) {
      console.error(`Plugin diagnosis unavailable: ${error.message}`)
      return 1
    }
  },
}

function main(args = process.argv.slice(2), env = process.env) {
  const command = args[0]
  if (!command || command === '--help' || command === '-h') {
    showHelp()
    return 0
  }

  const handler = COMMAND_HANDLERS[command]
  if (!handler) {
    console.error(`Unknown plugin command: ${command}`)
    showHelp()
    return 1
  }

  try {
    const configPath = resolveConfigPath(env)
    const config = command === 'restore-default' ? undefined : readConfig(configPath)
    return handler(args, { config, configPath, env })
  } catch (error) {
    console.error(`Plugin command failed: ${error instanceof SyntaxError ? 'invalid plugin JSON metadata' : error.message}`)
    return 1
  }
}

if (require.main === module) {
  Promise.resolve(main()).then(code => { process.exitCode = code }).catch(error => {
    console.error(`Plugin command failed: ${error instanceof SyntaxError ? 'invalid plugin JSON metadata' : error.message}`)
    process.exitCode = 1
  })
}

module.exports = {
  main,
  readConfig,
  resolveConfigPath,
  validateManifest,
  writeConfig,
}
