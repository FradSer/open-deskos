import { AgentValidationError, validateCompletion, validateLessons } from '../../src/agent-plugins/completion.mjs'

const status = value => ['passed', 'needs_review'].includes(value) ? value : 'invalid'
const scope = value => ['admission', 'completion', 'derivation'].includes(value) ? value : 'unspecified'
const knownTools = new Set(['codemode', 'agent_packages_list', 'agent_skill_read', 'agent_package_candidate', 'agent_package_install', 'agent_package_remove', 'agent_package_rollback', 'agent_mcp_tools', 'agent_mcp_call', 'agent_mcp_disconnect', 'experience_list', 'experience_read', 'agent_identity_list', 'agent_identity_read', 'agent_identity_save', 'agent_start', 'agent_input'])
const mentions = (text, pattern) => typeof text === 'string' && pattern.test(text)

/** Record fixed identities and error categories; exclude model code and arguments. */
export function toolExecutionMetadata(context) {
  const last = context.messages.at(-1)
  if (last?.role !== 'toolResult') return undefined
  const assistant = context.messages.findLast(message => message.role === 'assistant')
  const names = new Set()
  for (const part of Array.isArray(assistant?.content) ? assistant.content : []) {
    if (part.type !== 'toolCall') continue
    if (part.name !== 'codemode' && knownTools.has(part.name)) names.add(part.name)
    if (part.name !== 'codemode' || typeof part.arguments?.code !== 'string') continue
    for (const match of part.arguments.code.slice(0, 32768).matchAll(/tools\.([a-z][a-z0-9_]*)/g)) if (knownTools.has(match[1])) names.add(match[1])
  }
  if (!last.isError) return { tools: [...names] }
  const text = (Array.isArray(last.content) ? last.content : []).slice(0, 64)
    .filter(part => part.type === 'text' && typeof part.text === 'string').map(part => part.text.slice(0, 1024)).join('\n').slice(0, 8192)
  const error = /revision.*changed/i.test(text) ? 'revision_changed'
    : /arguments.*(?:schema|match)|validation|invalid.*argument/i.test(text) ? 'arguments'
    : /undefined|not a function|unknown member|tool.*not found/i.test(text) ? 'code_entry'
    : /intent|workflow|owner turn|authoriz/i.test(text) ? 'authority'
    : /already.*turn|reserved|replay/i.test(text) ? 'replay'
    : /abort|cancel/i.test(text) ? 'cancelled'
    : /unavailable|unsafe|catalog|staged/i.test(text) ? 'unavailable' : 'unknown'
  return { tools: [...names], error }
}

/** Keep validation facts only. Neither provider text nor receipt text enters evidence. */
export function pluginEvidenceMetadata(input, text) {
  const kind = Object.hasOwn(input, 'existingExperience') ? 'learning' : 'completion'
  const result = { kind, jsonValid: false }
  let value
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n/, '').replace(/\n```$/, '')); result.jsonValid = true } catch { return result }
  try { (kind === 'completion' ? validateCompletion : validateLessons)(value, input.receipts); result.validation = 'valid' }
  catch (error) {
    result.validation = 'invalid'
    if (error instanceof AgentValidationError) result.failureCode = error.code
  }
  result.receipts = input.receipts.slice(0, 64).map(receipt => ({ tool: knownTools.has(receipt.tool) ? receipt.tool : 'other',
    kind: receipt.kind === 'computation' ? 'computation' : 'tool',
    succeeded: receipt.status === 'succeeded', truncated: receipt.truncated === true, admissionOnly: receipt.admissionOnly === true }))
  if (kind === 'learning') {
    result.lessons = Array.isArray(value?.lessons) ? Math.min(value.lessons.length, 5) : -1
    return result
  }
  result.status = status(value?.status)
  result.checks = Array.isArray(value?.checks) ? value.checks.slice(0, 32).map(check => ({
    status: status(check?.status), scope: scope(check?.scope), skill: mentions(check?.requirement, /skill/i),
    report: mentions(check?.requirement, /report|报告/i), result: mentions(check?.requirement, /result|结果/i),
    evidence: Array.isArray(check?.evidence) ? check.evidence.slice(0, 4).map(citation => {
      const receipt = input.receipts.find(receipt => receipt.id === citation?.id)
      return { receiptKnown: Boolean(receipt), quoteMatches: Boolean(receipt && typeof citation?.quote === 'string' && receipt.text.includes(citation.quote)) }
    }) : [],
  })) : []
  return result
}
