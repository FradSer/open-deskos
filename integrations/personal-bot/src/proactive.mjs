import { randomUUID } from 'node:crypto'
import { rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { writeFileSync, fsyncSync, closeSync } from 'node:fs'
import { readProactiveFile, openProactiveTemporary } from './proactive-private.mjs'
import { pollGenerated } from './proactive-generation.mjs'

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const FIELD = /^(?:[A-Za-z][A-Za-z0-9_]*|\d+)(?:\.(?:[A-Za-z][A-Za-z0-9_]*|\d+))*$/
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const OPS = { lt: (a, b) => a < b, lte: (a, b) => a <= b, gt: (a, b) => a > b, gte: (a, b) => a >= b, eq: (a, b) => a === b }
const ACTIONS = new Set(['memory_update', 'user_app_install', 'coding_task_start', 'coding_task_history'])
const pending = p => p.status === 'pending'
const own = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).every(key => keys.includes(key))
const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\x00-\x08]/.test(value)
function pathValid(value) {
  return typeof value === 'string' && value.length <= 256 && FIELD.test(value) && !value.split('.').some(part => ['__proto__', 'constructor', 'prototype'].includes(part))
}
function field(value, path) {
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}

/** Only an owner file creates rules. Plugin strings never enter this parser. */
export function validateOwnerConfig(config) {
  const fail = () => { throw Error('Invalid proactive owner configuration') }
  const generated = config?.version === 2
  if (!own(config, ['version', 'pollMs', 'maxAgeMs', 'cooldownMs', 'quietHours', 'rules', 'suppressed', 'snoozed', 'routineDays', ...(generated ? ['maxCandidates', 'maxPush'] : [])]) || ![1, 2].includes(config.version)) fail()
  if (generated && (!Number.isInteger(config.maxCandidates) || config.maxCandidates < 1 || config.maxCandidates > 16 || !Number.isInteger(config.maxPush) || config.maxPush < 1 || config.maxPush > config.maxCandidates)) fail()
  for (const [key, minimum, maximum] of [['pollMs', 1000, 3600000], ['maxAgeMs', 1000, 86400000], ['cooldownMs', 60000, 604800000]]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < minimum || config[key] > maximum) fail()
  }
  if (config.quietHours) {
    if (!own(config.quietHours, ['start', 'end', 'timeZone']) || !TIME.test(config.quietHours.start) || !TIME.test(config.quietHours.end) || !text(config.quietHours.timeZone, 80)) fail()
    try { new Intl.DateTimeFormat('en', { timeZone: config.quietHours.timeZone }).format() } catch { fail() }
  }
  if (!Array.isArray(config.rules) || config.rules.length > 32 || new Set(config.rules.map(r => r.id)).size !== config.rules.length) fail()
  for (const rule of config.rules) {
    if (generated) {
      if (!own(rule, ['id', 'goal', 'observations', 'delivery', 'urgent', 'at', 'coding']) || !ID.test(rule.id) || !text(rule.goal, 1000) || !['immediate', 'routine', 'silent'].includes(rule.delivery) || typeof rule.urgent !== 'boolean' || (rule.delivery === 'routine' && !TIME.test(rule.at))) fail()
      if (rule.coding) {
        if (rule.observations || !own(rule.coding, ['target', 'project', 'taskId']) || !['cm5', 'mac'].includes(rule.coding.target) || !text(rule.coding.project, 1024) || (rule.coding.taskId !== undefined && !/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rule.coding.taskId))) fail()
      } else if (!Array.isArray(rule.observations) || !rule.observations.length || rule.observations.length > 8) fail()
      for (const o of rule.observations ?? []) {
        if (!own(o, ['readingId', 'fields', 'measuredAtField', 'liveWhen']) || !ID.test(o.readingId) || !Array.isArray(o.fields) || !o.fields.length || o.fields.length > 8 || new Set(o.fields).size !== o.fields.length || !o.fields.every(pathValid) || (o.measuredAtField !== undefined && !pathValid(o.measuredAtField))) fail()
        if (o.liveWhen && (!own(o.liveWhen, ['field', 'value']) || !pathValid(o.liveWhen.field) || typeof o.liveWhen.value !== 'boolean')) fail()
      }
      continue
    }
    if (!own(rule, ['id', 'conditions', 'delivery', 'urgent', 'advice', 'at', 'action', 'coding']) || !ID.test(rule.id) || !text(rule.advice, 1000) || !['immediate', 'routine', 'silent'].includes(rule.delivery) || typeof rule.urgent !== 'boolean') fail()
    if (rule.delivery === 'routine' && !TIME.test(rule.at)) fail()
    if (rule.coding) {
      if (!own(rule.coding, ['target', 'project', 'taskId']) || !['cm5', 'mac'].includes(rule.coding.target) || !text(rule.coding.project, 1024) || (rule.coding.taskId !== undefined && !/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(rule.coding.taskId)) || rule.conditions?.length || rule.action) fail()
    } else if (!Array.isArray(rule.conditions) || !rule.conditions.length || rule.conditions.length > 8) fail()
    for (const c of rule.conditions ?? []) {
      if (!own(c, ['readingId', 'field', 'measuredAtField', 'op', 'value']) || !ID.test(c.readingId) || !pathValid(c.field) || (c.measuredAtField !== undefined && !pathValid(c.measuredAtField)) || !Object.hasOwn(OPS, c.op)) fail()
      if (!['number', 'boolean', 'string'].includes(typeof c.value) || (typeof c.value === 'number' && !Number.isFinite(c.value)) || (c.op !== 'eq' && typeof c.value !== 'number') || (typeof c.value === 'string' && c.value.length > 256)) fail()
    }
    if (rule.action) {
      if (!own(rule.action, ['tool', 'params']) || !ACTIONS.has(rule.action.tool) || !rule.action.params || typeof rule.action.params !== 'object' || Array.isArray(rule.action.params) || JSON.stringify(rule.action.params).length > 4096) fail()
      if (rule.action.tool === 'memory_update' && (!own(rule.action.params, ['category', 'value']) || !/^[\p{L}\p{N}_-]{1,40}$/u.test(rule.action.params.category) || !text(rule.action.params.value, 1000) || /[\r\n]/.test(rule.action.params.value))) fail()
    }
  }
  if (!Array.isArray(config.suppressed) || config.suppressed.length > 32 || !config.suppressed.every(id => config.rules.some(r => r.id === id)) || !own(config.snoozed, config.rules.map(r => r.id)) || !Object.values(config.snoozed).every(Number.isSafeInteger)) fail()
  const routineDays = config.routineDays ?? {}
  if (!own(routineDays, config.rules.map(r => r.id)) || !Object.values(routineDays).every(day => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day))) fail()
  return { ...structuredClone(config), routineDays: structuredClone(routineDays) }
}

