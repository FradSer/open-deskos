import { isJudgmentModel } from '../judgment-client.mjs'
import { randomUUID, createHash } from 'node:crypto'
import { basename, dirname, join } from 'node:path'
import { lstatSync, realpathSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync, openSync } from 'node:fs'
import { parseDocument, stringify } from 'yaml'
import { createProactiveDirectory, checkProactivePath, readProactiveFile, openProactiveTemporary } from '../proactive-private.mjs'
import { observationField as field, observationKey, observationMeasuredAt } from './proactive-lifecycle.mjs'
import { createIntervalClock, minuteOfDay, validInterval } from './routine-schedule.mjs'

export const isIntentRuleId = id => typeof id === 'string' && /^intent-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
/** Only genuine desk evidence distinguishes a local Intent card from legacy previews. */
export function isDeskIntentProposal(proposal) {
  if (proposal?.action !== null || !isIntentRuleId(proposal.ruleId) || !Array.isArray(proposal.evidence)) return false
  const synthetic = `intent.${proposal.ruleId.slice('intent-'.length)}`
  return proposal.evidence.some(row => typeof row?.readingId === 'string' && row.readingId && row.readingId !== synthetic)
}
export const INTENT_OUTCOMES = ['checking', 'preparing', 'condition_false', 'condition_unknown', 'ready', 'failed', 'superseded', 'interrupted', 'expired']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const bounded = (value, max = 1000) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x08]/.test(value)
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key))
const validObservation = o => exact(o, ['readingId', 'fields']) && /^[\w.-]{1,80}$/.test(o.readingId) && Array.isArray(o.fields) && o.fields.length > 0 && o.fields.length <= 4 && o.fields.every(f => /^[\w.-]{1,80}$/.test(f) && !f.split('.').some(p => ['__proto__', 'constructor', 'prototype'].includes(p)))
export const validGmailBinding = gmail => exact(gmail, ['label', 'labelId', 'accountKey', 'historyId', 'since'])
  && bounded(gmail.label, 225) && !/[\x00-\x1f\x7f]/.test(gmail.label)
  && typeof gmail.labelId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(gmail.labelId) && /^[a-f0-9]{64}$/.test(gmail.accountKey)
  && typeof gmail.historyId === 'string' && /^\d{1,32}$/.test(gmail.historyId)
  && Number.isSafeInteger(gmail.since) && gmail.since >= 0 && gmail.since <= 8640000000000000
function validate(entry) {
  if (!exact(entry, ['id', 'revision', 'enabled', 'wish', 'condition', 'at', 'timeZone', 'windowMinutes', 'memoryKeys', 'observations', 'ride', 'ownerText', 'schedule', 'gmail']) ||
    !UUID.test(entry.id) || !Number.isInteger(entry.revision) || entry.revision < 1 || typeof entry.enabled !== 'boolean' || !bounded(entry.wish) || !bounded(entry.condition) || !bounded(entry.ownerText, 4096) ||
    (entry.at !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.at)) || !bounded(entry.timeZone, 80) || !Number.isInteger(entry.windowMinutes) || entry.windowMinutes < 1 || entry.windowMinutes > 30 ||
    !Array.isArray(entry.memoryKeys) || entry.memoryKeys.length > 8 || !entry.memoryKeys.every(key => /^[\p{L}\p{N}_-]{1,40}$/u.test(key)) ||
    !Array.isArray(entry.observations) || entry.observations.length > 4 || !entry.observations.every(validObservation)) throw Error('Invalid Intent')
  try { new Intl.DateTimeFormat('en', { timeZone: entry.timeZone }).format() } catch { throw Error('Invalid Intent time zone') }
  if (entry.schedule !== undefined && (!validInterval(entry.schedule) || entry.at !== undefined || entry.ride !== undefined
    || entry.windowMinutes !== 10)) throw Error('Invalid interval routine')
  if (entry.gmail !== undefined && (!entry.schedule || !validGmailBinding(entry.gmail) || entry.observations.length
    || entry.memoryKeys.length || entry.wish.length + entry.condition.length > 800)) throw Error('Invalid Gmail routine')
  if (entry.ride !== undefined && (!exact(entry.ride, ['city', 'from', 'to', 'cityMemoryKey', 'fromMemoryKey', 'toMemoryKey']) || !['from', 'to'].every(k => (entry.ride[k] !== undefined ? bounded(entry.ride[k], 120) : /^[\p{L}\p{N}_-]{1,40}$/u.test(entry.ride[`${k}MemoryKey`] ?? ''))) || !['cityMemoryKey', 'fromMemoryKey', 'toMemoryKey'].every(k => entry.ride[k] === undefined || /^[\p{L}\p{N}_-]{1,40}$/u.test(entry.ride[k])) || (entry.ride.city !== undefined && !bounded(entry.ride.city, 80)))) throw Error('Invalid Intent route')
  return entry
}
const LEGACY_INTENT_BYTES = 65536
export const ROUTINE_FILENAME = 'ROUTINE.yaml'
const ROUTINE_VERSION = 2
const LEGACY_ROUTINE_VERSION = 1
// Also bound reads of the earlier structured Markdown during migration.
const ROUTINE_BYTES = 384 * 1024
const legacyDocument = entries => `# Intents\n\nOwner wishes are data, not instructions or action permission.\n\n${entries.map(e => `## ${e.id}\n\n${e.wish}\n\nCondition: ${e.condition}\n\nDaily window: ${e.at ?? 'context only'}, ${e.timeZone}, ${e.windowMinutes} minutes.\n\nStatus: ${e.enabled ? 'enabled' : 'muted'}; revision ${e.revision}.\n`).join('\n')}\n<!-- odk-intents-v1\n${JSON.stringify(entries)}\n-->\n`

