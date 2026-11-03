import { DEFAULT_OVERVIEW_PREFERENCES } from './overview-preferences.mjs'
import { projectHydraSnapshot } from './producer-readings.mjs'
import { resolveHomeTemplate, homeTemplateVariables, homeFactVariables, compileHomeSelection, homeSelectionInstructions, homeAttention, fallbackHomeSelection, rebindHomeSelection, stripHomeJoiner } from './home-template.mjs'
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const STATES = new Set(['live', 'stale', 'unavailable', 'unconfigured', 'unauthorized', 'error'])
const ICONS = new Set(['sessions', 'plants', 'weather', 'mail', 'calendar', 'tasks', 'reading', 'portfolio', 'quota', 'apps', 'status'])
const MAX_AGE_MS = 15 * 60 * 1000
const MIN_GENERATION_INTERVAL_MS = 15 * 60 * 1000
const MAX_RETRY_INTERVAL_MS = 30 * 60 * 1000
const MEASUREMENT_TIMES = new Set(['asOf', 'measuredAt', 'updatedAt', 'publishedAt'])

function homeDeclaration(home) {
  if (home === undefined) return undefined
  if (!home || typeof home !== 'object' || Array.isArray(home)
    || Object.keys(home).some(key => !['mode', 'priority', 'icon', 'fields'].includes(key))
    || !['required', 'optional', 'hidden'].includes(home.mode)
    || !Number.isInteger(home.priority) || home.priority < 0 || home.priority > 100 || !ICONS.has(home.icon)
    || !Array.isArray(home.fields) || home.fields.length > 16 || new Set(home.fields).size !== home.fields.length
    || home.fields.some(field => typeof field !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field))) throw Error('Invalid home declaration')
  return { ...home, fields: [...home.fields] }
}

function semanticValue(value) {
  if (Array.isArray(value)) return value.map(semanticValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !MEASUREMENT_TIMES.has(key)).map(([key, data]) => [key, semanticValue(data)]))
}

const contentFingerprint = readings => JSON.stringify(semanticValue(readings))
function valueShape(value) {
  if (value === null) return 'null'
  if (Array.isArray(value)) return value.map(valueShape)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, valueShape(field)]))
  return typeof value
}
function selectionValue(value, path = '', now = Date.now()) {
  if (Array.isArray(value)) return value.map((item, index) => selectionValue(item, `${path}.${index}`, now))
  if (/(?:^|\.)(?:id|sessionId|taskId)$/.test(path) && (typeof value === 'string' || Number.isFinite(value))) return value
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !MEASUREMENT_TIMES.has(key)).map(([key, child]) => [key, selectionValue(child, path ? `${path}.${key}` : key, now)]))
  if (typeof value === 'number') return /(?:^|\.)(waiting|blocked|failed|error)$/.test(path) ? value : { type: 'number', attention: homeAttention(path, value, {}, now) }
  if (typeof value === 'string' && /(?:At|Time|deadline)$/.test(path)) return { value, attention: homeAttention(path, value, {}, now) }
  return value
}
const layoutFingerprint = (readings, now) => JSON.stringify(readings.map(({ id, serviceId, label, kind, state, home, value }) => ({ id, serviceId, label, kind, state, home, shape: valueShape(value), selection: selectionValue(value, '', now) })))
const partialValue = value => typeof value === 'string' ? value.length > 8192 : Boolean(value && typeof value === 'object'
  && (value.truncated === true || value.incomplete === true || Object.values(value).some(partialValue)))

function failureKind(stage, error, code, status) {
  if (status === 429) return 'provider_rate_limited'
  if (status >= 500) return 'provider_server_error'
  if (status >= 400) return 'provider_request_rejected'
  if (code && /^E[A-Z0-9_]+$/.test(code)) return 'transport_failure'
  if (error?.message === 'Suggestion generation timed out') return 'generation_timeout'
  if (error?.name === 'SyntaxError') return 'invalid_model_json'
  if (stage === 'readings') return 'reading_failure'
  if (stage === 'validate') return 'invalid_model_output'
  return 'generation_failure'
}

