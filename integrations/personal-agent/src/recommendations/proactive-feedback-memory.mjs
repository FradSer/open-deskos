import { generationKey } from './proactive-lifecycle.mjs'
import { projectPrivateFeedback, projectPrivateRuleFeedback, privateFeedbackRuleContext, privateFeedbackSignalsSafe, privateFeedbackJobSafe } from './private-feedback-projection.mjs'
import { sensitiveMemoryPattern } from '../proactive-private.mjs'

const DIMENSIONS = Object.freeze({ useful: 'utility', irrelevant: 'relevance', incorrect: 'accuracy', snooze: 'timing', ignore: 'relevance', mute: 'relevance', done: 'completion' })
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const HASH = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const revision = value => Number.isSafeInteger(value) && value > 0
const validSignal = signal => exact(signal, ['decision', 'dimension', 'subject', 'at']) && Object.hasOwn(DIMENSIONS, signal.decision) && signal.dimension === DIMENSIONS[signal.decision] && text(signal.subject, 120) && date(signal.at)

export function validateFeedbackLearning(value) {
  if (!exact(value, ['revision', 'decision', 'status']) || !revision(value.revision) || !Object.hasOwn(DIMENSIONS, value.decision)
    || !['queued', 'running', 'applied', 'failed', 'unavailable', 'stale'].includes(value.status)) throw Error('Invalid feedback learning state')
}

export function validateFeedbackState(state) {
  if (!exact(state, ['version', 'entries', 'jobs']) || state.version !== 1 || !Array.isArray(state.entries) || state.entries.length > 64 || !Array.isArray(state.jobs) || state.jobs.length > 64
    || new Set(state.entries.map(entry => entry.ruleId)).size !== state.entries.length || new Set(state.jobs.map(job => job.proposalId)).size !== state.jobs.length) throw Error('Invalid feedback memory state')
  for (const entry of state.entries) if (!exact(entry, ['ruleId', 'ruleVersionKey', 'revision', 'signals']) || !ID.test(entry.ruleId) || !HASH.test(entry.ruleVersionKey) || !revision(entry.revision)
    || !Array.isArray(entry.signals) || !entry.signals.length || entry.signals.length > 8 || !entry.signals.every(validSignal)) throw Error('Invalid feedback memory entry')
  for (const job of state.jobs) if (!exact(job, ['proposalId', 'revision', 'ruleId', 'ruleVersionKey', 'decision', 'advice', 'nextStep', 'at', 'status', 'attempts']) || !UUID.test(job.proposalId)
    || !revision(job.revision) || !ID.test(job.ruleId) || !HASH.test(job.ruleVersionKey) || !Object.hasOwn(DIMENSIONS, job.decision) || typeof job.advice !== 'string' || !job.advice.trim() || job.advice.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(job.advice)
    || typeof job.nextStep !== 'string' || job.nextStep.length > 240 || /[\x00-\x1f\x7f]/.test(job.nextStep) || !date(job.at) || !['queued', 'running', 'failed', 'unavailable'].includes(job.status) || !Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 2) throw Error('Invalid feedback memory job')
  return state
}

export function feedbackRuleKey(rule) {
  // Intent occurrence dates and transient quote handles do not change the saved wish.
  const { occurrenceDate: _date, manualPreview: _preview, ...definition } = rule
  return generationKey(JSON.stringify(definition))
}

function hostAllows(watch, proposal) {
  try { return watch.canRefineFeedbackMemory(proposal) === true } catch { return false }
}

function allowed(watch, proposal) {
  if (!hostAllows(watch, proposal)) return false
  if (proposal?.privateData === true) return Boolean(projectPrivateFeedback(watch, proposal))
  if (proposal?.sourcePolicy?.skipAutomaticLearning === true) return false
  return true
}

async function migrateFeedback(watch) {
  if (!watch.feedbackStore || !watch.feedbackMemory.entries.length) return
  watch.feedbackMigration ??= (async () => {
    const entries = watch.feedbackMemory.entries
    const remaining = []
    for (const entry of entries) {
      const signals = entry.signals
      const privateRule = watch.proposals.some(proposal => proposal.ruleId === entry.ruleId && proposal.privateData === true)
      if (signals.some(signal => sensitiveMemoryPattern.test(signal.subject))
        || privateRule
        || (entry.ruleId.startsWith('private-feedback-') && !privateFeedbackSignalsSafe(signals))) {
        remaining.push(entry)
        continue
      }
      await watch.feedbackStore.put('legacy-' + generationKey([entry.ruleId, entry.ruleVersionKey]),
        signals.map(signal => signal.decision + ': ' + signal.subject).join('\n'),
        { rule_id: entry.ruleId, rule_version_key: entry.ruleVersionKey, signals, revision: entry.revision }, { replace: false, signal: watch.controller.signal })
    }
    if (remaining.length === entries.length) return
    watch.feedbackMemory.entries = remaining
    try { watch.persist() } catch (error) { watch.feedbackMemory.entries = entries; throw error }
  })().finally(() => { watch.feedbackMigration = undefined })
  await watch.feedbackMigration
}

