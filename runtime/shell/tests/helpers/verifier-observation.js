'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { MAX_OUTPUT_BYTES } = require('../../src/user-app-verifier')

function createVerifierObserver({ spawnProcess = spawn, watch = fs.watch } = {}) {
  const records = []
  const starts = new WeakMap()
  const closures = []
  const stops = []
  function observedSpawn(executable, args, options) {
    const started = performance.now()
    const record = { events: [], closed: false }
    starts.set(record, started)
    const append = (event, values = {}) => {
      if (record.events.length < 20) record.events.push({ event, elapsedMs: Math.round(performance.now() - started), ...values })
    }
    records.push(record)
    append('requested')
    const resultPath = args[3]
    let watcher, stopped = false, fileObserved = false, stdoutObserved = false, output = Buffer.alloc(0)
    const stop = () => {
      if (stopped) return
      stopped = true
      try { watcher?.close() } catch { append('observer-error') }
      output = Buffer.alloc(0)
    }
    stops.push(stop)
    try {
      watcher = watch(path.dirname(resultPath), (_event, filename) => {
        if (fileObserved || String(filename) !== path.basename(resultPath)) return
        try {
          if (fs.statSync(resultPath).size > MAX_OUTPUT_BYTES) return
          const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'))
          if (typeof result?.ok !== 'boolean') return
          fileObserved = true
          append('file-result', { ok: result.ok })
        } catch { /* A missing or incomplete file does not establish a result. */ }
      })
      watcher.on('error', () => { append('observer-error'); stop() })
    } catch { append('observer-unavailable') }
    let child
    try { child = spawnProcess(executable, args, options) }
    catch (error) { append('spawn-failed'); stop(); throw error }
    closures.push(new Promise(resolve => {
      child.once('close', (code, signal) => {
        append('close', { code, signal })
        record.closed = true
        stop()
        resolve()
      })
    }))
    child.once('spawn', () => append('spawned'))
    child.once('error', () => append('process-error'))
    child.once('exit', (code, signal) => append('exit', { code, signal }))
    child.stdout.on('data', chunk => {
      if (stdoutObserved || stopped || output.length >= MAX_OUTPUT_BYTES) return
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      output = Buffer.concat([output, bytes.subarray(0, MAX_OUTPUT_BYTES - output.length)])
      try {
        const result = JSON.parse(output.toString('utf8').trim().split('\n').filter(Boolean).at(-1))
        if (typeof result?.ok !== 'boolean') return
        stdoutObserved = true
        append('stdout-result', { ok: result.ok })
        output = Buffer.alloc(0)
      } catch { /* Partial output is observation only. The production verifier owns its verdict. */ }
    })
    return child
  }
  return {
    spawnProcess: observedSpawn,
    recordVerdict(result) {
      const record = records.at(-1)
      if (!record || record.events.length >= 20) return
      record.events.push({ event: 'verdict', elapsedMs: Math.round(performance.now() - starts.get(record)),
        outcome: result.ok ? 'accepted' : result.error === 'verification-timeout' ? 'timeout' : 'rejected' })
    },
    snapshot: () => structuredClone(records),
    async close() {
      let timer
      try {
        await Promise.race([Promise.all(closures), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Observed verifier process did not close')), 5000)
        })])
      } finally { clearTimeout(timer); stops.forEach(stop => stop()) }
    },
  }
}

module.exports = { createVerifierObserver }
