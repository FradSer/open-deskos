'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

function isRepositoryRoot(dir) {
  const hasPeripherals = fs.existsSync(path.join(dir, 'peripherals', 'esp32-p4-camera'))
  const hasCheckoutRuntime = fs.existsSync(path.join(dir, 'runtime', 'shell', 'package.json'))
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

function integrationPath(relative, start = __dirname) {
  return path.join(findRepositoryRoot(start), 'integrations', relative)
}

function integrationURL(relative, start = __dirname) {
  return pathToFileURL(integrationPath(relative, start)).href
}

module.exports = { findRepositoryRoot, integrationPath, integrationURL }