function routineRecord(entry, version) {
  const { id, revision, enabled, ownerText, at, timeZone, windowMinutes, condition, observations, memoryKeys, wish, ride, schedule, gmail } = entry
  const inputs = observations.map(observation => ({ type: 'odk-data', ...observation }))
  if (gmail) {
    const { label, ...binding } = gmail
    inputs.push({ type: 'service', connectorId: 'gmail', selection: { type: 'label', name: label }, binding })
  }
  return {
    id, revision, enabled, ownerText,
    when: schedule ? { type: 'interval-window', timeZone, days: schedule.days, start: schedule.start, end: schedule.end, everyMinutes: schedule.everyMinutes }
      : { type: at === undefined ? 'context' : 'daily-window', ...(at === undefined ? {} : { at }), timeZone, windowMinutes },
    if: version === LEGACY_ROUTINE_VERSION ? { condition, observations, memoryKeys, ...(gmail === undefined ? {} : { gmail }) }
      : { condition, inputs, memoryKeys },
    then: { type: 'suggestion', goal: wish, ...(ride === undefined ? {} : { ride }) },
  }
}

function readInputs(inputs) {
  if (!Array.isArray(inputs) || inputs.length > 5) throw Error('Invalid routine inputs')
  const observations = []
  let gmail
  for (const input of inputs) {
    if (input?.type === 'odk-data' && exact(input, ['type', 'readingId', 'fields'])) {
      observations.push({ readingId: input.readingId, fields: input.fields })
      continue
    }
    if (gmail || !exact(input, ['type', 'connectorId', 'selection', 'binding'])
      || input.type !== 'service' || input.connectorId !== 'gmail' || !exact(input.selection, ['type', 'name'])
      || input.selection.type !== 'label' || !exact(input.binding, ['labelId', 'accountKey', 'historyId', 'since'])) throw Error('Invalid routine input')
    gmail = { label: input.selection.name, ...input.binding }
    if (!validGmailBinding(gmail)) throw Error('Invalid Gmail binding')
  }
  return { observations, gmail }
}

function readRoutine(record, version) {
  if (!exact(record, ['id', 'revision', 'enabled', 'ownerText', 'when', 'if', 'then'])) throw Error('Invalid routine record')
  const { id, revision, enabled, ownerText, when, if: scope, then } = record
  const interval = when?.type === 'interval-window'
  const legacy = version === LEGACY_ROUTINE_VERSION
  if (!(interval ? exact(when, ['type', 'timeZone', 'days', 'start', 'end', 'everyMinutes'])
    : exact(when, ['type', 'at', 'timeZone', 'windowMinutes']) && when.type === (when.at === undefined ? 'context' : 'daily-window'))
    || !exact(scope, legacy ? ['condition', 'observations', 'memoryKeys', 'gmail'] : ['condition', 'inputs', 'memoryKeys'])
    || !exact(then, ['type', 'goal', 'ride']) || then.type !== 'suggestion') throw Error('Invalid routine record')
  const { observations, gmail } = legacy ? scope : readInputs(scope.inputs)
  return validate({
    id, revision, enabled, ownerText,
    ...(when.at === undefined ? {} : { at: when.at }), timeZone: when.timeZone, windowMinutes: interval ? 10 : when.windowMinutes,
    ...(interval ? { schedule: { days: when.days, start: when.start, end: when.end, everyMinutes: when.everyMinutes } } : {}),
    ...(gmail ? { gmail } : {}),
    condition: scope.condition, observations, memoryKeys: scope.memoryKeys,
    wish: then.goal, ...(then.ride === undefined ? {} : { ride: then.ride }),
  })
}

