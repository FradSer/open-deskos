'use strict'

const { createHydraReadings } = require('./readings/hydra')
const { createWeatherReadings } = require('./readings/weather')
const { createWereadReadings } = require('./readings/weread')
const { createPiSessionReadings } = require('./readings/pi-sessions')
const { createQuotaReadings } = require('./readings/quota')
const { createFutuServiceReadings } = require('./readings/futu')
const { projectCatalog } = require('./readings/catalog')

// Preserve legacy named-source callers. Active source plugins supply factories directly.
function createDefaultSourceReadings({ hydra, weather, weread, piSessions, quota } = {}) {
  return [
    ...createHydraReadings(hydra),
    ...createWeatherReadings(weather),
    ...createWereadReadings(weread),
    ...createPiSessionReadings(piSessions),
    ...createQuotaReadings(quota),
  ]
}

module.exports = { createDefaultSourceReadings, createFutuServiceReadings, projectCatalog }
