import { createHash } from 'node:crypto'

export const PROPOSAL_DECISIONS = /** @type {const} */ (['accept', 'ignore', 'mute', 'done', 'snooze', 'useful', 'irrelevant', 'incorrect'])

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
export const generationKey = value => digest(value)
export const observationKey = evidence => digest(evidence.map(e => [e.readingId, e.field, e.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))))
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
  return proposal.ruleVersion === candidate.ruleVersion && proposal.subject === `${candidate.ruleId}:${candidate.key}`
    && (proposal.occurrenceKey ? proposal.occurrenceKey === candidate.occurrenceKey : !candidate.episodeSequence && observationKey(proposal.evidence) === observationKey(candidate.evidence))
}

export function proposalPriority(watch, a, b) {
  const rule = p => watch.rules().find(rule => rule.id === p.ruleId)
  const urgency = p => rule(p)?.urgent ? 2 : rule(p)?.delivery === 'routine' ? 1 : 0
  const deadline = p => Math.min(...deadlines(p.evidence))
  return urgency(b) - urgency(a) || deadline(a) - deadline(b) || (b.judgment?.probability ?? 0) - (a.judgment?.probability ?? 0)
    || Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)
}
