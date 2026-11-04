'use strict'
const path = require('node:path')
const { spawn } = require('node:child_process')
const { MATRIX_ENV, FULL } = require('../tests/helpers/surface-matrix')

const root = path.resolve(__dirname, '..')
const files = [
  'hydra-surface-electron.test.js',
  'weather-surface-electron.test.js',
  'weread-surface-electron.test.js',
  'hydra-surface-restart.test.js',
  'weather-surface-restart.test.js',
  'weread-surface-restart.test.js',
].map(file => path.join(root, 'tests', file))

// Two workers protect the reference host Mali GPU while the full matrix runs.
function plan() {
  return { mode: FULL, concurrency: 2, files }
}

function main() {
  const selected = plan()
  if (process.argv.includes('--list')) {
    console.log(JSON.stringify(selected))
    return
  }
  console.error(`[test-matrix] full matrix: ${selected.files.length} files, concurrency ${selected.concurrency}`)
  const child = spawn(process.execPath,
    ['--test', `--test-concurrency=${selected.concurrency}`, ...selected.files],
    { cwd: root, stdio: 'inherit', env: { ...process.env, [MATRIX_ENV]: FULL } })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.on('exit', (code, signal) => { process.exitCode = code === null ? (signal ? 1 : 0) : code })
}

if (require.main === module) main()

module.exports = { plan }
