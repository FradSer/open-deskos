import { generationKey } from './proactive-lifecycle.mjs'

const abstractReview = Object.freeze({
  advice: 'Review a private notification before choosing a next step.',
  nextStep: 'Read the notification and confirm the next step with the owner.',
})

/** A fixed host projection supplies no source text or model-derived private advice. */
export function projectPrivateFeedback(watch, proposal) {
  try {
    if (proposal?.privateData !== true || !/^[a-z][a-z0-9-]{0,63}$/.test(proposal.privateSourceId)
      || !/^[a-f0-9]{64}$/.test(proposal.privateEventKey)
      || proposal.sourceSnapshot?.sourceId !== proposal.privateSourceId
      || proposal.sourceSnapshot?.eventKey !== proposal.privateEventKey) return undefined
    const rule = watch.rules().find(item => item.id === proposal.ruleId)
    if (!rule || rule.privateSourceId !== proposal.privateSourceId || rule.privateEventKey !== proposal.privateEventKey
      || proposal.ruleVersion !== JSON.stringify(rule) || typeof rule.goal !== 'string') return undefined
    if (watch.privateSources?.valid(proposal.sourceSnapshot) !== true) {
      const current = watch.privateSources?.snapshot(rule)
      // Only abstract feedback can survive a new process binding. Actions keep
      // their original full snapshot and cannot use this preference-only check.
      const fields = ['sourceId', 'connectorId', 'connectorRevision', 'accountKey', 'eventKey', 'handle', 'bindingKey']
      if (!current || watch.privateSources.valid(current) !== true || !fields.every(field => typeof proposal.sourceSnapshot[field] === 'string'
        && proposal.sourceSnapshot[field] === current[field])) return undefined
    }
    const action = proposal.action
    if (action?.tool !== 'private_source_review' || !action.params || Object.keys(action.params).sort().join(',') !== 'handle,sourceId'
      || action.params.sourceId !== proposal.privateSourceId || action.params.handle !== proposal.privateEventKey
      || !rule.actions?.some(item => item.tool === action.tool && item.params?.sourceId === action.params.sourceId && item.params?.handle === action.params.handle)) return undefined
    return { ...abstractReview, scopeId: `private-feedback-${proposal.privateSourceId}`,
      scopeKey: generationKey(['private-review-feedback-v1', proposal.privateSourceId, rule.goal]) }
  } catch { return undefined }
}

export function privateFeedbackJobSafe(proposal, job) {
  return proposal?.privateData === true && job.advice === abstractReview.advice && job.nextStep === abstractReview.nextStep
}

/** Recovered private preferences must remain excerpts of the same fixed projection. */
export function privateFeedbackSignalsSafe(signals, projection) {
  return Array.isArray(signals) && signals.length <= 8 && signals.every(signal => typeof signal.subject === 'string' && signal.subject.trim()
    && [projection.advice, projection.nextStep].some(source => source.includes(signal.subject)))
}

/** A later event can read the topic preference before it has a generated proposal. */
export function projectPrivateRuleFeedback(watch, rule) {
  return projectPrivateFeedback(watch, privateFeedbackRuleContext(watch, rule))
}

export function privateFeedbackRuleContext(watch, rule) {
  const action = rule.actions?.find(item => item.tool === 'private_source_review')
  return { ruleId: rule.id, ruleVersion: JSON.stringify(rule), privateData: true,
    privateSourceId: rule.privateSourceId, privateEventKey: rule.privateEventKey,
    sourceSnapshot: watch.privateSources?.snapshot(rule), action }
}
