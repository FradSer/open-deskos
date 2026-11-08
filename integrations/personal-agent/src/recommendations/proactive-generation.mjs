import { feedbackFor, feedbackPending } from './proactive-feedback-memory.mjs'
import { visibleUiText, visibleUiPairs, validateSuggestionUI, walkUi } from './openui-contract.mjs'
import { randomUUID } from 'node:crypto'
import {privateRule,privateEventReceiptKey} from './private-proposal-sources.mjs'
import { generationKey, identifyCandidate, observationKey, sameOccurrence, timeWindow } from './proactive-lifecycle.mjs'

const KEY = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/
// Unresolved prompt/secret templates ({{x}}, ${x}, {%x%}, {x}) never name a host key.
const TEMPLATE_MARKER = /[{}]/
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => keys.includes(k))
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max && !/[\x00-\x08]/.test(value)
const TECHNICAL_DETAIL = /sha[\s_-]*256|[0-9a-f]{32,}/i

/** Preserve the stable diagnostic code when a candidate has no Advice text. */
class MissingAdviceError extends Error {
  constructor() { super('Invalid generated suggestion: advice is required'); this.code = 'advice_required' }
}
/**
 * The model sees only what it needs to write a candidate. Host bookkeeping and
 * per-observation metadata repeated on every row stay with the host; a reading's
 * shared state and time are declared once on its topic. The host keeps the full
 * input for validation, investigation tools and Jev, so this is a view, not a copy.
 */
export function modelInput(input) {
  const { topics, ...rest } = input ?? {}
  if (!Array.isArray(topics)) return input
  const projected = topics.map(topic => {
    const { cacheKey, observationKey, episodeSequence, urgent, delivery, at, intentCondition, evidence, ...keep } = topic
    const rows = Array.isArray(evidence) ? evidence : []
    const state = rows[0]?.state
    const measuredAt = rows[0]?.measuredAt
    const uniform = rows.length > 0 && rows.every(row => row.state === state && row.measuredAt === measuredAt)
    return { ...keep,
      ...(keep.intentPreview === true && intentCondition ? { intentConditionMet: true } : {}),
      ...(uniform && state !== undefined ? { state } : {}),
      ...(uniform && measuredAt !== undefined ? { measuredAt } : {}),
      evidence: rows.map(row => {
        const { ruleId, ...rowKeep } = row
        return uniform ? (({ state: _s, measuredAt: _m, ...bare }) => bare)(rowKeep) : rowKeep
      }) }
  })
  return { ...rest, topics: projected }
}

// Prose repeats advice only when it contains the complete normalized sentence.
// Short headings, badges and reading labels can share words with the advice.
// The host binds facts mechanically without a model judgment.
const PROSE_TYPES = new Set(['Heading', 'Text', 'Badge'])
const normalize = value => value.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase()

// Canonical numeric value from one token. Times (14:00) stay whole; thousands
// separators and decimal points are normalized; sign and exponent are kept.
function canonicalNumber(token) {
  const text = token.replace(/\s/g, '')
  if (/^[+-]?\d{1,2}:\d{2}(?::\d{2})?$/.test(text)) return text
  const cleaned = text.replace(/,(?=\d{3}(\D|$))/g, '').replace(/,(?=\d+$)/, '.')
  const n = Number(cleaned)
  return Number.isFinite(n) ? String(n) : null
}

// Host-issued ground values: numbers and ISO timestamps that an observation
// actually holds. Free prose, labels, badges and headings are presentation, not
// measured claims; they stay outside this binding.
function evidenceGrounds(entry) {
  const out = new Set()
  const collect = value => {
    if (typeof value === 'number' && Number.isFinite(value)) { out.add(String(value)); return }
    if (typeof value === 'boolean') { return }
    if (typeof value === 'string') {
      for (const token of value.match(/[+-]?\d[\d,.:]*/g) ?? []) {
        const n = canonicalNumber(token)
        if (n) out.add(n)
      }
      const trimmed = value.trim()
      if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(trimmed)) out.add(normalize(trimmed))
      return
    }
    if (value && typeof value === 'object') for (const item of Object.values(value)) collect(item)
  }
  collect(entry?.value)
  return out
}

