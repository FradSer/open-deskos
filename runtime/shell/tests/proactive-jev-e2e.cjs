// Explicit opt-in device E2E. Reads deployed modules and a protected Jev key;
// IPC, owner writes and checkpoints belong to this fixture. The explicit actual
// Widget mode reads live Desk Data without writing to any production source.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomBytes } = require('node:crypto')
const { pathToFileURL } = require('node:url')

if (!process.argv.includes('--live-jev-e2e')) throw Error('Explicit --live-jev-e2e required')
const option = name => process.argv[process.argv.indexOf(name) + 1]
for (const name of ['--runtime-root', '--personal-bot-root', '--jev-key', '--receipt']) {
  if (!process.argv.includes(name)) throw Error(`Missing ${name}`)
}
const runtime = path.resolve(option('--runtime-root'))
const personalBotRoot = path.resolve(option('--personal-bot-root'))
const receipt = path.resolve(option('--receipt'))
const generated = process.argv.includes('--generated-e2e')
const actual = process.argv.includes('--actual-widget-e2e')
let actualConfig, actualRead, generationCount = 0
if (actual && (!generated || !process.argv.includes('--owner'))) throw Error('Actual Widget E2E requires --generated-e2e and --owner')
process.umask(0o077)
if (generated) {
  for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--env-file') {
    for (const line of fs.readFileSync(process.argv[++i], 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z][A-Z0-9_]+)=(.*)$/)
      if (!m || /^(HOME|DISPLAY|XDG_|APPDATA|LOCALAPPDATA)/.test(m[1]) || (m[1].startsWith('ODESK_') && m[1] !== 'ODESK_PERSONAL_BOT_MODEL')) continue
      process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1')
    }
  }
}
const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'odk-jev-e2e-')))
app.setPath('userData', path.join(profile, 'electron'))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-dev-shm-usage')
const receipts = []
let receiptWriter
const record = value => {
  if (!receiptWriter) { console.error('E2E failed before private receipt initialization'); return }
  receipts.push(value)
  receiptWriter.write(JSON.stringify({ host: process.platform, isolated: true, fixtureProfile: profile, receipts }, null, 2))
  console.log(JSON.stringify(actual ? { case: value.case, result: value.result, model: value.model } : value))
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const until = async (predicate, label, timeout = 30000) => {
  const start = Date.now()
  while (!await predicate()) {
    if (Date.now() - start > timeout) throw Error(`Timed out: ${label}`)
    await pause(50)
  }
}
let win, client, watch, service, server, generator
let executeCount = 0
const deadline = setTimeout(() => { record({ result: 'fail', reason: 'E2E deadline' }); app.exit(1) }, generated ? 360000 : 120000)
async function cleanup() {
  clearTimeout(deadline)
  client?.stop()
  await watch?.close()
  await service?.close()
  await server?.close()
  await generator?.close()
  win?.destroy()
  // Windows keeps Chromium profile handles until Electron exits. Its external
  // task runner removes this exact directory after waiting for the process.
  if (process.platform !== 'win32') fs.rmSync(profile, { recursive: true })
}

app.whenReady().then(async () => {
  const load = name => import(pathToFileURL(path.join(personalBotRoot, 'src', name)))
  const [{ ProactiveWatch }, { createJevJudge }, { PersonalBotService }, { listen }, { proposalStateStore }] = await Promise.all([
    load('proactive.mjs'), load('proactive-jev.mjs'), load('service.mjs'), load('socket.mjs'), load('proactive-state.mjs'),
  ])
  const { createPersonalBotClient } = require(path.join(runtime, 'src/personal-bot-client.js'))
  const { createHydraStore } = require(path.join(runtime, 'src/hydra-mqtt.js'))
  const { createShellDeskData } = require(path.join(runtime, 'src/desk-data.js'))
  const { protectProactivePath } = await load('proactive-private.mjs')
  const { privateReceipt } = require('./helpers/private-receipt')
  receiptWriter = privateReceipt(receipt, protectProactivePath)
  if (process.platform === 'win32') protectProactivePath(profile)
  let forward = false
  const hydra = createHydraStore({ onUpdate: () => { if (forward) client.servicePush(['odk.tile.hydra']) } })
  hydra.markConnected(true)
  const soil = value => {
    for (const [topic, data] of [['main/online', 'true'], ['main/env', 'v=1;t=26;h=50;p=1000;l=0'], ['node1/online', 'true'], ['node1/soil', String(value)]]) {
      assert.equal(hydra.applyMessage(`hydra/${topic}`, data, Date.now()), true)
    }
  }
  soil(60)
  const { createDeskDataRegistry } = require(path.join(runtime, 'src/desk-data-registry.js'))
  const registry = generated ? createDeskDataRegistry({ onPublish: id => { if (forward) client.servicePush([id]) } }) : createShellDeskData({ hydra: { snapshot: () => hydra.snapshot(Date.now()) } }).registry
  if (generated) {
    const { createPersonalBot } = await load('agent.mjs')
    const {createAgentSession}=await import(pathToFileURL(path.join(personalBotRoot,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')))
    generator = await createPersonalBot({ stateDir: path.join(profile, 'generator'), model: process.env.ODESK_PERSONAL_BOT_MODEL, personal: { profile: 'personal', skillPaths: [], memoryFile: path.join(profile, 'generator/memory.json') } }, {createSession:async options=>{const r=await createAgentSession(options);r.session.subscribe(e=>{if(e.type==='message_end' && e.message.role==='assistant' && ['error','aborted'].includes(e.message.stopReason))record({case:'generation_provider_failure',stopReason:e.message.stopReason})});return r}})
    for (const id of ['example.parcels', 'example.ci']) registry.register({ id, label: id, kind: 'package', declaration: { fields: { status: { type: 'string' }, measured_at: { type: 'string' } } } })
  }
  const judge = createJevJudge({ env: { ODESK_JEV_KEY_FILE: option('--jev-key') } })
  service = new PersonalBotService({ record: async () => assert.fail('No microphone capture'), transcribe: async () => assert.fail('No transcription'), prompt: async () => assert.fail('No conversation call') })
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\odk-jev-e2e-${randomBytes(8).toString('hex')}` : path.join(profile, 'personal-bot/agent.sock')
  const token = process.platform === 'win32' ? randomBytes(32).toString('base64url') : ''
  server = await listen(endpoint, service, { token })
  client = createPersonalBotClient({ socketPath: endpoint, token })
  for (const channel of ['odk-opencode-go-status', 'odk-pi-sessions', 'odk-hydra-status', 'odk-weread-highlight', 'odk-futu-holdings', 'odk-weather-status', 'odk-user-apps-list', 'odk-camera-frame', 'odk-app-manager-list', 'odk-remote-publish-page-state']) {
    ipcMain.handle(channel, () => ({ ok: false, sessions: [], workspaces: [], apps: [] }))
  }
  ipcMain.handle('odk-personal-bot-status', () => client.snapshot())
  const commands = []
  ipcMain.handle('odk-personal-bot-proposal', (_event, command) => { commands.push(command); return { accepted: client.proposalCommand(command) } })
  win = new BrowserWindow({ show: false, width: 480, height: 854, useContentSize: true, webPreferences: { preload: path.join(runtime, 'src/preload.js'), contextIsolation: true, sandbox: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(path.join(runtime, 'src/renderer/index.html'))
  const run = expression => win.webContents.executeJavaScript(expression)
  client.subscribe(status => win.webContents.send('odk-personal-bot-status', status))
  client.start()
  await until(() => client.snapshot().state === 'idle', 'authenticated client')
  const snapshot = () => run(`(() => { const panel=document.getElementById('personal-bot-status'); return {hidden:panel.hidden,proactive:panel.dataset.proactive,modal:panel.getAttribute('aria-modal'),focus:document.activeElement?.id,overflow:document.documentElement.scrollWidth>innerWidth,rows:[...panel.querySelectorAll('.personal-bot-proposal')].map(n=>({state:n.querySelector('.personal-bot-proposal-state').textContent,evidence:[...n.querySelectorAll('.personal-bot-proposal-evidence')].map(e=>e.textContent),advice:n.textContent,buttons:[...n.querySelectorAll('button')].map(b=>({text:b.textContent,height:b.getBoundingClientRect().height}))}))} })()`)
  if(actual) {
 const {readProactiveFile}=await load('proactive-private.mjs')
 const {deskDataRequest}=await load('desk-data.mjs')
 actualConfig=JSON.parse(readProactiveFile(option('--owner'),65536))
 assert.equal(actualConfig.version,2)
 const listed=await deskDataRequest('list');record({case:'actual_widget_inventory',readings:listed.readings})
 actualRead=async id=>{const {reading}=await deskDataRequest('read',{id});record({case:'actual_widget_read',reading});return reading}
}
  const config = () => actual ? actualConfig : generated ? { version: 2, pollMs: 1000, maxAgeMs: 1800000, cooldownMs: 60000, maxCandidates: 8, maxPush: 3, suppressed: [], snoozed: {}, rules: [
    { id: 'parcels', goal: '及时领取确实已到达且即将超过保管期限的包裹。', observations: [{ readingId: 'example.parcels', fields: ['status'] }], delivery: 'immediate', urgent: false },
    { id: 'builds', goal: '我希望在负责的发布验证失败时立即提醒我检查错误报告。', observations: [{ readingId: 'example.ci', fields: ['status'] }], delivery: 'immediate', urgent: false },
  ] } : { version: 1, pollMs: 1000, maxAgeMs: 1800000, cooldownMs: 60000, suppressed: [], snoozed: {}, rules: [{ id: 'e2e-dry-soil', delivery: 'immediate', urgent: false, advice: '检查这盆植物的盆土；确认干燥后再决定是否浇水。', conditions: [{ readingId: 'odk.tile.hydra', field: 'plants.0.soilPercent', measuredAtField: 'plants.0.measuredAt', op: 'lt', value: 15 }] }] }
  let judgments = [], popupCount = 0, ownerWrites = []
  async function setup(name, judgeOverride = judge) {
    await watch?.close()
    forward = false; judgments = []; popupCount = 0; ownerWrites = []
    const store = proposalStateStore(path.join(profile, name, 'state.json'))
    watch = new ProactiveWatch({ config: config(),
      read: async id => actual ? actualRead(id) : (await registry.read(id)).reading,
      judge: judgeOverride, onJudgment: data => { judgments.push(data); record({ case: name, ...data }) },
      ...(generated ? { generate: async input => { let raw;const began=Date.now();try{raw=await generator.generateProposals(input)}catch(e){record({case:'generation_failure',errorType:e.name,elapsedMs:Date.now()-began});throw e}; record({ case: name, ...(actual ? {actualCandidates:raw.suggestions}: {syntheticCandidates:raw.suggestions}) }); return raw }, onGeneration: data => { generationCount++; record({ case: name, model: generator.generationModel, generation: data }) } } : {}),
      publish: frame => { if (frame.popup) popupCount++; service.propose(frame) },
      save: async data => { ownerWrites.push(structuredClone(data)); fs.writeFileSync(path.join(profile, `${name}-owner.json`), JSON.stringify(data), { mode: 0o600 }) },
      loadState: store.load, saveState: store.save,
      phrase: async ({ advice }) => advice,
      execute: async () => { executeCount++; assert.fail('E2E must not execute an action') },
    })
    service.attachWatch(watch)
    service.propose({ proposals: [], popup: false })
    await run('odkPersonalBotStatus.close()')
    await pause(150)
    return store
  }
  const assertPanel = async (kind, value) => {
    await until(() => watch.list().some(p => p.presented && p.status === 'pending'), 'renderer acknowledgement')
    const dom = await snapshot(), p = watch.list().find(p => p.status === 'pending')
    assert.equal(dom.hidden, false); assert.equal(dom.proactive, 'true'); assert.equal(dom.modal, 'false'); assert.equal(dom.overflow, false)
    assert.equal(p.judgment.trigger, kind); assert.match(p.judgment.model, /^jev-/)
    assert.ok(p.judgment.probability >= p.judgment.threshold)
    assert.equal(p.evidence[0].value, value)
    assert.ok(dom.rows.some(row => row.evidence.some(e => e.includes(`: ${value}`) && e.includes('measured'))))
    assert.ok(dom.rows.every(row => row.buttons.every(b => b.height >= 44)))
    assert.equal(service.status.transcript, ''); assert.equal(executeCount, 0)
    record({ case: kind, result: 'panel_pass', judgment: p.judgment, dom })
  }

  if(actual) {
    await setup('actual_widgets')
    await watch.tick()
    assert.equal(watch.judgmentError,'')
    assert.ok(generationCount > 0, 'Actual evidence must reach generator')
    await pause(500)
    record({case:'actual_heartbeat',proposals:watch.list(),dom:await snapshot()})
    if(watch.list().some(p=>p.status==='pending')){assert.equal(client.proposalCommand({type:'proposal_list'}),true);await until(()=>watch.list().some(p=>p.presented),'heartbeat explicit advice acknowledgement');record({case:'actual_explicit_view',dom:await snapshot()});await run('odkPersonalBotStatus.close()')}
    const ids=[...watch.selectedSources()].filter(id=>!id.startsWith('pi-tasks.'))
    const before=generationCount
    assert.equal(client.servicePush(ids),true)
    await until(()=>generationCount > before || !!watch.judgmentError,'actual service push generation',150000)
    await until(()=>!watch.running,'actual push finishes',30000)
    assert.equal(watch.judgmentError,'')
    await pause(500)
    const dom=await snapshot(), proposals=watch.list().filter(p=>p.status==='pending')
    assert.equal(dom.overflow,false)
    if(!proposals.length)assert.equal(dom.hidden,true)
    assert.equal(executeCount,0)
    record({case:'actual_service_push',proposals,dom})
    if(proposals.length){assert.equal(client.proposalCommand({type:'proposal_list'}),true);await until(()=>watch.list().some(p=>p.presented),'actual selected advice acknowledgement');record({case:'actual_explicit_view',dom:await snapshot()})}
    await cleanup()
    record({result:'pass',actualWidgetData:true,generationCount,judgmentCount:judgments.length,executeCount:0,productionDataWrites:0})
    app.exit(0);return
  }
  if (generated) {
    const source = (positive) => {
      assert.equal(registry.publish('example.parcels', { status: positive ? '包裹已到达取件点，需要本人领取，距离退回仅剩10分钟，尚未领取。' : '当前没有待领取包裹，也没有即将到期的包裹。', measured_at: new Date().toISOString() }).ok, true)
      assert.equal(registry.publish('example.ci', { status: positive ? '你负责的发布验证刚失败，3项测试失败，错误报告已准备好，尚未查看。' : '最近的发布验证已通过，报告已查看，没有未处理问题。', measured_at: new Date().toISOString() }).ok, true)
    }
    const check = async kind => {
      await until(() => watch.list().filter(p => p.status === 'pending' && p.presented).length >= 1, 'generated renderer acknowledgement')
      const proposals = watch.list().filter(p => p.status === 'pending'), dom = await snapshot()
      assert.equal(dom.hidden, false); assert.equal(dom.modal, 'false'); assert.equal(dom.overflow, false)
      assert.ok(proposals.every(p => p.action === null && p.judgment.trigger === kind && p.judgment.groundingProbability >= p.judgment.threshold))
      assert.ok(dom.rows.some(row => row.evidence.some(e => e.includes('example.') && e.includes('measured'))))
      record({ case: kind, result: 'generated_panel_pass', count: proposals.length, proposals: proposals.map(p => ({ advice: p.advice, judgment: p.judgment })), dom })
    }
    source(false)
    await setup('generated_heartbeat')
    watch.start()
    await until(() => !watch.running && (judgments.length > 0 || !!watch.judgmentError || watch.timer), 'normal generation completes', 60000)
    assert.equal(watch.judgmentError, ''); assert.equal(watch.list().filter(p => p.status === 'pending').length, 0); assert.equal((await snapshot()).hidden, true)
    source(true)
    await until(() => watch.list().some(p => p.status === 'pending'), 'periodic generated advice', 90000)
    await check('heartbeat')
    await watch.close()
    source(false)
    const store = await setup('generated_push')
    watch.config.pollMs = 60000
    await watch.tick()
    assert.equal(watch.list().filter(p => p.status === 'pending').length, 0)
    forward = true; source(true)
    await until(() => watch.list().some(p => p.status === 'pending'), 'generic published source push', 90000)
    await check('service_push')
    await run(`[...document.querySelectorAll('.personal-bot-proposal button')].find(b=>b.textContent==='Ignore').click()`)
    await until(() => watch.list().some(p => p.status === 'ignored'), 'generated UI ignore')
    assert.ok(store.load().proposals.some(p => p.status === 'ignored'))
    assert.equal(executeCount, 0); assert.equal(service.status.transcript, '')
    assert.ok(receipts.some(r => r.generation?.candidates >= 2), 'one generation batch must produce multiple candidates')
    await cleanup(); record({ result: 'pass', generatorAndJev: true, executeCount, microphoneCaptures: 0, productionDataWrites: 0 }); app.exit(0); return
  }

  // The next positive originates from the actual periodic timer, not a manual tick.
  const heartbeatStore = await setup('heartbeat')
  watch.start()
  await until(() => judgments.length >= 1, 'normal heartbeat judgment')
  assert.equal(watch.list().length, 0); assert.equal((await snapshot()).hidden, true)
  soil(5)
  await until(() => watch.list().some(p => p.status === 'pending'), 'periodic dry heartbeat')
  await assertPanel('heartbeat', 5)
  assert.equal(heartbeatStore.load().proposals[0].presented, true)
  await until(() => judgments.length >= 3, 'repeat heartbeat')
  await until(() => !watch.running, 'heartbeat completion')
  assert.equal(popupCount, 1); assert.equal(watch.list().filter(p => p.status === 'pending').length, 1)
  record({ case: 'heartbeat', result: 'no_duplicate_popup', count: popupCount })
  await watch.close()

  soil(60)
  const pushStore = await setup('service_push')
  watch.config.pollMs = 60000
  watch.start()
  await until(() => judgments.length === 1 && !watch.running, 'normal push baseline')
  assert.equal(watch.list().length, 0); assert.equal((await snapshot()).hidden, true)
  forward = true; soil(5)
  await until(() => watch.list().some(p => p.status === 'pending'), 'Hydra push judgment')
  await assertPanel('service_push', 5)
  assert.equal(judgments.length, 2, 'four source messages must coalesce to one push judgment')
  await run(`[...document.querySelectorAll('.personal-bot-proposal button')].find(b=>b.textContent==='Ignore').click()`)
  await until(() => watch.list().some(p => p.status === 'ignored'), 'UI ignore through private channel')
  assert.ok(ownerWrites.at(-1).snoozed['e2e-dry-soil'] > Date.now())
  assert.equal(pushStore.load().proposals[0].status, 'ignored')
  record({ case: 'service_push', result: 'ignore_checkpoint_pass', commands: commands.filter(c => c.type === 'proposal_respond').map(c => c.decision) })
  await watch.close()

  // A controlled transport fault exercises the actual adapter's error path.
  const unavailableJudge = createJevJudge({ env: { ODESK_JEV_KEY_FILE: option('--jev-key') }, fetchImpl: async () => { throw Error('E2E transport unavailable') } })
  await setup('unavailable', unavailableJudge)
  await watch.tick()
  await until(() => !!client.snapshot().proposalError, 'unavailable status crossing channel')
  assert.equal(watch.list().length, 0); assert.equal(popupCount, 0); assert.equal((await snapshot()).hidden, true)
  assert.match(client.snapshot().proposalError, /Jev/); assert.equal(executeCount, 0)
  record({ case: 'unavailable', result: 'no_fallback_pass', error: client.snapshot().proposalError })
  await cleanup()
  record({ result: 'pass', executeCount, microphoneCaptures: 0, productionDataWrites: 0 })
  app.exit(0)
}).catch(async error => {
  record({ result: 'fail', reason: error.message })
  await cleanup().catch(() => {})
  app.exit(1)
})
