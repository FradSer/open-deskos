'use strict'

const fs = require('node:fs/promises')

async function writeMarker(file, value) {
  await fs.writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 })
  await fs.rename(`${file}.tmp`, file)
}

async function readMarker(file, { signal, outcome } = {}) {
  let active = true
  const read = async () => {
    const deadline = Date.now() + 10000
    while (active) {
      signal?.throwIfAborted()
      try { return JSON.parse(await fs.readFile(file, 'utf8')) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (Date.now() >= deadline) throw Error('Camera runtime checkpoint timed out')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    throw Error('Camera runtime checkpoint cancelled')
  }
  try {
    const exited = outcome?.then(({ error }) => { throw error || Error('Camera process exited before its checkpoint') })
    return await (exited ? Promise.race([read(), exited]) : read())
  } finally { active = false }
}

// This self-contained function also runs in the document before services are published.
function installSubscriptionTracker(root) {
  root.cameraTrackedSubscriptions = 0
  let services
  Object.defineProperty(root, 'odkServices', { configurable: true, enumerable: true,
    get() { return services },
    set(value) {
      const subscribe = value.camera.subscribe
      value.camera.subscribe = listener => {
        if (root.cameraTrackedSubscriptions !== 0) throw Error('Previous Camera subscription retained')
        root.cameraTrackedSubscriptions++
        const release = subscribe.call(value.camera, listener)
        let released = false
        return () => {
          if (released) return
          release()
          released = true
          root.cameraTrackedSubscriptions--
        }
      }
      services = value
    },
  })
}

module.exports = { readMarker, writeMarker, installSubscriptionTracker }