export function loadProactiveConfig(file) {
  return validateOwnerConfig(JSON.parse(readProactiveFile(file, 65536)))
}

/** Atomic owner suppression updates; refuse a replaced or concurrently edited file. */
export function ownerConfigWriter(file, initial) {
  let expected = JSON.stringify(initial)
  return async config => {
    const current = loadProactiveConfig(file)
    if (JSON.stringify(current) !== expected) throw Error('Proactive owner configuration changed; restart service')
    const validated = validateOwnerConfig(config)
    const temporary = join(dirname(file), `.proactive-${randomUUID()}.tmp`)
    try {
      const fd = openProactiveTemporary(temporary)
      try { writeFileSync(fd, JSON.stringify(validated, null, 2) + '\n'); fsyncSync(fd) } finally { closeSync(fd) }
      await rename(temporary, file)
      expected = JSON.stringify(validated)
    } finally { await unlink(temporary).catch(() => {}) }
  }
}

function localTime(now, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const get = name => parts.find(p => p.type === name).value
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` }
}

/** Jev judges relevance; code owns observations, delivery and explicit actions. */
export class ProactiveWatch {
  constructor({ config, read, publish, save, phrase, execute, generate = undefined, judge = undefined, onGeneration = (_record) => {}, onJudgment = (_record) => {}, codingStatus = undefined, codingList = undefined, loadState = () => ({ version: 1, proposals: [] }), saveState = (_state) => {}, now = Date.now }) {
    this.config = validateOwnerConfig(config)
    this.read = read
    this.publish = publish
    this.save = save
    this.phrase = phrase
    this.execute = execute
    this.judge = judge ?? (async () => { throw Error('Jev unavailable') })
    this.generate = generate ?? (async () => { throw Error('Suggestion generation unavailable') })
    this.onGeneration = onGeneration
    this.onJudgment = onJudgment
    this.codingStatus = codingStatus
    this.codingList = codingList
    this.now = now
    this.saveState = saveState
    this.proposals = structuredClone(loadState().proposals)
    for (const p of this.proposals) {
      if (p.status === 'executing') { p.status = 'unknown'; p.result = '服务中断，执行结果未确认；请通过原工具核实，不要重复执行。' }
      const rule = this.config.rules.find(r => r.id === p.ruleId)
      if (pending(p) && (p.ruleVersion !== JSON.stringify(rule) || !this.authorizedAction(p, rule))) p.status = 'expired'
      if (pending(p) && !p.judgment) p.status = 'expired'
      if (pending(p) && !p.presented && rule?.delivery === 'immediate') p.offered = false
    }
    this.storageFailure = false
    this.busy = false
    this.revealAll = false
    this.running = false
    this.started = false
    this.closed = false
    this.controller = new AbortController()
    this.timer = undefined
    this.inflight = Promise.resolve()
    this.responding = false
    this.revision = 0
    this.interactionRevision = 0
    this.sourceRevisions = new Map()
    this.pushIds = new Set()
    this.pushTimer = undefined
    this.judgmentError = ''
    this.failedJudgments = new Set()
    this.seenTurns = new Map()
  }
  persist() { this.saveState({ version: 1, proposals: structuredClone(this.proposals) }) }
  start() {
    if (this.started || this.closed) return
    this.started = true
    const poll = () => {
      this.inflight = this.tick().catch(() => { /* One failed source is unavailable, never a guessed reading. */ })
      void this.inflight.finally(() => { if (!this.closed) this.timer = setTimeout(poll, this.config.pollMs) })
    }
    poll()
  }
  async close() {
    this.closed = true
    clearTimeout(this.timer)
    clearTimeout(this.pushTimer)
    this.controller.abort()
    await this.inflight
  }
  setBusy(busy) {
    this.busy = busy
    if (!busy && !this.closed) this.emit(true)
    if (!busy && this.pushIds.size) this.schedulePush()
  }
  push(readingIds) {
    if (this.closed || !Array.isArray(readingIds) || !readingIds.length || readingIds.length > 32 || !readingIds.every(id => typeof id === 'string' && ID.test(id))) return false
    const selected = this.selectedSources()
    const accepted = readingIds.filter(id => selected.has(id))
    if (!accepted.length) return false
    for (const id of new Set(accepted)) {
      this.pushIds.add(id)
      this.sourceRevisions.set(id, (this.sourceRevisions.get(id) ?? 0) + 1)
    }
    this.revision++
    this.schedulePush()
    return true
  }
  selectedSources() {
    return new Set(this.config.rules.flatMap(rule => rule.coding ? [`pi-tasks.${rule.coding.target}`] : (rule.observations ?? rule.conditions).map(c => c.readingId)))
  }
  schedulePush() {
    if (this.closed || this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = undefined
      if (this.closed || !this.pushIds.size) return
      if (this.running || this.responding || this.busy) { this.schedulePush(); return }
      const readingIds = [...this.pushIds].slice(0, 32)
      for (const id of readingIds) this.pushIds.delete(id)
      void this.tick({ kind: 'service_push', readingIds }).catch(() => {})
    }, 1000)
  }
  quiet() {
    const q = this.config.quietHours
    if (!q || q.start === q.end) return false
    const { time } = localTime(this.now(), q.timeZone)
    return q.start < q.end ? time >= q.start && time < q.end : time >= q.start || time < q.end
  }
  fresh(p) {
    return p.evidence.every(e => e.state === 'live' && Number.isFinite(Date.parse(e.measuredAt)) && this.now() >= Date.parse(e.measuredAt) && this.now() - Date.parse(e.measuredAt) <= this.config.maxAgeMs)
  }
  list() {
    for (const p of this.proposals) if (pending(p) && !this.fresh(p)) p.status = 'expired'
    return structuredClone(this.proposals)
  }
  async presented(ids) {
    const displayed = this.proposals.filter(p => ids.includes(p.id) && pending(p) && p.offered && !p.presented)
    const routine = displayed.filter(p => this.config.rules.find(r => r.id === p.ruleId)?.delivery === 'routine')
    for (const p of displayed) p.presented = true
    try { this.persist() } catch { this.emit(); return }
    if (routine.length) {
      if (this.responding) return
      this.responding = true
      try {
        const next = structuredClone(this.config)
        const { date } = localTime(this.now(), next.quietHours?.timeZone ?? 'UTC')
        for (const p of routine) next.routineDays[p.ruleId] = date
        await this.save(next)
        this.config = next
      } finally { this.responding = false }
    }
    this.emit()
  }
  emit(interaction = false) {
    if (this.closed) return
    this.list()
    const eligible = this.busy || this.storageFailure || this.judgmentError ? [] : this.proposals.filter(p => pending(p) && ((this.revealAll && this.recoverable(p)) || (!p.offered && this.deliverable(p, interaction)) || (interaction && p.offered && !p.presented && this.recoverable(p))))
    const priority = p => pending(p) ? (p.offered ? 1 : 0) : 2
    const display = []
    for (const p of this.list().sort((a, b) => priority(a) - priority(b))) {
      if (Buffer.byteLength(JSON.stringify([...display, p])) > 48000) continue
      display.push(p)
    }
    const popup = !this.busy && eligible.some(p => display.some(d => d.id === p.id))
    if (popup) for (const p of eligible) if (display.some(d => d.id === p.id)) {
      p.offered = true
      if (this.config.rules.find(r => r.id === p.ruleId)?.delivery === 'routine') p.routineDay = localTime(this.now(), this.config.quietHours?.timeZone ?? 'UTC').date
    }
    try { this.persist() } catch {
      this.storageFailure = true
      this.publish({ proposals: display, popup: false, interaction, hiddenCount: this.proposals.length - display.length, error: 'Suggestions unavailable: private proposal state could not be saved. No proposal action will run.' })
      return
    }
    if (popup) this.revealAll = false
    this.publish({ proposals: display, popup, interaction, hiddenCount: this.proposals.length - display.length, ...(this.judgmentError ? { error: this.judgmentError } : {}) })
  }
  interact(revealAll = false) { this.revealAll ||= revealAll; this.emit(true) }
  recoverable(p) {
    const rule = this.config.rules.find(r => r.id === p.ruleId)
    const clock = localTime(this.now(), this.config.quietHours?.timeZone ?? 'UTC')
    return rule && !this.config.suppressed.includes(rule.id) && (rule.delivery !== 'routine' || (clock.time >= rule.at && this.config.routineDays[rule.id] !== clock.date))
  }
  authorizedAction(p, rule) {
    if (!rule) return false
    if (this.config.version === 2) return p.action === null
    if (!rule.coding) return JSON.stringify(p.action ?? null) === JSON.stringify(rule.action ?? null)
    const params = p.action?.params
    const scope = rule.coding
    return p.action?.tool === 'coding_task_history' && params?.target === scope.target && params.taskId === p.subject &&
      (!scope.taskId || params.taskId === scope.taskId) && typeof params.project === 'string' &&
      (params.project === scope.project || (!scope.taskId && params.project.startsWith(scope.project.replace(/\/$/, '') + '/'))) &&
      Object.keys(params).every(key => ['target', 'project', 'taskId'].includes(key))
  }
  deliverable(p, interaction = false) {
    const rule = this.config.rules.find(r => r.id === p.ruleId)
    if (!rule || this.config.suppressed.includes(rule.id)) return false
    if (rule.delivery === 'routine') {
      const clock = localTime(this.now(), this.config.quietHours?.timeZone ?? 'UTC')
      if (clock.time < rule.at || this.config.routineDays[rule.id] === clock.date || this.proposals.some(q => q.ruleId === rule.id && q.routineDay === clock.date)) return false
    }
    if (interaction) return true
    if ((this.config.snoozed[rule.id] ?? 0) > this.now() || (this.quiet() && !rule.urgent)) return false
    if (rule.delivery === 'silent' || (this.config.version === 1 && this.proposals.some(q => q !== p && q.ruleId === p.ruleId && pending(q) && q.offered))) return false
    return true
  }
  async evidence(rule, enforceCriteria = false) {
    if (rule.observations) {
      const evidence = []
      for (const o of rule.observations) {
        let reading
        try { reading = await this.read(o.readingId, this.controller.signal) } catch { return null }
        if (reading?.state !== 'live' || reading.id !== o.readingId || (o.liveWhen && field(reading.value, o.liveWhen.field) !== o.liveWhen.value)) return null
        const measuredAt = o.measuredAtField ? field(reading.value, o.measuredAtField) : reading.value?.measured_at ?? reading.value?.asOf
        if (typeof measuredAt !== 'string') return null
        for (const name of o.fields) {
          const value = field(reading.value, name)
          if (!['number', 'string', 'boolean'].includes(typeof value) || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 256)) return null
          evidence.push({ readingId: o.readingId, field: name, value, state: 'live', measuredAt, ruleId: rule.id })
        }
      }
      return this.fresh({ evidence }) ? evidence : null
    }
    const readings = new Map()
    const ids = [...new Set(rule.conditions.map(c => c.readingId))]
    const results = await Promise.allSettled(ids.map(id => this.read(id, this.controller.signal)))
    results.forEach((r, i) => { if (r.status === 'fulfilled') readings.set(ids[i], r.value) })
    const evidence = []
    for (const c of rule.conditions) {
      const reading = readings.get(c.readingId)
      if (reading?.state !== 'live' || (reading.id !== undefined && reading.id !== c.readingId)) return null
      const value = field(reading.value, c.field)
      if (typeof value !== typeof c.value || (typeof value === 'number' && !Number.isFinite(value)) || (typeof value === 'string' && value.length > 256) || (enforceCriteria && !OPS[c.op](value, c.value))) return null
      // Hydra's aggregate live state does not prove an individual plant is online.
      const parent = c.field.includes('.') ? field(reading.value, c.field.slice(0, c.field.lastIndexOf('.'))) : reading.value
      if (parent?.stale === true || parent?.online === false) return null
      const measuredAt = c.measuredAtField ? field(reading.value, c.measuredAtField) : reading.value?.measured_at ?? reading.value?.asOf
      if (typeof measuredAt !== 'string') return null
      evidence.push({ readingId: c.readingId, field: c.field, value, state: reading.state, measuredAt, ruleId: rule.id })
    }
    return this.fresh({ evidence }) ? evidence : null
  }
  observeTask(target, task) {
    if (!task) return
    for (const rule of this.config.rules) {
      const scope = rule.coding
      if (!scope || scope.target !== target || (scope.taskId && scope.taskId !== task.taskId) ||
          typeof task.project !== 'string' || !(task.project === scope.project || (!scope.taskId && task.project.startsWith(scope.project.replace(/\/$/, '') + '/')))) continue
      if (task.activity === 'working' || task.state === 'running') this.seenTurns.set(`${rule.id}:${task.taskId}`, { working: true, updatedAt: task.updatedAt, finished: false })
    }
  }
  async codingEvidence(rule, identity) {
    if (!this.codingStatus) return null
    let task
    try { task = await this.codingStatus(identity, this.controller.signal) } catch { return null }
    const key = `${rule.id}:${identity.taskId}`
    if (task?.taskId !== identity.taskId || task.project !== identity.project) return null
    const previous = this.seenTurns.get(key)
    const working = task.activity === 'working' || task.state === 'running'
    const finished = task.turnOutcome === 'finished' && (task.activity === 'idle' || (task.lifecycle === 'ended' && task.state === 'finished'))
    const finishedPending = finished && (previous?.working || (previous?.finishedPending && previous.updatedAt === task.updatedAt))
    this.seenTurns.set(key, { working, updatedAt: task.updatedAt, finished, finishedPending })
    const existing = this.proposals.some(p => p.ruleId === rule.id && p.subject === identity.taskId && pending(p))
    if (!finished || (!finishedPending && !existing)) return null
    return [{ readingId: `pi-tasks:${rule.coding.target}:${task.taskId}`, field: 'turnOutcome', value: 'finished', state: 'live', measuredAt: task.updatedAt, ruleId: rule.id },
      { readingId: `pi-tasks:${rule.coding.target}:${task.taskId}`, field: 'verification', value: task.verification ?? 'not_run', state: 'live', measuredAt: task.updatedAt, ruleId: rule.id }]
  }
  consumeCoding(rule, identity, evidence) {
    if (!rule.coding) return
    const receipt = this.seenTurns.get(`${rule.id}:${identity.taskId}`)
    if (receipt?.updatedAt === evidence[0].measuredAt) receipt.finishedPending = false
  }
  judgmentFailed(candidates) {
    for (const c of candidates) this.failedJudgments.add(c.ruleId)
    this.judgmentError = 'Jev 判断暂不可用；不会回退为阈值提醒或执行动作。'
    this.emit()
  }
  async readProposals() {
    await this.inflight
    if (this.closed || this.storageFailure || this.judgmentError) throw Error('Suggestions unavailable')
    this.interact(true)
    if (this.storageFailure) throw Error('Suggestions unavailable')
    return this.list()
  }
  tick(trigger = { kind: 'heartbeat', readingIds: [] }) {
    const selected = this.selectedSources()
    if (!trigger || Object.keys(trigger).some(key => !['kind', 'readingIds'].includes(key)) || !['heartbeat', 'service_push'].includes(trigger.kind) || !Array.isArray(trigger.readingIds) || trigger.readingIds.length > 32 || (trigger.kind === 'heartbeat' && trigger.readingIds.length) || (trigger.kind === 'service_push' && !trigger.readingIds.length) || !trigger.readingIds.every(id => typeof id === 'string' && ID.test(id) && selected.has(id))) return Promise.reject(Error('Invalid judgment trigger'))
    trigger = { kind: trigger.kind, readingIds: [...new Set(trigger.readingIds)] }
    if (this.closed || this.storageFailure || this.responding) return Promise.resolve()
    if (this.running) return this.inflight
    this.running = true
    this.inflight = this.pollRules(trigger).finally(() => { this.running = false; if (this.pushIds.size) this.schedulePush() })
    return this.inflight
  }
  async pollRules(trigger) {
    if (this.config.version === 2) return pollGenerated(this, trigger, { now: new Date(this.now()).toISOString(), local: localTime(this.now(), this.config.quietHours?.timeZone ?? 'UTC'), quiet: this.quiet(), busy: this.busy })
    const revision = this.revision
    const candidates = []
    for (const rule of this.config.rules) {
      const dependencies = rule.coding ? [`pi-tasks.${rule.coding.target}`] : rule.conditions.map(c => c.readingId)
      if (trigger.kind === 'service_push' && !dependencies.some(id => trigger.readingIds.includes(id))) continue
      let identities = [rule.coding]
      if (rule.coding && !rule.coding.taskId) {
        try {
          const tasks = await this.codingList?.(rule.coding, this.controller.signal) ?? []
          identities = tasks.filter(task => typeof task.project === 'string' &&
            (task.project === rule.coding.project || task.project.startsWith(rule.coding.project.replace(/\/$/, '') + '/')) &&
            /^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(task.taskId))
            .map(task => ({ target: rule.coding.target, project: task.project, taskId: task.taskId }))
        } catch { identities = [] }
      }
      for (const identity of identities) {
        if (this.closed) return
        if (this.config.suppressed.includes(rule.id) || (this.config.snoozed[rule.id] ?? 0) > this.now()) continue
        const evidence = rule.coding ? await this.codingEvidence(rule, identity) : await this.evidence(rule)
        if (this.closed || this.responding) return
        const current = this.proposals.find(p => p.ruleId === rule.id && p.subject === (identity?.taskId ?? rule.id) && pending(p))
        if (!evidence || !this.fresh({ evidence })) {
          if (current && !rule.coding) current.status = 'expired'
          continue
        }
        if (this.proposals.some(p => p.ruleId === rule.id && p.subject === (identity?.taskId ?? rule.id) && (['executing', 'unknown'].includes(p.status) || (p.status === 'completed' && this.now() - Date.parse(p.completedAt) < this.config.cooldownMs)))) continue
        candidates.push({ id: `c${candidates.length}`, ruleId: rule.id, rule, identity, current, advice: rule.advice, criteria: rule.conditions ?? [], evidence })
      }
    }
    if (this.closed || this.responding || revision !== this.revision) return
    let result
    try {
      if (candidates.length) result = await this.judge({
        trigger, candidates: candidates.map(({ id, ruleId, advice, criteria, evidence }) => ({ id, ruleId, advice, criteria, evidence })),
        context: { now: new Date(this.now()).toISOString(), local: localTime(this.now(), this.config.quietHours?.timeZone ?? 'UTC'), quiet: this.quiet(), busy: this.busy },
        recent: this.proposals.slice(-16).map(({ ruleId, status, advice, presented, evidence }) => ({ ruleId, status, advice, presented, evidence })),
        signal: this.controller.signal,
      })
    } catch {
      if (!this.closed) this.judgmentFailed(candidates)
      return
    }
    if (this.closed || this.responding || revision !== this.revision) return
    for (const candidate of candidates) {
        const answer = result?.answers?.[candidate.id]
        if (typeof result?.model !== 'string' || !/^jev-[\w.-]{1,60}$/.test(result.model) || !Number.isFinite(answer?.probability) || answer.probability < 0 || answer.probability > 1 || !Number.isFinite(answer?.threshold) || answer.threshold <= 0.5 || answer.threshold > 1) {
          this.judgmentFailed(candidates); return
        }
    }
    for (const c of candidates) this.failedJudgments.delete(c.ruleId)
    if (!this.failedJudgments.size) this.judgmentError = ''
    if (candidates.length) this.onJudgment({ trigger: trigger.kind, model: result.model, at: new Date(this.now()).toISOString(), decisions: candidates.map(c => ({ ruleId: c.ruleId, probability: result.answers[c.id].probability, threshold: result.answers[c.id].threshold })) })
    for (const { id: candidateId, rule, identity, current, evidence } of candidates) {
        const answer = result.answers[candidateId]
        if (answer.probability < answer.threshold || !this.fresh({ evidence })) { if (current) current.status = 'expired'; this.consumeCoding(rule, identity, evidence); continue }
        const judgment = { model: result.model, probability: answer.probability, threshold: answer.threshold, trigger: trigger.kind, judgedAt: new Date(this.now()).toISOString() }
        if (current) { current.evidence = evidence; current.judgment = judgment; this.consumeCoding(rule, identity, evidence); continue }
        const id = randomUUID()
        const action = rule.coding ? { tool: 'coding_task_history', params: identity } : rule.action
        const confirmation = action?.tool === 'memory_update'
          ? `记住 ${action.params.category}：${action.params.value}` : `确认执行 ${id}`
        const proposal = { id, ruleId: rule.id, ruleVersion: JSON.stringify(rule), subject: identity?.taskId ?? rule.id, status: 'pending', evidence, advice: rule.advice,
          action: action ?? null, confirmation: action ? confirmation : '', offered: false, presented: false, createdAt: new Date(this.now()).toISOString(), result: '', judgment }
        try { proposal.advice = await this.phrase({ evidence: structuredClone(evidence), advice: rule.advice, signal: this.controller.signal }) } catch { proposal.advice = rule.advice }
        if (typeof proposal.advice !== 'string' || !proposal.advice.trim()) proposal.advice = rule.advice
        proposal.advice = proposal.advice.slice(0, 1000)
        if (this.closed || this.responding || revision !== this.revision || this.config.suppressed.includes(rule.id) || (this.config.snoozed[rule.id] ?? 0) > this.now()) continue
        if (!this.fresh(proposal)) proposal.status = 'expired'
        this.proposals.push(proposal)
        this.consumeCoding(rule, identity, evidence)
        if (this.proposals.length > 64) {
          const removable = this.proposals.findIndex(p => !['pending', 'executing', 'unknown'].includes(p.status))
          if (removable >= 0) this.proposals.splice(removable, 1)
          else this.proposals.pop()
        }
    }
    this.emit()
  }
  async respond(id, decision, confirmation = '', fromSpokenTurn = false) {
    if (this.closed || this.storageFailure || this.judgmentError || this.responding || (this.busy && !fromSpokenTurn)) throw Error('Proposal response busy or unavailable')
    const p = this.proposals.find(p => p.id === id)
    if (!p || !pending(p)) throw Error('Proposal no longer pending')
    this.revision++
    this.interactionRevision++
    this.responding = true
    try {
      if (['ignore', 'mute'].includes(decision)) {
        const next = structuredClone(this.config)
        if (decision === 'mute') next.suppressed = [...new Set([...next.suppressed, p.ruleId])]
        next.snoozed[p.ruleId] = this.now() + next.cooldownMs
        await this.save(next)
        this.config = next
        p.status = 'ignored'
        if (decision === 'mute') for (const related of this.proposals) if (related.ruleId === p.ruleId && pending(related)) related.status = 'ignored'
      } else if (decision === 'accept') {
        if (!p.presented) throw Error('Proposal must be presented before confirmation')
        if (!p.action || confirmation !== p.confirmation) throw Error('Exact confirmation required')
        const rule = this.config.rules.find(r => r.id === p.ruleId)
        if (!this.authorizedAction(p, rule)) { p.status = 'expired'; throw Error('Proposal action no longer authorized') }
        const expectedConfirmation = p.action.tool === 'memory_update' ? `记住 ${p.action.params.category}：${p.action.params.value}` : `确认执行 ${p.id}`
        if (confirmation !== expectedConfirmation) throw Error('Exact owner action confirmation required')
        const evidence = rule.coding ? (this.fresh(p) ? p.evidence : null) : await this.evidence(rule, true)
        if (!evidence) { p.status = 'expired'; throw Error('Proposal expired; read fresh data before another action') }
        p.evidence = evidence
        // Reserve before awaiting: any failure is uncertain and cannot replay this action.
        p.status = 'executing'
        this.persist()
        this.emit()
        if (this.storageFailure) throw Error('Private proposal state unavailable; action was not executed')
        try {
          const result = await this.execute(p.action.tool, structuredClone(p.action.params), confirmation)
          p.result = typeof result === 'string' ? result.slice(0, 4096) : JSON.stringify(result).slice(0, 4096)
          p.status = 'completed'
          p.completedAt = new Date(this.now()).toISOString()
        } catch {
          p.status = 'unknown'
          p.result = '执行结果未确认；请通过原工具核实，不要重复执行。'
        }
        this.persist()
        const next = structuredClone(this.config)
        next.snoozed[p.ruleId] = this.now() + next.cooldownMs
        try { await this.save(next); this.config = next } catch { p.result += '\n未能保存限频配置，请检查 owner 配置。' }
      } else throw Error('Invalid proposal decision')
    } finally { this.responding = false; this.emit() }
    return structuredClone(p)
  }
}