const quote = value => value.replace(/[\\\x60*_{}\[\]()#+.!<>|&-]/g, '\\$&').split(/\r\n|\r|\n/).map(line => '>' + (line ? ' ' + line : '')).join('\n')
const literal = value => '`' + value + '`'

function legacyRoutineDocument(entries) {
  const records = entries.map(entry => routineRecord(entry, LEGACY_ROUTINE_VERSION))
  const sections = records.map(({ id, enabled, revision, ownerText, when, if: scope, then }) => {
    const trigger = when.type === 'daily-window'
      ? `Daily at ${literal(when.at)} in ${literal(when.timeZone)} for ${when.windowMinutes} minutes.`
      : `Check the current context in ${literal(when.timeZone)}.`
    const inputs = scope.observations.map(({ readingId, fields }) =>
      `Read ${fields.map(literal).join(', ')} from ${literal(readingId)} in Open DeskOS Data.`)
    if (scope.memoryKeys.length) inputs.push(`Use the Memory notes ${scope.memoryKeys.map(literal).join(', ')}.`)
    return [
      `## ${id}`, `${enabled ? 'Enabled' : 'Paused'} · Revision ${revision}`,
      '### When', trigger,
      '### If', quote(scope.condition), ...inputs,
      '### Then', 'Offer one next step in Personal Agent.', quote(then.goal),
      '### Original request', quote(ownerText),
    ].join('\n\n')
  })
  // Escape comment delimiters in data without expanding ordinary punctuation.
  const data = JSON.stringify(records, null, 2).replaceAll('<!--', '\\u003c!--').replace(/--(!?)>/g, '--$1\\u003e')
  return ['# Routines', ...sections, `<!-- odk-routines-v2\n${data}\n-->`].join('\n\n') + '\n'
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { throw Error('Invalid Intent document') }
}

function readEntries(records, decode) {
  if (!Array.isArray(records) || records.length > 16) throw Error('Invalid Intent document')
  const entries = records.map(decode)
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) throw Error('Invalid Intent document')
  return entries
}

const routineDocument = (entries, version) => ({ version, entries: entries.map(entry => routineRecord(entry, version)) })
const routineJson = entries => JSON.stringify(routineDocument(entries, LEGACY_ROUTINE_VERSION), null, 2) + '\n'
const routineYaml = (entries, version = ROUTINE_VERSION) => stringify(routineDocument(entries, version), { lineWidth: 0, aliasDuplicateObjects: false })

function parseYaml(bytes) {
  try {
    const document = parseDocument(bytes, { schema: 'core' })
    if (document.errors.length || document.warnings.length) throw Error('Invalid routine YAML')
    return document.toJS({ maxAliasCount: 0 })
  } catch { throw Error('Invalid routine YAML') }
}

function parseRoutineFile(bytes, legacyJson = false) {
  const document = legacyJson ? parseJson(bytes) : parseYaml(bytes)
  if (!exact(document, ['version', 'entries']) || (document.version !== LEGACY_ROUTINE_VERSION
    && (legacyJson || document.version !== ROUTINE_VERSION))) throw Error('Invalid routine file')
  const entries = readEntries(document.entries, record => readRoutine(record, document.version))
  if ((legacyJson ? routineJson(entries) : routineYaml(entries, document.version)) !== bytes) throw Error('Routine file changed outside the reviewed editor')
  return entries
}

function parseLegacyIntentDocument(bytes) {
  const routine = bytes.startsWith('# Routines\n\n')
  const pattern = routine ? /\n<!-- odk-routines-v2\n([\s\S]+?)\n-->\n$/ : /\n<!-- odk-intents-v1\n([^\n]+)\n-->\n$/
  const match = pattern.exec(bytes)
  if (!match || (!routine && Buffer.byteLength(bytes) > LEGACY_INTENT_BYTES)) throw Error('Invalid Intent document')
  const entries = readEntries(parseJson(match[1]), routine ? record => readRoutine(record, LEGACY_ROUTINE_VERSION) : validate)
  if ((routine ? legacyRoutineDocument : legacyDocument)(entries) !== bytes) throw Error('Intent document changed outside the reviewed editor')
  return entries
}

/** One fixed private routine file. The model cannot choose a path or save executable actions. */
export function createIntentStore(file) {
  const directory = dirname(file)
  const legacyJson = join(directory, 'routine.json')
  if (basename(file) === 'routine.json') file = join(directory, ROUTINE_FILENAME)
  const paths = basename(file) === ROUTINE_FILENAME ? [file, legacyJson, join(directory, 'routines.md'), join(directory, 'intent.md')] : [file]
  createProactiveDirectory(directory)
  let cached
  function load() {
    checkProactivePath(directory)
    const parent = lstatSync(directory)
    if (!parent.isDirectory() || realpathSync(directory) !== directory || (process.platform !== 'win32' && (parent.uid !== process.getuid?.() || (parent.mode & 0o077)))) throw Error('Unsafe private Intent directory')
    for (const source of paths) {
      try { lstatSync(source) } catch (error) {
        if (error.code === 'ENOENT') continue
        throw error
      }
      const bytes = readProactiveFile(source, source !== file && basename(source) === 'intent.md' ? LEGACY_INTENT_BYTES : ROUTINE_BYTES)
      if (cached?.source === source && cached.bytes === bytes) return cached
      const entries = source === file || source === legacyJson ? parseRoutineFile(bytes, source === legacyJson) : parseLegacyIntentDocument(bytes)
      cached = { entries, bytes, source }
      return cached
    }
    return { entries: [], bytes: null, source: null }
  }
  function persist(entries, previous) {
    const current = load()
    if (current.source !== previous.source || current.bytes !== previous.bytes) throw Error('Intent document changed; read it again')
    const bytes = routineYaml(entries)
    if (Buffer.byteLength(bytes) > ROUTINE_BYTES) throw Error('Intent document too large')
    const temporary = join(directory, `.routine-${randomUUID()}.tmp`)
    try {
      const fd = openProactiveTemporary(temporary)
      try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
      renameSync(temporary, file)
      if (process.platform !== 'win32') { const fd = openSync(directory, 'r'); try { fsyncSync(fd) } finally { closeSync(fd) } }
    } finally { try { unlinkSync(temporary) } catch {} }
  }
  return {
    file,
    list: () => structuredClone(load().entries),
    save(input) {
      const snapshot = load()
      const { entries } = snapshot
      const previous = input.id ? entries.find(e => e.id === input.id) : undefined
      if (input.id && (!previous || previous.revision !== input.revision)) throw Error('Intent changed; read its current revision')
      const entry = validate({ ...input, id: previous?.id ?? randomUUID(), revision: (previous?.revision ?? 0) + 1, enabled: input.enabled ?? true,
        ownerText: input.ownerText ?? input.wish })
      if (!previous && entries.length >= 16) throw Error('Intent limit reached')
      persist(previous ? entries.map(e => e.id === entry.id ? entry : e) : [...entries, entry], snapshot)
      return structuredClone(entry)
    },
  }
}

function local(now, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]))
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minute: Number(parts.hour) * 60 + Number(parts.minute) }
}
const MINUTE_MS = 60000
const DAY_MINUTES = 1440