async function scopedFeedback(watch, ruleId, ruleVersionKey) {
  if (!watch.feedbackStore) return undefined
  try {
    await migrateFeedback(watch)
    const rows = await watch.feedbackStore.list({ rule_id: ruleId, rule_version_key: ruleVersionKey }, 513, watch.controller.signal)
    const items = rows.map(row => row.metadata).filter(item => {
      if (item?.rule_id !== ruleId || item.rule_version_key !== ruleVersionKey || !Array.isArray(item.signals) || !item.signals.every(validSignal)) return false
      if (!item.proposal_id) return true
      const proposal = watch.proposals.find(proposal => proposal.id === item.proposal_id)
      return !proposal || (proposal.feedbackLearning?.revision === item.revision && proposal.feedbackLearning.status === 'applied')
    })
    const signals = items.flatMap(item => item.signals).sort((a, b) => a.at.localeCompare(b.at)).slice(-8)
    return signals.length ? { revision: generationKey(signals), signals } : undefined
  } catch { return undefined }
}

export async function feedbackFor(watch, rule) {
  const projected = projectPrivateRuleFeedback(watch, rule)
  if (projected) {
    const proposal = watch.proposals.findLast(item => item.ruleId === rule.id) ?? privateFeedbackRuleContext(watch, rule)
    if (!hostAllows(watch, proposal)) return undefined
    const entry = await scopedFeedback(watch, projected.scopeId, projected.scopeKey)
    const current = projectPrivateRuleFeedback(watch, rule)
    return entry && current?.scopeKey === projected.scopeKey && current.scopeId === projected.scopeId
      && privateFeedbackSignalsSafe(entry.signals, current) && hostAllows(watch, proposal) ? entry : undefined
  }
  if (rule.privateSourceId !== undefined || rule.privateEventKey !== undefined) return undefined
  const proposal = watch.proposals.findLast(item => item.ruleId === rule.id)
  if (proposal && !allowed(watch, proposal)) return undefined
  const entry = await scopedFeedback(watch, rule.id, feedbackRuleKey(rule))
  return !proposal || allowed(watch, proposal) ? entry : undefined
}

/** Display-history eviction must not destroy acknowledged learning work or its policy context. */
export function feedbackPending(watch, proposal) {
  return watch.feedbackMemory.jobs.some(job => job.proposalId === proposal.id)
}

/** Queue only an actual owner response, in the same checkpoint as that response. */
export function queueFeedback(watch, proposal, decision) {
  if (!Object.hasOwn(DIMENSIONS, decision) || (proposal.feedbackLearning?.decision === decision && ['queued', 'running', 'applied'].includes(proposal.feedbackLearning.status))) return
  const nextRevision = (proposal.feedbackLearning?.revision ?? 0) + 1
  if (!revision(nextRevision)) throw Error('Feedback revision limit exceeded')
  const hadPending = feedbackPending(watch, proposal)
  const projected = projectPrivateFeedback(watch, proposal)
  watch.feedbackMemory.jobs = watch.feedbackMemory.jobs.filter(job => job.proposalId !== proposal.id)
  const eligible = (watch.feedbackMemoryEnabled || hadPending) && allowed(watch, proposal) && watch.feedbackMemory.jobs.length < 64
  const status = eligible && watch.feedbackMemoryEnabled && watch.feedbackStore ? 'queued' : 'unavailable'
  proposal.feedbackLearning = { revision: nextRevision, decision, status }
  if (eligible) watch.feedbackMemory.jobs.push({ proposalId: proposal.id, revision: nextRevision, ruleId: proposal.ruleId, ruleVersionKey: generationKey(proposal.ruleVersion), decision,
    advice: projected?.advice ?? proposal.advice, nextStep: projected?.nextStep ?? proposal.nextStep ?? '', at: new Date(watch.now()).toISOString(), status, attempts: 0 })
}

/** The timer boundary lets the persisted feedback receipt complete before the Mem0 write starts. */
export function scheduleFeedback(watch) {
  if (watch.closed || watch.storageFailure || watch.feedbackTimer || watch.feedbackInflight || !watch.feedbackMemory.jobs.some(job => job.status === 'queued')) return
  watch.feedbackTimer = setTimeout(() => {
    watch.feedbackTimer = undefined
    if (watch.closed || watch.storageFailure) return
    const work = drain(watch)
    watch.feedbackInflight = work
    void work.catch(() => { /* Feedback is committed; the worker reports only fixed states. */ }).finally(() => {
      if (watch.feedbackInflight === work) watch.feedbackInflight = undefined
      scheduleFeedback(watch)
    })
  }, 0)
}

/** Source hydration can resume only an existing fixed private-feedback job. */
export function resumePrivateFeedback(watch) {
  if (watch.closed || watch.storageFailure || !watch.feedbackMemoryEnabled || !watch.feedbackStore) return
  let changed = false
  for (const job of watch.feedbackMemory.jobs.filter(item => item.status === 'unavailable' && item.attempts < 2)) {
    const proposal = watch.proposals.find(item => item.id === job.proposalId)
    if (!privateFeedbackJobSafe(proposal, job) || !allowed(watch, proposal)
      || proposal.feedbackLearning?.revision !== job.revision) continue
    job.status = 'queued'; proposal.feedbackLearning.status = 'queued'; changed = true
  }
  if (changed) {
    try { watch.persist() } catch { watch.storageFailure = true; return }
    scheduleFeedback(watch)
  }
}

