'use strict'

const fs = require('node:fs')
const path = require('node:path')

function isRepositoryRoot(dir) {
  const hasPeripherals = fs.existsSync(path.join(dir, 'peripherals', 'esp32-p4-camera'))
  const hasCheckoutRuntime = fs.existsSync(path.join(dir, 'runtime', 'linux', 'package.json'))
  const hasSealedRuntime = fs.existsSync(path.join(dir, 'scripts', 'cm5-install.sh'))
  return hasPeripherals && (hasCheckoutRuntime || hasSealedRuntime)
}

function findRepositoryRoot(start = __dirname) {
  let dir = path.resolve(start)
  while (true) {
    if (isRepositoryRoot(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) throw new Error('repository root not found')
    dir = parent
  }
}

module.exports = { findRepositoryRoot }