function formatReadingUnits(ui, cited) {
  const sources = cited.map(entry => {
    let unit = ''
    if (typeof entry.value === 'number') {
      const field = String(entry.field ?? '').split('.').at(-1)
      if (field === 'temperatureC') unit = '°C'
      else if (field?.endsWith('Percent')) unit = '%'
    }
    return { unit, values: evidenceGrounds(entry) }
  })
  if (!sources.some(source => source.unit)) return ui
  const copy = structuredClone(ui)
  let changed = false
  walkUi(copy, node => {
    if (node.type !== 'Reading' && node.type !== 'Metric') return
    const measurement = /^([+-]?\d+(?:[.,]\d+)?)\s*(°\s*C|℃|摄氏度|[%％])?$/i.exec(node.props.value.trim())
    if (!measurement) return
    const [, value, explicitUnit] = measurement
    const number = canonicalNumber(value)
    const units = new Set(sources.filter(source => source.values.has(number)).map(source => source.unit))
    if (explicitUnit) {
      const displayed = /[%％]/.test(explicitUnit) ? '%' : '°C'
      if (units.size && !units.has('') && !units.has(displayed)) throw Error('Card states a unit no cited observation supplies')
      return
    }
    const [unit] = units
    if (units.size === 1 && unit && !node.props.label.includes(unit)) {
      node.props.value = `${value}${unit}`
      changed = true
    }
  })
  return changed ? copy : ui
}

// Canonical numeric or timestamp tokens that the owner can read as measurements.
function visibleClaims(strings) {
  const numbers = new Set(), times = new Set()
  for (const text of strings) {
    for (const token of String(text).match(/[+-]?\d[\d,.:]*/g) ?? []) {
      const n = canonicalNumber(token)
      if (n) numbers.add(n)
    }
    const value = String(text).trim()
    if (/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(value)) times.add(normalize(value))
  }
  return { numbers, times }
}

function proseUiText(ui) {
  const out = []
  const step = (node, active) => {
    if (!node || typeof node !== 'object' || active.has(node)) return
    active.add(node)
    if (PROSE_TYPES.has(node.type)) {
      const value = node.props?.value ?? node.props?.text
      if (typeof value === 'string' && value.trim()) out.push(value.trim())
    }
    for (const child of (Array.isArray(node.children) ? node.children : Array.isArray(node.props?.children) ? node.props.children : [])) step(child, active)
    active.delete(node)
  }
  step(ui, new Set())
  return out
}

function validateCardText(s, evidence) {
  const advice = normalize(s.advice)
  const text = visibleUiText(s.ui)
  if (advice.length >= 4 && proseUiText(s.ui).some(value => {
    const n = normalize(value)
    return n.includes(advice)
  })) throw Error('Card text restates advice')
  const pairs = visibleUiPairs(s.ui).map(([label, value]) => `${normalize(label)}:${normalize(value)}`)
  if (new Set(pairs).size !== pairs.length) throw Error('Card repeats a reading')
  const grounds = new Set(evidence.flatMap(entry => [...evidenceGrounds(entry)]))
  // OwnerStep is model-authored but excluded from visibleUiText. Bind it too.
  const shown = visibleClaims([s.advice, s.nextStep ?? '', ...text])
  for (const n of shown.numbers) if (!grounds.has(n)) throw Error('Card states a number no cited observation supplies')
  for (const t of shown.times) if (!grounds.has(t)) throw Error('Card states a time no cited observation supplies')
  return text
}

