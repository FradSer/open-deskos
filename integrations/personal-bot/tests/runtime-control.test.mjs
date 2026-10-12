import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createPersonalBotComposition, BOT_PORTS } from '../src/plugin-composition.mjs'
import { PersonalBotService } from '../src/service.mjs'
import { listen, personalBotControlEndpoint } from '../src/socket.mjs'

const require = createRequire(import.meta.url)
const { resolveShellHost } = require('../../../runtime/shell/src/platform')
const { requestLocalControl } = require('../../../runtime/shell/src/local-control-client')
const run = promisify(execFile)
const cli = fileURLToPath(new URL('../../../runtime/shell/scripts/open-deskos-plugin-cli.js', import.meta.url))

test('resident control endpoint agrees with every Shell Host mapping', () => {
  const env = { XDG_RUNTIME_DIR: '/run/user/1000', LOCALAPPDATA: 'C:\\Users\\desk\\AppData\\Local' }
  for (const platform of ['linux', 'darwin', 'win32']) {
    const host = resolveShellHost({ env, platform, arch: platform === 'win32' ? 'x64' : 'arm64' })
    assert.equal(personalBotControlEndpoint(env, platform), host.endpoint('personal-bot-control'))
    assert.notEqual(host.endpoint('personal-bot-control'), host.endpoint('personal-bot'))
  }
  assert.equal(personalBotControlEndpoint({}, 'linux'), null)
  assert.equal(personalBotControlEndpoint({ XDG_RUNTIME_DIR: 'relative' }, 'darwin'), null)
})

test('resident control authenticates before changing its component graph', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-bot-auth-'))
  const endpoint = join(root, 'control.sock')
  const stateDir = join(root, 'state')
  let closed = 0
  const composition = createPersonalBotComposition({
    control: { endpoint, stateDir, platform: 'win32' },
    createService: () => ({ close() {}, suspend() {}, resume() {} }),
    openChannel: () => ({ close() {} }),
    initialize: () => ({ agent: { abort() {}, close() {} } }),
    createHome: () => ({ start() {}, close() { closed++ } }),
  })
  t.after(async () => { await composition.stop(); await rm(root, { recursive: true, force: true }) })
  await composition.start()
  const wrong = join(root, 'wrong-token')
  await writeFile(wrong, 'wrong')
  const options = { endpoint, platform: 'win32', label: 'resident fixture', request: { command: 'disable', pluginId: 'odk.personal-bot.home' } }
  await assert.rejects(requestLocalControl({ ...options, tokenFile: wrong }), /closed/)
  assert.equal(closed, 0)
  assert.equal(composition.catalog().find(plugin => plugin.manifest.id === 'odk.personal-bot.home').state, 'running')
  const receipt = await requestLocalControl({ ...options, tokenFile: join(stateDir, 'local-channel.token') })
  assert.equal(receipt.scope, 'personal-agent')
  assert.equal(receipt.state, 'disabled')
  assert.equal(closed, 1)
})

