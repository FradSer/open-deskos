'use strict'

// A canonical string keeps every CSS name/value while avoiding a large IPC object graph.
function serializeComputedStyle(style) {
  return JSON.stringify([...style].sort().map(property => [property, style.getPropertyValue(property)]))
}

module.exports = { serializeComputedStyle }