export const homeInstructions = homeSelectionInstructions

/** Validate whole statements; truncation could change their factual meaning. */
export function validateHomeBriefing(raw, readings, { requireSegments = false } = {}) {
  if (!raw || Object.keys(raw).some(k => k !== 'items') || !Array.isArray(raw.items) || raw.items.length > 4) throw Error('Invalid home briefing')
  const compact = requireSegments || raw.items.some(item => item?.segments !== undefined)
  if (compact && (raw.items.length > 2 || raw.items.reduce((sum, item) => sum + (item?.text?.length || 0), 0) > 240)) throw Error('Home sentence too long')
  for (const source of readings) {
    if (!raw.items.some(item => item?.readingIds?.includes(source.id)) || source.home?.icon !== 'portfolio' || source.home.fields.length !== 1 || source.home.fields[0] !== 'todayChangePercent' || source.state !== 'live' || !Number.isFinite(source.value?.todayChangePercent)) continue
    // The icon names the service; the bound percentage is the fact. Keep the
    // value check without requiring the source label in the concise copy.
    const cited = raw.items.filter(item => item.readingIds?.includes(source.id))
    const segments = cited.flatMap(item => (item.segments || []).filter(segment => segment.icon === 'portfolio'))
    // A label still distinguishes two portfolio sources in one sentence. A
    // single concise portfolio fact is identified by its own bound value.
    const labelled = segments.filter(segment => segment.text.includes(source.label))
    if (segments.length > 1 && segments.some(segment => !readings.some(reading => reading.home?.icon === 'portfolio' && segment.text.includes(reading.label)))) throw Error('Invalid portfolio percentage')
    const facts = labelled.length ? labelled : segments.length === 1 ? segments : []
    const expected = Number(source.value.todayChangePercent.toFixed(2))
    if (facts.length !== 1) throw Error('Invalid portfolio percentage')
    const matches = [...facts[0].text.matchAll(/([+-]?\d+\.\d{2})%/g)]
    if (matches.length !== 1 || Number(matches[0][1]) !== expected || (expected !== 0 && !/^[+-]/.test(matches[0][1])) || /[\d$€£¥]/.test(facts[0].text.replace(matches[0][0], ''))) throw Error('Invalid portfolio percentage')
  }
  return raw.items.map(item => {
    if (!item || Object.keys(item).some(k => !['text', 'readingIds', 'segments'].includes(k))
      || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 600 || /[\x00-\x08\x0b-\x1f]/.test(item.text)
      || !Array.isArray(item.readingIds) || !item.readingIds.length || item.readingIds.length > 8
      || new Set(item.readingIds).size !== item.readingIds.length) throw Error('Invalid home statement')
    if (compact && (!Array.isArray(item.segments) || !item.segments.length || item.segments.length > 12
      || !item.segments.some(segment => ICONS.has(segment?.icon))
      || item.segments.some(segment => !segment || Object.keys(segment).some(key => !['text', 'icon'].includes(key))
        || typeof segment.text !== 'string' || !segment.text.trim() || segment.text.length > 240
        || (segment.icon !== undefined && !ICONS.has(segment.icon)))
      || item.segments.map(segment => segment.text).join('') !== item.text)) throw Error('Invalid home segments')
    const sources = item.readingIds.map(id => {
      const source = readings.find(r => r.id === id)
      if (!source) throw Error('Unknown home source')
      return { id: source.id, label: source.label, state: source.state,
        ...(Number.isFinite(source.updatedAt) ? { updatedAt: source.updatedAt } : {}) }
    })
    return { text: compact ? item.text : item.text.trim(), sources, ...(compact ? { segments: item.segments.map(segment => ({ ...segment })) } : {}) }
  })
}

function boundSourceFacts(readings, now, preferences = DEFAULT_OVERVIEW_PREFERENCES) {
  return validateHomeBriefing(resolveHomeTemplate(fallbackHomeSelection(readings, now, preferences), readings, now), readings, { requireSegments: true })
}

