'use strict'

const path = require('node:path')

// The in-repo addon is built against Electron's ABI into its own directory: it
// is not an npm dependency, so it never appears under `node_modules`.
const DEFAULT_MODULE_PATH = path.join(__dirname, '..', '..', 'native', 'odk-process', 'build', 'Release', 'odk_process.node')

/**
 * Load the Windows process reader if it is there and usable.
 *
 * The module is optional by design: a host that never built it keeps a working
 * desk with a smaller truth, so a missing file, a failed load, or a module that
 * exposes nothing is reported instead of thrown.
 */
function createNativeProcessReader({ modulePath = DEFAULT_MODULE_PATH, requireImpl = require } = {}) {
  let loaded = null
  try {
    loaded = requireImpl(modulePath)
  } catch (error) {
    return { reader: null, reason: `process reader unavailable: ${error.code || error.message}` }
  }
  if (!loaded || typeof loaded.listProcesses !== 'function') {
    return { reader: null, reason: 'process reader unavailable: it does not expose listProcesses' }
  }
  return { reader: loaded, reason: '' }
}

module.exports = { createNativeProcessReader, DEFAULT_MODULE_PATH }