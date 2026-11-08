import { createHash } from 'node:crypto'
import {privateRule,privateEventReceiptKey} from './private-proposal-sources.mjs'

export const PROPOSAL_DECISIONS = /** @type {const} */ (['accept', 'ignore', 'mute', 'done', 'snooze', 'useful', 'irrelevant', 'incorrect'])

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const generationKey = value => digest(value)
export const observationKey = evidence => digest(evidence.map(e => [e.readingId, e.field, e.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))

export function observationField(value, path) {
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, part)) return undefined
    value = value[part]
  }
  return value
}

export function observationMeasuredAt(reading, path, timestampPath = undefined) {
  const separator = path.lastIndexOf('.')
  const parent = separator < 0 ? reading?.value : observationField(reading?.value, path.slice(0, separator))
  const field = path.slice(separator + 1)
  if (parent?.stale === true || parent?.online === false || (field === 'soilPercent' && parent?.soilStale === true)) return undefined
  if (timestampPath) return observationField(reading?.value, timestampPath)
  // A plant or greenhouse measurement can be older than its enclosing snapshot.
  if (parent && Object.hasOwn(parent, 'measuredAt')) return parent.measuredAt
  // An installed package publishes through the host registry, which owns this clock.
  if (reading?.kind === 'package' && Number.isFinite(reading.updatedAt)) {
    const published = new Date(reading.updatedAt)
    return Number.isFinite(published.valueOf()) ? published.toISOString() : undefined
  }
  return reading?.value?.measured_at ?? reading?.value?.asOf ?? reading?.measured_at ?? reading?.asOf
}

const deadlines = evidence => evidence.filter(e => /(?:^|\.)(?:deadline|dueAt|expiresAt|startsAt|startAt)$/i.test(e.field) && typeof e.value === 'string')
  .map(e => Date.parse(e.value)).filter(Number.isFinite)
export const timeWindow = (evidence, now) => deadlines(evidence).map(deadline => {
  const remaining = deadline - now
  return remaining <= 0 ? 'due' : remaining <= 300000 ? Math.ceil(remaining / 60000) : 'later'
})
const fingerprint = candidate => JSON.stringify([candidate.ruleId ?? candidate.topicId,
  candidate.advice.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase(),
  candidate.evidence.map(e => `${e.readingId}:${e.field}`).sort()])

/** Retain handled identity without carrying old evidence or recommendation text. */
export function handledReceipt(proposal) {
  return { ruleId: proposal.ruleId, ruleVersionKey: digest(proposal.ruleVersion), subject: proposal.subject,
    needKey: proposal.needKey, observationKey: proposal.observationKey, occurrenceKey: proposal.occurrenceKey,
    fingerprint: digest(fingerprint(proposal)), status: proposal.status }
}

/** Identity describes a need and its observed occurrence, never a model invocation. */
export function identifyCandidate(watch, candidate, topic) {
  const rule = watch.rules().find(rule => rule.id === candidate.topicId)
  const ruleVersion = JSON.stringify(rule)
  if (privateRule(rule)) {
    const receipt = privateEventReceiptKey(rule.privateSourceId,rule.privateEventKey)
    return {...candidate,key:rule.privateEventKey,ruleId:rule.id,ruleVersion,needKey:receipt,observationKey:topic.observationKey,occurrenceKey:receipt,
      privateData:true,privateSourceId:rule.privateSourceId,privateEventKey:rule.privateEventKey,sourceSnapshot:structuredClone(topic.sourceSnapshot),
      goal:rule.goal,urgent:rule.urgent,delivery:rule.delivery,generated:true,criteria:[]}
  }
  const ruleVersionKey = digest(ruleVersion), candidateFingerprint = fingerprint(candidate)
  const candidateFingerprintKey = digest(candidateFingerprint)
  const prior = [...Object.values(watch.handledOccurrences), ...watch.proposals].findLast(p => (p.ruleVersion === ruleVersion || p.ruleVersionKey === ruleVersionKey)
    && (p.subject === `${rule.id}:${candidate.key}` || (p.advice ? fingerprint(p) === candidateFingerprint : p.fingerprint === candidateFingerprintKey)))
  const key = prior ? prior.subject.slice(rule.id.length + 1) : candidate.key
  const needKey = prior?.needKey ?? digest([ruleVersion, key])
  const observed = topic.observationKey
  return { ...candidate, key, ruleId: rule.id, ruleVersion, needKey, observationKey: observed,
    occurrenceKey: digest(topic.episodeSequence ? [needKey, observed, topic.episodeSequence] : [needKey, observed]), episodeSequence: topic.episodeSequence,
    goal: rule.goal, urgent: rule.urgent, delivery: rule.delivery, ...(rule.at ? { at: rule.at } : {}), generated: true, criteria: [] }
}

/** Old checkpoints have only cited evidence. Preserve those receipts on their first upgrade. */
export function sameOccurrence(proposal, candidate) {
  // A changed private binding revokes the earlier publication and confirmation.
  // Handled-event suppression is separate and survives these transport changes.
  if (proposal.privateData === true || candidate.privateData === true) {
    const fields = ['sourceId', 'connectorId', 'connectorRevision', 'epoch', 'accountKey', 'eventKey', 'handle', 'bindingKey', 'observedAt']
    if (proposal.privateData !== true || candidate.privateData !== true
      || !fields.every(field => proposal.sourceSnapshot?.[field] === candidate.sourceSnapshot?.[field])) return false
  }
  return proposal.ruleVersion === candidate.ruleVersion && proposal.subject === `${candidate.ruleId}:${candidate.key}`
    && (proposal.occurrenceKey ? proposal.occurrenceKey === candidate.occurrenceKey : !candidate.episodeSequence && observationKey(proposal.evidence) === observationKey(candidate.evidence))
}

export function proposalPriority(watch, a, b) {
  const rule = p => watch.rules().find(rule => rule.id === p.ruleId)
  const urgency = p => rule(p)?.urgent ? 2 : rule(p)?.delivery === 'routine' ? 1 : 0
  const deadline = p => Math.min(...deadlines(p.evidence))
  return urgency(b) - urgency(a) || deadline(a) - deadline(b)
    || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)
}