// Withdrawn sources lose their selection. Temporary read failures remain in the catalog.
function retainVisibleSelection(raw, readings, visible, now, preferences = DEFAULT_OVERVIEW_PREFERENCES) {
  if (!raw) return null
  const ids = new Set(visible.map(source => source.id))
  if (raw.items.every(item => item.readingIds.every(id => ids.has(id)))) return raw
  const facts = homeFactVariables(readings, now, preferences)
  const items = raw.items.flatMap(item => {
    const sources = item.segments.flatMap(segment => {
      const example = stripHomeJoiner(segment.text)
      const index = facts.findIndex(fact => fact.example === example && ids.has(fact.id))
      return index < 0 ? [] : [index]
    })
    return sources.length ? [{ sources }] : []
  })
  return compileHomeSelection({ items }, facts)
}

/** A read-only, replaceable home synthesis, independent of voice and proposals. */
export class HomeBriefing {
  constructor({ list, read, generate, publish, onFailure = (_failure) => {}, now = Date.now, requireBindings = false, readTimeoutMs = 10000, preferences = DEFAULT_OVERVIEW_PREFERENCES }) {
    this.requireBindings = requireBindings
    this.template = null
    this.sourceOnly = false
    this.templateCreatedAt = 0
    this.templateLayout = ''
    this.templateReadings = null
    this.templateReadingsAt = 0
    this.nextGenerationAt = 0
    this.generationFailures = 0
    this.list = list
    this.read = read
    this.generate = generate
    this.publish = publish
    this.onFailure = onFailure
    this.now = now
    this.readTimeoutMs = readTimeoutMs
    this.preferences = preferences
    this.hydra = null
    this.coverage = undefined
    this.frame = { state: 'unavailable', items: [], generatedAt: 0, omittedSources: 0 }
    this.revision = 0
    this.fingerprint = ''
    this.closed = false
    this.started = false
    this.pending = null
    this.controller = null
    this.timer = null
    this.interval = null
  }

  emit(state, extra = {}) {
    if (this.closed) return
    const coverage = Object.hasOwn(extra, 'items') ? this.coverage : this.frame.coverage ?? this.coverage
    const { hydra: previousHydra, ...base } = this.frame
    this.frame = { ...base, state, ...extra, ...(this.hydra ? { hydra: this.hydra } : {}) }
    if (coverage) this.frame.coverage = { ...coverage, selectedSources: new Set(this.frame.items.flatMap(item => item.sources.map(source => source.id))).size }
    this.publish(this.frame)
  }

  start() {
    if (this.started || this.closed) return
    this.started = true
    this.interval = setInterval(() => { void this.refresh() }, 60000)
    void this.refresh()
  }

  invalidate() {
    if (this.closed) return
    this.revision++
    this.schedule()
  }

