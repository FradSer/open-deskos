'use strict'

const { stateFrom, isoTime, omit, measured } = require('./common')
const { sourceHealth } = require('../health')

const WEATHER_STATES = { unconfigured: ['unconfigured'], unavailable: ['unavailable'], stale: ['stale'], live: ['live'] }
const projectWeather = snapshot => ({
  asOf: isoTime(snapshot?.updatedAt) ?? undefined,
  place: snapshot?.place ?? null,
  temperatureC: omit(snapshot, 'current')?.temperature,
  condition: omit(snapshot, 'current')?.condition,
  highC: omit(snapshot, 'daily')?.high,
  lowC: omit(snapshot, 'daily')?.low,
})

function createWeatherReadings(weather) {
  if (!weather?.refresh) return []
  return [{
    id: 'odk.tile.weather',
    home: { mode: 'optional', priority: 0, icon: 'weather', fields: ['place', 'temperatureC', 'condition'] },
    label: 'Weather',
    kind: 'tile',
    read: async () => {
      const snapshot = await weather.refresh()
      const state = stateFrom(snapshot?.status, WEATHER_STATES, 'unavailable')
      return { state, value: measured(state, projectWeather(snapshot)), updatedAt: snapshot?.updatedAt }
    },
  }]
}

const getWeatherHealth = source => sourceHealth(source, snapshot => snapshot?.status,
  { live: 'healthy', stale: 'degraded', unavailable: 'failed', unconfigured: 'degraded' })

module.exports = { createWeatherReadings, getWeatherHealth }