async function drain(watch) {
  while (!watch.closed && !watch.storageFailure) {
    const job = watch.feedbackMemory.jobs.find(item => item.status === 'queued')
    if (!job) return
    const proposal = watch.proposals.find(item => item.id === job.proposalId)
    const ruleCurrent = () => watch.rules().some(rule => rule.id === job.ruleId && generationKey(JSON.stringify(rule)) === job.ruleVersionKey)
    const current = () => !watch.closed && !watch.controller.signal.aborted && watch.feedbackMemory.jobs.includes(job)
      && proposal?.feedbackLearning?.revision === job.revision && ruleCurrent()
    const checkpoint = () => {
      try { watch.persist(); return true } catch { watch.storageFailure = true; return false }
    }
    if (!current()) {
      if (privateFeedbackJobSafe(proposal, job)) {
        job.status = 'unavailable'
        if (proposal.feedbackLearning?.revision === job.revision) proposal.feedbackLearning.status = 'unavailable'
        if (!checkpoint()) return
        continue
      }
      watch.feedbackMemory.jobs = watch.feedbackMemory.jobs.filter(item => item !== job)
      if (proposal?.feedbackLearning?.revision === job.revision) proposal.feedbackLearning.status = 'stale'
      if (!checkpoint()) return
      continue
    }
    if (!allowed(watch, proposal) || !watch.feedbackMemoryEnabled || !watch.feedbackStore) {
      if (!allowed(watch, proposal) && !privateFeedbackJobSafe(proposal, job)) watch.feedbackMemory.jobs = watch.feedbackMemory.jobs.filter(item => item !== job)
      else job.status = 'unavailable'
      proposal.feedbackLearning.status = 'unavailable'
      checkpoint(); watch.emit(); continue
    }
    const projected = projectPrivateFeedback(watch, proposal)
    if (proposal.privateData === true && (!projected || job.advice !== projected.advice || job.nextStep !== projected.nextStep)) {
      watch.feedbackMemory.jobs = watch.feedbackMemory.jobs.filter(item => item !== job)
      proposal.feedbackLearning.status = 'unavailable'
      checkpoint(); watch.emit(); continue
    }
    if (job.attempts >= 2) { job.status = 'failed'; proposal.feedbackLearning.status = 'failed'; checkpoint(); continue }
    job.attempts++
    job.status = 'running'; proposal.feedbackLearning.status = 'running'
    if (!checkpoint()) return
    const key = generationKey([job.proposalId, job.revision])
    try {
      await migrateFeedback(watch)
      if (current() && allowed(watch, proposal)) {
        const subject = [job.advice, job.nextStep].map(value => value.split(/[\r\n]/, 1)[0].trim().slice(0, 120))
          .find(value => text(value, 120) && !sensitiveMemoryPattern.test(value))
        if (!subject) throw Error('No safe feedback subject')
        const signal = { decision: job.decision, dimension: DIMENSIONS[job.decision], subject, at: job.at }
        await watch.feedbackStore.put(key, job.decision + ': ' + subject, {
          rule_id: projected?.scopeId ?? job.ruleId,
          rule_version_key: projected?.scopeKey ?? feedbackRuleKey(watch.rules().find(rule => rule.id === job.ruleId)),
          proposal_id: job.proposalId, revision: job.revision, signals: [signal],
        }, { replace: false, signal: watch.controller.signal })
      }
      if (!current() || !allowed(watch, proposal)) {
        if (!watch.closed) await watch.feedbackStore.remove(key).catch(() => {})
        if (!watch.closed && watch.feedbackMemory.jobs.includes(job)) {
          watch.feedbackMemory.jobs = watch.feedbackMemory.jobs.filter(item => item !== job)
          if (proposal?.feedbackLearning?.revision === job.revision) proposal.feedbackLearning.status = 'stale'
          checkpoint(); watch.emit()
        }
        continue
      }
      const before = structuredClone(watch.feedbackMemory)
      watch.feedbackMemory.jobs = watch.feedbackMemory.jobs.filter(item => item !== job)
      proposal.feedbackLearning.status = 'applied'
      if (!checkpoint()) { watch.feedbackMemory = before; proposal.feedbackLearning.status = 'running'; return }
      // Generation already in progress cannot apply a result that predates this memory.
      watch.interactionRevision++
      watch.emit()
    } catch {
      if (!current() || !allowed(watch, proposal)) {
        if (!watch.closed && watch.feedbackMemory.jobs.includes(job)) {
          watch.feedbackMemory.jobs = watch.feedbackMemory.jobs.filter(item => item !== job)
          if (proposal?.feedbackLearning?.revision === job.revision) proposal.feedbackLearning.status = 'stale'
          checkpoint(); watch.emit()
        }
        continue
      }
      job.status = 'failed'; proposal.feedbackLearning.status = 'failed'
      checkpoint(); watch.emit()
    }
  }
}
