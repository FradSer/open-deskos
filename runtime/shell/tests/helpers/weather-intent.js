'use strict'

const assert = require('node:assert/strict')
const { spawn } = require('node:child_process')
const { once } = require('node:events')
const { createInterface } = require('node:readline')
const { createRequire } = require('node:module')
const { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { integrationPath, integrationURL } = require('./repo-root')
const { createPersonalAgentClient } = require('../../src/personal-agent-client')
const { createPluginHost } = require('../../src/plugin-host')
const { createMainPlugins } = require('../../src/plugins/main-composition')
const { createShellOdkData } = require('../../src/odk-data')
const { listenOdkData } = require('../../src/odk-data-control')
const { createWeatherSource } = require('../../src/weather-source')

const readingId = 'odk.tile.weather'
const defaultOwnerText = 'Save this as my custom Intent. Whenever the Weather Widget current temperature is below 30 °C, suggest that I bring a light jacket for my next walk. Use only the current temperature from the Weather Widget. Make it a suggestion only.'
const ideaText = '我在想，当天最低气温低于 22 °C 时，晚间散步带件薄外套。请用一句话概括这个想法。'
const timeZone = 'Asia/Shanghai'
const walkNote = 'walk_weather'
const walkEnabled = '晚间散步计划开启'
const walkPaused = '晚间散步计划已暂停'
const unrelatedNote = 'unrelated_weather_test'
const unrelatedValue = '偏好在上午整理桌面'
const pluginIds = new Set(['odk.source.weather', 'odk.system.data', 'odk.transport.data', 'odk.system.personal-agent'])

async function until(check, message, timeout = 10000) {
  const deadline = Date.now() + timeout
  do {
    const result = await check()
    if (result) return result
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (Date.now() < deadline)
  assert.fail(typeof message === 'function' ? message() : message)
}

async function verifyWeatherIntent(ipc, win, evaluate, { pinIdea = false, useInterval = false, useMem0 = false } = {}) {
  const started = performance.now()
  const report = (phase, detail = {}) => console.log('WEATHER_INTENT_E2E_PHASE ' + JSON.stringify({
    phase, elapsedMs: Math.round(performance.now() - started), ...detail,
  }))
  const root = await realpath(await mkdtemp(join(tmpdir(), 'odk-wi-')))
  const state = join(root, 'state')
  const endpoint = join(root, 'data.sock')
  const personalConfig = join(root, 'personal.json')
  const memoryFile = join(root, 'memory.json')
  const stateDir = join(state, 'odk-personal-agent')
  const agentState = join(stateDir, 'personal-agent')
  const env = { ...process.env, XDG_RUNTIME_DIR: root, XDG_STATE_HOME: state, ODK_DATA_SOCKET: endpoint,
    ODK_PERSONAL_AGENT_CONFIG: personalConfig, ODK_CONFIG_DIR: root, ODK_DISABLED_PLUGINS: 'odk.personal-agent.home' }
  delete env.ODK_PROACTIVE_CONFIG
  delete env.ODK_PRIVATE_RECOMMENDATIONS_FILE
  delete env.ODK_TASK_TARGETS_FILE
  const client = createPersonalAgentClient({ socketPath: join(root, 'odk-personal-agent', 'agent.sock'), reconnectDelayMs: 100 })
  let weatherSource
  const host = createPluginHost({ capabilities: {
    ipc,
    broadcast: (name, frame) => { if (!win.isDestroyed()) win.webContents.send(name, frame) },
    'source.weather': { create: options => { weatherSource = createWeatherSource(options); return weatherSource }, options: {
      latitude: 31.23, longitude: 121.47, place: 'Shanghai', cacheFile: join(root, 'weather.json'),
      onUpdate: () => client.servicePush([readingId]),
    } },
    'desk.data': { create: createShellOdkData, smokeMode: false },
    'desk.link': { listen: listenOdkData, smokeMode: false, enabled: true, options: { endpoint, stateDir: root },
      report: message => process.stderr.write(message + '\n') },
    'system.personal-agent': { options: {}, create: () => client, smokeMode: false,
      isConsumerFrame: event => event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame },
  } })
  let resident, exited, exit, output, unsubscribe, ownerTurn, submittedText
  const generationReceipts = []
  try {
    const profile = { profile: 'personal', agentPlugins: { enabled: ['intent'] } }
    if (useMem0) {
      assert.ok(env.ODK_PERSONAL_AGENT_MEM0_CONFIG, 'Select a real isolated Mem0 backend')
      if (env.ODK_INTENT_E2E_MEM0_CACHE) {
        const mem0 = join(agentState, 'mem0')
        await mkdir(mem0, { recursive: true, mode: 0o700 })
        await cp(env.ODK_INTENT_E2E_MEM0_CACHE, join(mem0, 'embedding-cache'), { recursive: true, verbatimSymlinks: true })
      }
    } else {
      profile.memoryFile = memoryFile
      await writeFile(memoryFile, '{}', { mode: 0o600 })
    }
    await writeFile(personalConfig, JSON.stringify(profile), { mode: 0o600 })
    createMainPlugins().filter(plugin => pluginIds.has(plugin.manifest.id)).forEach(plugin => host.register(plugin))
    await host.start()
    await until(() => lstat(endpoint).then(stat => stat.isSocket(), error => {
      if (error.code !== 'ENOENT') throw error
      return false
    }), () => 'The Data Link did not start: ' + JSON.stringify(host.list().map(({ manifest, state, error }) => [manifest.id, state, error])))
    const { odkDataRequest } = await import(integrationURL('personal-agent/src/odk-data.mjs'))
    const { createIntentStore, ROUTINE_FILENAME } = await import(integrationURL('personal-agent/src/recommendations/index.mjs'))
    const { parse: parseYaml } = createRequire(integrationPath('personal-agent/package.json'))('yaml')
    const selected = (await odkDataRequest('list', { env })).readings.find(row => row.id === readingId)
    assert.equal(selected?.label, 'Weather')
    function freshWeatherAfter(previous, timeout) {
      let retryAt = 0
      return until(async () => {
        if (Date.now() < retryAt) return false
        await weatherSource.refresh({ force: true })
        retryAt = Date.now() + 2500
        const { reading } = await odkDataRequest('read', { id: readingId, env })
        return reading.state === 'live' && Date.parse(reading.value.asOf) > previous && reading
      }, 'Open-Meteo did not provide a fresh live reading in the test window', timeout)
    }
    const { reading: initial } = await odkDataRequest('read', { id: readingId, env })
    const reading = initial.state === 'live' ? initial : await freshWeatherAfter(0, 30000)
    const field = pinIdea ? 'lowC' : 'temperatureC'
    const threshold = pinIdea ? 22 : 30
    let evidence = reading.value
    assert(Number.isFinite(evidence[field]) && evidence[field] < threshold, 'The test condition must match a real reading')
    assert(Number.isFinite(Date.parse(evidence.asOf)))
    report('weather-ready', { field, value: evidence[field], measuredAt: evidence.asOf })
    const agentRoot = integrationPath('personal-agent')
    const entry = join(agentRoot, 'src', 'main.mjs')
    resident = spawn(process.env.npm_node_execpath || 'node', [entry],
      { cwd: agentRoot, env, stdio: ['ignore', 'pipe', 'inherit'] })
    exit = once(resident, 'exit').then(result => { exited = result }, error => { exited = [String(error)] })
    output = createInterface({ input: resident.stdout })
    output.on('line', line => {
      if (!line.startsWith('{') || line.length > 8192) return
      let receipt
      try { receipt = JSON.parse(line) } catch { return }
      if (receipt.event !== 'proactive_generation' || receipt.phase !== 'generated' || !Array.isArray(receipt.topics)
        || typeof receipt.model !== 'string' || !Number.isSafeInteger(receipt.candidates)) return
      generationReceipts.push(receipt)
      if (generationReceipts.length > 16) generationReceipts.shift()
    })
    report('resident-launched')
    const intentStore = () => createIntentStore(join(agentState, ROUTINE_FILENAME))
    const wait = (check, message, timeout) => until(() => {
      assert.equal(exited, undefined, 'Resident exited during Weather Intent acceptance')
      assert.notEqual(ownerTurn?.state, 'error', 'The submitted Weather Intent conversation turn ended in error')
      return check()
    }, message, timeout)
    const navigate = name => evaluate(`[...document.querySelectorAll('#dots .dot')].find(dot => dot.getAttribute('aria-label')?.includes(${JSON.stringify(name)}))?.click()`)
    await wait(() => client.snapshot().textInput === true && client.snapshot().state === 'idle',
      () => 'Personal Agent did not become ready for text: ' + (client.snapshot().message || client.snapshot().state), 25000)
    const { selected: model } = await client.configure({ action: 'list' })
    assert.ok(typeof model?.provider === 'string' && model.provider && typeof model.id === 'string' && model.id,
      'The resident did not report a selected model')
    const selectedModel = model.provider + '/' + model.id
    if (env.ODK_PERSONAL_AGENT_MODEL) assert.equal(selectedModel, env.ODK_PERSONAL_AGENT_MODEL, 'Resident did not select the configured model')
    report('resident-ready', { selectedModel })
    assert.deepEqual(intentStore().list(), [])
    assert.equal((client.snapshot().proposals ?? []).length, 0)
    await navigate('Home')
    await wait(() => evaluate(`document.querySelector('[data-widget="odk.tile.weather"] .w-weather-number')?.textContent === ${JSON.stringify(String(reading.value.temperatureC))}`),
      'The Weather Widget did not display the Data Link temperature')
    await navigate('Personal Agent')
    unsubscribe = client.subscribe(({ ownerTurnId, state, transcript }) => {
      if (!ownerTurnId || transcript !== submittedText || (ownerTurn && ownerTurn.id !== ownerTurnId) || ownerTurn?.state === state) return
      ownerTurn = { id: ownerTurnId, state }
      report('owner-turn', { state })
    })
    async function submit(text) {
      submittedText = text
      ownerTurn = undefined
      report('composer-submit')
      await wait(() => evaluate(`(() => {
        const form = document.querySelector('.agent-composer')
        if (!form) return false
        if (form.dataset.mode !== 'keyboard') form.querySelector('.agent-keys').click()
        const input = form.querySelector('textarea')
        if (!input || input.disabled) return false
        input.value = ${JSON.stringify(text)}
        input.dispatchEvent(new Event('input', { bubbles: true }))
        const send = form.querySelector('.agent-send')
        if (!send || send.disabled) return false
        send.click()
        return true
      })()`), 'The composer did not accept the next test input')
    }
    async function remember(name, value) {
      await submit(`记住 ${name}：${value}`)
      const reply = await wait(() => ownerTurn?.state === 'idle' && client.snapshot().message?.trim(),
        'The model did not complete the exact note command', 180000)
      assert.match(reply, /已保存|已记住|已记录|已更新|saved|remembered|updated/i, 'The model must confirm that the note was saved')
    }
    const idea = useMem0
      ? `我有个想法：名为 ${walkNote} 的命名笔记表示晚间散步计划开启，而且 Weather Widget 当日最低气温低于 22 °C 时，就建议我散步带件薄外套。先简述想法，先别保存成规则。`
      : ideaText
    if (useMem0) {
      await remember(walkNote, walkEnabled)
      report('named-note-command-completed')
    }
    let ownerText = defaultOwnerText, dueAt, at, schedule
    if (pinIdea) {
      await submit(idea)
      await wait(() => ownerTurn?.state === 'idle' && client.snapshot().message?.trim(),
        'The model did not complete the idea discussion', 180000)
      assert.deepEqual(intentStore().list(), [])
      assert.equal((client.snapshot().proposals ?? []).length, 0)
      await assert.rejects(lstat(intentStore().file), { code: 'ENOENT' })
      report('idea-discussed', { text: idea, routineExists: false })
      dueAt = Math.ceil((Date.now() + (useMem0 ? 120000 : 180000)) / 60000) * 60000
      const time = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      at = time.format(dueAt)
      if (useInterval) {
        schedule = { days: 'daily', start: at, end: time.format(dueAt + (useMem0 ? 12 : 6) * 60000), everyMinutes: 1 }
        assert(schedule.start < schedule.end, 'Start the interval acceptance before local midnight')
      }
      const timing = schedule ? `${schedule.start} 到 ${schedule.end} 每 1 分钟` : at
      ownerText = `把刚才的想法保存成 ROUTINE 关注规则。每天上海时间 ${timing} 检查 Weather Widget 的当日最低气温，低于 22 °C 就在 Personal Agent 对话列表里建议我晚间散步带一件薄外套。只使用 Weather Widget 的当日最低气温，只给一个只读建议。`
      if (useMem0) {
        ownerText = `把刚才的想法保存成 ROUTINE 关注规则。每天上海时间 ${timing} 检查。当 Weather Widget 的当日最低气温低于 22 °C，并且名为 ${walkNote} 的命名笔记内容为「${walkEnabled}」时，才建议晚间散步带一件薄外套。把 ${walkNote} 保存为这条规则的命名笔记引用，检查时读取当前值。只用 Weather Widget 的当日最低气温和这一条命名笔记，只给一个只读建议。`
      }
    }
    await submit(ownerText)
    const intent = await wait(() => {
      if (ownerTurn?.state !== 'idle') return false
      const saved = intentStore().list()
      assert.equal(saved.length, 1, 'The completed Weather Intent turn did not save exactly one Intent: ' + (client.snapshot().message || 'No owner response'))
      return saved[0]
    }, () => 'The Weather Intent turn did not complete: ' + (ownerTurn?.state ?? 'not observed'), 240000)
    report('intent-saved', { revision: intent.revision })
    assert.equal(intent.ownerText, ownerText)
    assert.equal(intent.revision, 1)
    assert.equal(intent.enabled, true)
    assert.equal(intent.ride, undefined)
    assert.deepEqual(intent.memoryKeys, useMem0 ? [walkNote] : [])
    assert.deepEqual(intent.observations, [{ readingId, fields: [field] }])
    const document = parseYaml(await readFile(intentStore().file, 'utf8'))
    assert.equal(document.version, 2)
    assert.equal(document.entries.length, 1)
    const [routine] = document.entries
    assert.equal(routine.id, intent.id)
    assert.equal(routine.ownerText, ownerText)
    if (schedule) assert.deepEqual(routine.when, { type: 'interval-window', timeZone, ...schedule })
    else if (pinIdea) assert.deepEqual(routine.when, { type: 'daily-window', at, timeZone, windowMinutes: 10 })
    else assert.equal(routine.when.type, 'context')
    assert.deepEqual(routine.if.inputs, intent.observations.map(input => ({ type: 'odk-data', ...input })))
    assert.equal(routine.then.type, 'suggestion')
    assert.deepEqual(routine.if.memoryKeys, useMem0 ? [walkNote] : [])
    if (!useMem0) assert.deepEqual(JSON.parse(await readFile(memoryFile, 'utf8')), {})
    report('routine-yaml-verified', { file: ROUTINE_FILENAME })

    const proposals = () => (client.snapshot().proposals ?? []).filter(p => p.status === 'pending' && p.ruleId === 'intent-' + intent.id)
    if (pinIdea) {
      const refreshed = await freshWeatherAfter(Date.parse(reading.value.asOf), Math.max(1000, dueAt - Date.now() - 1000))
      evidence = refreshed.value
      assert(Number.isFinite(evidence[field]) && evidence[field] < threshold, 'The live Weather Widget must still match the saved condition')
      assert(Date.parse(evidence.asOf) > Date.parse(reading.value.asOf), 'Refresh must obtain a later provider observation')
      assert(Date.now() < dueAt, 'The routine must be pinned before the scheduled check')
      assert.equal(proposals().length, 0, 'The routine must wait for its scheduled check')
      report('routine-pinned-before-due', { text: ownerText, when: routine.when, dueAt: new Date(dueAt).toISOString(),
        value: evidence[field], measuredAt: evidence.asOf })
    }
    const current = await wait(() => {
      const proposal = proposals()[0]
      assert.ok(proposal || !client.snapshot().proposalError, 'Weather Intent generation failed: ' + client.snapshot().proposalError)
      if (pinIdea && Date.now() < dueAt) assert.equal(proposal, undefined, 'The model suggestion arrived before the saved time')
      return proposal
    },
      () => 'No suggestion reached the Shell: ' + (client.snapshot().proposalError || client.snapshot().message || client.snapshot().state),
      180000 + (pinIdea ? Math.max(0, dueAt - Date.now()) : 0))
    report('suggestion-published')
    const generation = await wait(() => generationReceipts.find(receipt => receipt.topics.includes(current.ruleId) && receipt.candidates > 0),
      'The resident did not report successful model generation for this Intent')
    assert.equal(generation.model, selectedModel, 'The Intent suggestion must use the resident selected model')
    if (pinIdea) {
      assert.equal(generation.trigger, 'intent_due')
      assert(Date.parse(generation.at) >= dueAt, 'The scheduled model generation must run at or after the saved time')
      assert.equal(typeof current.nextStep, 'string')
      assert(current.nextStep.trim().length > 0)
    }
    report('generation-verified', { model: generation.model, trigger: generation.trigger, at: generation.at })
    assert.equal(current.action, null)
    assert.equal(current.confirmation, '')
    if (useMem0) {
      const countNodes = (node, type) => Number(node?.type === type)
        + (node?.children ?? node?.props?.children ?? []).reduce((count, child) => count + countNodes(child, type), 0)
      assert.equal(countNodes(current.ui, 'OwnerStep'), 1, 'OpenUI must contain exactly one read-only next step')
      assert.equal(countNodes(current.ui, 'ApprovedAction'), 0)
    }
    assert.equal(current.evidence.length, 1)
    const { id: evidenceId, ...source } = current.evidence[0]
    assert.match(evidenceId, /^e\d+$/)
    assert.deepEqual(source, { readingId, field, value: evidence[field], state: 'live', measuredAt: evidence.asOf, ruleId: current.ruleId })
    const cardSelector = `.agent-conversation .agent-message-assistant .personal-agent-proposal[data-proposal-id="${current.id}"]`
    await wait(() => evaluate(`!!document.querySelector(${JSON.stringify(cardSelector)} + ' .personal-agent-proposal-advice')`),
      'The matching conversation card did not render advice')
    win.showInactive()
    await evaluate(`document.querySelector(${JSON.stringify(cardSelector)} + ' .personal-agent-proposal-advice').scrollIntoView({ block: 'center', behavior: 'instant' })`)
    await wait(() => evaluate(`(() => {
      const advice = document.querySelector(${JSON.stringify(cardSelector)} + ' .personal-agent-proposal-advice')
      const bounds = advice?.getBoundingClientRect()
      const view = advice?.closest('.agent-conversation').getBoundingClientRect()
      return bounds && bounds.top >= Math.max(0, view.top) && bounds.bottom <= Math.min(innerHeight, view.bottom)
    })()`), 'The advice was outside the conversation viewport')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const rendered = await evaluate(`(() => {
      const card = document.querySelector(${JSON.stringify(cardSelector)})
      return { evidenceDisclosure: Boolean(card.querySelector('details.personal-agent-proposal-evidence')),
        sourceIdentifier: card.textContent.includes(${JSON.stringify(readingId)}),
        canExecute: Boolean(card.querySelector('.personal-agent-proposal-primary, a')),
        advice: card.querySelector('.personal-agent-proposal-advice')?.textContent,
        nextSteps: [...card.querySelectorAll('.personal-agent-proposal-next-step')].map(node => node.textContent.trim()),
        readings: [...card.querySelectorAll('.openui-reading, .openui-metric')].map(node => ({
          label: node.querySelector('.personal-agent-preview-label')?.textContent ?? '',
          value: node.querySelector('.personal-agent-preview-value')?.textContent ?? '',
        })) }
    })()`)
    const { advice, readings, nextSteps, ...controls } = rendered
    if (useMem0) assert.deepEqual(nextSteps, [current.nextStep])
    assert.deepEqual(controls, { evidenceDisclosure: false, sourceIdentifier: false, canExecute: false })
    assert.match(pinIdea ? [advice, current.nextStep].join(' ') : advice, /jacket|外套/i)
    const temperatureReadings = readings.filter(({ label, value }) => /temperature|气温|温度/i.test(label) && /\d/.test(value))
    for (const { label, value } of temperatureReadings) {
      assert.match(`${label} ${value}`, /°\s*C|℃|摄氏度/i, 'A rendered temperature must show degrees Celsius')
    }
    assert.equal(proposals().length, 1)
    assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(cardSelector)}).length`), 1)
    const replySelector = `.agent-conversation .agent-message-assistant[data-owner-turn-id="${ownerTurn.id}"]:not(.agent-recommendation) .agent-message-body`
    const typography = await wait(() => evaluate(`(() => {
      const reply = document.querySelector(${JSON.stringify(replySelector)})
      const advice = document.querySelector(${JSON.stringify(cardSelector)} + ' .personal-agent-proposal-advice')
      if (!reply?.checkVisibility() || !reply.textContent.trim() || !advice?.checkVisibility()) return null
      return {
        replyFontSize: getComputedStyle(reply.querySelector('p') || reply).fontSize,
        recommendationFontSize: getComputedStyle(advice.querySelector('p') || advice).fontSize,
      }
    })()`), 'The completed model reply and recommendation were not both rendered in the conversation')
    assert.equal(typography.recommendationFontSize, typography.replyFontSize,
      'The Weather Intent recommendation must match the completed model reply font size')
    report('card-verified', typography)
    await evaluate(`document.querySelector(${JSON.stringify(cardSelector)}).scrollIntoView({ block: 'end', behavior: 'instant' })`)
    await evaluate(`(() => {
      const latest = document.querySelector('.agent-latest')
      if (latest && !latest.hidden) latest.click()
    })()`)
    await wait(() => evaluate(`document.querySelector('.agent-latest')?.hidden !== false`),
      'Jump to latest still covered the reminder controls')
    await wait(() => evaluate(`(() => {
      const more = document.querySelector(${JSON.stringify(cardSelector)} + ' details.personal-agent-proposal-more > summary')
      const bounds = more?.getBoundingClientRect()
      const view = more?.closest('.agent-conversation').getBoundingClientRect()
      return bounds && bounds.top >= Math.max(0, view.top) && bounds.bottom <= Math.min(innerHeight, view.bottom)
    })()`), 'The More control was outside the conversation viewport')
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    if (process.env.ODK_INTENT_E2E_SCREENSHOT) {
      const image = await win.webContents.capturePage()
      await writeFile(process.env.ODK_INTENT_E2E_SCREENSHOT, image.toPNG(), { mode: 0o600 })
    }
    const checkpoint = join(stateDir, 'proactive', 'state.json')
    if (useMem0) {
      const refreshed = await freshWeatherAfter(Date.parse(current.evidence[0].measuredAt), 30000)
      const freshWeather = await wait(() => proposals().find(p => p.id === current.id
        && p.evidence[0]?.measuredAt === refreshed.value.asOf)?.evidence[0],
      'The same suggestion did not receive refreshed live weather evidence')
      await remember(unrelatedNote, unrelatedValue)
      assert.deepEqual(proposals().map(p => p.id), [current.id], 'An unrelated note cannot invalidate the recommendation')
      assert.equal(await evaluate(`!!document.querySelector(${JSON.stringify(cardSelector)})`), true)
      report('unrelated-note-preserved-card')
      await remember(walkNote, walkPaused)
      await wait(async () => {
        const state = JSON.parse(await readFile(checkpoint, 'utf8'))
        return state.proposals.find(p => p.id === current.id)?.status === 'expired'
      }, 'Changing the referenced note did not expire the saved proposal')
      await wait(() => evaluate(`!document.querySelector(${JSON.stringify(cardSelector)})`),
        'The expired proposal remained in the conversation')
      assert.equal(proposals().length, 0)
      assert.deepEqual(intentStore().list(), [intent], 'The rule must remain enabled at the same revision')
      assert(Date.now() < dueAt + 12 * 60000, 'The saved schedule was still open')
      assert(Date.now() - Date.parse(freshWeather.measuredAt) < 300000, 'The weather evidence must still be fresh')
      report('referenced-note-expired-card', { status: 'expired', stillEnabled: true, removedFromConversation: true })
      if (process.env.ODK_INTENT_E2E_EXPIRED_SCREENSHOT) {
        await writeFile(process.env.ODK_INTENT_E2E_EXPIRED_SCREENSHOT, (await win.capturePage()).toPNG(), { mode: 0o600 })
      }
      resident.kill('SIGTERM')
      await exit
      assert.deepEqual(exited, [0, null], 'Close the resident before opening its native Qdrant store')
      const { createMem0Backend } = await import(integrationURL('personal-agent/src/mem0.mjs'))
      const { createMemoryStore } = await import(integrationURL('personal-agent/src/memory.mjs'))
      const backend = createMem0Backend({ stateDir, env })
      try {
        const notes = createMemoryStore({ stateDir, scope: backend.scope(stateDir, 'notes') })
        assert.deepEqual((await notes.readNamed([walkNote, unrelatedNote])).notes,
          { [walkNote]: walkPaused, [unrelatedNote]: unrelatedValue })
      } finally { await backend.close() }
      report('native-mem0-restart-verified')
      console.log('WEATHER_MEM0_ROUTINE_E2E_PASS ' + JSON.stringify({ arch: process.arch, provider: 'Open-Meteo',
        selectedModel, generationModel: generation.model, trigger: generation.trigger, generatedAt: generation.at,
        dueAt: new Date(dueAt).toISOString(), field, weatherValue: evidence[field], measuredAt: evidence.asOf,
        conversationSave: true, routineRevision: intent.revision, namedNotes: routine.if.memoryKeys, nextStep: current.nextStep,
        openUI: true, nextStepCount: 1, readOnly: true, sourceDisclosure: false, nativeMem0: true,
        unrelatedNotePreservedCard: true, expiredAfterReferencedNoteWrite: true, removedFromConversation: true,
        routineStillEnabled: true, refreshedWeatherEvidenceAt: freshWeather.measuredAt, ...typography }))
      return
    }
    if (schedule) {
      const nextAt = dueAt + schedule.everyMinutes * 60000
      const [hour, minute] = at.split(':').map(Number)
      const nextMinute = String(hour * 60 + minute + schedule.everyMinutes).padStart(4, '0')
      const slot = await wait(async () => {
        if (Date.now() < nextAt) return false
        const claim = JSON.parse(await readFile(checkpoint, 'utf8')).intentClaims.find(item => item.intentId === intent.id)
        return claim?.checkSlot?.slice(11) >= nextMinute && claim.checkSlot
      }, 'The next interval slot was not recorded', Math.max(0, nextAt - Date.now()) + 30000)
      assert.deepEqual(proposals().map(p => p.id), [current.id])
      assert.equal(await evaluate(`document.querySelectorAll(${JSON.stringify(cardSelector)}).length`), 1)
      report('next-slot-deduplicated', { slot, sameCard: true })
    }
    const matchingCards = proposals().length
    await evaluate(`(() => {
      const card = document.querySelector(${JSON.stringify(cardSelector)})
      const menu = card.querySelector('details.personal-agent-proposal-more')
      if (!menu?.open) menu?.querySelector('summary').click()
      const pause = card.querySelector('button[data-proposal-action="mute"]')
      if (!pause || pause.textContent !== 'Pause reminder' || pause.disabled) throw Error('The reminder pause control is unavailable')
      pause.scrollIntoView({ block: 'center', behavior: 'instant' })
    })()`)
    await wait(() => evaluate(`document.querySelector(${JSON.stringify(cardSelector)} + ' button[data-proposal-action="mute"]')?.checkVisibility() === true`),
      'The pause reminder control did not become visible in More')
    await evaluate(`document.querySelector(${JSON.stringify(cardSelector)} + ' button[data-proposal-action="mute"]').click()`)
    await wait(() => intentStore().list().find(saved => saved.id === intent.id)?.enabled === false,
      'Pause reminder did not persist the exact Intent disabled')
    await wait(() => proposals().length === 0, 'The paused Intent retained a pending suggestion')
    await wait(() => evaluate(`!document.querySelector(${JSON.stringify(cardSelector)})`),
      'The paused reminder card remained in the conversation')
    report('reminder-paused')
    console.log('WEATHER_INTENT_E2E_PASS ' + JSON.stringify({ arch: process.arch, provider: 'Open-Meteo', readingId,
      field, value: evidence[field], measuredAt: evidence.asOf, conversationSave: true,
      ...(pinIdea ? { discussionBeforeSave: true, savedSchedule: routine.when, dueAt: new Date(dueAt).toISOString(),
        generatedAt: generation.at, trigger: generation.trigger, advice, nextStep: current.nextStep,
        ...(schedule ? { nextSlotDeduplicated: true } : {}) } : {}),
      persistedRevision: intent.revision, matchingCards, readOnly: true, sourceDisclosure: false, backendEvidenceVerified: true, reminderPaused: true,
      selectedModel, generationModel: generation.model, routineFile: ROUTINE_FILENAME, memorySeparate: true, temperatureReadings, ...typography }))
  } finally {
    unsubscribe?.()
    output?.close()
    if (resident && !exited) resident.kill('SIGTERM')
    try {
      if (exit) await exit
      await host.stop()
    } finally { await rm(root, { recursive: true, force: true }) }
  }
}

module.exports = { verifyWeatherIntent }
