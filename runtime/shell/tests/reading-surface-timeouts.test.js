'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

for (const name of ['weather', 'weread']) {
  const { surfaceTimeouts } = require(`./helpers/${name}-selection`)
  for (const platform of ['linux', 'win32', 'darwin']) {
    test(`${name} complete matrix has explicit ${platform} budgets`, () => {
      assert.deepEqual(surfaceTimeouts(platform), platform !== 'linux'
        ? { fixture: 45000, child: 55000, test: 60000, revisions: 180000 }
        : name === 'weather'
          ? { fixture: 75000, child: 85000, test: 120000, revisions: 360000 }
          : { fixture: 90000, child: 100000, test: 130000, revisions: 420000 })
    })
    for (const restartVersion of [undefined, '2.0.0']) {
      test(`${name} ${platform} fixture wires ${restartVersion ? 'source revision' : 'complete matrix'} budget`, () => {
        const source = fs.readFileSync(path.join(__dirname, `${name}-plugin-electron.cjs`), 'utf8')
        const statement = source.split('\n').find(line => line.startsWith('const deadline = setTimeout('))
        let delay
        vm.runInNewContext(statement, { surfaceTimeouts: () => surfaceTimeouts(platform), restartVersion, process: { platform },
          setTimeout(_callback, milliseconds) { delay = milliseconds }, finish() {} })
        assert.equal(delay, restartVersion || platform !== 'linux' ? 45000 : name === 'weather' ? 75000 : 90000)
      })
    }
  }
  for (const suffix of ['electron', 'surface-electron', 'surface-restart']) {
    test(`${name} ${suffix} parent wires its aggregate and child budgets`, () => {
      const source = fs.readFileSync(path.join(__dirname, `${name}-${suffix}.test.js`), 'utf8')
      assert.match(source, /timeout: surfaceTimeouts\(\)\.child/)
      assert.match(source, suffix === 'surface-restart'
        ? /timeout: surfaceTimeouts\(\)\.revisions/ : /timeout: surfaceTimeouts\(\)\.test/)
    })
  }
}
