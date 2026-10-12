'use strict'

const { pick, READING_LIMIT } = require('./common')

const projectCatalog = apps => ({
  total: apps.length,
  apps: apps.slice(0, READING_LIMIT).map(app => pick(app, {
    id: app => app.id,
    name: app => app.name,
    kind: app => app.kind,
    version: app => app.version,
    placement: app => app.placement ?? null,
  })),
  truncated: apps.length > READING_LIMIT,
})

module.exports = { projectCatalog }
