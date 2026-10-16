import { createHash } from 'node:crypto'
import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { loadTargets, taskRequest } from '../task-client.mjs'
import { validateCompletion } from './completion.mjs'

const hash = text => 'sha256:' + createHash('sha256').update(text).digest('hex')
const DIGEST = /^sha256:[a-f0-9]{64}$/
const READS = new Set(['read', 'grep', 'find', 'ls', 'tool_search'])
const LIMITATIONS = 'Historical task evidence only. Matching source samples are not an immutable checkout, current source verification, test adequacy, or physical acceptance.'
const review = () => ({ status: 'needs_review', summary: 'The finished task lacks complete, stable, supported verification evidence.', checks: [] })

function stableTask(task, identity) {
  if (!task || task.taskId !== identity.taskId || task.project !== identity.project || task.turnOutcome !== 'finished'
    || !['settled', 'finished'].includes(task.state) || !['live', 'ended'].includes(task.lifecycle)
    || task.activity === 'working' || task.currentTurnId || typeof task.prompt !== 'string' || !task.prompt.trim()
    || typeof task.response !== 'string' || !task.response.trim() || typeof task.updatedAt !== 'string') throw Error('Task is not finished')
  return JSON.stringify(task)
}

function checkReceipt(event, project, index) {
  const check = event.codingCheck
  if (!check || check.version !== 1 || check.toolCallId !== event.toolCallId || check.cwd !== project
    || check.toolCallIdTruncated !== false || check.commandTruncated !== false || check.cwdTruncated !== false
    || typeof check.command !== 'string' || !check.command.trim() || check.commandScrubbed
    || check.toolCallIdDigest !== hash(check.toolCallId) || check.commandDigest !== hash(check.command) || check.cwdDigest !== hash(check.cwd)
    || check.sourceScheme?.id !== 'git-worktree-sha256-v1' || typeof check.sourceScheme.stability !== 'string'
    || typeof check.sourceScheme.outsideSource !== 'string' || check.sourceBinding !== 'matching'
    || check.before?.status !== 'available' || check.after?.status !== 'available' || !DIGEST.test(check.before.digest)
    || check.before.digest !== check.after.digest || event.truncated || event.isError !== false
    || check.outcome !== 'exited' || check.exitCode !== 0) throw Error('Unsupported check evidence')
  const text = JSON.stringify({ codingCheck: check, output: event.text })
  if (Buffer.byteLength(text) > 32768) throw Error('Check evidence exceeds its budget')
  return { id: `check-${index}`, tool: 'coding_check', status: 'succeeded', text, truncated: false, sourceDigest: check.after.digest }
}

function completionReceipts(events, task) {
  if (events.some(event => event.truncated)) throw Error('History is incomplete')
  const users = events.filter(event => event.kind === 'user')
  if (!users.length || users[0].text !== task.prompt.trim() || events.findLast(event => event.kind === 'assistant')?.text !== task.response.trim()) throw Error('Task history does not match its request and result')
  const latest = events.findLastIndex(event => event.kind === 'user')
  let checks = []
  const pending = new Map(), results = new Set()
  for (const event of events.slice(latest + 1)) {
    if (!['tool', 'result'].includes(event.kind)) continue
    const name = event.toolName
    if (typeof event.toolCallId !== 'string' || !event.toolCallId || typeof name !== 'string') throw Error('Tool identity is missing')
    if (event.kind === 'tool') {
      if (pending.has(event.toolCallId) || results.has(event.toolCallId)) throw Error('Duplicate tool identity')
      pending.set(event.toolCallId, name)
    } else {
      if (results.has(event.toolCallId) || (event.parentToolCallId ? !pending.has(event.parentToolCallId) : pending.get(event.toolCallId) !== name)) throw Error('Tool result has no matching call')
      results.add(event.toolCallId)
      pending.delete(event.toolCallId)
    }
    if (name === 'coding_check') {
      if (event.kind === 'result') {
        // A failed or unavailable check cannot reuse an earlier passing check.
        try { checks.push(checkReceipt(event, task.project, checks.length + 1)) } catch { checks = [] }
      }
    } else if (name === 'codemode' && event.kind === 'result') {
      // Do not infer nested execution from a script's printed output or prose.
      const nested = event.nestedCalls
      if (event.isError !== false || !nested?.complete || !Array.isArray(nested.calls) || !nested.calls.length
        || nested.calls.some(call => call.status !== 'ok' || (!READS.has(call.name) && call.name !== 'coding_check'))
        || nested.calls.some(call => call.name === 'coding_check' && !checks.some(receipt => JSON.parse(receipt.text).codingCheck.toolCallId === call.id))) checks = []
    } else if (name !== 'codemode' && !READS.has(name)) checks = []
  }
  if (pending.size || !checks.length || checks.length > 16 || checks.some(receipt => receipt.sourceDigest !== checks.at(-1).sourceDigest)) throw Error('No final candidate checks')
  return { receipts: checks, instructions: users.map(event => event.text) }
}

