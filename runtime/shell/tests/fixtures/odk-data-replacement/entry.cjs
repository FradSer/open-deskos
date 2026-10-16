'use strict'

const { createShellOdkData } = require('./odk-data')
const manifest = require('./manifest.json')
const CATALOG = 'odk:system/package-catalog/v1'
const PORT = 'odk:system/data/v1'
const readingPorts = manifest.requires.map(port => port.interface).filter(port => port.startsWith('odk:desk-reading/'))
const servicePorts = manifest.requires.map(port => port.interface).filter(port => port.startsWith('odk:desk-service-readings/'))
let registry

exports.create = ctx => {
  const config = ctx.capability('desk.data')
  const data = createShellOdkData({ registry, store: ctx.get(CATALOG), signal: ctx.signal, onUpdate: config.onUpdate,
    readings: readingPorts.flatMap(port => {
      const readings = ctx.get(port)
      if (readings === null) return []
      if (!Array.isArray(readings)) throw Error(`invalid reading port ${port}`)
      return readings
    }),
    serviceReadings: () => servicePorts.flatMap(port => {
      const provider = ctx.get(port)
      if (provider === null) return []
      if (typeof provider.readings !== 'function') throw Error(`invalid service reading port ${port}`)
      const readings = provider.readings()
      if (!Array.isArray(readings)) throw Error(`invalid service reading declarations ${port}`)
      return readings
    }),
  })
  registry = data.registry
  return { ports: { [PORT]: data }, async start() {
    if (!config.smokeMode) await data.syncPackages({ preserveUnchanged: true })
  } }
}