/** OpenUI owns the tree; the host validates only its visible claims before publication. */
export function validateGeneratedBatch(raw, topics, maxCandidates) {
  if (!exact(raw, ['suggestions']) || !Array.isArray(raw.suggestions) || raw.suggestions.length > maxCandidates || Buffer.byteLength(JSON.stringify(raw)) > 16384) throw Error('Invalid generated suggestions')
  const seen = new Set()
  return raw.suggestions.map(s => {
    if (s && typeof s === 'object' && !Array.isArray(s) && (typeof s.advice !== 'string' || !s.advice.trim())) throw new MissingAdviceError()
    const topic = topics.find(t => t.id === s.topicId)
    const key = `${s.topicId}:${s.key}`
    const intent = topic?.intentPreview === true
    const action = !intent && topic?.actions?.find(action => action.id === s.actionId)
    if (typeof s.advice === 'string') {
      const label = normalize(action?.label ?? '')
      // An observation can contain the same words. A separate instruction duplicates the button.
      if (label && s.advice.split(/[.!?。！？,，;；\n]+/).some(clause => {
        const words = normalize(clause)
        return words === label || words === `请${label}` || words === `please${label}`
      })) throw Error('Advice repeats the action label')
    }
    if (!exact(s, ['topicId', 'key', 'advice', intent ? 'nextStep' : 'actionId', 'evidenceIds', 'ui']) || !topic || typeof s.key !== 'string' || TEMPLATE_MARKER.test(s.key) || !KEY.test(s.key) || seen.has(key) || !text(s.advice, 400) || TECHNICAL_DETAIL.test(s.advice)
      || (intent ? !text(s.nextStep, 240) || /[\x00-\x1f\x7f]/.test(s.nextStep) || TECHNICAL_DETAIL.test(s.nextStep) : typeof s.actionId !== 'string' || !action)
      || !Array.isArray(s.evidenceIds) || !s.evidenceIds.length || s.evidenceIds.length > 8 || new Set(s.evidenceIds).size !== s.evidenceIds.length || !s.evidenceIds.every(id => topic.evidence.some(e => e.id === id))) throw Error('Invalid generated suggestion')
    // A scoped Intent may use more observations than a card can carry. Bind
    // each displayed claim to its selected citations. Other topics retain
    // their existing whole-topic evidence contract.
    const cited = topic.evidence.filter(entry => s.evidenceIds.includes(entry.id))
    const evidence = topic.intentCondition ? cited : topic.evidence
    if (!s.ui) {
      const grounds = new Set(evidence.flatMap(entry => [...evidenceGrounds(entry)]))
      const shown = visibleClaims([s.advice, s.nextStep ?? ''])
      for (const n of shown.numbers) if (!grounds.has(n)) throw Error('Candidate states a number no cited observation supplies')
      for (const t of shown.times) if (!grounds.has(t)) throw Error('Candidate states a time no cited observation supplies')
    }
    let candidate = s
    let uiText = s.ui ? validateCardText(s, evidence) : []
    if (s.ui) {
      validateSuggestionUI(s)
      const ui = formatReadingUnits(s.ui, cited)
      if (ui !== s.ui) {
        candidate = { ...s, ui }
        uiText = validateCardText(candidate, evidence)
      }
    }
    seen.add(key)
    return { ...candidate, nextStep: intent ? s.nextStep : action.label,
      evidence: evidence.map(entry => ({ ...entry })), uiText }
  })
}

