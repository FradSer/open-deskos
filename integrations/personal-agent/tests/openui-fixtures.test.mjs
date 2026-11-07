// Shared OpenUI Lang fixtures and UI-tree inspection for Personal Agent tests.
// This module has no tests of its own; tests import its helpers.
import { parseSuggestionDocument } from '../src/openui-contract.mjs'

export const REGISTERED_PRIMITIVES = [
  'Suggestions', 'Suggestion', 'Advice', 'Readings', 'Reading', 'ApprovedAction', 'OwnerStep',
  'Heading', 'Text', 'Badge', 'Metric', 'Stack', 'Row', 'OptionSet', 'Option', 'Divider',
]

export const EMPTY_DOCUMENT = 'root = Suggestions([])'

export const FULL_TREE_DOCUMENT = `root = Suggestions([s1])
s1 = Suggestion([h1, a1, badge1, divider1, stack1, readings1, act1],"commute-anomaly","k-full",["e0","e1"])
h1 = Heading("通勤观察")
a1 = Advice("通勤比平时多了28分钟。")
badge1 = Badge("需要留意")
divider1 = Divider()
stack1 = Stack([text1, row1, options1])
text1 = Text("读数来自本轮引用观察。")
row1 = Row([metric1])
metric1 = Metric("通勤用时","52分钟")
options1 = OptionSet([option1, option2])
option1 = Option("查看安排","open")
option2 = Option("稍后再看","later")
readings1 = Readings([reading1])
reading1 = Reading("平时用时","24分钟")
act1 = ApprovedAction("open")`

export const FULL_TREE_TYPE_COUNTS = {
  Suggestion: 1, Heading: 1, Advice: 1, Badge: 1, Divider: 1,
  Stack: 1, Text: 1, Row: 1, Metric: 1, OptionSet: 1, Option: 2,
  Readings: 1, Reading: 1, ApprovedAction: 1,
}

export const EXTRA_DOCUMENT = `root = Suggestions([s1])
s1 = Suggestion([h1, a1, badge1, divider1, act1],"commute-anomaly","k-extra",["e0","e1"])
h1 = Heading("通勤观察")
a1 = Advice("通勤比平时多了28分钟。")
badge1 = Badge("需要留意")
divider1 = Divider()
act1 = ApprovedAction("open")`

const quoted = value => JSON.stringify(value)

/** Build one valid OpenUI Lang document from host candidate fields. */
export function openuiDocuments(fieldsList) {
  const lines = [`root = Suggestions([${fieldsList.map((_, index) => `s${index + 1}`).join(', ')}])`]
  fieldsList.forEach((fields, index) => {
    const n = index + 1
    const children = [`h${n}`, `a${n}`, `badge${n}`, `divider${n}`, `stack${n}`]
    if (fields.actionId) children.push(`act${n}`)
    if (fields.nextStep) children.push(`step${n}`)
    lines.push(`s${n} = Suggestion([${children.join(', ')}],${quoted(fields.topicId)},${quoted(fields.key)},${quoted(fields.evidenceIds ?? ['e0'])})`)
    lines.push(`h${n} = Heading(${quoted(fields.heading ?? '本轮观察')})`)
    lines.push(`a${n} = Advice(${quoted(fields.advice)})`)
    lines.push(`badge${n} = Badge(${quoted(fields.badge ?? '待查看')})`)
    lines.push(`divider${n} = Divider()`)
    lines.push(`stack${n} = Stack([row${n}, options${n}])`)
    lines.push(`row${n} = Row([text${n}])`)
    lines.push(`text${n} = Text("读数来自本轮引用观察。")`)
    lines.push(`options${n} = OptionSet([option${n}a, option${n}b])`)
    lines.push(`option${n}a = Option("查看","inspect")`)
    lines.push(`option${n}b = Option("稍后","later")`)
    if (fields.actionId) lines.push(`act${n} = ApprovedAction(${quoted(fields.actionId)})`)
    if (fields.nextStep) lines.push(`step${n} = OwnerStep(${quoted(fields.nextStep)})`)
  })
  return lines.join('\n')
}

export const openuiDocument = fields => openuiDocuments([fields])
export const openuiSuggestion = fields => parseSuggestionDocument(openuiDocument(fields)).suggestions[0]
export const openuiBatch = fieldsList => ({ suggestions: parseSuggestionDocument(openuiDocuments(fieldsList)).suggestions })

/** Collect every component node. Renderer-compatible trees can expose the same
    children through props.children and node.children; count that array once. */
export function uiNodes(ui) {
  const found = [], seen = new Set()
  const visit = node => {
    if (!node || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (typeof node.type !== 'string') return
    found.push(node)
    const nested = Array.isArray(node.props?.children) ? node.props.children :
      Array.isArray(node.children) ? node.children : []
    for (const child of nested) visit(child)
  }
  visit(ui)
  return found
}

export const uiTypes = ui => uiNodes(ui).map(node => node.type)
export const uiTypeCounts = ui => uiTypes(ui).reduce((counts, type) => ({ ...counts, [type]: (counts[type] ?? 0) + 1 }), {})
export const componentNames = text => [...new Set([...text.matchAll(/\b([A-Z][A-Za-z]+)\s*\(/g)].map(match => match[1]))]
    .filter(name => REGISTERED_PRIMITIVES.includes(name))