/** Read-only host-owned final-result check. No task command or mutation is replayed. */
export function createHostedCompletionTool({ targets, request = taskRequest, infer }) {
  return defineTool({ name: 'coding_task_verify', label: 'Check finished coding task', exposure: 'codemode', executionMode: 'sequential',
    description: 'Independently check a finished Hosted Pi result against its original request, later instructions and host coding_check records. Reads bounded status/history only; never executes commands or retries work. Running, unsupported native endpoints or incomplete evidence require review. Reports historical evidence, not the current checkout or physical acceptance. Pass the exact target/project/taskId reported by coding_tasks_list.',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    namespace: { name: 'hosted_pi', description: 'Configured Hosted Pi identities and bounded result verification.' },
    parameters: Type.Object({ target: Type.Union([Type.Literal('cm5'), Type.Literal('mac')]), project: Type.String({ minLength: 1 }),
      taskId: Type.String({ pattern: '^[0-9a-fA-F-]{36}$' }) }, { additionalProperties: false }),
    outputSchema: Type.Record(Type.String(), Type.Unknown()),
    execute: async (_id, identity, signal) => {
      signal?.throwIfAborted()
      let verification = review(), receipts = []
      try {
        const configured = targets ?? await loadTargets()
        const target = configured.find(target => target.id === identity.target)
        if (!target) throw Error('Target is unavailable')
        const readSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000)
        const read = async (command, extra = {}) => {
          readSignal.throwIfAborted()
          const value = await request(target, { project: identity.project, taskId: identity.taskId, command, ...extra }, readSignal)
          readSignal.throwIfAborted()
          return value
        }
        const { task } = await read('status')
        const fingerprint = stableTask(task, identity)
        let position = 0, boundary, bytes = 0
        const events = []
        for (let page = 0; page < 32; page++) {
          const response = await read('history', { position })
          if (stableTask(response.task, identity) !== fingerprint) throw Error('Task changed')
          const history = response.history
          if (!history || !Number.isSafeInteger(history.boundary) || history.boundary < position || !Array.isArray(history.events)
            || (boundary !== undefined && boundary !== history.boundary)) throw Error('History changed')
          boundary = history.boundary
          bytes += Buffer.byteLength(JSON.stringify(history.events))
          if (bytes > 262144) throw Error('History exceeds its budget')
          let last = position
          for (const batch of history.events) {
            if (!Number.isSafeInteger(batch.position) || batch.position <= last || batch.position > boundary || !Array.isArray(batch.events)
              || batch.events.some(event => !event || typeof event.kind !== 'string' || typeof event.text !== 'string')) throw Error('Invalid history page')
            last = batch.position
            events.push(...batch.events)
          }
          if (history.continuation === null) break
          if (!Number.isSafeInteger(history.continuation) || history.continuation <= position || history.continuation < last
            || history.continuation >= boundary || page === 31) throw Error('History is incomplete')
          position = history.continuation
        }
        const collected = completionReceipts(events, task)
        if (stableTask((await read('status')).task, identity) !== fingerprint) throw Error('Task changed')
        const input = { request: task.prompt, answer: task.response, receipts: collected.receipts,
          hostedTask: { ...identity, instructions: collected.instructions, history: events, limitations: LIMITATIONS } }
        verification = validateCompletion(await infer('completion', input, signal), collected.receipts)
        if (verification.checks.some(check => check.scope === 'admission')) throw Error('Final checks cannot certify admission')
        signal?.throwIfAborted()
        // Inference can take time. Withdraw the result if the task changed meanwhile.
        const after = await request(target, { command: 'status', project: identity.project, taskId: identity.taskId }, signal)
        signal?.throwIfAborted()
        if (stableTask(after.task, identity) !== fingerprint) throw Error('Task changed during verification')
        if (verification.status === 'passed') receipts = collected.receipts
      } catch {
        signal?.throwIfAborted()
        verification = review()
      }
      const value = { ...identity, verification, limitations: LIMITATIONS }
      return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, details: { completionReceipts: receipts } }
    },
  })
}