/** Generation proposes; host validation binds facts; the watch separately schedules attention. */
export async function pollGenerated(watch, trigger, context, rules = watch.rules()) {
  const interactionRevision = watch.interactionRevision
  const current = () => !watch.closed && !watch.responding && interactionRevision === watch.interactionRevision
  const revisions = new Map()
  const topicCurrent = id => watch.rules().some(rule => rule.id === id)
    && revisions.get(id)?.every(([source, revision]) => (watch.sourceRevisions.get(source) ?? 0) === revision)
  const topics = [], codingReceipts = []
  let evidenceIndex = 0, cachedTopics = 0, generationCalls = 0
  const auditGeneration = record => {
    try { watch.onGeneration({ trigger: trigger.kind, at: new Date(watch.now()).toISOString(), ...record, generationCalls }) } catch { /* Diagnostics cannot change generation state. */ }
  }
  for (const rule of rules) {
    if (rule.intentRevision && watch.intents?.awaitingEvidence?.(rule.id)) continue
    const dependencies = rule.coding ? [`pi-tasks.${rule.coding.target}`] : rule.observations.map(o => o.readingId)
    if (trigger.kind === 'service_push' && !dependencies.some(id => trigger.readingIds.includes(id))) continue
    revisions.set(rule.id, dependencies.map(source => [source, watch.sourceRevisions.get(source) ?? 0]))
    if (watch.config.suppressed.includes(rule.id) || (watch.config.snoozed[rule.id] ?? 0) > watch.now()) {
      watch.clearGenerationFailure(rule.id); continue
    }
    if (privateRule(rule) && (watch.privateSources?.shouldGenerate?.(rule) === false
      || watch.privateHandledEvents.has(privateEventReceiptKey(rule.privateSourceId,rule.privateEventKey)))) continue
    const actions = rule.intentRevision ? [] : watch.availableActions(rule)
    if (!rule.intentRevision && !actions.length) {
      watch.clearGenerationFailure(rule.id)
      for (const p of watch.proposals) if (p.ruleId === rule.id && p.status === 'pending' && p.action !== null) p.status = 'expired'
      continue
    }
    let evidence
    if (rule.coding) {
      try {
        const identities = rule.coding.taskId ? [rule.coding] : (await watch.codingList?.(rule.coding, watch.controller.signal) ?? [])
          .filter(t => typeof t.project === 'string' && (t.project === rule.coding.project || t.project.startsWith(rule.coding.project.replace(/\/$/, '') + '/')) && /^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(t.taskId))
          .slice(0, 16).map(t => ({ target: rule.coding.target, project: t.project, taskId: t.taskId }))
        evidence = []
        for (const identity of identities) {
          const facts = await watch.codingEvidence(rule, identity)
          if (facts) { evidence.push(...facts); codingReceipts.push({ rule, identity, evidence: facts }) }
        }
        if (!evidence.length) evidence = null
      } catch { evidence = null }
    } else evidence = await watch.evidence(rule)
    if (!current()) return
    if (!topicCurrent(rule.id)) continue
    if (!evidence) {
      for (const p of watch.proposals) if (p.ruleId === rule.id && p.status === 'pending') p.status = 'expired'
      delete watch.generationCache[rule.id]
      watch.clearGenerationFailure(rule.id)
      continue
    }
    const observed = observationKey(evidence)
    const previousEpisode = watch.observationEpisodes[rule.id]
    const episodeSequence = previousEpisode ? previousEpisode.sequence + Number(previousEpisode.key !== observed) : 0
    if (!Number.isSafeInteger(episodeSequence)) {
      watch.failedGeneration.add(rule.id)
      watch.generationError = '建议事件容量已满；请更新主题配置。已有记录已保留。'
      continue
    }
    watch.observationEpisodes[rule.id] = { key: observed, sequence: episodeSequence }
    for (const p of watch.proposals) if (p.ruleId === rule.id && p.status === 'pending') {
      const freshEvidence = p.evidence.map(old => evidence.find(e => e.readingId === old.readingId && e.field === old.field))
      const sameValues = freshEvidence.every(Boolean) && observationKey(p.evidence) === observationKey(freshEvidence)
      if (!sameValues || (p.observationKey && p.observationKey !== observed)) p.status = 'expired'
      else p.evidence = freshEvidence.map((fresh, i) => ({ ...fresh, ...(p.evidence[i].id ? { id: p.evidence[i].id } : {}) }))
    }
    const feedbackMemory = await feedbackFor(watch, rule)
    if (!current()) return
    if (!topicCurrent(rule.id)) continue
    const cacheVersion = rule.intentCondition ? 'qualified-intent-v1' : 'executable-card-v3'
    const cacheKey = generationKey([cacheVersion, feedbackMemory, actions.map(({ id, label }) => ({ id, label })), JSON.stringify(rule), observed, episodeSequence, context.local.date,
      rule.delivery === 'routine' ? context.local.time >= rule.at : null, context.quiet, timeWindow(evidence, watch.now())])
    const cached = watch.generationCache[rule.id]
    const interval = watch.config.generationIntervalMs ?? 300000
    if (cached?.key === cacheKey && watch.now() >= cached.at && watch.now() - cached.at < interval) {
      cachedTopics++
      continue
    }
    topics.push({ ...(rule.intentRevision ? { intentPreview: true, ...(rule.intentCondition ? { intentCondition: rule.intentCondition } : {}) } : { actions: actions.map(({ id, label }) => ({ id, label })) }), id: rule.id, ...(privateRule(rule) ? { sourceSnapshot: watch.privateSources.snapshot(rule) } : {}), goal: rule.goal, ...(feedbackMemory ? { feedbackMemory } : {}), urgent: rule.urgent, delivery: rule.delivery, ...(rule.at ? { at: rule.at } : {}),
      observationKey: observed, episodeSequence, cacheKey, evidence: evidence.map(e => ({ id: `e${evidenceIndex++}`, ...e })) })
  }
  if (!current()) return
  if (!topics.length) {
    if (cachedTopics) auditGeneration({ phase: 'cached', candidates: 0, topics: [], cachedTopics, budget: watch.config.maxGenerationCalls ?? 4 })
    watch.emit(); return
  }
  // Fairly rotate deferred topics. A large catalog never disappears behind an input slice.
  topics.sort((a, b) => (watch.generationAttempts.get(a.id) ?? 0) - (watch.generationAttempts.get(b.id) ?? 0))
  const recentFor = selected => watch.proposals.filter(p => selected.some(t => t.id === p.ruleId)).slice(-16)
    .map(({ ruleId, subject, advice, status, presented, evidence, feedback }) => ({ ruleId, key: subject.split(':').slice(1).join(':'), advice, status, presented, evidence, ...(feedback ? { feedback } : {}) }))
  const inputFor = selected => ({ trigger, context, topics: selected.map(({ sourceSnapshot, ...topic }) => topic), recent: recentFor(selected), maxCandidates: watch.config.maxCandidates ?? 8, signal: watch.controller.signal })
  const fits = selected => Buffer.byteLength(JSON.stringify({ ...inputFor(selected), signal: undefined })) <= 32768
  const batches = []
  let batch = []
  for (const topic of topics) {
    if (Object.hasOwn(topic, 'sourceSnapshot') || watch.isolatedTopics.has(topic.id)) {
      if (batch.length) { batches.push(batch); batch = [] }
      if (fits([topic])) batches.push([topic])
      else { watch.failedGeneration.add(topic.id); watch.generationError = '部分建议生成暂不可用。' }
      continue
    }
    if (batch.length && (Boolean(batch[0].intentCondition) !== Boolean(topic.intentCondition) || !fits([...batch, topic]))) { batches.push(batch); batch = [] }
    if (!fits([topic])) { watch.failedGeneration.add(topic.id); watch.generationError = '部分建议生成暂不可用。'; continue }
    batch.push(topic)
  }
  if (batch.length) batches.push(batch)
  let attempts = 0
  const budget = watch.config.maxGenerationCalls ?? 4
  const fail = selected => {
    const applicable = selected.filter(t => topicCurrent(t.id))
    if (!applicable.length) return
    for (const topic of applicable) watch.failedGeneration.add(topic.id)
    watch.generationError = '部分建议生成暂不可用；其他建议仍可查看。'
  }
  const complete = async (selected, candidates) => {
    if (!current()) return
    const active = selected.filter(t => topicCurrent(t.id))
    for (const t of active) {
      watch.failedGeneration.delete(t.id)
      watch.isolatedTopics.delete(t.id)
      watch.generationCache[t.id] = { key: t.cacheKey, at: watch.now() }
    }
    if (!watch.failedGeneration.size) watch.generationError = ''
    for (const candidate of candidates.filter(c => topicCurrent(c.ruleId))) {
      if (candidate.privateData === true && !await watch.privateSources?.validate(candidate.sourceSnapshot,watch.controller.signal)) continue
      if (!current()) return
      if (!topicCurrent(candidate.ruleId)) continue
      const existing = watch.proposals.findLast(p => sameOccurrence(p, candidate))
      if (!watch.fresh(candidate)) { if (existing?.status === 'pending') existing.status = 'expired'; continue }
      // Handled and uncertain occurrences are host-owned receipts, never model-overridable advice.
      if (watch.handledOccurrences[candidate.occurrenceKey] || (existing && ['ignored', 'completed', 'executing', 'unknown'].includes(existing.status))) continue
      if (watch.proposals.some(p => p.needKey === candidate.needKey && p.action !== null && ['executing', 'unknown'].includes(p.status))) continue
      for (const p of watch.proposals) if (p.ruleId === candidate.ruleId && p.status === 'pending'
        && p.subject === `${candidate.ruleId}:${candidate.key}` && !sameOccurrence(p, candidate)) p.status = 'expired'
      const record = { needKey: candidate.needKey, observationKey: candidate.observationKey, occurrenceKey: candidate.occurrenceKey,
        evidence: candidate.evidence, advice: candidate.advice, nextStep: candidate.nextStep,
        ui: candidate.ui,
        ...(candidate.privateData?{privateData:true,privateSourceId:candidate.privateSourceId,privateEventKey:candidate.privateEventKey,sourceSnapshot:structuredClone(candidate.sourceSnapshot)}:{}) }
      const rule = watch.rules().find(rule => rule.id === candidate.ruleId)
      const approved = rule?.intentRevision ? undefined : watch.availableActions(rule).find(action => action.id === candidate.actionId)
      if (!rule?.intentRevision && (!approved || candidate.nextStep !== approved.label)) continue
      if (existing && !rule?.intentRevision && existing.action === null) continue
      const action = approved ? structuredClone({ tool: approved.tool, params: approved.params }) : null
      const id = existing?.id ?? randomUUID()
      const confirmation = action ? action.tool === 'memory_update' ? `记住 ${action.params.category}：${action.params.value}` : `确认执行 ${id}` : ''
      const binding = { action, confirmation, ...(approved ? { actionId: approved.id, nextStep: approved.label } : {}) }
      if (existing) {
        if (!rule?.intentRevision && (existing.actionId !== candidate.actionId || JSON.stringify(existing.action) !== JSON.stringify(action))) continue
        Object.assign(existing, record, binding, { status: 'pending' }); continue
      }
      watch.proposals.push({ id, ruleId: candidate.ruleId, ruleVersion: candidate.ruleVersion, subject: `${candidate.ruleId}:${candidate.key}`,
        status: 'pending', ...record, ...binding, offered: false, presented: false, createdAt: new Date(watch.now()).toISOString(), result: '',
        ...(watch.intents?.details(candidate.ruleId) ? { ridePreview: watch.intents.details(candidate.ruleId) } : {}) })
      if (watch.proposals.length > 64) {
        const removable = watch.proposals.findIndex(p => !feedbackPending(watch, p) && (p.status === 'expired'
          || (!p.occurrenceKey && ['ignored', 'completed'].includes(p.status))
          || (p.occurrenceKey && watch.handledOccurrences[p.occurrenceKey])))
        if (removable >= 0) watch.proposals.splice(removable, 1)
        else {
          watch.proposals.pop()
          delete watch.generationCache[candidate.ruleId]
          watch.generationError = '建议容量已满；请先处理已有建议。未删除已有建议或执行状态。'
        }
      }
    }
    for (const receipt of codingReceipts.filter(r => active.some(t => t.id === r.rule.id))) watch.consumeCoding(receipt.rule, receipt.identity, receipt.evidence)
    for (const topic of active.filter(t => t.sourceSnapshot && topicCurrent(t.id))) {
      const candidate = candidates.find(c => c.ruleId === topic.id)
      if (!candidate || watch.proposals.some(p => sameOccurrence(p, candidate))) {
        watch.privateSources?.consume?.(watch.rules().find(rule => rule.id === topic.id), Boolean(candidate))
      }
    }
  }
  const evaluate = async selected => {
    if (!current() || attempts >= budget) return
    attempts++
    for (const t of selected) watch.generationAttempts.set(t.id, ++watch.generationSequence)
    let candidates
    try {
      generationCalls++
      const raw = await watch.generate(inputFor(selected))
      if (!current()) return
      const unique = new Map(), intentTopics = new Set()
      for (const s of validateGeneratedBatch(raw, selected, watch.config.maxCandidates ?? 8)) {
        const occurrence = watch.intents?.key(s.topicId)
        if (occurrence) { if (intentTopics.has(s.topicId)) continue; intentTopics.add(s.topicId); s.key = occurrence }
        const candidate = identifyCandidate(watch, s, selected.find(t => t.id === s.topicId))
        const equivalent = [...unique.values()].some(c => c.ruleId === candidate.ruleId && c.advice.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase() === candidate.advice.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase() && observationKey(c.evidence) === observationKey(candidate.evidence))
        if (!equivalent && topicCurrent(s.topicId)) unique.set(candidate.occurrenceKey, candidate)
      }
      candidates = [...unique.values()].map((c, i) => ({ ...c, id: `c${i}` }))
      auditGeneration({ phase: 'generated', candidates: candidates.length, topics: selected.map(t => t.id), cachedTopics, budget })
    } catch (error) {
      if (!current()) return
      fail(selected)
      // A time budget covers the whole batch. Re-running each topic would start
      // fresh sessions against the same exhausted deadline and cannot succeed.
      const deadlineFailure = error?.code === 'generation_timeout' || error?.code === 'generation_cancelled'
      if (!deadlineFailure && selected.length > 1) {
        for (const t of selected) watch.isolatedTopics.add(t.id)
        for (const t of selected) { if (attempts >= budget) break; await evaluate([t]) }
      }
      return
    }
    try {
      await complete(selected, candidates)
    } catch {
      if (current()) fail(selected)
    }
  }
  for (const selected of batches) { if (!current() || attempts >= budget) break; await evaluate(selected) }
  if (current()) auditGeneration({ phase: 'round', candidates: 0, topics: [], cachedTopics, budget, budgetUsed: attempts })
  if (current()) watch.emit()
}
