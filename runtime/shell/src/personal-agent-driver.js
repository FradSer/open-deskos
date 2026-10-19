const fs = require('node:fs')
const path = require('node:path')

/**
 * A development frame source for the Personal Agent link.
 *
 * The desk owns generation, so this source lives on the desk too: a phone never
 * carries a fixture. The source publishes the states the resident cannot produce
 * on demand, and the desk marks every frame it produces as development, so a
 * reviewed state is never presented as personal activity.
 *
 * Selection is explicit and file-based: `selected` in the fixture directory
 * names one state, and the phone follows it. Without that file the source walks
 * the fixture order on its own interval.
 */

const MAX_SELECTED_BYTES = 1024

function readStates(fixtureFile) {
  const raw = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
  const states = raw?.states
  if (!states || typeof states !== 'object' || Object.keys(states).length === 0) {
    throw new Error('the Personal Agent development fixture holds no states')
  }
  return states
}

function createPersonalAgentDriver({ fixtureFile, selectedFile = null, intervalMs = 0, replyDelayMs = 1200 } = {}) {
  if (typeof fixtureFile !== 'string' || !path.isAbsolute(fixtureFile)) {
    throw new Error('the Personal Agent development source requires an absolute fixture path')
  }
  const states = readStates(fixtureFile)
  const names = Object.keys(states)
  const listeners = new Set()
  let index = 0
  let status = states[names[0]]
  let selected = null
  let timer = null
  let pollTimer = null
  let replyTimer = null

  function publish(next) {
    status = next
    for (const listener of [...listeners]) {
      try { listener(status) } catch { /* one failed reader must not stop the others */ }
    }
  }

  function select(name) {
    if (typeof name !== 'string' || !Object.hasOwn(states, name)) return false
    selected = name
    index = names.indexOf(name)
    publish(states[name])
    return true
  }

  function advance() {
    index = (index + 1) % names.length
    publish(states[names[index]])
  }

  function readSelection() {
    if (!selectedFile) return
    let value = ''
    try {
      const info = fs.statSync(selectedFile)
      if (!info.isFile() || info.size > MAX_SELECTED_BYTES) return
      value = fs.readFileSync(selectedFile, 'utf8').trim()
    } catch {
      return
    }
    if (value.length > 0 && value !== selected) select(value)
  }

  function start() {
    if (selectedFile) {
      readSelection()
      // The selection is watched for the whole life of the source. A file that
      // already names a state must still follow a later change.
      pollTimer = setInterval(readSelection, 500)
    } else if (intervalMs > 0) {
      timer = setInterval(advance, intervalMs)
    }
  }

  function stop() {
    if (timer) clearInterval(timer)
    if (pollTimer) clearInterval(pollTimer)
    if (replyTimer) clearTimeout(replyTimer)
    timer = null
    pollTimer = null
    replyTimer = null
    listeners.clear()
  }

  return {
    stateNames: names,
    start,
    stop,
    subscribe(listener) {
      listeners.add(listener)
      listener(status)
      return () => listeners.delete(listener)
    },
    async snapshot() {
      // The state is only ever produced by the selection watch or by a turn, so a
      // reader cannot apply a pending selection over an in-flight turn.
      return status
    },
    /**
     * A submitted turn is answered from the fixture, so the composer flow is
     * reviewable without a resident. The reply is a scripted state, never a
     * generated answer, and the desk marks every frame it publishes as
     * development state.
     */
    async sendText(text, replyTo) {
      // This labelled fixture cannot establish a real session-bound reply.
      if (replyTo !== undefined) return false
      const transcript = typeof text === 'string' ? text : ''
      publish({ ...states[names[index]], state: 'thinking', transcript, message: '' })
      if (replyTimer) clearTimeout(replyTimer)
      replyTimer = setTimeout(() => {
        const reply = states['idle-reply'] ?? status
        publish({ ...reply, transcript })
      }, replyDelayMs)
      // The resident answers a boolean receipt, so this source answers one too.
      return true
    },
  }
}

module.exports = { createPersonalAgentDriver }