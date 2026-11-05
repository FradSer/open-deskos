// Loads the OpenUI DOM adapter in a vm with a minimal document stub and checks
// the frozen renderer contract: every composable primitive renders a node, an
// unknown type is never dropped, nested children recurse, text is written with
// textContent (never innerHTML), and concentric shared-DOM classes are applied.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const RENDERER = path.join(__dirname, '../src/renderer/core/openui-dom.js')

// A composable primitive is a plain JSON node: { type, props: { children } }.
// Children may also live at the top level; the adapter reads both. These helpers
// build nodes exactly like parseSuggestionDocument / legacyPreviewUI emit them.
const node = (type, props = {}, children) => children
  ? { type, props: { ...props, children } }
  : { type, props }
const leaf = (type, props = {}) => ({ type, props })

// Minimal DOM stub. It records every write so the tests can prove the adapter
// only ever uses textContent, className and attributes: no innerHTML, no inline
// style, and no script/link/img node or remote source attribute.
function makeDocument() {
  const created = []
  const innerHTMLWrites = []
  const innerTextWrites = []
  const styleWrites = []
  const textContentWrites = []
  const setAttributes = []

  function textNode(data) {
    const t = { nodeType: 3, _data: String(data ?? '') }
    Object.defineProperty(t, 'textContent', {
      get() { return t._data },
      set(v) { t._data = String(v ?? '') },
    })
    return t
  }

  function element(tag) {
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      childNodes: [],
      attributes: {},
      dataset: {},
      listeners: {},
      _className: '',
    }
    Object.defineProperty(el, 'children', { get() { return el.childNodes.filter(n => n && n.nodeType === 1) } })
    Object.defineProperty(el, 'firstChild', { get() { return el.childNodes[0] ?? null } })
    Object.defineProperty(el, 'className', {
      get() { return el._className },
      set(v) { el._className = String(v ?? '') },
    })
    el.classList = {
      add(...names) { const set = new Set(el._className.split(/\s+/).filter(Boolean)); names.forEach(n => set.add(n)); el._className = [...set].join(' ') },
      remove(...names) { const set = new Set(el._className.split(/\s+/).filter(Boolean)); names.forEach(n => set.delete(n)); el._className = [...set].join(' ') },
      contains(n) { return el._className.split(/\s+/).filter(Boolean).includes(n) },
      toString() { return el._className },
    }
    Object.defineProperty(el, 'textContent', {
      get() { return el.childNodes.map(c => (c && c.textContent) ?? '').join('') },
      set(v) {
        textContentWrites.push({ tag: el.tagName, value: String(v ?? '') })
        el.childNodes.length = 0
        const s = String(v ?? '')
        if (s) el.childNodes.push(textNode(s))
      },
    })
    Object.defineProperty(el, 'innerHTML', {
      get() { return el.textContent },
      set(v) { innerHTMLWrites.push({ tag: el.tagName, value: String(v ?? '') }); el.textContent = v },
    })
    Object.defineProperty(el, 'innerText', {
      get() { return el.textContent },
      set(v) { innerTextWrites.push(String(v ?? '')); el.textContent = v },
    })
    el.style = new Proxy({}, {
      set(target, key, value) { styleWrites.push({ tag: el.tagName, key: String(key), value }); target[key] = value; return true },
    })
    const coerce = item => item == null ? textNode('') : typeof item === 'object' ? item : textNode(String(item))
    el.append = (...items) => { for (const it of items) el.childNodes.push(coerce(it)) }
    el.appendChild = child => { el.childNodes.push(coerce(child)); return child }
    el.replaceChildren = (...items) => { el.childNodes.length = 0; el.append(...items) }
    el.removeChild = child => { const i = el.childNodes.indexOf(child); if (i > -1) el.childNodes.splice(i, 1) }
    el.remove = () => {}
    el.setAttribute = (name, value) => { setAttributes.push({ tag: el.tagName, name, value: String(value) }); el.attributes[name] = String(value) }
    el.getAttribute = name => el.attributes[name] ?? null
    el.removeAttribute = name => { delete el.attributes[name] }
    el.addEventListener = (type, cb) => { (el.listeners[type] ||= []).push(cb) }
    el.removeEventListener = () => {}
    el.contains = () => false
    el.querySelector = () => null
    el.querySelectorAll = () => []
    created.push(el)
    return el
  }

  return {
    createElement: tag => element(tag),
    createTextNode: data => textNode(data),
    head: { appendChild() {} },
    created, innerHTMLWrites, innerTextWrites, styleWrites, textContentWrites, setAttributes,
  }
}