const windowOffset = (minute, start) => (minute - start + DAY_MINUTES) % DAY_MINUTES

function inWindow(entry, now) {
  const clock = local(now, entry.timeZone)
  if (entry.at === undefined) return { date: clock.date, due: true }
  const start = minuteOfDay(entry.at)
  const due = windowOffset(clock.minute, start) < entry.windowMinutes
  const date = due && clock.minute < start
    ? new Date(Date.parse(clock.date + 'T12:00:00Z') - DAY_MINUTES * MINUTE_MS).toISOString().slice(0, 10)
    : clock.date
  return { date, due }
}

function nextTimedWake(entries, now) {
  const zones = new Map()
  for (const entry of entries) {
    if (!entry.enabled || entry.at === undefined) continue
    let zone = zones.get(entry.timeZone)
    if (!zone) {
      zone = { clock: new Intl.DateTimeFormat('en-GB', { timeZone: entry.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }), windows: [] }
      zones.set(entry.timeZone, zone)
    }
    zone.windows.push({ start: minuteOfDay(entry.at), length: entry.windowMinutes })
  }
  const schedules = [...zones.values()]
  if (!schedules.length) return Infinity

  const nextMinute = (Math.floor(now / MINUTE_MS) + 1) * MINUTE_MS
  const due = at => schedules.some(({ clock, windows }) => {
    const minute = minuteOfDay(clock.format(at))
    return windows.some(({ start, length }) => windowOffset(minute, start) < length)
  })
  if (due(now)) return nextMinute // Recheck in the window and expire it at closing.

  // Scan actual UTC minutes so skipped wall times do not wake and either repeated minute can.
  const end = nextMinute + 3 * DAY_MINUTES * MINUTE_MS
  for (let minute = nextMinute; minute < end; minute += MINUTE_MS) {
    if (due(minute)) return minute
  }
  return Infinity
}

const usesDeskEvidence = entry => !entry.ride && entry.observations.length > 0
const isTimed = entry => entry.at !== undefined || entry.schedule !== undefined
const freshMeasurement = (measuredAt, now, maxAge) => {
  if (typeof measuredAt !== 'string') return false
  const age = now - Date.parse(measuredAt)
  return age >= 0 && age <= maxAge
}
const sourceFields = (source, reading, strict) => Object.fromEntries(source.fields.map(key => [key, field(reading?.value, key)])
  .filter(([, value]) => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))
    || (typeof value === 'string' && (!strict || value.length <= 256)))
  .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 256) : value]))


