'use strict'

const { stateFrom, isoTime, text, measured } = require('./common')
const { sourceHealth } = require('../health')

const WEREAD_STATES = { unconfigured: ['unconfigured'], unavailable: ['loading', 'error'] }
const projectWeread = snapshot => {
  const highlight = snapshot?.highlight
  if (!highlight) return { asOf: isoTime(snapshot?.updatedAt) ?? undefined, book: null, highlight: null }
  return {
    asOf: isoTime(snapshot?.updatedAt) ?? undefined,
    book: { title: highlight.title ?? null, author: highlight.author ?? null },
    // A cover is a picture, not a reading: it is dropped rather than shortened.
    highlight: { text: text(highlight.markText), chapterRange: highlight.range ?? null },
  }
}

function createWereadReadings(weread) {
  if (!weread?.refresh) return []
  return [{
    id: 'odk.tile.weread',
    home: { mode: 'optional', priority: 0, icon: 'reading', fields: ['book', 'highlight'] },
    label: 'WeRead highlight',
    kind: 'tile',
    read: async () => {
      const snapshot = await weread.refresh()
      const state = stateFrom(snapshot?.status, WEREAD_STATES)
      return { state, value: measured(state, projectWeread(snapshot)), updatedAt: snapshot?.updatedAt }
    },
  }]
}

const getWereadHealth = source => sourceHealth(source, snapshot => snapshot?.status,
  { live: 'healthy', empty: 'healthy', loading: 'degraded', unconfigured: 'degraded', error: 'failed' })

module.exports = { createWereadReadings, getWereadHealth }