  schedule() {
    if (!this.started || this.closed) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.refresh() }, 1000)
  }

  recordHydra(readings) {
    const source = readings.find(reading => reading.id === 'odk.tile.hydra')
    this.hydra = source ? projectHydraSnapshot(source.value, this.now(), source.state) : null
  }

  publishDeferred(readings, omittedSources) {
    this.recordHydra(readings)
    if (this.template && this.templateReadings) this.template = retainVisibleSelection(this.template, this.templateReadings, readings, this.templateReadingsAt, this.preferences)
    if (!this.requireBindings) {
      this.emit(this.frame.items.length ? 'stale' : 'error')
      return
    }
    let items, reboundTemplate, retained = false
    if (this.template && this.templateReadings) {
      try {
        reboundTemplate = rebindHomeSelection(this.template, this.templateReadings, readings, this.now(), this.templateReadingsAt, this.preferences)
        items = validateHomeBriefing(resolveHomeTemplate(reboundTemplate, readings, this.now()), readings, { requireSegments: true })
        retained = items.length > 0
      } catch { /* Changed identities cannot keep an old selected fact. */ }
    }
    if (!retained) {
      try { items = boundSourceFacts(readings, this.now(), this.preferences) }
      catch { items = [] }
    }
    this.sourceOnly = !retained
    // Force the next refresh to reconsider every originally selected identity.
    this.templateLayout = ''
    // A successful rebind uses the latest readings. The template's age cannot
    // make those current facts stale, and only a model generation earns a
    // success timestamp.
    const freshTemplate = retained && !this.generationFailures && this.now() - this.templateCreatedAt < MAX_AGE_MS
    // Current facts from live sources are a live Overview; a displayed
    // unavailable source keeps its stale marker.
    const allLive = items.length > 0 && items.every(item => item.sources?.every(source => source.state === 'live'))
    const state = this.generationFailures ? 'error' : allLive ? 'live' : 'stale'
    this.emit(state, {
      items, generatedAt: freshTemplate ? this.templateCreatedAt : 0, omittedSources,
    })
  }

  async readSource(id, signal) {
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    let timer, cancel
    const cancelled = new Promise((_, reject) => {
      cancel = () => reject(Error('Home source unavailable'))
      controller.signal.addEventListener('abort', cancel, { once: true })
      if (controller.signal.aborted) cancel()
      timer = setTimeout(() => controller.abort(), this.readTimeoutMs)
    })
    try { return await Promise.race([Promise.resolve().then(() => this.read(id, controller.signal)), cancelled]) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', cancel) }
  }

  refresh() {
    if (this.closed) return Promise.resolve()
    if (this.pending) return this.pending
    const revision = this.revision
    const controller = new AbortController()
    this.controller = controller
    const current = () => !this.closed && !controller.signal.aborted
    this.pending = (async () => {
      let stage = 'readings'
      let attempted = false
      let snapshot
      try {
        snapshot = async () => {
          stage = 'readings'
          const catalog = await this.list(controller.signal)
          if (!Array.isArray(catalog)) throw Error('Invalid source catalog')
          if (!current()) throw Error('Home closed')
          const entries = catalog.filter(e => e && e.home?.mode !== 'hidden' && typeof e.id === 'string' && ID.test(e.id)
            && typeof e.label === 'string' && e.label.trim() && e.label.length <= 128 && !/[\x00-\x1f]/.test(e.label))
            .map(entry => ({ ...entry, ...(entry.home !== undefined ? { home: homeDeclaration(entry.home) } : {}) }))
          const results = new Array(entries.length)
          let cursor = 0
          await Promise.all(Array.from({ length: Math.min(4, entries.length) }, async () => {
            while (cursor < entries.length && current()) {
              const index = cursor++
              try { results[index] = { status: 'fulfilled', value: await this.readSource(entries[index].id, controller.signal) } }
              catch { results[index] = { status: 'rejected' } }
            }
          }))
          if (!current()) throw Error('Home closed')
          const readings = []
          let failedSources = 0, incompleteSources = 0
          for (const [index, result] of results.entries()) {
            const entry = entries[index]
            const value = result.status === 'fulfilled' ? result.value : null
            const valid = value && value.id === entry.id && STATES.has(value.state)
              && (value.value === null || (typeof value.value === 'object' && !Array.isArray(value.value)))
            const home = { ...(entry.home ? { home: entry.home } : {}),
              ...(typeof entry.serviceId === 'string' && ID.test(entry.serviceId) && entry.serviceId !== entry.id ? { serviceId: entry.serviceId } : {}) }
            const selected = valid && value.value && entry.home ? Object.fromEntries(entry.home.fields.filter(field => Object.hasOwn(value.value, field)).map(field => [field, value.value[field]])) : value?.value
            let source = valid ? { id: entry.id, label: entry.label, kind: entry.kind, state: value.state, value: selected, ...home,
              ...(Number.isFinite(value.updatedAt) && value.updatedAt >= 0 && value.updatedAt <= 8640000000000000 ? { updatedAt: value.updatedAt } : {}) }
              : { id: entry.id, label: entry.label, kind: entry.kind, state: 'unavailable', value: null, ...home }
            if (Buffer.byteLength(JSON.stringify(source)) > 65536) source = { ...source, state: 'error', value: null }
            if (!valid || source.state !== 'live') failedSources++
            if (partialValue(source.value)) incompleteSources++
            readings.push(source)
          }
          const omittedSources = catalog.filter(entry => entry?.home?.mode !== 'hidden').length - readings.length
          this.coverage = { totalSources: entries.length + omittedSources, readSources: entries.length, failedSources, incompleteSources }
          return { readings, omittedSources }
        }
        let { readings, omittedSources } = await snapshot()
        this.recordHydra(readings)
        if (this.requireBindings && this.template && this.templateReadings) this.template = retainVisibleSelection(this.template, this.templateReadings, readings, this.templateReadingsAt, this.preferences)
        if (!readings.length) {
          this.fingerprint = ''
          this.emit(omittedSources ? 'unavailable' : 'empty', { items: [], generatedAt: this.now(), omittedSources })
          return
        }
        if (this.requireBindings && revision !== this.revision) {
          const latest = await snapshot()
          if (!current()) return
          readings = latest.readings
          omittedSources = latest.omittedSources
        }
        let fingerprint = contentFingerprint(readings)
        const layout = layoutFingerprint(readings, this.now())
        if (this.generationFailures && this.now() < this.nextGenerationAt) {
          this.publishDeferred(readings, omittedSources)
          return
        }
        if (!this.generationFailures && this.requireBindings && this.template && this.templateLayout === layout && this.now() - this.templateCreatedAt < MAX_AGE_MS) {
          try {
            const items = validateHomeBriefing(resolveHomeTemplate(this.template, readings, this.now()), readings, { requireSegments: true })
            this.sourceOnly = false
            if (fingerprint !== this.fingerprint || this.frame.state !== 'live' || this.frame.omittedSources !== omittedSources) this.emit(items.length ? 'live' : 'empty', { items, generatedAt: this.now(), omittedSources })
            this.fingerprint = fingerprint
            return
          } catch { /* Rebind current facts through the deferred path. */ }
        }
        if (!this.generationFailures && !this.requireBindings && fingerprint === this.fingerprint && this.frame.state !== 'stale' && this.now() - this.frame.generatedAt < MAX_AGE_MS) {
          if (this.frame.omittedSources !== omittedSources) this.emit(this.frame.state, { omittedSources })
          return
        }
        if (this.now() < this.nextGenerationAt) {
          this.publishDeferred(readings, omittedSources)
          return
        }
        if (this.requireBindings && (!this.frame.items.length || this.sourceOnly)) {
          try {
            const items = boundSourceFacts(readings, this.now(), this.preferences)
            this.sourceOnly = true
            this.emit('loading', { items, generatedAt: 0, omittedSources })
          } catch {
            // Keep the original limits even before a model response is available.
            this.emit('loading')
          }
        } else this.emit('loading')
        stage = 'generate'
        attempted = true
        const capturedAt = this.now()
        let raw = await this.generate({ readings, omittedSources, now: capturedAt, previous: this.frame.items.filter(item => item.sources.every(source => readings.some(reading => reading.id === source.id))), ...(this.requireBindings ? { variables: homeTemplateVariables(readings, capturedAt) } : {}), preferences: this.preferences, signal: controller.signal })
        if (!current()) return
        let selectedTemplate = raw
        const selectedReadings = readings
        let selectionChanged = false
        // A push reports possible change, not changed content. Repeated telemetry
        // must not cancel a slow model; confirm against fresh readings before use.
        if (this.requireBindings || revision !== this.revision) {
          const confirmationRevision = this.revision
          const latest = await snapshot()
          if (!current()) return
          if (confirmationRevision !== this.revision || !this.requireBindings && (contentFingerprint(latest.readings) !== fingerprint || latest.omittedSources !== omittedSources)) {
            this.fingerprint = ''
            // A push during confirmation does not make the current facts old.
            // Bind the latest readings locally and publish without a model
            // success timestamp; stale would only report an inconclusive model.
            const fresh = await snapshot()
            if (!current()) return
            try {
              const items = boundSourceFacts(fresh.readings, this.now(), this.preferences)
              this.sourceOnly = true
              this.emit('live', { items, generatedAt: 0, omittedSources: fresh.omittedSources })
            } catch {
              this.emit('loading')
            }
            this.schedule()
            return
          }
          if (this.requireBindings) {
            selectedTemplate = retainVisibleSelection(selectedTemplate, selectedReadings, latest.readings, capturedAt, this.preferences)
            raw = selectedTemplate
            selectionChanged = layoutFingerprint(latest.readings, this.now()) !== layout || latest.omittedSources !== omittedSources
            if (!selectionChanged) {
              try { resolveHomeTemplate(raw, latest.readings, this.now()) }
              catch { selectionChanged = true }
            }
            if (selectionChanged) {
              stage = 'validate'
              raw = rebindHomeSelection(raw, readings, latest.readings, this.now(), capturedAt, this.preferences)
              if (!raw.items.length) {
                const items = boundSourceFacts(latest.readings, this.now(), this.preferences)
                this.template = structuredClone(selectedTemplate)
                this.templateReadings = structuredClone(selectedReadings)
                this.templateReadingsAt = capturedAt
                this.templateCreatedAt = this.now()
                this.templateLayout = ''
                this.sourceOnly = true
                this.generationFailures = 0
                this.emit('stale', { items, generatedAt: 0, omittedSources: latest.omittedSources })
                this.schedule()
                return
              }
            }
            readings = latest.readings
            omittedSources = latest.omittedSources
            this.recordHydra(readings)
            fingerprint = contentFingerprint(readings)
          }
        }
        stage = 'validate'
        const items = validateHomeBriefing(this.requireBindings ? resolveHomeTemplate(raw, readings, this.now()) : raw, readings, { requireSegments: this.requireBindings })
        if (this.requireBindings) {
          this.template = structuredClone(selectedTemplate)
          this.templateLayout = selectionChanged ? '' : layoutFingerprint(readings, this.now())
          this.templateCreatedAt = this.now()
          this.templateReadings = structuredClone(selectedReadings)
          this.templateReadingsAt = capturedAt
        }
        this.generationFailures = 0
        this.fingerprint = fingerprint
        this.sourceOnly = false
        this.emit(items.length ? 'live' : 'empty', { items, generatedAt: this.now(), omittedSources })
        if (selectionChanged) this.schedule()
      } catch (error) {
        if (current()) {
          if (attempted) {
            this.generationFailures = Math.min(4, this.generationFailures + 1)
            this.nextGenerationAt = this.now() + Math.min(MAX_RETRY_INTERVAL_MS, MIN_GENERATION_INTERVAL_MS * 2 ** (this.generationFailures - 1))
          }
          const name = typeof error?.name === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(error.name) ? error.name : 'Error'
          const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,31}$/.test(error.code) ? error.code : undefined
          const rawStatus = error?.status ?? error?.statusCode
          const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : undefined
          const failure = { stage, kind: failureKind(stage, error, code, status), name, ...(code ? { code } : {}), ...(status ? { status } : {}) }
          try { this.onFailure(failure) } catch { /* Diagnostics cannot affect briefing recovery. */ }
          if (this.requireBindings && ['generate', 'validate'].includes(stage)) {
            try {
              const recheckRevision = this.revision
              const fresh = await snapshot()
              if (!current() || recheckRevision !== this.revision) return
              const items = boundSourceFacts(fresh.readings, this.now(), this.preferences)
              // These are current bound source values, not a successful model summary.
              this.sourceOnly = true
              this.emit('error', { items, generatedAt: 0, omittedSources: fresh.omittedSources })
              return
            } catch { /* Missing or oversized facts cannot become a fabricated fallback. */ }
          }
          this.emit(this.frame.items.length ? 'stale' : 'error')
        }
      } finally {
        if (attempted) this.nextGenerationAt = Math.max(this.nextGenerationAt, this.now() + MIN_GENERATION_INTERVAL_MS)
      }
    })().finally(() => {
      this.pending = null
      if (revision !== this.revision && !this.closed) this.schedule()
    })
    return this.pending
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    clearInterval(this.interval)
    this.controller?.abort()
  }
}