// context.button is the only host-bound DOM factory the adapter is allowed to call.
function contextFor(doc) {
  return {
    document: doc,
    button(label, callback) {
      const b = doc.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', callback)
      return b
    },
    onAction() {},
  }
}

// The adapter is a classic-script IIFE that exposes { renderOpenUI, isOpenUINode }
// through odkOpenUI / odkOpenUIDOM / module.exports. The loader also tolerates a
// future `export` form by stripping export keywords and capturing named exports.
function loadRenderer() {
  const source = fs.readFileSync(RENDERER, 'utf8')
  const code = source
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^(\s*)export\s+(default\s+)?/gm, '$1') +
    '\n;globalThis.__openuiNamed = { renderOpenUI: (typeof renderOpenUI !== "undefined" ? renderOpenUI : undefined), isOpenUINode: (typeof isOpenUINode !== "undefined" ? isOpenUINode : undefined) };\n'
  const moduleObj = { exports: {} }
  const sandbox = { console, document: makeDocument(), module: moduleObj, exports: moduleObj.exports }
  vm.runInNewContext(code, sandbox, { filename: 'openui-dom.js' })
  const isApi = c => c && typeof c.renderOpenUI === 'function' && typeof c.isOpenUINode === 'function'
  for (const c of [sandbox.__openuiNamed, sandbox.odkOpenUIDOM, sandbox.odkOpenUI, moduleObj.exports]) if (isApi(c)) return c
  for (const key of Object.keys(sandbox)) if (isApi(sandbox[key])) return sandbox[key]
  throw Error('openui-dom.js did not expose renderOpenUI / isOpenUINode')
}

const api = loadRenderer()
const isNode = value => Boolean(value && typeof value === 'object' && typeof value.nodeType === 'number')
const classesIn = doc => new Set(doc.created.flatMap(el => el.className.split(/\s+/)).filter(Boolean))

// Composable primitives the generic renderer must turn into a DOM node. Host-owned
// nodes (Advice, ApprovedAction, OwnerStep) are exercised in their own test: the
// bubble already renders advice once and binds its controls.
const RENDERABLE = {
  Suggestions: node('Suggestions', {}, []),
  Suggestion: leaf('Suggestion', { topicId: 't', key: 'k', evidenceIds: ['e0'] }),
  Readings: node('Readings', {}, []),
  Reading: leaf('Reading', { label: 'Today', value: '52 min', tone: 'warn' }),
  Heading: leaf('Heading', { value: 'Summary' }),
  Text: leaf('Text', { value: 'A plain paragraph.' }),
  Badge: leaf('Badge', { value: 'Live', tone: 'good' }),
  Metric: leaf('Metric', { label: 'Delta', value: '28 min' }),
  Stack: node('Stack', { direction: 'vertical' }, []),
  Row: node('Row', {}, []),
  OptionSet: node('OptionSet', { label: 'From' }, []),
  Option: leaf('Option', { label: 'Home', value: 'home' }),
  Divider: leaf('Divider', {}),
  Chip: leaf('Chip', { label: 'C', value: 'c' }),
  Button: leaf('Button', { label: 'Open', actionId: 'open' }),
}

test('every composable OpenUI primitive produces a DOM node', () => {
  for (const [type, sample] of Object.entries(RENDERABLE)) {
    const doc = makeDocument()
    const rendered = api.renderOpenUI(sample, contextFor(doc))
    assert.ok(isNode(rendered), `${type} must produce a node, got ${String(rendered)}`)
    assert.equal(typeof rendered.tagName, 'string', `${type} produced a node without a tag name`)
  }
})

