// OpenUI owns the generation contract: the component library, the system prompt,
// the output syntax and the parser. The host still owns Jev qualification, action
// binding, evidence provenance, freshness and every renderer primitive.
//
// The Shell is a framework-free DOM renderer with a strict CSP, so no React
// runtime is loaded here. Only the framework-agnostic @openuidev/lang-core runs,
// inside the Node Personal Agent service. Parsed AST nodes map back to the same
// generic preview primitives the renderer already uses.

import { createLibrary, defineComponent, createParser } from '@openuidev/lang-core'
import { z } from 'zod'

// Shared primitives only. No domain-specific card, no ride/taxi widget.
const Suggestions = defineComponent({
  name: 'Suggestions',
  props: z.object({ children: z.array(z.any()) }),
  description: 'Root statement. Zero or more Suggestion nodes; emit none when no observation shows a current need.',
})
const Suggestion = defineComponent({
  name: 'Suggestion',
  props: z.object({
    children: z.array(z.any()),
    topicId: z.string(),
    key: z.string(),
    evidenceIds: z.array(z.string()),
  }),
  description: 'One candidate. topicId and evidenceIds must come from the supplied input. Reuse a key for the same intent.',
})
const Advice = defineComponent({
  name: 'Advice',
  props: z.object({ value: z.string() }),
  description: 'One short natural sentence stating only what changed. Do not restate the action label or add an unsupported consequence.',
})
const Readings = defineComponent({
  name: 'Readings',
  props: z.object({ children: z.array(z.any()) }),
  description: 'One to three Reading nodes that support the advice. Omit when no reading supports it.',
})
const Reading = defineComponent({
  name: 'Reading',
  props: z.object({
    label: z.string(),
    value: z.string(),
    tone: z.enum(['warn', 'good', 'neutral']).optional(),
  }),
  description: 'One observed reading. Copy the value from a cited observation; put the unit in the value. A plain short label has no bracketed unit or trailing colon.',
})
// "Action" is reserved by OpenUI Lang, so the host-approved control has its own name.
const ApprovedAction = defineComponent({
  name: 'ApprovedAction',
  props: z.object({ actionId: z.string() }),
  description: 'One actionId from the topic\'s supplied actions. The host binds its label and tool; never invent one.',
})
const OwnerStep = defineComponent({
  name: 'OwnerStep',
  props: z.object({ text: z.string() }),
  description: 'Intent preview only: a concrete read-only owner step, never execution permission.',
})

const library = createLibrary({
  root: 'Suggestions',
  components: [Suggestions, Suggestion, Advice, Readings, Reading, ApprovedAction, OwnerStep],
})

// Host authority rules are injected into the generated prompt, not hand-written as
// a long essay. OpenUI generates the syntax and component signatures; these rules
// state who owns evidence, actions and judgment.
const HOST_RULES = [
  'Only the host binds approved actions; ApprovedAction carries an actionId from the topic actions, never a label, tool, parameter or permission.',
  'All factual assertions must come from cited observations; never invent facts, plans, permissions, urgency, success or causes.',
  'Keep hashes, technical identifiers and diagnostics out of advice; they stay in the observations.',
  'Advice is one short natural sentence stating only what changed; do not restate the action label.',
  'Readings holds at most three Reading nodes, each showing a value copied from a cited observation.',
  'Omit a Suggestion when its observations show no current need; the host independently judges every returned candidate.',
]

export const OPENUI_EXAMPLE = `root = Suggestions([s1])
s1 = Suggestion([a1, r1, b1],"commute-anomaly","k-commute",["e0","e1"])
a1 = Advice("通勤比平时多了28分钟。")
r1 = Readings([c1, c2])
c1 = Reading("通勤用时","52分钟","warn")
c2 = Reading("平时用时","24分钟")
b1 = ApprovedAction("open")`

export const generationSystemPrompt = library.prompt({
  additionalRules: HOST_RULES,
  examples: [OPENUI_EXAMPLE],
})

const parser = createParser(library.toJSONSchema())

