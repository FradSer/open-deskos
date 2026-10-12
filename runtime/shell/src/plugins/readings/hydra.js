'use strict'

const { stateFrom, isoTime, pick, measured } = require('./common')
const { sourceHealth } = require('../health')

const HYDRA_STATES = {
  unconfigured: snapshot => snapshot?.configured === false,
  unavailable: snapshot => snapshot?.connected !== true,
  stale: snapshot => snapshot?.env?.stale === true,
}
const projectHydra = snapshot => ({
  asOf: isoTime(snapshot?.updatedAt) ?? undefined,
  gatewayOnline: snapshot?.mainOnline === true,
  greenhouse: snapshot?.env ? pick(snapshot.env, {
    temperatureC: env => env.tempC,
    humidityPercent: env => env.humidity,
    pressureHpa: env => env.pressureHpa,
    lightLux: env => env.lux,
    stale: env => env.stale,
    measuredAt: env => isoTime(env.updatedAt),
  }) : null,
  plants: (Array.isArray(snapshot?.nodes) ? snapshot.nodes : []).map(node => pick(node, {
    id: node => node.id,
    name: node => `Plant ${node.id}`,
    soilPercent: node => node.soilPercent,
    watering: node => node.pump,
    online: node => node.online,
    stale: node => node.stale,
    measuredAt: node => isoTime(node.soilUpdatedAt),
  })),
})

function createHydraReadings(hydra) {
  if (!hydra?.snapshot) return []
  return [{
    id: 'odk.tile.hydra',
    home: { mode: 'optional', priority: 50, icon: 'plants', fields: ['greenhouse', 'plants'] },
    label: 'Hydra plants',
    kind: 'tile',
    read: async () => {
      const snapshot = hydra.snapshot()
      const state = stateFrom(snapshot, HYDRA_STATES)
      return { state, value: measured(state, projectHydra(snapshot)), updatedAt: snapshot?.updatedAt }
    },
  }]
}

const getHydraHealth = source => sourceHealth(
  typeof source?.cachedSnapshot === 'function' ? { snapshot: () => source.cachedSnapshot() } : source,
  snapshot => stateFrom(snapshot, HYDRA_STATES),
  { live: 'healthy', stale: 'degraded', unavailable: 'failed', unconfigured: 'degraded' })

module.exports = { createHydraReadings, getHydraHealth }