test('unknown primitives render as plain text and are never dropped', () => {
  const doc = makeDocument()
  const ctx = contextFor(doc)
  const unknown = leaf('TotallyUnknownPrimitive', { value: 'KEEP_ME_MARKER' })
  const rendered = api.renderOpenUI(unknown, ctx)
  assert.ok(isNode(rendered), 'an unknown type must render, not return null')
  assert.match(rendered.textContent, /KEEP_ME_MARKER/, 'the unknown node keeps its value as text')
  assert.match(rendered.textContent, /TotallyUnknownPrimitive/, 'the unknown type is named, not silently swallowed')

  // Nested among known siblings, the unknown node survives recursion too.
  const tree = node('Stack', {}, [
    leaf('Text', { value: 'ALPHA_MARK' }),
    leaf('TotallyUnknownPrimitive', { value: 'KEEP_ME_MARKER' }),
    leaf('Text', { value: 'OMEGA_MARK' }),
  ])
  const root = api.renderOpenUI(tree, ctx)
  assert.ok(isNode(root))
  assert.ok(root.children.length >= 3, `unknown sibling was dropped (${root.children.length} children)`)
  for (const marker of ['ALPHA_MARK', 'KEEP_ME_MARKER', 'OMEGA_MARK'])
    assert.ok(root.textContent.includes(marker), `nested text ${marker} is missing`)
})

test('nested children recurse through the full component tree', () => {
  const doc = makeDocument()
  const tree = node('Suggestions', {}, [
    node('Suggestion', { topicId: 'commute-anomaly', key: 'k', evidenceIds: ['e0', 'e1'] }, [
      leaf('Heading', { value: 'HEADING_MARK' }),
      node('Readings', {}, [
        leaf('Reading', { label: 'LABEL_MARK', value: 'RECURSED_VALUE', tone: 'warn' }),
        leaf('Metric', { label: 'METRIC_MARK', value: '42' }),
      ]),
      leaf('Divider', {}),
    ]),
  ])
  const root = api.renderOpenUI(tree, contextFor(doc))
  assert.ok(isNode(root), 'the root renders')
  const text = root.textContent
  for (const marker of ['HEADING_MARK', 'LABEL_MARK', 'RECURSED_VALUE', 'METRIC_MARK', '42'])
    assert.ok(text.includes(marker), `the leaf ${marker} must recurse four levels up into the root`)
  const chips = doc.created.filter(el => el.classList.contains('personal-agent-preview-chip'))
  assert.ok(chips.length >= 2, 'deep Reading and Metric nodes each render a chip')
})

test('all rendered text uses textContent, never innerHTML, inline style or a remote asset', () => {
  const doc = makeDocument()
  const tree = node('Suggestion', {}, [
    leaf('Heading', { value: 'Summary line' }),
    node('Readings', {}, [leaf('Reading', { label: 'Today', value: '52 min' })]),
  ])
  api.renderOpenUI(tree, contextFor(doc))
  assert.ok(doc.textContentWrites.length > 0, 'the renderer writes visible text with textContent')
  assert.deepEqual(doc.innerHTMLWrites, [], 'innerHTML must never be used')
  assert.deepEqual(doc.innerTextWrites, [], 'innerText must never be used')
  assert.deepEqual(doc.styleWrites, [], 'no inline style is written')
  assert.ok(!doc.created.some(el => ['SCRIPT', 'IFRAME', 'IMG', 'LINK'].includes(el.tagName)), 'no script or remote asset node is created')
  assert.ok(!doc.setAttributes.some(a => /^(src|href|style|on[a-z]+)$/i.test(a.name)), 'no src, style or inline handler attribute is set')
})

test('concentric shared-DOM primitive classes are applied', () => {
  const doc = makeDocument()
  const tree = node('Suggestion', { topicId: 't', key: 'k', evidenceIds: ['e0'] }, [
    leaf('Heading', { value: 'Summary' }),
    node('Readings', {}, [leaf('Reading', { label: 'Today', value: '52 min', tone: 'warn' })]),
    node('Row', {}, [leaf('Badge', { value: 'Live', tone: 'good' })]),
    leaf('Divider', {}),
  ])
  const root = api.renderOpenUI(tree, contextFor(doc))
  assert.ok(isNode(root))
  const classes = classesIn(doc)
  for (const name of [
    'personal-agent-preview-card',
    'personal-agent-preview-summary',
    'personal-agent-preview-chips',
    'personal-agent-preview-chip',
    'personal-agent-preview-label',
    'personal-agent-preview-value',
  ]) assert.ok(classes.has(name), `concentric primitive class ${name} must be applied`)
  const chip = doc.created.find(el => el.classList.contains('personal-agent-preview-chip'))
  assert.equal(chip.dataset.tone, 'warn', 'the tone is carried as data, not an invented class or inline style')
  assert.deepEqual(doc.styleWrites, [], 'concentric geometry comes from CSS classes, not inline style')
})