test('actual runtime CLI manages resident components and preserves independent recovery', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-bot-control-'))
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: root, OPEN_DESKOS_CONFIG_DIR: join(root, 'config') }
  const platform = resolveShellHost({ env })
  let initialized = 0
  let closed = 0
  let failHome = false
  let composition
  composition = createPersonalBotComposition({
    control: { endpoint: platform.endpoint('personal-bot-control'), stateDir: platform.stateDir, platform: platform.platform },
    createService: () => new PersonalBotService({ record: async () => { throw Error('fixture never captures') }, transcribe: async () => '', prompt: async () => '' }),
    openChannel: service => listen(platform.endpoint('personal-bot'), service, { runtimeSnapshot: () => composition.catalog() }),
    initialize: async () => { initialized++; return { agent: { abort() {}, close() { closed++ } } } },
    createHome: () => ({ start() {}, close() { if (failHome) throw Error('private home failure') } }),
    createWatch: () => ({ start() {}, close() {} }),
  })
  t.after(async () => { failHome = false; await composition.stop(); await rm(root, { recursive: true, force: true }) })
  await composition.start()
  const control = composition.catalog().find(plugin => plugin.manifest.id === 'odk.personal-bot.control')
  assert.equal(control.state, 'running')
  const command = (operation, name) => run(process.execPath, [cli, operation, `odk.personal-bot.${name}`, '--runtime'], { env })
  const service = composition.port(BOT_PORTS.service)
  const channel = composition.port(BOT_PORTS.channel)
  for (const name of ['home', 'watch', 'runtime']) {
    const disabled = JSON.parse((await command('disable', name)).stdout)
    assert.equal(disabled.scope, 'personal-agent')
    assert.equal(disabled.state, 'disabled')
    assert.equal(composition.port(BOT_PORTS[name]), null)
    assert.equal(composition.port(BOT_PORTS.service), service)
    assert.equal(composition.port(BOT_PORTS.channel), channel)
    assert.equal(JSON.parse((await command('enable', name)).stdout).state, 'running')
  }
  assert.equal(initialized, 2)
  assert.equal(closed, 1)
  await command('disable', 'channel')
  assert.equal(composition.port(BOT_PORTS.channel), null)
  assert.equal(composition.port(BOT_PORTS.runtime), null)
  await command('enable', 'channel')
  assert.notEqual(composition.port(BOT_PORTS.channel), channel)
  await command('disable', 'service')
  assert.equal(composition.port(BOT_PORTS.service), null)
  await command('enable', 'service')
  assert.notEqual(composition.port(BOT_PORTS.service), service)
  assert.ok(composition.catalog().every(plugin => plugin.state === 'running'))
  await assert.rejects(command('disable', 'control'), /protected-plugin/)
  await assert.rejects(command('disable', 'missing'), /unknown-plugin/)
  failHome = true
  await assert.rejects(command('disable', 'home'), error => {
    assert.match(error.stderr, /lifecycle-failed/)
    assert.equal(error.stderr.includes('private home failure'), false)
    return true
  })
  failHome = false
  await command('enable', 'home')
  await assert.rejects(access(join(env.OPEN_DESKOS_CONFIG_DIR, 'plugins.json')), /ENOENT/)
  await composition.stop()
  await assert.rejects(access(platform.endpoint('personal-bot-control')), /ENOENT/)
})

for (const initial of ['disabled-service', 'disabled-channel', 'failed-service', 'failed-channel']) {
  test(`resident management recovers ${initial} at startup`, { skip: process.platform === 'win32' }, async t => {
    const root = await mkdtemp(join(tmpdir(), 'odk-bot-recover-'))
    const name = initial.endsWith('service') ? 'service' : 'channel'
    const id = `odk.personal-bot.${name}`
    let failed = initial.startsWith('failed')
    const composition = createPersonalBotComposition({
      disabled: initial.startsWith('disabled') ? [id] : [],
      control: { endpoint: join(root, 'control.sock'), stateDir: root },
      createService() {
        if (failed && name === 'service') throw Error('private service failure')
        return { close() {}, suspend() {}, resume() {} }
      },
      openChannel() {
        if (failed && name === 'channel') throw Error('private channel failure')
        return { close() {} }
      },
      initialize: () => ({ agent: { abort() {}, close() {} } }),
    })
    t.after(async () => { await composition.stop(); await rm(root, { recursive: true, force: true }) })
    await composition.start()
    assert.equal(composition.catalog().find(plugin => plugin.manifest.id === 'odk.personal-bot.control').state, 'running')
    failed = false
    const receipt = await requestLocalControl({ endpoint: join(root, 'control.sock'), label: 'resident recovery', request: { command: 'enable', pluginId: id } })
    assert.equal(receipt.state, 'running')
    assert.ok(composition.catalog().every(plugin => plugin.state === 'running'))
  })
}

test('resident management can cancel cooperative pending runtime initialization', { skip: process.platform === 'win32' }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'odk-bot-init-'))
  const endpoint = join(root, 'control.sock')
  let entered
  const initializing = new Promise(resolve => { entered = resolve })
  let release
  const pending = new Promise(resolve => { release = resolve })
  const composition = createPersonalBotComposition({
    control: { endpoint, stateDir: root },
    createService: () => ({ close() {}, suspend() {}, resume() {} }),
    openChannel: () => ({ close() {} }),
    initialize: async (_service, context) => {
      context.signal.addEventListener('abort', release, { once: true })
      entered()
      await pending
      return { agent: { abort() {}, close() {} } }
    },
  })
  t.after(async () => { release(); await composition.stop(); await rm(root, { recursive: true, force: true }) })
  const startup = composition.start()
  await initializing
  const receipt = await requestLocalControl({ endpoint, label: 'pending initialization', request: { command: 'disable', pluginId: 'odk.personal-bot.runtime' } })
  assert.equal(receipt.state, 'disabled')
  await startup
  assert.equal(composition.port(BOT_PORTS.runtime), null)
})
