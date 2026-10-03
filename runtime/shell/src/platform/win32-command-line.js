'use strict'

/**
 * Split a Windows command line the way the platform does, not on whitespace.
 * A quoted path with spaces is one argument, and a backslash only ever escapes
 * the quote that follows it when its run is odd — the rule that makes
 * `"C:\dir\"` swallow what follows it, which is why a path ending in a
 * backslash must be written with two.
 *
 * This lives apart from the process reader because two callers need the same
 * rule: the reader that receives a command line, and the shell that decides
 * whether that command line is a Pi invocation.
 */
function tokenizeWindowsCommandLine(value) {
  if (!value || typeof value !== 'string') return []
  const tokens = []
  let current = ''
  let started = false
  let inQuotes = false
  let index = 0
  while (index < value.length) {
    const char = value[index]
    if (char === '\\') {
      let backslashes = 0
      while (index < value.length && value[index] === '\\') {
        backslashes += 1
        index += 1
      }
      if (index < value.length && value[index] === '"') {
        current += '\\'.repeat(Math.floor(backslashes / 2))
        if (backslashes % 2 === 1) current += '"'
        else inQuotes = !inQuotes
        started = true
        index += 1
      } else {
        current += '\\'.repeat(backslashes)
        started = true
      }
      continue
    }
    if (char === '"') {
      inQuotes = !inQuotes
      started = true
      index += 1
      continue
    }
    if (!inQuotes && (char === ' ' || char === '\t')) {
      if (started) tokens.push(current)
      current = ''
      started = false
      index += 1
      continue
    }
    current += char
    started = true
    index += 1
  }
  if (started) tokens.push(current)
  return tokens
}

module.exports = { tokenizeWindowsCommandLine }