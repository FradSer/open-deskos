const fs = require('node:fs')
const execute = require('node:util').promisify(require('node:child_process').execFile)

async function wait(promise, signal) {
  let cancel
  const aborted = new Promise((_, reject) => { cancel = () => reject(signal.reason || Error('Wire test cancelled')) })
  if (signal.aborted) cancel()
  else signal.addEventListener('abort', cancel, { once: true })
  try { return await Promise.race([promise, aborted]) }
  finally { signal.removeEventListener('abort', cancel) }
}

async function cleanup(host, broker, root, signal) {
  let failure
  try { await wait(host?.stop() || Promise.resolve(), signal) } catch (error) { failure = error }
  await broker?.stop()
  fs.rmSync(root, { recursive: true, force: true })
  if (failure) throw failure
}

async function runCommand(executable, args, options) {
  const operation = execute(executable, args, { ...options, killSignal: 'SIGKILL' })
  const closed = operation.child ? new Promise(resolve => operation.child.once('close', resolve)) : Promise.resolve()
  try { return await operation } finally { await closed }
}

function fixtureRejection(error, expected) {
  return error.code === 1 && error.signal === null && error.killed === false
    && expected.test(error.stderr || '')
}

module.exports = { wait, cleanup, runCommand, fixtureRejection }
