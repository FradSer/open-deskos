// OpenUI owns the component vocabulary, the wire syntax, the system prompt and
// the parser. The host owns Jev qualification, action binding, evidence
// provenance, freshness, lifecycle receipts and budgets.

import { createLibrary, createParser, defineComponent } from '@openuidev/lang-core'
import { z } from 'zod'

const children = (min = 0, max) => {
  let schema = z.array(z.any()).min(min)
  if (max !== undefined) schema = schema.max(max)
  return schema
}
const tone = () => z.enum(['warn', 'good', 'neutral']).optional()
const text = () => z.string().min(1)

// Shared primitives only. No domain-specific card and no framework renderer.
const COMPONENTS = [
  ['Suggestions', z.object({ children: children() }), 'Root; zero or more Suggestion nodes.'],
  ['Suggestion', z.object({
    children: children(),
    topicId: text(),
    key: text(),
    evidenceIds: z.array(text()).min(1).max(8),
  }), 'One candidate; use supplied topicId and 1-8 evidenceIds.'],
  ['Advice', z.object({ value: text() }), 'One short sentence stating what changed.'],
  ['Readings', z.object({ children: children(1, 3) }), 'One to three Reading nodes.'],
  ['Reading', z.object({ label: text(), value: text(), tone: tone() }), 'An observed label and cited value.'],
  ['ApprovedAction', z.object({ actionId: text() }), 'One supplied actionId; the host binds its tool.'],
  ['OwnerStep', z.object({ text: text() }), 'Read-only Intent preview; no execution permission.'],
  ['Heading', z.object({ value: text() }), 'Short section label.'],
  ['Text', z.object({ value: text(), tone: tone() }), 'Plain paragraph with optional tone.'],
  ['Badge', z.object({ value: text(), tone: tone() }), 'Status badge with optional tone.'],
  ['Metric', z.object({ label: text(), value: text(), tone: tone() }), 'One observed label and cited value.'],
  ['Stack', z.object({ children: children(), direction: z.string().optional() }), 'Generic layout group with optional direction.'],
  ['Row', z.object({ children: children() }), 'Inline layout group.'],
  ['OptionSet', z.object({ children: children() }), 'Owner choices; no execution permission.'],
  ['Option', z.object({ label: text(), value: text() }), 'One owner choice.'],
  ['Divider', z.object({}), 'Visual separator.'],
].map(([name, props, description]) => defineComponent({ name, props, description, component: null }))

const library = createLibrary({ root: 'Suggestions', components: COMPONENTS })
const COMPONENT_NAMES = new Set(COMPONENTS.map(component => component.name))
const SCHEMA_BY_TYPE = new Map(COMPONENTS.map(component => [component.name, component.props]))
const HOST_SUGGESTION_PROPS = z.object({
  topicId: text(),
  key: text(),
  evidenceIds: z.array(text()).min(1).max(8),
})

// These rules state who owns evidence, actions, judgment and composition.
const HOST_RULES = [
  'Only the host binds approved actions; never invent one. ApprovedAction carries an actionId only.',
  'All factual assertions come from cited observations; never invent facts.',
  'Advice states only what changed, in one short natural sentence.',
  'Every Reading/Metric value is copied from a cited observation. Readings holds at most three Reading nodes.',
  'Omit a Suggestion when observations show no current need.',
  'The host independently judges every returned candidate.',
]

export const OPENUI_EXAMPLE = `root = Suggestions([s1])
s1 = Suggestion([a1, h1, r1, stack1, d2, b1],"commute-anomaly","k-commute",["e0","e1"])
a1 = Advice("通勤比平时多了28分钟。")
h1 = Heading("当前观察")
r1 = Readings([c1, c2])
c1 = Reading("通勤用时","52分钟","warn")
c2 = Reading("平时用时","24分钟")
stack1 = Stack([row1, metrics1, d1, options1],"vertical")
row1 = Row([badge1, text1])
badge1 = Badge("偏离常态","warn")
text1 = Text("以下数值均来自本次观察。","neutral")
metrics1 = Stack([m1, m2],"horizontal")
m1 = Metric("通勤用时","52分钟","warn")
m2 = Metric("平时用时","24分钟")
d1 = Divider()
options1 = OptionSet([o1, o2])
o1 = Option("稍后","later")
o2 = Option("忽略","dismiss")
d2 = Divider()
b1 = ApprovedAction("open")`

export const generationSystemPrompt = library.prompt({
  additionalRules: HOST_RULES,
  examples: [OPENUI_EXAMPLE],
})

const parser = createParser(library.toJSONSchema(), library.root)
const fail = (message, code) => {
  const error = Error(`Invalid OpenUI document: ${message}`)
  if (code) error.code = code
  throw error
}
const adviceRequired = () => fail('advice is required', 'advice_required')
const isElementNode = value => value && typeof value === 'object' && value.type === 'element'
const isUiNode = value => value && typeof value === 'object' && !Array.isArray(value) &&
  typeof value.type === 'string' && COMPONENT_NAMES.has(value.type) &&
  value.props && typeof value.props === 'object' &&
  (value.children === undefined || Array.isArray(value.children))
const childrenOf = node => Array.isArray(node?.children) ? node.children : []

function plainValue(value, active, path) {
  if (value === null || value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') fail(`unsupported value at ${path}`)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(`unsupported number at ${path}`)
    return value
  }
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (active.has(value)) fail(`cyclic value at ${path}`)
  if (Array.isArray(value)) {
    active.add(value)
    const copy = value.map((item, index) => plainValue(item, active, `${path}/${index}`))
    active.delete(value)
    return copy
  }
  if (isElementNode(value)) return toUiNode(value, active)
  if (typeof value === 'object') {
    if (typeof value.k === 'string') fail(`unsupported expression at ${path}`)
    active.add(value)
    const copy = {}
    for (const [key, item] of Object.entries(value)) copy[key] = plainValue(item, active, `${path}/${key}`)
    active.delete(value)
    return copy
  }
  return fail(`unsupported value at ${path}`)
}

