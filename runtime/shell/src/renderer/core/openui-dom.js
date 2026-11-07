;(function (root) {
  'use strict'

  // The Shell loads this file as a classic script. Node tests can also require or
  // import it. Component props are untrusted IPC data: only textContent writes
  // text, and no component can add markup, inline style or a remote asset.
  const MAX_TEXT = 512
  const TECHNICAL_TEXT = /sha[-_\s]?256|\b[a-f0-9]{32,}\b/i
  const WITHHELD_TEXT = 'Value withheld.'
  const OMITTED_PROPS = new Set(['children', 'type', 'typeName', 'component', 'props'])
  const KNOWN_TYPES = new Set([
    'suggestions', 'suggestion', 'advice', 'readings', 'reading', 'approvedaction', 'ownerstep',
    'heading', 'text', 'badge', 'metric', 'stack', 'row', 'optionset', 'option', 'divider',
  ])
  const EXTRA_CLASSES = new Map([
    ['chip', ['openui-badge']],
  ])
  const globalDocument = typeof document !== 'undefined' ? document : null

  function componentName(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
    if (typeof value.typeName === 'string' && value.typeName.trim()) return value.typeName.trim()
    if (typeof value.type === 'string' && value.type !== 'element' && value.type.trim()) return value.type.trim()
    if (typeof value.component === 'string' && value.component.trim()) return value.component.trim()
    return ''
  }

  function isOpenUINode(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    if (!componentName(value)) return false
    return value.props === undefined || (typeof value.props === 'object' && value.props !== null && !Array.isArray(value.props))
  }

  function propsOf(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return {}
    const props = node.props && typeof node.props === 'object' && !Array.isArray(node.props) ? node.props : {}
    const direct = {}
    for (const key of Object.keys(node)) if (!OMITTED_PROPS.has(key)) direct[key] = node[key]
    return { ...direct, ...props }
  }

  function childrenOf(node) {
    const children = [], seen = new Set()
    for (const group of [node?.props?.children, node?.children]) {
      const list = Array.isArray(group) ? group : group && typeof group === 'object' ? [group] : []
      for (const child of list) {
        if (child === null || child === undefined || seen.has(child)) continue
        seen.add(child)
        children.push(child)
      }
    }
    return children
  }

  function readable(value) {
    if (value === null || value === undefined) return ''
    const kind = typeof value
    if (kind === 'string') return value
    if (kind === 'number' || kind === 'boolean' || kind === 'bigint') return String(value)
    if (kind !== 'object') return ''
    try { return JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item) ?? '' }
    catch { return '[unreadable value]' }
  }

  function safeText(value) {
    let text
    try { text = String(value ?? '') }
    catch { return WITHHELD_TEXT }
    return TECHNICAL_TEXT.test(text) ? WITHHELD_TEXT : text.slice(0, MAX_TEXT)
  }

  function textOf(props, names) {
    for (const name of names) {
      const text = readable(props?.[name]).trim()
      if (text) return safeText(text)
    }
    return ''
  }

  function describeProps(props, kind) {
    const parts = []
    for (const [key, value] of Object.entries(props)) {
      if (OMITTED_PROPS.has(key)) continue
      const text = readable(value).trim()
      if (text) parts.push(`${safeText(key)}: ${safeText(text)}`)
    }
    const detail = parts.join(' · ')
    return safeText(detail ? `${kind}: ${detail}` : kind)
  }

  function documentFor(context) {
    return context?.document ?? root.document ?? globalDocument
  }

  function createElement(tag, context) {
    const dom = documentFor(context)
    if (!dom || typeof dom.createElement !== 'function') return null
    try { return dom.createElement(tag) }
    catch { return null }
  }

  function append(parent, child) {
    if (!parent || !child) return
    try {
      if (typeof parent.append === 'function') parent.append(child)
      else if (typeof parent.appendChild === 'function') parent.appendChild(child)
    } catch { /* A malformed host element cannot break the rest of the tree. */ }
  }

  function setAttribute(element, name, value) {
    if (!element || !value || typeof element.setAttribute !== 'function') return
    try { element.setAttribute(name, value) }
    catch { /* Optional accessibility metadata. */ }
  }

  function addClass(element, ...names) {
    if (!element) return
    const classes = String(element.className ?? '').trim().split(/\s+/).filter(Boolean)
    for (const name of names) if (name && !classes.includes(name)) classes.push(name)
    element.className = classes.join(' ')
  }

  function toneOf(props) {
    const tone = safeText(readable(props?.tone)).trim().toLowerCase()
    return ['warn', 'good', 'neutral'].includes(tone) ? tone : ''
  }

  function applyTone(element, props) {
    const tone = toneOf(props)
    if (tone && element?.dataset) element.dataset.tone = tone
  }

  function applyDirection(element, props) {
    const direction = safeText(readable(props?.direction)).trim().toLowerCase()
    if (direction && element?.dataset) element.dataset.direction = direction
  }

  function makeChip(kind, props, context) {
    const chip = createElement('span', context)
    if (!chip) return null
    chip.className = 'personal-agent-preview-chip'
    applyTone(chip, props)
    const label = createElement('span', context), value = createElement('span', context)
    if (label) {
      label.className = 'personal-agent-preview-label'
      label.textContent = textOf(props, ['label', 'name', 'productName', 'key'])
      append(chip, label)
    }
    if (value) {
      value.className = 'personal-agent-preview-value'
      value.textContent = textOf(props, ['value', 'priceText', 'text', 'reading', 'metric'])
      if (!label?.textContent && !value.textContent) value.textContent = describeProps(props, kind)
      append(chip, value)
    }
    return chip
  }

  function makeOption(props, context) {
    const option = createElement('span', context)
    if (option) option.textContent = textOf(props, ['label', 'text', 'name', 'value'])
    return option
  }

  function makeOptionList(node, props, context, seen) {
    const group = createElement('div', context)
    const list = createElement('ul', context)
    if (!group || !list) return null
    group.className = 'openui-options'
    list.className = 'openui-option-set'
    const label = textOf(props, ['label', 'ariaLabel', 'name'])
    setAttribute(list, 'aria-label', label || 'Options')
    if (label) {
      const heading = createElement('span', context)
      if (heading) {
        heading.className = 'openui-options-label'
        heading.textContent = label
        append(group, heading)
      }
    }
    const options = Array.isArray(props.options) ? [...childrenOf(node), ...props.options] : childrenOf(node)
    for (const child of options) {
      const text = renderChild(child, context, seen)?.textContent
      if (!text) continue
      const item = createElement('li', context)
      if (!item) continue
      item.className = 'openui-option'
      item.textContent = text
      append(list, item)
    }
    append(group, list)
    return group
  }

  function makeUnknown(kind, props, context) {
    const span = createElement('span', context)
    if (!span) return null
    applyTone(span, props)
    span.textContent = describeProps(props, kind)
    return span
  }

  function renderChild(child, context, seen) {
    if (child === null || child === undefined) return null
    if (isOpenUINode(child)) return renderOpenUI(child, context, seen)
    const span = createElement('span', context)
    if (span) { span.className = 'openui-unknown'; span.textContent = safeText(readable(child)) }
    return span
  }

  function appendChildren(target, node, context, seen) {
    for (const child of childrenOf(node)) append(target, renderChild(child, context, seen))
  }

  function appendOptionText(option, node, context, seen) {
    const parts = []
    for (const child of childrenOf(node)) {
      const rendered = renderChild(child, context, seen)
      if (rendered?.textContent) parts.push(rendered.textContent)
    }
    if (!parts.length) return
    option.textContent = [option.textContent, safeText(parts.join(' '))].filter(Boolean).join(' ')
  }

  function renderOpenUI(node, context = {}, seen = new Set()) {
    if (!isOpenUINode(node) || seen.has(node)) return null
    const dom = documentFor(context)
    if (!dom || typeof dom.createElement !== 'function') return null
    const kind = componentName(node), type = kind.toLowerCase()
    // The caller binds approved actions and read-only owner steps.
    // Advice, ApprovedAction and OwnerStep are host-owned: the bubble already
    // renders advice once and binds its controls. Rendering them again duplicates text.
    if (type === 'advice' || type === 'approvedaction' || type === 'ownerstep') return null
    const props = propsOf(node)
    seen.add(node)
    try {
      let element
      switch (type) {
        case 'suggestions':
          element = createElement('div', context)
          // The root is a layout container, not another bordered card.
          break
        case 'suggestion':
          element = createElement('div', context)
          if (element) element.className = 'personal-agent-preview-card'
          break
        case 'stack':
          element = createElement('div', context)
          if (element) { element.className = 'personal-agent-preview-chips'; applyDirection(element, props) }
          break
        case 'readings':
          element = createElement('div', context)
          if (element) { element.className = 'personal-agent-preview-chips'; applyDirection(element, props) }
          break
        case 'row':
          element = createElement('div', context)
          if (element) element.className = 'personal-agent-preview-chips'
          break
        case 'heading':
          element = createElement('p', context)
          if (element) {
            element.className = 'personal-agent-preview-summary'
            applyTone(element, props)
            element.textContent = textOf(props, ['value', 'text', 'label', 'summary', 'title']) || describeProps(props, kind)
          }
          break
        case 'text':
          element = createElement('p', context)
          if (element) {
            applyTone(element, props)
            element.textContent = textOf(props, ['value', 'text', 'label', 'summary']) || describeProps(props, kind)
          }
          break
        case 'badge':
          element = createElement('span', context)
          if (element) {
            element.className = 'openui-badge'
            applyTone(element, props)
            element.textContent = textOf(props, ['value', 'text', 'label']) || describeProps(props, kind)
          }
          break
        case 'reading':
        case 'chip':
          element = makeChip(kind, props, context)
          break
        case 'metric':
          element = makeChip(kind, props, context)
          if (element) element.dataset.emphasis = 'true'
          break
        case 'optionset':
          element = makeOptionList(node, props, context, seen)
          break
        case 'option':
          element = makeOption(props, context)
          break
        case 'divider':
          element = createElement('hr', context)
          break
        default:
          element = makeUnknown(kind, props, context)
      }
      if (!element) return null
      const classType = type.replace(/[^a-z0-9]+/g, '-')
      addClass(element, `openui-${classType}`)
      for (const extra of EXTRA_CLASSES.get(type) ?? []) addClass(element, extra)
      if (!KNOWN_TYPES.has(type)) addClass(element, 'openui-unknown')
      if (type === 'option') appendOptionText(element, node, context, seen)
      else if (type !== 'optionset') appendChildren(element, node, context, seen)
      return element
    } finally {
      seen.delete(node)
    }
  }

  const api = { renderOpenUI, isOpenUINode }
  root.odkOpenUIDOM = api
  root.odkOpenUI = api
  root.renderOpenUI = renderOpenUI
  root.isOpenUINode = isOpenUINode
  if (typeof globalThis === 'object' && globalThis !== root) {
    globalThis.odkOpenUIDOM = api
    globalThis.odkOpenUI = api
    globalThis.renderOpenUI = renderOpenUI
    globalThis.isOpenUINode = isOpenUINode
  }
  if (typeof module === 'object' && module.exports) {
    module.exports = api
    module.exports.renderOpenUI = renderOpenUI
    module.exports.isOpenUINode = isOpenUINode
  }
  if (typeof exports === 'object' && exports) {
    exports.renderOpenUI = renderOpenUI
    exports.isOpenUINode = isOpenUINode
  }
  try {
    if (typeof root.CustomEvent === 'function' && typeof root.dispatchEvent === 'function')
      root.dispatchEvent(new root.CustomEvent('odk-openui-dom-ready'))
  } catch { /* Readiness is optional in Node fixtures. */ }
})(typeof window !== 'undefined' ? window : globalThis)
