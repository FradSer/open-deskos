'use strict'

function stateFrom(sourceState, table, fallback = 'live') {
  for (const [state, cases] of Object.entries(table)) {
    const matched = typeof cases === 'function' ? cases(sourceState) : cases.includes(sourceState)
    if (matched) return state
  }
  return fallback
}
/*
 * What a reading says to a reader.
 *
 * A projection renames and drops; it never computes, rounds or infers. The tile
 * draws a source's own payload, which also carries the things no spoken answer
 * needs and can be misread as: a cover image, firmware and boot detail, vendor
 * status codes, a machine's working directory. A reading keeps the measurements,
 * gives them plain names, and carries the time each was taken so a stale answer
 * cannot be reported as a live one.
 */
const READING_LIMIT = 20
const TEXT_LIMIT = 400
const GOAL_LIMIT = 160

const isoTime = value => (Number.isFinite(value) ? new Date(value).toISOString() : null)

function text(value, limit = TEXT_LIMIT) {
  if (typeof value !== 'string') return value === undefined ? null : value
  return value.length <= limit ? value : `${value.slice(0, limit)}...`
}

const omit = (value, key) => (value === undefined || value === null ? undefined : value[key])

function pick(source, keys) {
  const result = {}
  for (const [key, read] of Object.entries(keys)) {
    const value = read(source)
    if (value !== undefined) result[key] = value
  }
  return result
}

/**
 * What a reading carries when it is not live.
 *
 * An instrument that cannot be read right now has no reading: an empty object
 * beside `unavailable` reads as "there is nothing there", which is a different
 * claim from "nothing could be read". A stale reading is the exception, because
 * its last measurement is the reading and it is marked as the last one.
 */
const measured = (state, value) => (state === 'unavailable' || state === 'unconfigured' ? null : value)


module.exports = { stateFrom, READING_LIMIT, TEXT_LIMIT, GOAL_LIMIT, isoTime, text, omit, pick, measured }
