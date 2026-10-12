'use strict'

const { StringDecoder } = require('node:string_decoder')

// Existing protocol readers preserve their record lengths. New bounded channels
// must select a byte limit explicitly. The limit includes CR and excludes LF.
function createJsonLineReader(onLine, { maxBytes } = {}) {
  if (maxBytes !== undefined && (!Number.isSafeInteger(maxBytes) || maxBytes <= 0)) throw TypeError('line byte limit must be a positive integer')
  let decoder = new StringDecoder('utf8')
  let pending = ''
  let pendingBytes = 0
  let discarding = false

  function reset() {
    decoder = new StringDecoder('utf8')
    pending = ''
    pendingBytes = 0
    discarding = false
  }

  function finish(trimCarriageReturn) {
    const line = discarding ? '' : pending + decoder.end()
    reset()
    const result = trimCarriageReturn ? line.replace(/\r$/, '') : line
    if (result.length > 0) onLine(result)
  }

  return {
    push(chunk) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      let offset = 0
      while (offset < bytes.length) {
        const newline = bytes.indexOf(10, offset)
        const end = newline === -1 ? bytes.length : newline
        if (!discarding) {
          const length = end - offset
          if (maxBytes !== undefined && pendingBytes + length > maxBytes) {
            // Drop before decoding; a single large read cannot create a large string.
            pending = ''
            pendingBytes = 0
            decoder = new StringDecoder('utf8')
            discarding = true
          } else {
            pending += decoder.write(bytes.subarray(offset, end))
            pendingBytes += length
          }
        }
        if (newline === -1) return
        finish(true)
        offset = newline + 1
      }
    },
    end() {
      finish(false)
    },
  }
}

module.exports = { createJsonLineReader }
