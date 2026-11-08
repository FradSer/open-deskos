'use strict'

const assert = require('node:assert/strict')
const { execFileSync, spawn } = require('node:child_process')
const { once } = require('node:events')
const { createInterface } = require('node:readline')
const { createRequire } = require('node:module')
const { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { integrationPath, integrationURL } = require('./repo-root')
const { createPersonalAgentClient } = require('../../src/personal-agent-client')
const { createPluginHost } = require('../../src/plugin-host')
const { createMainPlugins } = require('../../src/plugins/main-composition')

const ownerText = '请保存为我的关注规则：工作日 9:00–18:00，每 15 分钟检查一次 Gmail 的「工作」标签。发现需要我处理的新邮件，就在 Personal Agent 对话列表里提醒我一次，并给一个下一步。'
const pauseText = '暂停刚保存的 Gmail「工作」标签关注规则。'
const weekday = '2026-11-09'
const slot = minute => weekday + ':' + minute
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const report = (phase, detail = {}) => console.log('GMAIL_ROUTINE_E2E ' + JSON.stringify({ phase, ...detail }))
const exists = path => lstat(path).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })
const readJSON = async (path, fallback) => {
  try { return JSON.parse(await readFile(path, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return fallback; throw error }
}

async function verifyGmailRoutine(ipc, win, evaluate) {
  const { ROUTINE_FILENAME } = await import(integrationURL('personal-agent/src/recommendations/index.mjs'))
  const { parse: parseYaml } = createRequire(integrationPath('personal-agent/package.json'))('yaml')
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-gr-')))
  const state = join(root, 'state')
  const agentState = join(state, 'odk-personal-agent', 'personal-agent')
  const config = join(root, 'personal.json'), memoryFile = join(root, 'memory.json')
  const routine = join(agentState, ROUTINE_FILENAME), checkpoint = join(state, 'odk-personal-agent', 'proactive', 'state.json')
  const clock = join(root, 'clock.json'), trace = join(root, 'requests.jsonl')
  const node = process.env.ODK_TEST_NODE || execFileSync('which', ['node'], { encoding: 'utf8' }).trim()
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: state, ODK_CONFIG_DIR: root,
    ODK_PERSONAL_AGENT_CONFIG: config, ODK_DISABLED_PLUGINS: 'odk.personal-agent.home',
    ODK_MCP_GMAIL_ROUTINE_E2E_CLOCK: clock, ODK_MCP_GMAIL_ROUTINE_E2E_TRACE: trace }
  for (const key of ['ODK_PROACTIVE_CONFIG', 'ODK_PRIVATE_RECOMMENDATIONS_FILE', 'ODK_TASK_TARGETS_FILE', 'ODK_DATA_SOCKET']) delete env[key]
  const release = process.env.ODK_GMAIL_ROUTINE_E2E_RELEASE
  assert.ok(release && env.ODK_MCP_GMAIL_CREDENTIALS_FILE, 'Set the private Gmail credential path and test email release path')
  const setClock = async (time, running = false) => {
    await writeFile(clock + '.tmp', JSON.stringify({ at: Date.parse(time), ...(running ? { start: Date.now() } : {}) }), { mode: 0o600 })
    await rename(clock + '.tmp', clock)
  }
  const requests = async (endpoint, status = undefined) => {
    const rows = (await readFile(trace, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error }))
      .trim().split('\n').filter(Boolean).map(JSON.parse)
    return rows.filter(row => row.endpoint === endpoint && (status === undefined || row.status === status)).length
  }
  let resident, exit, exited, ownerTurn, unsubscribe
  let routineId
  const generated = []
  const client = createPersonalAgentClient({ socketPath: join(root, 'odk-personal-agent', 'agent.sock'), reconnectDelayMs: 100 })
  const host = createPluginHost({ capabilities: {
    ipc,
    broadcast: (name, frame) => { if (!win.isDestroyed()) win.webContents.send(name, frame) },
    'system.personal-agent': { options: {}, create: () => client, smokeMode: false,
      isConsumerFrame: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame },
  } })
  async function wait(check, message, timeout = 10000) {
    const until = Date.now() + timeout
    do {
      assert.equal(exited, undefined, 'Personal Agent resident exited')
      const result = await check()
      if (result) return result
      await pause(100)
    } while (Date.now() < until)
    assert.fail(typeof message === 'function' ? message() : message)
  }
  const submit = text => evaluate(`(() => {
    const form = document.querySelector('.agent-composer')
    if (form.dataset.mode !== 'keyboard') form.querySelector('.agent-keys').click()
    const input = form.querySelector('textarea')
    input.value = ${JSON.stringify(text)}
    input.dispatchEvent(new Event('input', { bubbles: true }))
    form.querySelector('.agent-send').click()
  })()`)
  const doc = async () => {
    try { return parseYaml(await readFile(routine, 'utf8')).entries } catch (error) { if (error.code === 'ENOENT') return []; throw error }
  }
  const progress = async id => (await readJSON(checkpoint, {})).gmailRoutines?.[id]
  const pending = () => (client.snapshot().proposals ?? []).filter(p => p.privateData && p.status === 'pending')
  const rearm = () => assert.equal(client.proposalCommand({ type: 'proposal_list' }), true)
  function startResident(hook) {
    exited = undefined
    resident = spawn(node, ['--import', hook, integrationPath('personal-agent/src/main.mjs')],
      { cwd: integrationPath('personal-agent'), env, stdio: ['ignore', 'pipe', 'inherit'] })
    exit = once(resident, 'exit').then(result => { exited = result })
    createInterface({ input: resident.stdout }).on('line', line => {
      try {
        const receipt = JSON.parse(line)
        if (receipt.event === 'proactive_generation' && receipt.phase === 'generated') generated.push(receipt)
      } catch {}
    })
  }
  async function stopResident() {
    if (!resident || exited !== undefined) return
    resident.kill('SIGTERM')
    await Promise.race([exit, pause(4000)])
    if (exited === undefined) { resident.kill('SIGKILL'); await exit }
  }
  try {
    await setClock(weekday + 'T08:59:00+08:00')
    await Promise.all([
      writeFile(config, JSON.stringify({ profile: 'personal', memoryFile, agentPlugins: { enabled: ['intent', 'catalog', 'mcp'] } }), { mode: 0o600 }),
      writeFile(memoryFile, '{}', { mode: 0o600 }),
    ])
    if (env.ODK_PERSONAL_AGENT_MEM0_CONFIG && env.ODK_INTENT_E2E_MEM0_CACHE) {
      const mem0 = join(agentState, 'mem0')
      await mkdir(mem0, { recursive: true, mode: 0o700 })
      await cp(env.ODK_INTENT_E2E_MEM0_CACHE, join(mem0, 'embedding-cache'), { recursive: true, verbatimSymlinks: true })
    }
    const { openAgentCatalog } = await import(integrationURL('personal-agent/src/agent-catalog/catalog.mjs'))
    const { createGmailManifest } = await import(integrationURL('gmail/src/manifest.mjs'))
    const catalog = await openAgentCatalog(join(agentState, 'packages'))
    const manifest = createGmailManifest({ directory: integrationPath('gmail'), nodePath: node })
    const hook = join(__dirname, 'gmail-routine-clock.mjs')
    manifest.transport.args.unshift('--import', hook)
    for (const key of ['ODK_MCP_GMAIL_ROUTINE_E2E_CLOCK', 'ODK_MCP_GMAIL_ROUTINE_E2E_TRACE']) {
      manifest.transport.env[key] = { fromEnv: key }
    }
    await catalog.installMcp(manifest)
    createMainPlugins().filter(p => p.manifest.id === 'odk.system.personal-agent').forEach(p => host.register(p))
    await host.start()
    startResident(hook)
    await wait(() => client.snapshot().textInput && client.snapshot().state === 'idle', 'Personal Agent is unavailable', 25000)
    const { selected } = await client.configure({ action: 'list' })
    const model = selected?.provider + '/' + selected?.id
    assert.equal(model, env.ODK_PERSONAL_AGENT_MODEL, 'Use the model configured on CM5')
    await evaluate(`[...document.querySelectorAll('#dots .dot')].find(dot => dot.getAttribute('aria-label')?.includes('Personal Agent'))?.click()`)
    unsubscribe = client.subscribe(({ ownerTurnId, state }) => { if (ownerTurnId) ownerTurn = { ownerTurnId, state } })
    await submit(ownerText)
    const entry = await wait(async () => {
      assert.notEqual(ownerTurn?.state, 'error', 'The real model did not complete the Gmail routine save turn')
      if (ownerTurn?.state !== 'idle') return false
      const entries = await doc()
      assert.equal(entries.length, 1, 'The completed owner turn did not save exactly one Gmail routine')
      return entries[0]
    }, () => 'Gmail routine save did not complete: ' + (ownerTurn?.state ?? 'no owner turn'), 240000)
    assert.equal(entry.ownerText, ownerText)
    routineId = entry.id
    assert.deepEqual(entry.when, { type: 'interval-window', timeZone: 'Asia/Shanghai', days: 'weekdays', start: '09:00', end: '18:00', everyMinutes: 15 })
    const [source] = entry.if.inputs
    assert.equal(entry.if.inputs.length, 1)
    assert.equal(source.type, 'service')
    assert.equal(source.connectorId, 'gmail')
    assert.deepEqual(source.selection, { type: 'label', name: '工作' })
    assert.match(source.binding.labelId, /^Label_/)
    assert.equal(entry.then.type, 'suggestion')
    assert.match(await readFile(routine, 'utf8'), /^version: 2\nentries:\n/)
    assert.deepEqual(await readJSON(memoryFile), {})
    assert.equal(await requests('gmail_labels', 200), 1)
    assert.equal(await requests('gmail_history'), 0)
    report('routine-saved', { model, when: entry.when, label: source.selection.name, routineFile: ROUTINE_FILENAME, release })

    await wait(() => exists(release), 'The controlled Gmail test mail has not been released', 240000)
    assert.equal(await requests('gmail_history'), 0, 'Gmail must not be polled before 09:00')
    assert.equal(pending().length, 0)
    const firstAttempt = Date.now()
    await setClock(weekday + 'T08:59:56+08:00', true)
    rearm()
    await wait(async () => await requests('gmail_history') > 0 || (await progress(entry.id))?.slot === slot('0540')
      || Date.now() - firstAttempt >= 45000, 'The first scheduled slot did not start', 50000)
    if (!await requests('gmail_history') && !(await progress(entry.id))?.slot && !generated.length && !pending().length) {
      report('retrying-first-slot', { profileReads: await requests('gmail_profile'), profileSuccesses: await requests('gmail_profile', 200) })
      await stopResident()
      await setClock(weekday + 'T08:59:56+08:00', true)
      startResident(hook)
    }
    await wait(async () => (await progress(entry.id))?.slot === slot('0540'), 'The first scheduled slot did not complete', 180000)
    assert.ok(generated.some(row => row.model === model && row.candidates === 1), 'The configured model must generate the actual suggestion')
    assert.ok(generated.some(row => row.model === model && row.candidates === 0), 'The real model must skip informational mail')
    const first = await wait(() => pending()[0], 'No pending suggestion appeared from real Gmail and the real model')
    assert.equal(pending().length, 1)
    const card = `[data-proposal-id="${first.id}"].personal-agent-proposal`
    await wait(() => evaluate(`Boolean(document.querySelector('.agent-conversation ${card}'))`), 'The recommendation is missing from the conversation')
    const rendered = await evaluate(`(() => {
      const card = document.querySelector(${JSON.stringify(card)})
      const action = card.querySelectorAll('.personal-agent-proposal-primary button, button.personal-agent-proposal-primary')
      return { actions: action.length, action: action[0]?.textContent?.trim(),
        openUI: !!card.querySelector('.personal-agent-preview-card'), sourceDisclosure: !!card.querySelector('.personal-agent-proposal-evidence') }
    })()`)
    assert.equal(rendered.actions, 1, 'The real recommendation must offer exactly one next step')
    assert.match(rendered.action, /查看邮件|准备回复/)
    assert.equal(rendered.openUI, true)
    assert.equal(rendered.sourceDisclosure, false)
    assert.equal(await requests('gmail_history', 200) >= 1, true)
    assert.equal(await requests('model', 200) >= 3, true)
    report('one-action-in-conversation', { action: rendered.action, openUI: rendered.openUI, generated: generated.map(row => row.candidates) })
    if (process.env.ODK_GMAIL_ROUTINE_E2E_SCREENSHOT) {
      await evaluate(`document.querySelector(${JSON.stringify(card)})?.scrollIntoView({ block: 'center' })`)
      await pause(250)
      await writeFile(process.env.ODK_GMAIL_ROUTINE_E2E_SCREENSHOT, (await win.capturePage()).toPNG(), { mode: 0o600 })
    }
    const reapply = release + '.reapplied'
    await wait(() => exists(reapply), 'The test label was not reapplied', 120000)
    const before = await requests('gmail_history')
    const generationCount = generated.length
    await setClock(weekday + 'T09:14:56+08:00', true)
    rearm()
    await wait(async () => (await progress(entry.id))?.slot === slot('0555'), 'The 09:15 check did not complete', 60000)
    assert.ok(await requests('gmail_history', 200) > before)
    assert.equal(generated.length, generationCount)
    assert.deepEqual(pending().map(p => p.id), [first.id])
    report('deduplicated-at-0915', { sameCard: true, generationCount })

    await stopResident()
    await setClock(weekday + 'T09:29:56+08:00', true)
    startResident(hook)
    await wait(async () => (await progress(entry.id))?.slot === slot('0570'), 'The restarted resident did not check at 09:30', 60000)
    await wait(() => pending().some(p => p.id === first.id), 'The same live suggestion was not rebound after restart')
    assert.deepEqual(pending().map(p => p.id), [first.id])
    assert.equal(generated.length, generationCount)
    report('restored-after-restart', { sameCard: true, generationCount })

    const checked = await requests('gmail_history')
    for (const outside of [weekday + 'T18:00:00+08:00', '2026-11-14T09:00:00+08:00']) {
      await setClock(outside)
      rearm()
      await pause(1400)
      assert.equal(await requests('gmail_history'), checked)
    }
    report('closed-and-weekend-skipped')
    const priorTurn = ownerTurn?.ownerTurnId
    await submit(pauseText)
    await wait(async () => {
      if (ownerTurn?.ownerTurnId === priorTurn) return false
      assert.notEqual(ownerTurn?.state, 'error', 'The real model did not complete the pause turn')
      return ownerTurn?.state === 'idle' && (await doc())[0]?.enabled === false
    }, 'The real model did not pause the saved routine', 180000)
    await setClock('2026-11-16T09:15:00+08:00')
    rearm()
    await pause(1500)
    assert.equal(await requests('gmail_history'), checked)
    assert.equal(pending().length, 0)
    report('passed', { model, gmailHistoryReads: checked, modelRequests: await requests('model', 200), paused: true })
  } catch (error) {
    const lastSlot = routineId ? (await progress(routineId).catch(() => undefined))?.slot : undefined
    report('failed', { lastSlot, gmailHistoryReads: await requests('gmail_history').catch(() => undefined),
      gmailHistorySuccesses: await requests('gmail_history', 200).catch(() => undefined), generated: generated.map(row => row.candidates) })
    throw error
  } finally {
    unsubscribe?.()
    await host.stop().catch(() => {})
    client.stop()
    await stopResident()
    await rm(root, { recursive: true, force: true })
  }
}

module.exports = { verifyGmailRoutine }
