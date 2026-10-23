'use strict'

const { createMainPlugins } = require('../../src/plugins/main-composition')
const { DESK_PORTS } = require('../../src/plugins/desk-runtime')
const { SYSTEM_PORTS } = require('../../src/plugins/system-channels')

// Independent test implementations use only declared ports and capabilities.
const frameProviders = new WeakMap()
const factories = {
  'odk.system.service-notifications': ctx => ({ ports: {
    [SYSTEM_PORTS.serviceNotifications]: { publish(ids) {
      if (ctx.signal.aborted) return
      const destination = ctx.get(SYSTEM_PORTS.personalBot)
      return destination?.servicePush(ids)
    } },
  } }),
  'odk.system.frame-status': ctx => {
    const frames = ctx.capability('shell.frames')
    const provider = ctx.get(SYSTEM_PORTS.personalBot)
    if (provider && frameProviders.get(frames) !== provider) ctx.capability('broadcast')('odk-personal-bot-status', { state: 'unavailable' })
    frameProviders.set(frames, provider)
    const publishBotStatus = () => {
      const agent = ctx.get(SYSTEM_PORTS.personalBot)
      ctx.capability('broadcast')('odk-personal-bot-status', agent ? agent.snapshot() : { state: 'unavailable' })
    }
    publishBotStatus()
    const send = frame => {
      if (ctx.signal.aborted) return
      const remote = ctx.get(SYSTEM_PORTS.remoteLink)
      publishBotStatus()
      frame.send('odk-remote-link-state', remote ? remote.status() : { state: 'disconnected', sequence: 0 })
    }
    ctx.onCleanup(frames.subscribe(send))
    return {}
  },
  'odk.system.service-refresh': (ctx, manifest) => {
    const config = ctx.capability('desk.refresh')
    const sources = manifest.requires.map(port => port.interface).filter(port => port !== DESK_PORTS.data)
    let task, clock
    const report = error => { try { config.report(`service readings refresh failed: ${error.message}`) } catch {} }
    const request = () => {
      if (ctx.signal.aborted || task) return task
      task = (async () => {
        for (const source of sources) {
          if (ctx.signal.aborted) return
          try { await ctx.get(source)?.refresh?.() } catch (error) { report(error) }
        }
        if (!ctx.signal.aborted) ctx.get(DESK_PORTS.data).syncServices()
      })().catch(report).finally(() => { task = null })
      return task
    }
    ctx.onCleanup(async () => {
      if (clock) { config.clearInterval(clock); clock = null }
      await task
    })
    return { start() {
      if (config.smokeMode || ctx.signal.aborted) return
      request()
      clock = config.setInterval(request, 60000)
      clock.unref?.()
    } }
  },
}

function independentCoordinator({ manifest }) {
  if (!factories[manifest.id]) throw Error('Unknown coordinator identity')
  const selected = { ...manifest, version: '2.0.0' }
  return { manifest: selected, create: ctx => factories[selected.id](ctx, selected) }
}

function selectIndependentCoordinators(definitions) {
  const replacements = definitions.filter(definition => factories[definition.manifest.id]).map(independentCoordinator)
  const selected = new Map(createMainPlugins({ replacementPlugins: replacements }).map(definition => [definition.manifest.id, definition]))
  return definitions.map(definition => factories[definition.manifest.id] ? selected.get(definition.manifest.id) : definition)
}

module.exports = { selectIndependentCoordinators, independentCoordinator }
