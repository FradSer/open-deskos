'use strict'

const { createPersonalAgentReadingSource } = require('../personal-agent-readings')
const READING_PORT = 'odk:desk-service-readings/personal-agent/v1'

/** A source plugin bridges declared producer projections, not resident internals. */
function createPersonalAgentReadingsPlugin() {
  return {
    manifest: { schemaVersion: 1, id: 'odk.source.personal-agent-readings', name: 'Personal Agent source readings', version: '1.0.0',
      kind: 'service', host: 'electron-main', provides: [{ interface: READING_PORT }], requires: [], permissions: ['source.personal-agent-readings'] },
    create(ctx) {
      const config = ctx.capability('source.personal-agent-readings')
      const source = createPersonalAgentReadingSource({ ...config, signal: ctx.signal })
      ctx.onCleanup(() => source.close())
      return { ports: { [READING_PORT]: source }, start: () => source.refresh() }
    },
  }
}
module.exports = { createPersonalAgentReadingsPlugin, READING_PORT }
