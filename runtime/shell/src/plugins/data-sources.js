'use strict'

const { createHydraReadings, getHydraHealth } = require('./readings/hydra')
const { createWeatherReadings, getWeatherHealth } = require('./readings/weather')
const { createWereadReadings, getWereadHealth } = require('./readings/weread')
const { getCameraHealth } = require('./readings/camera')
const { healthPort } = require('./health')
const { createPiSessionReadings } = require('./readings/pi-sessions')
const { createQuotaReadings } = require('./readings/quota')
const { createQuotaSource } = require('../quota-source')
const { SYSTEM_PORTS } = require('./system-channels')

const DATA_PORTS = Object.freeze({
  odkLink: 'odk:source/link/v1',
  piSessions: 'odk:source/pi-sessions/v1',
  piEvents: 'odk:source/pi-events/v1',
  hydra: 'odk:source/hydra/v1',
  weather: 'odk:source/weather/v1',
  weread: 'odk:source/weread/v1',
  camera: 'odk:source/camera/v1',
  quota: 'odk:source/quota/v1',
  deviceGateway: 'odk:source/device-gateway/v1',
})

function sourcePlugin({ id, name, port, requires = [], optionalRequires = [], channels = {}, construct, stop, createReadings, health, compatibleProvides }) {
  const readingPort = createReadings ? `odk:desk-reading/${id}/v1` : null
  const healthInterface = health ? healthPort(`odk.source.${id}`) : null
  return {
    manifest: {
      schemaVersion: 1, ...(compatibleProvides ? { compatibleProvides } : {}), id: `odk.source.${id}`, name, version: '1.0.0',
      kind: 'service', host: 'electron-main',
      provides: [{ interface: port }, ...(readingPort ? [{ interface: readingPort }] : []), ...(healthInterface ? [{ interface: healthInterface }] : [])],
      requires: [...requires.map(interfaceName => ({ interface: interfaceName })), ...optionalRequires.map(interfaceName => ({ interface: interfaceName, optional: true }))],
      permissions: [`source.${id}`, ...(Object.keys(channels).length ? ['ipc'] : [])],
    },
    create(ctx) {
      const config = ctx.capability(`source.${id}`)
      const source = construct ? construct(config, ctx) : config.create(config.options)
      // Register ownership before any IPC operation can fail. Shutdown releases
      // the same provider instance used by its Widget and Open DeskOS Data readers.
      if (stop) ctx.onCleanup(() => stop(source))
      for (const [channel, dispatch] of Object.entries(channels)) {
        const ipc = ctx.capability('ipc')
        ipc.handle(channel, (event, request) => dispatch(source, request, event))
        ctx.onCleanup(() => ipc.removeHandler(channel))
      }
      const readings = readingPort ? createReadings(source) : null
      if (readingPort && !Array.isArray(readings)) throw Error('source reading factory requires an array')
      return { ports: { [port]: source, ...(readingPort ? { [readingPort]: readings } : {}),
        ...(healthInterface ? { [healthInterface]: { snapshot: () => health(source) } } : {}) } }
    },
  }
}

function createDataSourcePlugins() {
  return [
    sourcePlugin({
      id: 'device-gateway', name: 'Bridge devices', port: DATA_PORTS.deviceGateway,
      optionalRequires: [SYSTEM_PORTS.remoteLink],
      construct: (config, ctx) => config.create({ ...config.options, client: ctx.get(SYSTEM_PORTS.remoteLink)?.client }),
      stop: source => source.stop(),
      channels: { 'odk-device-gateway': (source, request, event) => source.dispatch(event, request) },
    }),
    sourcePlugin({ id: 'odk-link', name: 'Open DeskOS Link readings', port: DATA_PORTS.odkLink,
      construct: (config, ctx) => config.create({ ...config.options, signal: ctx.signal }),
      stop: source => source.stop?.() }),
    sourcePlugin({
      id: 'pi-sessions', createReadings: scan => createPiSessionReadings({ scan }), name: 'Pi sessions', port: DATA_PORTS.piSessions, requires: [DATA_PORTS.odkLink],
      construct: (config, ctx) => config.create({ odkLink: ctx.get(DATA_PORTS.odkLink), signal: ctx.signal }),
      stop: source => source.stop?.(),
      channels: { 'odk-pi-sessions': scan => scan() },
    }),
    sourcePlugin({
      id: 'pi-events', name: 'Pi session events', port: DATA_PORTS.piEvents, requires: [DATA_PORTS.odkLink],
      construct: (config, ctx) => config.create({ odkLink: ctx.get(DATA_PORTS.odkLink), signal: ctx.signal }),
      stop: source => source.stop?.(),
      channels: { 'odk-pi-session-events': (read, request) => read({
        cwd: typeof request?.cwd === 'string' ? request.cwd : '',
        sessionId: typeof request?.sessionId === 'string' ? request.sessionId : '',
        hostedPi: request?.hostedPi === true,
      }) },
    }),
    sourcePlugin({
      id: 'hydra', createReadings: createHydraReadings, health: getHydraHealth, name: 'Hydra plants', port: DATA_PORTS.hydra,
      optionalRequires: [DATA_PORTS.deviceGateway],
      construct: (config, ctx) => config.createDefault
        ? config.createDefault({ ...config.options, deviceGateway: ctx.get(DATA_PORTS.deviceGateway) })
        : config.create(config.options),
      channels: {
        'odk-hydra-status': source => source.snapshot(),
        'odk-hydra-device': (source, action, event) => source.dispatchDevice?.(event, action) ?? { ok: false, error: 'unsupported-transport' },
      }, stop: source => source.stop(),
    }),
    sourcePlugin({
      id: 'weather', createReadings: createWeatherReadings, health: getWeatherHealth, name: 'Weather', port: DATA_PORTS.weather,
      construct: (config, ctx) => config.create({ ...config.options, signal: ctx.signal }),
      stop: source => source.stop?.(),
      channels: { 'odk-weather-status': (source, request) => source.refresh({ force: Boolean(request?.force) }) },
    }),
    sourcePlugin({
      id: 'weread', createReadings: createWereadReadings, health: getWereadHealth, name: 'WeRead highlight', port: DATA_PORTS.weread,
      construct: (config, ctx) => config.create({ ...config.options, signal: ctx.signal }),
      stop: source => source.stop?.(),
      channels: { 'odk-weread-highlight': async source => { await source.refresh(); return source.snapshot() } },
    }),
    sourcePlugin({
      id: 'camera', name: 'Camera frame', port: DATA_PORTS.camera, health: getCameraHealth,
      construct: (config, ctx) => config.create({ ...config.options, signal: ctx.signal }),
      stop: source => source.stop?.(),
      compatibleProvides: [[DATA_PORTS.camera]],
      channels: { 'odk-camera-frame': async source => { await source.refresh(); return source.snapshot() } },
    }),
    sourcePlugin({
      id: 'quota', createReadings: createQuotaReadings, name: 'AI usage and quotas', port: DATA_PORTS.quota,
      construct: (config, ctx) => createQuotaSource({ read: config.read, signal: ctx.signal }),
      stop: source => source.stop(),
      channels: { 'odk-opencode-go-status': source => source.read() },
    }),
  ]
}

module.exports = { createSourcePlugin: sourcePlugin, createDataSourcePlugins, DATA_PORTS }