const isNode = value => value && typeof value === 'object' && value.type === 'element' && typeof value.typeName === 'string'
const childrenOf = node => (isNode(node) && Array.isArray(node.props?.children) ? node.props.children : [])
const fail = message => { throw Error(`Invalid OpenUI document: ${message}`) }
// The host already keys its one retry and diagnostics off this stable code.
const missingAdvice = () => { throw Object.assign(Error('Invalid generated suggestion: advice is required'), { code: 'advice_required' }) }

function readingsFrom(node) {
  const rows = childrenOf(node)
  if (!rows.length || rows.length > 3) fail('Readings must hold 1 to 3 Reading nodes')
  return rows.map(row => {
    if (!isNode(row) || row.typeName !== 'Reading') fail('a Readings child must be Reading')
    const { label, value, tone } = row.props ?? {}
    if (typeof label !== 'string' || !label.trim() || typeof value !== 'string' || !String(value).trim()) fail('a Reading needs a label and a value')
    if (tone !== undefined && !['warn', 'good', 'neutral'].includes(tone)) fail('a Reading tone must be warn, good or neutral')
    return { label, value: String(value), ...(tone && tone !== 'neutral' ? { tone } : {}) }
  })
}

function suggestionFrom(node) {
  if (!isNode(node) || node.typeName !== 'Suggestion') fail('a Suggestions child must be Suggestion')
  const { topicId, key, evidenceIds } = node.props ?? {}
  if (typeof topicId !== 'string' || !topicId.trim() || typeof key !== 'string' || !key.trim()) fail('a Suggestion needs topicId and key')
  if (!Array.isArray(evidenceIds) || !evidenceIds.length || evidenceIds.length > 8 || evidenceIds.some(id => typeof id !== 'string' || !id.trim())) fail('a Suggestion needs 1 to 8 evidenceIds')
  const parts = childrenOf(node)
  const adviceNode = parts.find(part => isNode(part) && part.typeName === 'Advice')
  if (!adviceNode || typeof adviceNode.props?.value !== 'string' || !adviceNode.props.value.trim()) missingAdvice()
  const readingsNode = parts.find(part => isNode(part) && part.typeName === 'Readings')
  const actionNode = parts.find(part => isNode(part) && part.typeName === 'ApprovedAction')
  const stepNode = parts.find(part => isNode(part) && part.typeName === 'OwnerStep')
  if (actionNode && stepNode) fail('a Suggestion cannot carry both an ApprovedAction and an OwnerStep')
  const preview = readingsNode ? { items: readingsFrom(readingsNode) } : undefined
  return {
    topicId, key, advice: adviceNode.props.value, evidenceIds,
    ...(preview ? { preview } : {}),
    ...(actionNode ? { actionId: String(actionNode.props.actionId ?? '') } : {}),
    ...(stepNode ? { nextStep: String(stepNode.props.text ?? '') } : {}),
  }
}

/** Parse a model OpenUI Lang document into the host candidate shape. */
export function parseSuggestionDocument(text) {
  if (typeof text !== 'string' || !text.trim()) fail('empty document')
  let ast
  try { ast = parser.parse(text.trim()) } catch (error) { fail(error?.message ?? 'parser rejected the document') }
  const meta = ast?.meta ?? {}
  if (meta.errors?.length) fail(meta.errors.map(e => e.message ?? e.code).join('; '))
  if (meta.incomplete || meta.unresolved?.length || meta.orphaned?.length) fail('unresolved or orphaned reference')
  const root = ast?.root
  if (!isNode(root) || root.typeName !== 'Suggestions') fail('root must be Suggestions')
  const children = childrenOf(root)
  return { suggestions: children.map(suggestionFrom) }
}

/** A retry reports the failure and points back to the library contract. It never echoes model output. */
export function openuiFormatCorrection() {
  return `The previous response was not a valid OpenUI Lang document. Follow the component contract in the system prompt. Emit only OpenUI Lang, no prose. Example:\n${OPENUI_EXAMPLE}\nReturn root = Suggestions([]) when no observation shows a current need.`
}
