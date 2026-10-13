'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

test('preview retains its failure exit when Windows holds the temporary profile', () => {
  const source = fs.readFileSync(path.join(__dirname, 'home-preview.cjs'), 'utf8')
  const finish = source.slice(source.indexOf('function finish('), source.indexOf('\nfunction capturePaintedFrame('))
  let destroyed = false
  let exitCode
  const locked = Object.assign(new Error('Temporary profile is locked'), { code: 'EPERM' })
  const context = { clearTimeout() {}, timeout: 1, win: { destroy() { destroyed = true } }, profile: '/temporary-preview',
    fs: { rmSync() { throw locked } }, console: { error() {} }, app: { exit(code) { exitCode = code } } }
  vm.runInNewContext(finish + '\nfinish(1, new Error("Preview assertion failed"))', context)
  assert.equal(destroyed, true)
  assert.equal(exitCode, 1)
})
