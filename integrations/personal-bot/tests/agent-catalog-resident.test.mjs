import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, mkdir, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPersonalBot } from '../src/agent.mjs'
import { openAgentCatalog } from '../src/agent-catalog/catalog.mjs'
import { loadPersonalConfig } from '../src/personal-config.mjs'
import { assistant, fixtureModel, visibleTools } from './helpers/pi-fixture.mjs'
import { isolateAgentDirectory } from './helpers/agent-directory.mjs'

async function fixture(t, enabled = ['catalog']) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-catalog-resident-')))
  await isolateAgentDirectory(t, root)
  t.after(() => rm(root, { recursive: true, force: true }))
  const candidates = join(root, 'candidates')
  await mkdir(join(candidates, 'report-helper'), { recursive: true })
  await writeFile(join(candidates, 'report-helper', 'SKILL.md'), '---\nname: report-helper\ndescription: Prepare measured reports.\n---\nRead checks.md.')
  await writeFile(join(candidates, 'report-helper', 'checks.md'), 'Check every requested region.')
  return { root, candidates, config: { stateDir: join(root, 'state'), personal: { profile: 'personal', skillPaths: [], memoryFile: join(root, 'notes.json'), agentPlugins: { enabled } },
    env: { ODK_AGENT_PACKAGE_CANDIDATES: candidates } } }
}

function runtime(reply) {
  return { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel,
    streamSimple: (_model, context) => {
      const result = Promise.resolve().then(() => reply(context))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    } }
}

const execute = (id, code) => assistant([{ type: 'toolCall', id, name: 'codemode', arguments: { code } }], 'toolUse')
const ownerText = context => context.messages.findLast(message => message.role === 'user').content

test('actual Durable resident installs a staged Skill and reads its installed resources after restart', async t => {
  const { config, candidates } = await fixture(t)
  let action = 'install', sequence = 0
  const models = runtime(context => {
    assert.deepEqual(visibleTools(context).map(tool => tool.name), ['codemode'])
    if (context.messages.at(-1).role !== 'toolResult') {
      if (action === 'install') return execute(`install-${++sequence}`, 'const c = await tools.agent_package_candidate({id:"report-helper"}); text(await tools.agent_package_install({id:c.value.id,revision:c.value.revision}));')
      assert.match(ownerText(context), /report-helper/)
      return execute(`read-${++sequence}`, 'text(await tools.agent_skill_read({id:"report-helper",path:"checks.md"}));')
    }
    const result = context.messages.at(-1)
    assert.equal(result.isError, false, JSON.stringify(result.content))
    if (action === 'read') assert.match(JSON.stringify(result.content), /Check every requested region/)
    return assistant(action === 'install' ? '已安装 report-helper。' : '已按已安装技能读取检查要求。')
  })
  const dependencies = { createRuntime: async () => models, createIntentRouter: () => async () => ({ intent: action === 'install' ? 'package_manage' : 'conversation' }) }
  let bot = await createPersonalBot(config, dependencies)
  t.after(() => bot.close())
  assert.match(await bot.prompt('安装 report-helper 技能'), /已安装/)
  await writeFile(join(candidates, 'report-helper', 'checks.md'), 'Changed draft must not replace installed text.')
  await bot.close()
  action = 'read'
  bot = await createPersonalBot(config, dependencies)
  assert.match(await bot.prompt('读取区域报告技能的检查要求'), /已安装技能/)
})

test('resident MCP calls use installed metadata, preserve session state, and refuse cross-workflow or duplicate mutations', async t => {
  const { root, config } = await fixture(t, ['catalog', 'mcp'])
  const events = join(root, 'events')
  await writeFile(events, '')
  config.env.ODK_MCP_EVENTS = events
  const catalog = await openAgentCatalog(join(config.stateDir, 'personal-agent', 'packages'))
  await catalog.installMcp({ schemaVersion: 1, kind: 'mcp', id: 'offline-fixture', name: 'Offline reporting connector', transport: {
    type: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/agent-mcp-server.mjs', import.meta.url))], env: { FIXTURE_EVENTS: { fromEnv: 'ODK_MCP_EVENTS' } },
  } })
  let action = 'call', sequence = 0
  const models = runtime(context => {
    if (context.messages.at(-1).role !== 'toolResult') {
      if (action === 'call') return execute(`call-${++sequence}`, 'const d = await tools.agent_mcp_tools({id:"offline-fixture"}); text(await tools.agent_mcp_call({id:"offline-fixture",revision:d.value.revision,tool:"echo",arguments:{text:"first"}}));')
      if (action === 'deny') return execute(`deny-${++sequence}`, 'text(await tools.agent_mcp_call({id:"offline-fixture",tool:"echo",arguments:{text:"forbidden"}}));')
      return execute(`duplicate-${++sequence}`, 'const d = await tools.agent_mcp_tools({id:"offline-fixture"}); const call = {id:"offline-fixture",revision:d.value.revision,tool:"echo",arguments:{text:"once"}}; text(await tools.agent_mcp_call(call)); text(await tools.agent_mcp_call(call));')
    }
    const result = context.messages.at(-1)
    if (action === 'call') { assert.equal(result.isError, false, JSON.stringify(result.content)); return assistant('MCP 已返回结果。') }
    assert.equal(result.isError, true)
    return assistant('该调用未获准，未重放操作。')
  })
  const bot = await createPersonalBot(config, { createRuntime: async () => models, createIntentRouter: () => async input => {
    if (action === 'call') assert.match(JSON.stringify(input.extensionTools), /Offline reporting connector/)
    return { intent: action === 'deny' ? 'conversation' : 'extension' }
  } })
  t.after(() => bot.close())
  assert.match(await bot.prompt('调用报告 MCP'), /已返回结果/)
  action = 'deny'
  await bot.prompt('只聊天')
  action = 'duplicate'
  await bot.prompt('再调用一次报告 MCP')
  const log = await readFile(events, 'utf8')
  assert.equal(log.split('pid:').length - 1, 1)
  assert.equal(log.split('called:echo').length - 1, 2)
  const pid = Number(log.match(/pid:(\d+)/)[1])
  await bot.close()
  assert.throws(() => process.kill(pid, 0), /ESRCH/)
})

test('plugin selection admits only fixed catalog and MCP plugins with the required dependency', async t => {
  const { root } = await fixture(t)
  const file = join(root, 'config.json')
  const base = { profile: 'personal', memoryFile: join(root, 'notes.json') }
  await writeFile(file, JSON.stringify({ ...base, agentPlugins: { enabled: ['catalog', 'mcp'] } }))
  assert.deepEqual((await loadPersonalConfig({ ODK_PERSONAL_BOT_CONFIG: file })).agentPlugins.enabled, ['catalog', 'mcp'])
  await writeFile(file, JSON.stringify({ ...base, agentPlugins: { enabled: ['mcp'] } }))
  await assert.rejects(loadPersonalConfig({ ODK_PERSONAL_BOT_CONFIG: file }))
})
