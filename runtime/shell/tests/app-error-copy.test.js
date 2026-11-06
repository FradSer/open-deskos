const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const SHELL_SOURCE = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'shell.js'), 'utf8')

function errorViewSource() {
  const start = SHELL_SOURCE.indexOf('function openRuntimeUnavailable(')
  const end = SHELL_SOURCE.indexOf('function openAppActionError(', start)
  assert.notEqual(start, -1, 'missing openRuntimeUnavailable')
  assert.notEqual(end, -1, 'missing openAppActionError')
  return SHELL_SOURCE.slice(start, end)
}

test('the unavailable App view states the runtime reason without claiming an unchanged foreground', () => {
  const source = errorViewSource()
  assert.match(source, /Runtime returned \$\{reason \|\| 'an unknown error'\}\.\`/)
  assert.doesNotMatch(source, /The foreground App was not changed\./)
})

test('App error and retry status never claim that a request proves completion', () => {
  const start = SHELL_SOURCE.indexOf('function openRuntimeUnavailable(')
  const end = SHELL_SOURCE.indexOf('function openAppActionError(', start)
  const tail = SHELL_SOURCE.indexOf('function runtimeRoot()', end)
  const source = SHELL_SOURCE.slice(end, tail)
  assert.match(source, /result \? 'Action accepted\.' : 'Retry failed\.'/)
  assert.doesNotMatch(source, /Action completed\./)
  assert.doesNotMatch(SHELL_SOURCE.slice(start, tail), /The start request was resubmitted\./)
})
