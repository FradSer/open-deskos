'use strict'

const path = require('node:path')
const { resolveShellHost } = require('./platform')
const { createNativePluginStore } = require('./native-plugin-store')
const { createNativePluginManager } = require('./native-plugin-manager')
const { readNativeKeyring } = require('./native-plugin-policy')
const { readConfig } = require('./plugin-config')

function parse(args) {
  const command = args[1]
  const arities = { install: 1, update: 2, rollback: 1, remove: 1, inspect: 1, list: 0 }
  if (!Object.hasOwn(arities, command)) throw Error('native requires install, update, rollback, remove, inspect, or list')
  const count = arities[command]
  const positional = args.slice(2, 2 + count)
  if (positional.length !== count || positional.some(value => !value || value.startsWith('-'))) throw Error('invalid native command arguments')
  const mutation = ['install', 'update'].includes(command)
  const options = { trust: false, grants: [] }
  for (let index = 2 + count; index < args.length; index++) {
    const flag = args[index]
    if (flag === '--trust' && mutation && !options.trust) options.trust = true
    else if (flag === '--grant' && mutation && args[index + 1] && !args[index + 1].startsWith('-')) options.grants.push(args[++index])
    else if (flag === '--keyring' && !options.keyring && args[index + 1] && !args[index + 1].startsWith('-')) options.keyring = path.resolve(args[++index])
    else throw Error('invalid native command option')
  }
  if (command !== 'remove' && !options.keyring) throw Error('native commands require an explicit --keyring file')
  return { command, positional, options }
}

async function manageNative(args, { env, configPath }) {
  try {
    const { command, positional, options } = parse(args)
    const keyring = options.keyring ? await readNativeKeyring(options.keyring) : new Map()
    const host = resolveShellHost({ env })
    const store = createNativePluginStore({ stateDir: path.join(host.stateDir, 'plugins', 'native'), keyring })
    const manager = createNativePluginManager({ store, configPath })
    let result
    let failed = false
    if (command === 'install') result = await manager.install(path.resolve(positional[0]), options)
    else if (command === 'update') result = await manager.update(positional[0], path.resolve(positional[1]), options)
    else if (command === 'inspect') {
      const plugin = await manager.inspect(positional[0])
      result = { manifest: plugin.manifest, selection: plugin.selection, revision: plugin.revision }
    } else if (command === 'list') {
      result = await Promise.all(Object.entries(readConfig(configPath).plugins).filter(([_id, entry]) => entry.native).map(async ([id]) => {
        try {
          const plugin = await manager.inspect(id)
          return { pluginId: id, state: 'verified', manifest: plugin.manifest, selection: plugin.selection, revision: plugin.revision }
        } catch {
          failed = true
          return { pluginId: id, state: 'unavailable', error: 'verification-failed' }
        }
      }))
    } else result = await manager[command](positional[0])
    console.log(JSON.stringify(['inspect', 'list'].includes(command) ? result : { operation: command, effect: 'selection-only', selection: result }, null, 2))
    return failed ? 1 : 0
  } catch (error) {
    console.error(`Native plugin command failed: ${error instanceof SyntaxError ? 'invalid native JSON metadata' : error.message}`)
    return 1
  }
}

module.exports = { manageNative }
