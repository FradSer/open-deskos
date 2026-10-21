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

function androidPath(relative, start = __dirname) {
  const root = fs.realpathSync(findRepositoryRoot(start))
  const checkout = fs.existsSync(path.join(root, 'runtime', 'shell', 'package.json'))
  const source = path.join(root, ...(checkout ? ['runtime', 'android'] : ['android']))
  const boundary = fs.realpathSync(source)
  const target = fs.realpathSync(path.resolve(source, relative))
  if (boundary !== source || !target.startsWith(boundary + path.sep)) {
    throw new Error('Android source escapes its selected source boundary')
  }
  return target
}

module.exports = { findRepositoryRoot, integrationPath, integrationURL, androidPath }
