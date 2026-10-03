const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8')

test('smoke completion exits after writing its result instead of waiting for Electron cleanup', () => {
  assert.match(source, /function finishSmoke\(result\)/)
  assert.match(source, /writeSmokeResult\(result\)/)
  assert.match(source, /setTimeout\(\(\) => process\.exit\(result\.ok \? 0 : 1\), 0\)/)
  assert.match(source, /finishSmoke\(\{ ok, width: actual\.width, height: actual\.height \}\)/)
})

test('smoke mode does not construct Remote Bridge socket state', () => {
  assert.match(source, /const smokeMode = process\.argv\.includes\('--smoke'\)/)
  assert.match(source, /if \(!smokeMode\) \{\n    try \{\n      remoteSocketPath = resolveRemoteBridgeSocketPath\(\)/)
  assert.match(source, /if \(!smokeMode\) remoteBridge\.start\(\)/)
})
