const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')

test('a stale Electron profile lock exits with failure so the kiosk launcher can recover', () => {
  assert.match(source, /another Open DeskOS Shell instance owns the Electron profile/)
  assert.match(source, /process\.exit\(1\)/)
})