// Host authority: only the host binds approved actions and read-only owner steps.
// The generic adapter must not fabricate a control for them, and a tree that
// carries them must still render without leaking an executable action.
test('host-bound ApprovedAction and OwnerStep never become renderer controls', () => {
  const doc = makeDocument()
  const ctx = contextFor(doc)
  assert.equal(api.renderOpenUI(leaf('ApprovedAction', { actionId: 'open' }), ctx), null)
  assert.equal(api.renderOpenUI(leaf('OwnerStep', { text: 'Choose a place.' }), ctx), null)
  const tree = node('Suggestion', {}, [
    leaf('Advice', { value: 'CHANGED_MARK' }),
    leaf('ApprovedAction', { actionId: 'open' }),
    leaf('OwnerStep', { text: 'Choose a place.' }),
  ])
  const root = api.renderOpenUI(tree, ctx)
  assert.ok(isNode(root), 'a tree with host-bound nodes still renders its card')
  assert.ok(String(root.className).split(/\s+/).includes('personal-agent-preview-card'), 'the concentric card primitive class is applied')
  assert.ok(!root.textContent.includes('CHANGED_MARK'), 'Advice is host-owned: the bubble already renders advice once')
  assert.ok(!doc.created.some(el => el.tagName === 'BUTTON'), 'the generic adapter invents no action button')
})

test('one suggestion tree renders exactly one card surface', () => {
  const doc = makeDocument(), ctx = contextFor(doc)
  const tree = node('Suggestions', {}, [
    node('Suggestion', {}, [
      leaf('Heading', { value: '通勤状态' }),
      node('Stack', {}, [leaf('Metric', { label: '用时', value: '52 分钟' })]),
    ]),
  ])
  const root = api.renderOpenUI(tree, ctx)
  assert.ok(isNode(root))
  const cards = doc.created.filter(el => String(el.className).split(/\s+/).includes('personal-agent-preview-card'))
  assert.equal(cards.length, 1, 'a container must not nest another bordered card')
  assert.ok(doc.created.some(el => String(el.className).includes('personal-agent-preview-chip')), 'the reading is still visible')
})

test('isOpenUINode accepts plain JSON component trees and rejects non-nodes', () => {
  assert.equal(api.isOpenUINode(leaf('Reading', { label: 'a', value: 'b' })), true)
  assert.equal(api.isOpenUINode({ type: 'element', typeName: 'Reading', props: {} }), true, 'parser AST nodes are accepted')
  assert.equal(api.isOpenUINode(node('Suggestions', {}, [leaf('Text', { value: 'x' })])), true)
  for (const invalid of [null, undefined, [], {}, 'Reading', 42, { type: 'element' }, { type: 'Reading', props: [] }])
    assert.equal(api.isOpenUINode(invalid), false, `must reject ${JSON.stringify(invalid)}`)
})

test('each shared primitive renders a distinct DOM shape', () => {
  const doc = makeDocument(), ctx = contextFor(doc)
  const tree = node('Suggestions', {}, [node('Suggestion', {}, [
    leaf('Heading', { value: '本轮观察' }),
    leaf('Text', { value: '读数来自本轮引用观察。' }),
    leaf('Badge', { value: '偏离常态', tone: 'warn' }),
    node('Readings', {}, [leaf('Reading', { label: '通勤用时', value: '52 分钟' })]),
    node('Row', {}, [leaf('Metric', { label: '平时用时', value: '24 分钟' })]),
    node('Stack', {}, [leaf('Divider', {})]),
  ])], [])
  const root = api.renderOpenUI(tree, ctx)
  assert.ok(isNode(root))
  const classes = classesIn(doc)
  for (const name of ['openui-heading', 'openui-text', 'openui-badge', 'openui-readings', 'openui-row', 'openui-stack', 'openui-divider', 'openui-metric']) {
    assert.ok(classes.has(name), `${name} must be emitted`)
  }
  const metric = doc.created.find(el => String(el.className).split(/\s+/).includes('openui-metric'))
  const reading = doc.created.find(el => String(el.className).split(/\s+/).includes('openui-reading'))
  assert.ok(metric && reading)
  assert.equal(metric.dataset.emphasis, 'true', 'Metric is emphasized, distinct from a Reading chip')
  assert.equal(reading.dataset.emphasis, undefined)
  const badge = doc.created.find(el => String(el.className).split(/\s+/).includes('openui-badge'))
  assert.ok(badge && badge.tagName === 'SPAN' && !String(badge.className).includes('personal-agent-preview-chip'), 'Badge is no longer a chip')
})
