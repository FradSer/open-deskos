'use strict'

// The source owns provider requests, cache, and lifecycle. Public projection and
// device-location behavior remain explicitly shared contracts.
const { createWeatherSource } = require('./source.cjs')
const { createWeatherReadings, getWeatherHealth } = require('../../../src/plugins/readings/weather')

exports.create = context => {
  const configuration = context.capability('source.weather')
  const source = createWeatherSource({ ...configuration.options, signal: context.signal })
  context.onCleanup(() => source.stop())
  const ipc = context.capability('ipc')
  ipc.handle('odk-weather-status', (_event, request) => source.refresh({ force: Boolean(request?.force) }))
  context.onCleanup(() => ipc.removeHandler('odk-weather-status'))
  return { ports: {
    'odk:source/weather/v1': source,
    'odk:desk-reading/weather/v1': createWeatherReadings(source),
    'odk:plugin-health/odk.source.weather/v1': { snapshot: () => getWeatherHealth(source) },
  } }
}
