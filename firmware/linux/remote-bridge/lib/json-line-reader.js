'use strict'

const { StringDecoder } = require('node:string_decoder')

function createJsonLineReader(onLine) {
  const decoder = new StringDecoder('utf8')
  let pending = ''

  return {
    push(chunk) {
      pending += decoder.write(chunk)
      consumeLines()
    },
    end() {
      pending += decoder.end()
      if (pending.length > 0) onLine(pending)
      pending = ''
    },
  }

  function consumeLines() {
    let newlineIndex = pending.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = pending.slice(0, newlineIndex).replace(/\r$/, '')
      pending = pending.slice(newlineIndex + 1)
      if (line.length > 0) onLine(line)
      newlineIndex = pending.indexOf('\n')
    }
  }
}

module.exports = { createJsonLineReader }
