import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createTaskDaemon } from '../src/task-daemon.mjs'

test('constructing and closing a task daemon starts no resources', async () => {
  const previous = process.umask()
  try {
    const daemon = createTaskDaemon({ roots: [], stateDir: '/unused-task-state', socketPath: '/unused-task-control' })
    assert.ok(daemon.pluginCatalog().every(entry => entry.state === 'registered'))
    assert.equal(await daemon.close(), undefined)
  } finally { process.umask(previous) }
})

test('the CLI registers shutdown before it starts task plugins', async () => {
  const source = await readFile(new URL('../src/task-daemon.mjs', import.meta.url), 'utf8')
  const entry = source.slice(source.indexOf('if (isEntryPoint())'))
  assert.ok(entry.indexOf("process.once('SIGTERM'") < entry.indexOf('await daemon.start()'))
  assert.ok(entry.indexOf("process.once('SIGINT'") < entry.indexOf('await daemon.start()'))
})
