'use strict'

const SYSTEM_PORTS = Object.freeze({
  personalBot: 'odk:system/personal-bot/v1',
  remoteLink: 'odk:transport/remote-link/v1',
  appManager: 'odk:system/app-manager/v1',
  serviceNotifications: 'odk:system/service-notifications/v1',
})

function bind(ctx, channel, handler) {
  const ipc = ctx.capability('ipc')
  ipc.handle(channel, handler)
  ctx.onCleanup(() => ipc.removeHandler(channel))
}

function ownClient(ctx, client, smokeMode) {
  let stopped = false
  const stop = async () => {
    if (stopped) return
    await client.stop()
    stopped = true
  }
  ctx.onCleanup(stop)
  return { start: () => { if (!smokeMode) return client.start() }, stop }
}

function define({ id, name, kind = 'system', port, permission, broadcast = false, create }) {
  return {
    manifest: {
      schemaVersion: 1, id, name, version: '1.0.0', kind, host: 'electron-main',
      provides: [{ interface: port }], requires: [], permissions: ['ipc', permission, ...(broadcast ? ['broadcast'] : [])],
    },
    create,
  }
}

function createSystemChannelPlugins() {
  return [
    {
      manifest: {
        schemaVersion: 1, id: 'odk.system.personal-bot-diagnostics', name: 'Personal Bot lifecycle diagnosis',
        version: '1.0.0', kind: 'system', host: 'electron-main',
        provides: [{ interface: 'odk:plugin-runtime/personal-agent/v1' }],
        requires: [{ interface: SYSTEM_PORTS.personalBot, optional: true }], permissions: [],
      },
      create(ctx) {
        return { ports: { 'odk:plugin-runtime/personal-agent/v1': { snapshot() {
          const unavailable = reason => [{ host: 'personal-agent', instance: 'resident', state: 'unavailable', reason, plugins: [] }]
          if (ctx.signal.aborted) return unavailable('stopped')
          const client = ctx.get(SYSTEM_PORTS.personalBot)
          return typeof client?.diagnose === 'function' ? client.diagnose({ signal: ctx.signal }) : unavailable(client ? 'not-supported' : 'provider-unavailable')
        } } } }
      },
    },
    {
      manifest: {
        schemaVersion: 1, id: 'odk.system.remote-bridge-diagnostics', name: 'Remote Bridge lifecycle diagnosis',
        version: '1.0.0', kind: 'system', host: 'electron-main',
        provides: [{ interface: 'odk:plugin-runtime/remote-bridge/v1' }],
        requires: [{ interface: SYSTEM_PORTS.remoteLink, optional: true }], permissions: [],
      },
      create(ctx) {
        return { ports: { 'odk:plugin-runtime/remote-bridge/v1': { snapshot() {
          const unavailable = reason => [{ host: 'remote-bridge', instance: 'bridge', state: 'unavailable', reason, plugins: [] }]
          if (ctx.signal.aborted) return unavailable('stopped')
          const client = ctx.get(SYSTEM_PORTS.remoteLink)?.client
          return typeof client?.diagnose === 'function' ? client.diagnose({ signal: ctx.signal }) : unavailable(client ? 'not-supported' : 'provider-unavailable')
        } } } }
      },
    },
    {
      manifest: {
        schemaVersion: 1, id: 'odk.system.service-notifications', name: 'Service notification routing',
        version: '1.0.0', kind: 'system', host: 'electron-main',
        provides: [{ interface: SYSTEM_PORTS.serviceNotifications }],
        requires: [{ interface: SYSTEM_PORTS.personalBot, optional: true }], permissions: [],
      },
      create(ctx) {
        return { ports: { [SYSTEM_PORTS.serviceNotifications]: {
          publish: readingIds => {
            if (!ctx.signal.aborted) return ctx.get(SYSTEM_PORTS.personalBot)?.servicePush(readingIds)
          },
        } } }
      },
    },
    {
      manifest: {
        schemaVersion: 1, id: 'odk.system.frame-status', name: 'Initial frame status',
        version: '1.0.0', kind: 'system', host: 'electron-main', provides: [],
        requires: [SYSTEM_PORTS.personalBot, SYSTEM_PORTS.remoteLink].map(interfaceName => ({ interface: interfaceName, optional: true })),
        permissions: ['shell.frames', 'broadcast'],
      },
      create(ctx) {
        const broadcast = ctx.capability('broadcast')
        ctx.onCleanup(ctx.capability('shell.frames').subscribe(frame => {
          if (ctx.signal.aborted) return
          broadcast('odk-personal-bot-status', ctx.get(SYSTEM_PORTS.personalBot)?.snapshot() || { state: 'unavailable' })
          frame.send('odk-remote-link-state', ctx.get(SYSTEM_PORTS.remoteLink)?.status() || { state: 'disconnected', sequence: 0 })
        }))
        return {}
      },
    },
    define({
      id: 'odk.system.personal-bot', name: 'Personal Bot channel', port: SYSTEM_PORTS.personalBot,
      permission: 'system.personal-bot', broadcast: true,
      create(ctx) {
        const config = ctx.capability('system.personal-bot')
        const broadcast = ctx.capability('broadcast')
        const client = config.create(config.options)
        const lifecycle = ownClient(ctx, client, config.smokeMode)
        let pendingToggle = null
        ctx.onCleanup(client.subscribe(status => {
          if (pendingToggle === 'starting' && status.state === 'idle') return
          if (pendingToggle === 'sending' && status.state === 'recording') return
          pendingToggle = null
          broadcast('odk-personal-bot-status', status)
        }))
        bind(ctx, 'odk-personal-bot-status', () => client.snapshot())
        bind(ctx, 'odk-personal-bot-toggle', () => {
          const current = client.snapshot()
          if (pendingToggle || ['transcribing', 'thinking'].includes(current.state)) return { accepted: false }
          const sent = client.toggle()
          if (sent) {
            pendingToggle = current.state === 'recording' ? 'sending' : 'starting'
            broadcast('odk-personal-bot-status', { state: pendingToggle, message: '' })
          } else broadcast('odk-personal-bot-status', { ...current, activated: true })
          return { accepted: sent }
        })
        bind(ctx, 'odk-personal-bot-proposal', (_event, command) => {
          if (!command || !['proposal_list', 'proposal_presented', 'proposal_respond'].includes(command.type) || JSON.stringify(command).length > 4096) return { accepted: false }
          if (command.type === 'proposal_respond' && (typeof command.id !== 'string' || command.id.length !== 36 || !['accept', 'ignore', 'mute'].includes(command.decision) || (command.confirmation !== undefined && (typeof command.confirmation !== 'string' || command.confirmation.length > 2048)))) return { accepted: false }
          if (command.type === 'proposal_presented' && (!Array.isArray(command.ids) || command.ids.length > 64 || !command.ids.every(id => typeof id === 'string' && id.length === 36))) return { accepted: false }
          return { accepted: client.proposalCommand(command) }
        })
        return { ports: { [SYSTEM_PORTS.personalBot]: client }, ...lifecycle }
      },
    }),
    define({
      id: 'odk.transport.remote-link', name: 'Remote Link channel', kind: 'transport', port: SYSTEM_PORTS.remoteLink,
      permission: 'system.remote-link', broadcast: true,
      create(ctx) {
        const config = ctx.capability('system.remote-link')
        const broadcast = ctx.capability('broadcast')
        const client = config.create({ ...config.options, onRemoteMic: () => broadcast('odk-personal-bot-mic') })
        const lifecycle = ownClient(ctx, client, config.smokeMode)
        let sequence = 0
        ctx.onCleanup(client.onLinkState(state => {
          sequence++
          broadcast('odk-remote-link-state', { state, sequence })
        }))
        ctx.onCleanup(client.onNavigation(direction => broadcast('odk-remote-navigation', { direction })))
        ctx.onCleanup(client.onInput(input => broadcast('odk-remote-input', { input })))
        const status = () => ({ state: client.getLinkState(), sequence })
        bind(ctx, 'odk-remote-link-state', status)
        bind(ctx, 'odk-remote-publish-page-state', (_event, state) => client.publishPageState(state))
        return { ports: { [SYSTEM_PORTS.remoteLink]: { client, status } }, ...lifecycle }
      },
    }),
    define({
      id: 'odk.system.app-manager', name: 'Built-in App manager', port: SYSTEM_PORTS.appManager,
      permission: 'system.app-manager',
      create(ctx) {
        const manager = ctx.capability('system.app-manager').create()
        let ready = false
        const admit = callback => (...args) => {
          if (!ready || ctx.signal.aborted) throw Error('App Manager unavailable')
          return callback(...args)
        }
        bind(ctx, 'odk-app-manager-list', admit(() => manager.list()))
        bind(ctx, 'odk-app-manager-state', admit((_event, appId) => manager.get(appId)))
        bind(ctx, 'odk-app-manager-intent', admit((_event, intent) => manager.dispatch(intent)))
        return { ports: { [SYSTEM_PORTS.appManager]: manager },
          handoff: { schema: 'odk:system/app-manager-state/v1', capture: () => manager.captureState(), restore: state => manager.restoreState(state) },
          start() { ready = true }, stop() { ready = false },
        }
      },
    }),
  ]
}

module.exports = { createSystemChannelPlugins, SYSTEM_PORTS }
