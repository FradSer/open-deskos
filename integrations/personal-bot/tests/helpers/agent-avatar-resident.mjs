import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { randomUUID } from 'node:crypto'
import { createPersonalBot } from '../../src/agent.mjs'
import { PersonalBotService } from '../../src/service.mjs'
import { listen } from '../../src/socket.mjs'
import { assistant, fixtureModel } from './pi-fixture.mjs'

// This process receives only a private test environment. No operator model or Jev configuration is used.
const [directory, endpoint] = process.argv.slice(2)
const emit = value => process.stdout.write(`${JSON.stringify(value)}\n`)
await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true, mode: 0o700 })
await writeFile(join(process.env.PI_CODING_AGENT_DIR, 'settings.json'), JSON.stringify({
  retry: { enabled: false }, compaction: { enabled: false }, cacheWarming: 'off',
}), { mode: 0o600 })
let bot, service, server, release
const runtime = {
  getAvailable: async () => [fixtureModel], getModel: () => fixtureModel,
  streamSimple: (_model, context) => {
    const result = Promise.resolve().then(async () => {
      const message = context.messages.findLast(value => value.role === 'user')
      const text = typeof message?.content === 'string' ? message.content : message?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
      if (text.includes('Host-admitted workflow: agent_execute')) {
        const gate = Promise.withResolvers()
        release = gate.resolve
        emit({ type: 'child_started' })
        await gate.promise
        return assistant('Three synthetic measurements checked.')
      }
      if (context.messages.at(-1).role !== 'toolResult') return assistant([{ type: 'toolCall', id: `start-${randomUUID()}`, name: 'codemode',
        arguments: { code: 'text(await tools.agent_start({request:"Read the three supplied synthetic measurements.",identityId:"reporter"}));' },
      }], 'toolUse')
      assert.equal(context.messages.at(-1).isError, false)
      return assistant('Reporter accepted the task. Its result is pending.')
    })
    return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
  },
}
const config = { stateDir: join(directory, 'state'), env: {}, onAgentUpdate: tasks => service.publishAgents(tasks), personal: {
  profile: 'personal', skillPaths: [], memoryFile: join(directory, 'notes.json'), agentPlugins: { enabled: ['subagents'] },
} }
const dependencies = { createRuntime: async () => runtime, createIntentRouter: () => async () => ({ intent: 'agent_work' }) }
async function connect() {
  server = await listen(endpoint, service, { tokenFile: join(directory, 'channel.token') })
}
async function start() {
  service = new PersonalBotService({ record: async () => { throw Error('Capture is unavailable in this fixture') },
    transcribe: async () => { throw Error('Transcription is unavailable in this fixture') }, prompt: (text, onSnapshot) => bot.prompt(text, onSnapshot),
  })
  bot = await createPersonalBot(config, dependencies)
  if (process.argv.includes('--resume')) {
    assert(bot.agentTasks.identities().some(identity => identity.id === 'reporter'), 'Saved reporter is missing after restart')
    assert(bot.agentTasks.list().tasks.some(task => task.identity?.id === 'reporter' && task.state === 'finished'), 'Saved task history is missing after restart')
  } else {
    assert.equal(bot.agentTasks.identities().length, 0, 'Initial fixture storage must be empty')
    bot.agentTasks.saveIdentity({ id: 'reporter', name: 'Reporter 中文', avatar: 'book', role: 'Check only supplied synthetic measurements.' })
  }
  service.publishAgents(bot.agentTasks.activity())
  await connect()
  emit({ type: 'ready', pid: process.pid, identity: bot.agentTasks.identities()[0], tasks: bot.agentTasks.list().tasks })
}
async function stop() {
  release?.()
  await server?.close(); server = undefined
  await bot?.close(); bot = undefined
  await service?.close(); service = undefined
}
try {
  await start()
  for await (const line of createInterface({ input: process.stdin })) {
    const command = JSON.parse(line)
    if (command.type === 'release' || command.type === 'cancel') {
      const [task] = bot.agentTasks.activity()
      assert(task, 'An active child is required')
      if (command.type === 'cancel') { bot.agentTasks.cancel(task.taskId); emit({ type: 'cancelling', taskId: task.taskId }); continue }
      release()
      emit({ type: 'child_finished', task: await bot.agentTasks.wait(task.taskId) })
    } else if (command.type === 'disconnect') {
      await server.close(); server = undefined
      emit({ type: 'disconnected' })
    } else if (command.type === 'connect') {
      await connect(); emit({ type: 'connected' })
    } else if (command.type === 'close') {
      if (process.argv.includes('--stall-close')) { process.on('SIGTERM', () => {}); await new Promise(() => {}) }
      break
    }
    else throw Error('Unknown fixture command')
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally { await stop() }