function toUiNode(node, active) {
  if (!isElementNode(node)) fail('expected a component node')
  const type = node.typeName
  if (typeof type !== 'string' || !COMPONENT_NAMES.has(type)) fail(`unknown component ${String(type)}`)
  if (node.partial) fail(`partial component ${type}`)
  if (active.has(node)) fail(`cyclic component ${type}`)
  const schema = SCHEMA_BY_TYPE.get(type)
  if (!schema || !schema.safeParse(node.props).success) fail(`invalid ${type} props`)
  active.add(node)
  const props = {}
  let childNodes
  for (const [key, value] of Object.entries(node.props)) {
    if (value === undefined) continue
    const plain = plainValue(value, active, `${type}/props/${key}`)
    if (key === 'children') childNodes = plain
    else props[key] = plain
  }
  active.delete(node)
  const ui = { type, props }
  if (childNodes !== undefined) {
    if (!Array.isArray(childNodes)) fail(`${type} children must be an array`)
    if (childNodes.some(child => !isUiNode(child))) fail(`${type} children must be component nodes`)
    // Children live only at node.children; props keeps every other prop.
    ui.children = childNodes
  }
  return ui
}

function collectNodes(node, active = new Set(), nodes = []) {
  if (active.has(node)) fail('cyclic component tree')
  active.add(node)
  nodes.push(node)
  for (const child of childrenOf(node)) collectNodes(child, active, nodes)
  active.delete(node)
  return nodes
}

function suggestionFrom(ui) {
  if (!isUiNode(ui) || ui.type !== 'Suggestion') fail('a Suggestions child must be Suggestion')
  const hostProps = HOST_SUGGESTION_PROPS.safeParse(ui.props)
  if (!hostProps.success) fail('a Suggestion needs topicId, key and 1-8 evidenceIds')
  const { topicId, key, evidenceIds } = hostProps.data
  const nodes = collectNodes(ui)
  const adviceNodes = nodes.filter(node => node.type === 'Advice')
  if (adviceNodes.length !== 1 || typeof adviceNodes[0]?.props?.value !== 'string' || !adviceNodes[0].props.value.trim()) adviceRequired()
  const advice = adviceNodes[0].props.value
  const actions = nodes.filter(node => node.type === 'ApprovedAction')
  const steps = nodes.filter(node => node.type === 'OwnerStep')
  if (actions.length > 1) fail('a Suggestion cannot carry more than one ApprovedAction')
  if (steps.length > 1) fail('a Suggestion cannot carry more than one OwnerStep')
  if (actions.length && steps.length) fail('a Suggestion cannot carry both an ApprovedAction and an OwnerStep')
  for (const readings of nodes.filter(node => node.type === 'Readings')) {
    const rows = childrenOf(readings)
    if (!rows.length || rows.length > 3 || rows.some(row => row.type !== 'Reading')) fail('Readings must hold 1 to 3 Reading nodes')
  }
  let actionId
  if (actions.length) {
    actionId = actions[0].props?.actionId
    if (typeof actionId !== 'string' || !actionId.trim()) fail('an ApprovedAction needs an actionId')
  }
  let nextStep
  if (steps.length) {
    nextStep = steps[0].props?.text
    if (typeof nextStep !== 'string' || !nextStep.trim()) fail('an OwnerStep needs text')
  }
  return {
    topicId, key, advice, evidenceIds,
    ...(actionId !== undefined ? { actionId } : {}),
    ...(nextStep !== undefined ? { nextStep } : {}),
    ui,
  }
}

/** Parse a model OpenUI Lang document into host candidates and full UI trees. */
export function parseSuggestionDocument(text) {
  if (typeof text !== 'string' || !text.trim()) fail('empty document')
  let ast
  try { ast = parser.parse(text.trim()) } catch (error) { fail(`parser rejected the document: ${error?.message ?? 'unknown error'}`) }
  const meta = ast?.meta ?? {}
  if (Array.isArray(meta.errors) && meta.errors.length) fail(`parser errors: ${meta.errors.map(error => error.code ?? error.message).join(', ')}`)
  if (meta.incomplete) fail('incomplete document')
  if (Array.isArray(meta.unresolved) && meta.unresolved.length) fail('unresolved reference')
  if (Array.isArray(meta.orphaned) && meta.orphaned.length) fail('orphaned statement')
  if (ast?.rootExpression) fail('dynamic root expression')
  if (Object.keys(ast?.stateDeclarations ?? {}).length || ast?.queryStatements?.length || ast?.mutationStatements?.length) fail('unsupported dynamic expression')
  const root = ast?.root
  if (!isElementNode(root) || root.typeName !== 'Suggestions') fail('root must be Suggestions')
  const rootTree = JSON.parse(JSON.stringify(toUiNode(root, new Set())))
  const suggestions = childrenOf(rootTree)
  if (suggestions.some(node => node.type !== 'Suggestion')) fail('a Suggestions child must be Suggestion')
  return { suggestions: suggestions.map(suggestionFrom) }
}

/** A retry points back to the library contract. It never echoes model output. */
export function openuiFormatCorrection(_error) {
  return 'Invalid OpenUI Lang. Follow the component signatures and host rules in the system prompt. Emit only OpenUI Lang. Use root = Suggestions([]) when no observation shows a current need.'
}