/** Adapter to the existing Watch, proposal checkpoint, generator and Jev delivery judgment. No timer or owner turn. */
export function createIntentRuntime({ store, memory, memoryVersion = undefined, read, judge, previewRide, now = Date.now }) {
  const ready = new Map()
  function noteKeys(entry) {
    const keys = new Set(entry.memoryKeys)
    if (entry.ride) {
      for (const field of ['city', 'from', 'to']) {
        const key = entry.ride[`${field}MemoryKey`]
        if (entry.ride[field] === undefined && key) keys.add(key)
      }
    }
    return [...keys]
  }
  const readNotes = async (keys, signal) => keys.length ? memory(keys, signal) : { notes: {}, version: undefined }, intervals = new Map()
  let ownerWatch, wake
  function intervalFor(entry) {
    const cached = intervals.get(entry.id)
    if (cached?.revision === entry.revision) return cached.clock
    const clock = createIntervalClock(entry.schedule, entry.timeZone)
    intervals.set(entry.id, { revision: entry.revision, clock })
    return clock
  }
  function windowFor(entry, instant = now()) {
    if (!entry.schedule) return inWindow(entry, instant)
    const slot = intervalFor(entry).slot(instant)
    return slot ? { date: slot.slice(0, 10), due: true, slot }
      : { date: local(instant, entry.timeZone).date, due: false }
  }
  const unchanged = entry => store.list().some(e => e.id === entry.id && e.revision === entry.revision && e.enabled)
  const current = entry => unchanged(entry) && windowFor(entry).due
  const rule = (entry, manual = undefined) => ({ occurrenceDate: manual?.date ?? windowFor(entry).date, ...(manual ? { manualPreview: manual.handle } : {}), id: `intent-${entry.id}`, intentRevision: entry.revision, goal: entry.wish, ...(usesDeskEvidence(entry) ? { intentCondition: entry.condition } : {}), observations: entry.observations.length ? entry.observations : [{ readingId: `intent.${entry.id}`, fields: ['wish'] }], delivery: 'immediate', urgent: false })
  const evidenceExpired = (item, instant) => item.evidenceExpiresAt !== undefined && item.evidenceExpiresAt <= instant
  const windowClosed = (item, instant) => !item.manual && !windowFor(item.entry, instant).due
  function available(item) {
    try { return !evidenceExpired(item, now()) && (!item.valid || item.valid()) && (item.manual ? unchanged(item.entry) : current(item.entry)) && (!item.preview?.expiresAt || item.preview.expiresAt > now()) } catch { return false }
  }
  function refresh() {
    let changed = false
    for (const [id, item] of ready) if (!available(item)) {
      if (item.claim.status === 'ready') {
        const unchanged = store.list().some(e => e.id === item.entry.id && e.revision === item.entry.revision && e.enabled)
        item.claim.status = unchanged && (evidenceExpired(item, now()) || windowClosed(item, now()) || (item.preview?.expiresAt && item.preview.expiresAt <= now())) ? 'expired' : 'superseded'
        item.claim.updatedAt = new Date(now()).toISOString()
        changed = true
      }
      ready.delete(id)
    }
    if (changed) ownerWatch?.persist()
  }
  return {
    store,
    async readSelectedNotes(entry, signal) { return (await readNotes(noteKeys(entry), signal)).notes },
    async verifyObservationBindings(entry, previous, signal) {
      if (!usesDeskEvidence(entry)) return
      if (!entry.observations.every(validObservation)) throw Error('Invalid Intent observation fields')
      for (const source of entry.observations) {
        const existing = previous?.observations.find(item => item.readingId === source.readingId)
        const selected = source.fields.filter(key => !existing?.fields.includes(key))
        if (!selected.length) continue
        const reading = await read(source.readingId, signal)
        const values = sourceFields({ fields: selected }, reading, true)
        if (reading?.id !== source.readingId || !selected.every(key => Object.hasOwn(values, key))) throw Error('Open DeskOS Data could not verify the selected Intent fields')
      }
    },
    nextWake() {
      const entries = store.list()
      const timed = entries.filter(entry => entry.enabled && entry.at !== undefined)
      const key = JSON.stringify(timed.map(({ at, timeZone, windowMinutes }) => [at, timeZone, windowMinutes]))
      const from = now()
      if (wake?.key !== key || from < wake.from || from >= wake.at) wake = { key, from, at: nextTimedWake(timed, from) }
      const expiries = [...ready.values()].map(item => item.evidenceExpiresAt).filter(at => at > from)
      const intervalWakes = entries.filter(entry => entry.enabled && entry.schedule && !entry.gmail)
        .map(entry => intervalFor(entry).nextWake(from, true))
      return Math.min(wake.at, ...intervalWakes, ...expiries)
    },
    hasExpiry: () => [...ready.values()].some(item => evidenceExpired(item, now()) || windowClosed(item, now())),
    sources: () => store.list().filter(e => e.enabled).flatMap(e => e.observations.map(o => o.readingId)),
    key: id => { const item = ready.get(id); return item ? item.manual ? `manual-${item.manual.handle}` : `occurrence-${item.entry.revision}-${windowFor(item.entry).date}` : undefined },
    rules({ timedOnly = false } = {}) {
      refresh()
      return [...ready.values()].filter(item => (!timedOnly || isTimed(item.entry)) && available(item))
        .map(item => rule(item.entry, item.manual))
    },
    valid(p) { const item = ready.get(p.ruleId); return !!item && available(item) && (p.ruleVersion === undefined || p.ruleVersion === JSON.stringify(rule(item.entry, item.manual))) },
    details(ruleId) { const item = ready.get(ruleId); return item && available(item) ? structuredClone(item.preview) : undefined },
    evidence(ruleId) { const item = ready.get(ruleId); return item && available(item) ? structuredClone(item.evidence) : null },
    awaitingEvidence: ruleId => ready.get(ruleId)?.currentSources?.() === false,
    invalidate(watch) { for (const item of ready.values()) { item.claim.status = 'superseded'; item.claim.updatedAt = new Date(now()).toISOString() } ready.clear(); watch.interactionRevision++; watch.revision++; for (const p of watch.proposals) if (p.ruleId.startsWith('intent-') && p.status === 'pending') p.status = 'expired'; watch.emit() },
    async refreshPreview(handle, watch, ownerText, signal, ownerCurrent = () => true) {
      const p = watch.proposals.find(p => p.ridePreview?.handle === handle && ['pending', 'expired'].includes(p.status))
      if (!p) throw Error('The saved ride preview is unavailable; ask for a new ride search')
      const match = /^查看报价 ([a-zA-Z0-9-]{1,80}) ([a-zA-Z0-9-]{1,80}) ([a-zA-Z0-9-]{1,80})$/.exec(ownerText)
      const refresh = ownerText === `刷新行程 ${handle}`
      if (!refresh && (!match || match[1] !== handle || !p.ridePreview.from?.some(place => place.handle === match[2]) || !p.ridePreview.to?.some(place => place.handle === match[3]))) throw Error('Select actual displayed endpoints in the current owner turn')
      const prior = JSON.parse(p.ruleVersion)
      const entry = store.list().find(e => `intent-${e.id}` === p.ruleId && e.revision === prior.intentRevision && e.enabled)
      if (!entry || !entry.ride || !previewRide) throw Error('Intent changed or was muted; explicitly request a new ride search')
      const keys = noteKeys(entry)
      const revision = watch.interactionRevision
      const sources = entry.observations.map(o => [o.readingId, watch.sourceRevisions?.get(o.readingId) ?? 0])
      const { notes, version } = await readNotes(keys, signal)
      let prepared = false
      const contextValid = () => !watch.closed && !watch.controller.signal.aborted && unchanged(entry) && (version === undefined || memoryVersion(keys) === version) && sources.every(([id, v]) => (watch.sourceRevisions?.get(id) ?? 0) === v)
      // The provider retains this callback with its read-only route handles.
      const valid = () => contextValid() && (prepared || (!signal?.aborted && watch.interactionRevision === revision && ownerCurrent()))
      const route = Object.fromEntries(['city', 'from', 'to'].map(k => [k, entry.ride[k] ?? notes[entry.ride[`${k}MemoryKey`]]]))
      if (!['city', 'from', 'to'].every(k => bounded(route[k], k === 'city' ? 80 : 120)) || !valid() || !ownerCurrent()) throw Error('Current route data is unavailable or changed')
      const preview = await previewRide(route, signal, valid)
      if (!valid() || !ownerCurrent()) throw Error('Intent context or owner turn changed during the new search')
      const measuredAt = new Date(now()).toISOString()
      const evidence = [{ readingId: `intent.${entry.id}`, ruleId: p.ruleId, field: 'wish', value: entry.wish.slice(0, 256), state: 'live', measuredAt },
        { readingId: `intent.${entry.id}`, ruleId: p.ruleId, field: 'route', value: `${route.from} → ${route.to}`.slice(0, 256), state: 'live', measuredAt }]
      const claim = watch.intentClaims.find(c => c.intentId === entry.id && c.revision === entry.revision && c.date === prior.occurrenceDate) ?? { status: 'expired', updatedAt: measuredAt }
      const manual = { handle: preview.handle, date: local(now(), entry.timeZone).date }
      ready.set(p.ruleId, { entry, preview, evidence, valid, claim, manual })
      p.subject = `${p.ruleId}:manual-${preview.handle}`
      p.ridePreview = preview; p.ruleVersion = JSON.stringify(rule(entry, manual)); p.evidence = evidence; p.status = 'pending'
      // This is an owner-requested read, not a new scheduled offer or a restored confirmation.
      p.offered = true; p.presented = true
      watch.persist(); prepared = true; watch.emit()
      return { preview: structuredClone(preview), selectionRequired: true, message: 'Fresh search results have new handles. Select the actual endpoints again before requesting an interactive quote. No order confirmation was restored.' }
    },
    mute(id) { const entry = store.list().find(e => `intent-${e.id}` === id); if (!entry) throw Error('Intent unavailable'); return store.save({ ...entry, enabled: false }) },
    async prepare(watch, { timedOnly = false, readingIds = undefined } = {}) {
      ownerWatch = watch
      refresh()
      for (const entry of store.list().filter(e => e.enabled && !e.gmail && (!timedOnly || isTimed(e)))) {
        if (readingIds && usesDeskEvidence(entry) && !entry.observations.some(source => readingIds.includes(source.readingId))) continue
        const clock = windowFor(entry)
        if (!clock.due || watch.closed || watch.controller.signal.aborted) continue
        const key = `${entry.id}:${entry.revision}:${clock.date}`
        let claim = watch.intentClaims.find(c => c.key === key)
        const strict = usesDeskEvidence(entry)
        const previous = strict && claim?.status === 'ready' ? ready.get(`intent-${entry.id}`) : undefined
        // A push may revalidate a visible card, but only a new slot may evaluate the rule.
        if (clock.slot && (readingIds ? !previous : claim?.checkSlot >= clock.slot)) continue
        if (claim && !previous && !['condition_false', 'condition_unknown'].includes(claim.status)) continue
        if (!claim) {
          watch.intentWatermarks ??= {}
          watch.intentArchive ??= { count: 0, byStatus: {} }
          const watermark = watch.intentWatermarks[entry.id]
          if (watermark && watermark.revision >= entry.revision && watermark.date >= clock.date) continue
          if (watch.intentClaims.length >= 256) {
            const removable = watch.intentClaims.filter(c => c.date < clock.date && c.intentId === entry.id || store.list().some(e => e.id === c.intentId && (e.revision > c.revision || windowFor(e).date > c.date)))
            const archived = new Set(removable.slice(0, 128))
            for (const c of archived) {
              watch.intentArchive.count++
              watch.intentArchive.byStatus[c.status] = (watch.intentArchive.byStatus[c.status] ?? 0) + 1
              const prior = watch.intentWatermarks[c.intentId]
              if (!prior || c.revision > prior.revision || (c.revision === prior.revision && c.date > prior.date)) watch.intentWatermarks[c.intentId] = { revision: c.revision, date: c.date }
            }
            watch.intentClaims = watch.intentClaims.filter(c => !archived.has(c))
            if (watch.intentClaims.length >= 256) throw Error('Current Intent occurrence limit reached')
          }
          watch.intentWatermarks[entry.id] = { revision: entry.revision, date: clock.date }
          claim = { key, intentId: entry.id, revision: entry.revision, date: clock.date, status: 'checking', updatedAt: new Date(now()).toISOString() }
          watch.intentClaims.push(claim)
        }
        const update = status => { claim.status = status; claim.updatedAt = new Date(now()).toISOString(); watch.persist() }
        if (clock.slot && !readingIds) claim.checkSlot = clock.slot
        if (claim.status === 'checking' || (clock.slot && !readingIds)) watch.persist()
        const keys = noteKeys(entry)
        let notesVersion
        const revision = watch.interactionRevision
        const sourceRevisions = entry.observations.map(o => [o.readingId, watch.sourceRevisions?.get(o.readingId) ?? 0])
        const currentSources = () => sourceRevisions.every(([id, version]) => (watch.sourceRevisions?.get(id) ?? 0) === version)
        let prepared = false
        // A prepared read-only card keeps its current reading while the Watch
        // rechecks it. New generation still requires the latest source revision.
        const contextValid = () => (notesVersion === undefined || memoryVersion(keys) === notesVersion) && windowFor(entry).date === clock.date
          && ((prepared && strict) || currentSources()) && !watch.closed && !watch.controller.signal.aborted && current(entry)
        // Owner interaction cancels preparation, not a completed read-only preview.
        const valid = () => contextValid() && (prepared || watch.interactionRevision === revision)
        const discardCondition = () => {
          if (!watch.closed && !watch.controller.signal.aborted && current(entry) && windowFor(entry).date === clock.date) {
            delete claim.contextHash
            update('condition_unknown')
          } else update('superseded')
        }
        try {
          const snapshot = await readNotes(keys, watch.controller.signal).catch(() => undefined)
          if (!snapshot) {
            ready.delete(`intent-${entry.id}`)
            discardCondition()
            continue
          }
          const { notes, version } = snapshot
          notesVersion = version
          const selected = Object.fromEntries(keys.map(key => [key, Object.hasOwn(notes, key) ? notes[key] : null]))
          const observations = [], deskEvidence = []
          const maxAge = strict ? Math.min(watch.config?.maxAgeMs ?? 300000, 300000) : 300000
          for (const source of entry.observations) {
            let reading
            try { reading = await read(source.readingId, watch.controller.signal) } catch {}
            const fields = reading?.id === source.readingId && reading?.state === 'live'
              ? Object.entries(sourceFields(source, reading, strict)).map(([field, value]) => ({
                field, value, measuredAt: observationMeasuredAt(reading, field),
              })).filter(fact => freshMeasurement(fact.measuredAt, now(), maxAge))
              : []
            const available = fields.length > 0 && (!strict || source.fields.every(key => fields.some(fact => fact.field === key)))
            const measuredAt = fields.map(fact => fact.measuredAt).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
            if (available && strict) deskEvidence.push(...fields.map(fact => ({
              ...fact, readingId: source.readingId, ruleId: `intent-${entry.id}`, state: 'live',
            })))
            observations.push({ id: source.readingId, state: available ? 'live' : 'unavailable',
              measuredAt: available ? measuredAt : null, values: available ? Object.fromEntries(fields.map(fact => [fact.field, fact.value])) : {} })
          }
          if (!valid()) { if (!previous) discardCondition(); continue }
          const live = observations.every(item => item.state === 'live')
          const evidenceExpiresAt = strict && live ? Math.min(...observations.map(source => Date.parse(source.measuredAt))) + maxAge + 1 : undefined
          if (previous) {
            if (live && observationKey(previous.evidence) === observationKey(deskEvidence)) {
              Object.assign(previous, { evidence: deskEvidence, evidenceExpiresAt, currentSources })
            } else {
              ready.delete(`intent-${entry.id}`)
              update(live ? 'superseded' : 'expired')
            }
            continue
          }
          if (strict && !live) {
            delete claim.contextHash
            if (claim.status !== 'condition_unknown') update('condition_unknown')
            continue
          }
          const localClock = local(now(), entry.timeZone)
          const contextHash = createHash('sha256').update(JSON.stringify({ memory: selected, observations: observations.map(({ id, state, values }) => ({ id, state, values })), clock: clock.slot ?? (entry.at === undefined ? Math.floor(now() / 3600000) : `${clock.date}:${localClock.minute}`) })).digest('hex')
          if (claim.contextHash === contextHash && ['condition_false', 'condition_unknown'].includes(claim.status)) continue
          claim.contextHash = contextHash
          update('checking')
          const decision = await judge({ entry, memory: selected, observations, local: { date: clock.date, time: `${String(Math.floor(localClock.minute / 60)).padStart(2, '0')}:${String(localClock.minute % 60).padStart(2, '0')}`, at: entry.at, timeZone: entry.timeZone }, signal: watch.controller.signal })
          if (!valid() || (strict && observations.some(item => !freshMeasurement(item.measuredAt, now(), maxAge)))) { discardCondition(); continue }
          if (!decision || !['true', 'false', 'unknown'].includes(decision.status) || !isJudgmentModel(decision.model)) throw Error('Invalid Intent judgment')
          claim.model = decision.model
          if (decision.status !== 'true') { update(`condition_${decision.status}`); continue }
          // Persist before the first external lookup. A crash or error cannot replay it.
          update('preparing')
          const route = entry.ride ? Object.fromEntries(['city', 'from', 'to'].map(k => [k, entry.ride[k] ?? selected[entry.ride[`${k}MemoryKey`]]])) : undefined
          const routeReady = route && ['city', 'from', 'to'].every(k => bounded(route[k], k === 'city' ? 80 : 120))
          const preview = entry.ride ? (routeReady && previewRide ? await previewRide(route, watch.controller.signal, valid) : { status: 'needs_location', message: '请明确城市和门店；尚未搜索或报价。' }) : undefined
          if (!valid()) { update('superseded'); continue }
          const measuredAt = new Date(now()).toISOString()
          const values = { wish: entry.wish, condition: entry.condition, conditionStatus: 'The supplied context was judged sufficient now; not current pickup-location proof', ...(preview ? { rideStatus: `${preview.status}; ${preview.sandbox === true ? '沙箱测试，不代表真实车辆或真实行程' : 'Read-only preview, not an order'}`, route: `${route?.from ?? 'Unknown pickup'} → ${route?.to ?? 'Unknown destination'}`, quote: preview.items?.map(i => `${i.productName}: ${i.priceText}`).join('; ') || 'No confirmed quote; inspect place candidates first' } : {}) }
          const evidence = strict ? deskEvidence : Object.entries(values).map(([f, value]) => ({ readingId: `intent.${entry.id}`, ruleId: rule(entry).id, field: f, value: String(value).slice(0, 256), measuredAt, state: 'live' }))
          ready.set(rule(entry).id, { entry, preview, evidence, valid, claim, evidenceExpiresAt, ...(strict ? { currentSources } : {}) })
          update('ready')
          prepared = true
        } catch {
          update(valid() ? 'failed' : 'superseded')
        }
      }
    },
  }
}
