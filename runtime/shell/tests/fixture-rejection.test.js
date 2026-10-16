const test = require('node:test')
const assert = require('node:assert/strict')
const { fixtureRejection } = require('./helpers/hydra-wire-lifecycle')
const { promisify } = require('node:util')
const execute = promisify(require('node:child_process').execFile)
const marker = /Controlled fixture rejection/

test('a normal child failure can establish its deliberate rejection', async () => {
  await assert.rejects(execute(process.execPath, ['-e', "console.error('Controlled fixture rejection');process.exit(1)"]),
    error => fixtureRejection(error, marker))
})

test('a killed child cannot establish deliberate rejection from matching stderr', async () => {
  const operation = execute(process.execPath, ['-e', "console.error('Controlled fixture rejection');setInterval(()=>{},1000)"])
  operation.child.stderr.once('data', () => operation.child.kill('SIGKILL'))
  await assert.rejects(operation, error => {
    assert.equal(error.signal, 'SIGKILL')
    assert.equal(fixtureRejection(error, marker), false)
    return true
  })
})

test('a wrong message or process outcome cannot establish rejection', () => {
  const ordinary = { code: 1, signal: null, killed: false, stderr: 'Controlled fixture rejection' }
  assert.equal(fixtureRejection(ordinary, /Other boundary/), false)
  for (const change of [{ code: 0 }, { code: 'ABORT_ERR' }, { killed: true }, { signal: 'SIGTERM' }]) {
    assert.equal(fixtureRejection({ ...ordinary, ...change }, marker), false)
  }
})


for (const [control, mode, message] of [['missing', 'built-in', 'Selected Renderer control missing'],
  ['default', 'missing-tick', 'Clock Tick subscription changed']]) {
  test(`Clock Main ${control}/${mode} negative guard requires its own failure exit`, async () => {
    const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
    const source = fs.readFileSync(path.join(__dirname, 'clock-main-bootstrap.test.js'), 'utf8')
    const start = source.indexOf("        if (control === 'missing-bridge') await assert.rejects(launch,")
    const end = source.indexOf('        else {', start)
    assert.ok(start >= 0 && end > start)
    const run = error => vm.runInNewContext(`(async()=>{${source.slice(start, end)}})()`, {
      control, mode, launch: Promise.reject(error), assert, fixtureRejection,
    })
    await run(Object.assign(Error(message), { code: 1, killed: false, signal: null, stderr: message }))
    await assert.rejects(run(Object.assign(Error(message), { code: null, killed: true, signal: 'SIGKILL', stderr: message })),
      { code: 'ERR_ASSERTION' })
  })
}
