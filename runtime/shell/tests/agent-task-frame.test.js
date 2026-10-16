const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseAgentTasks } = require('../src/agent-task-frame')
const task = { taskId: '64a7f377-3169-447c-9b85-547a2454c28f', identity: { id: 'reporter', name: '<script>Reporter 中文</script>', avatar: 'book', revision: 'a'.repeat(64) }, state: 'running', updatedAt: '2026-10-16T00:00:00.000Z' }
test('child activity frames preserve only bounded identities and observed lifecycle metadata', () => {
  assert.deepEqual(parseAgentTasks({ state: 'live', tasks: [{ ...task, request: 'private input', memory: 'private note' }] }), { state: 'live', tasks: [task] })
  for (const invalid of [undefined, {}, { state: 'live', tasks: Array(5).fill(task) }, { state: 'live', tasks: [task, task] },
    ...[{ ...task, state: 'finished' }, { ...task, taskId: '../escape' }, { ...task, identity: { ...task.identity, avatar: 'https://example.invalid/avatar' } },
      { ...task, identity: { ...task.identity, name: 'x'.repeat(121) } }].map(value => ({ state: 'live', tasks: [value] }))]) {
    assert.deepEqual(parseAgentTasks(invalid), { state: 'unavailable', tasks: [] })
  }
})
