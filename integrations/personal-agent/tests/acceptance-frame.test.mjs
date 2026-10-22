import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { observeAcceptanceFrame } from './helpers/acceptance-frame.mjs'

function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.killed = 0
  child.kill = () => { child.killed++; return true }
  return child
}

test('a split Chinese JSON frame completes while the child remains alive', async () => {
  const child = fakeChild()
  const waiting = observeAcceptanceFrame(child, { acceptanceId: 'expected', timeoutMs: 200,
    validate: frame => assert.equal(frame.command, 'status') })
  const bytes = Buffer.from(JSON.stringify({ acceptanceId: 'expected', command: 'status', result: { response: '原会话已执行' } }) + '\n')
  for (const byte of bytes) child.stdout.write(Buffer.from([byte]))
  assert.deepEqual(await waiting, { response: '原会话已执行' })
  assert.equal(child.killed, 1)
})

test('wrong correlation or fixture identity is refused without a second process', async () => {
  for (const invalid of [
    { acceptanceId: 'other', command: 'status', result: { task: { taskId: 'expected' } } },
    { acceptanceId: 'expected', command: 'status', result: { task: { taskId: 'other' } } },
  ]) {
    const child = fakeChild()
    const waiting = observeAcceptanceFrame(child, { acceptanceId: 'expected', timeoutMs: 200,
      validate: frame => assert.equal(frame.result.task.taskId, 'expected') })
    child.stdout.write(JSON.stringify(invalid) + '\n')
    child.emit('close', 0)
    await assert.rejects(waiting)
    assert.equal(child.killed, 1)
  }
})

test('oversized or missing frames fail without replay', async () => {
  for (const input of ['x'.repeat(41), '']) {
    const child = fakeChild()
    const waiting = observeAcceptanceFrame(child, { acceptanceId: 'expected', validate: () => {}, timeoutMs: 25, maxBytes: 40 })
    if (input) child.stdout.write(input)
    await assert.rejects(waiting, /Oversized|timeout/)
    assert.equal(child.killed, 1)
  }
})
