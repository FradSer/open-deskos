const DEFAULTS = { target: 0.62, tolerance: 0.08, minOccupied: 0.2, maxEmptyBand: 0.28 }

function intervalLength(intervals) {
  const sorted = intervals.sort((a, b) => a[0] - b[0])
  let total = 0
  let end = -Infinity
  for (const [start, nextEnd] of sorted) {
    total += Math.max(0, nextEnd - Math.max(start, end))
    end = Math.max(end, nextEnd)
  }
  return total
}

function unionArea(boxes) {
  const xs = [...new Set(boxes.flatMap(box => [box.x, box.x + box.width]))].sort((a, b) => a - b)
  let area = 0
  for (let i = 1; i < xs.length; i += 1) {
    const intervals = boxes.filter(box => box.x < xs[i] && box.x + box.width > xs[i - 1])
      .map(box => [box.y, box.y + box.height])
    area += (xs[i] - xs[i - 1]) * intervalLength(intervals)
  }
  return area
}

function emptyBand(frame, boxes) {
  let end = frame.y
  let largest = 0
  for (const box of [...boxes].sort((a, b) => a.y - b.y)) {
    largest = Math.max(largest, box.y - end)
    end = Math.max(end, box.y + box.height)
  }
  return Math.max(largest, frame.y + frame.height - end) / frame.height
}

function measureDensity(frame, boxes, options = DEFAULTS) {
  if (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) || frame.width <= 0 || frame.height <= 0) {
    throw new Error('Invalid Widget frame')
  }
  const settings = { ...DEFAULTS, ...options }
  const valid = boxes.filter(box => [box.x, box.y, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0)
  const overflow = valid.some(box => box.x < frame.x - 1 || box.y < frame.y - 1 || box.x + box.width > frame.x + frame.width + 1 || box.y + box.height > frame.y + frame.height + 1)
  const clipped = valid.map(box => {
    const x = Math.max(frame.x, box.x)
    const y = Math.max(frame.y, box.y)
    return { x, y, width: Math.min(frame.x + frame.width, box.x + box.width) - x, height: Math.min(frame.y + frame.height, box.y + box.height) - y }
  }).filter(box => box.width > 0 && box.height > 0)
  const envelope = clipped.length ? {
    x: Math.min(...clipped.map(box => box.x)), y: Math.min(...clipped.map(box => box.y)),
    right: Math.max(...clipped.map(box => box.x + box.width)), bottom: Math.max(...clipped.map(box => box.y + box.height)),
  } : null
  const area = frame.width * frame.height
  const fill = envelope ? (envelope.right - envelope.x) * (envelope.bottom - envelope.y) / area : 0
  const occupied = unionArea(clipped) / area
  const gap = emptyBand(frame, clipped)
  const violations = []
  if (!clipped.length) violations.push('missing-content')
  if (overflow) violations.push('overflow')
  if (Math.abs(fill - settings.target) > settings.tolerance + 1e-8) violations.push('fill-outside-band')
  if (occupied < settings.minOccupied) violations.push('sparse-content')
  if (gap > settings.maxEmptyBand) violations.push('empty-band')
  return { fill, occupied, emptyBand: gap, deviation: fill - settings.target, envelope, violations }
}

function collectWidgetContent() {
  const rect = r => ({ x: r.left, y: r.top, width: r.width, height: r.height })
  const visible = el => {
    for (let node = el; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || node.hidden) return false
    }
    return true
  }
  const clippedByAncestor = (box, element, widget) => {
    for (let node = element; node && node !== widget; node = node.parentElement) {
      const style = getComputedStyle(node)
      const bounds = node.getBoundingClientRect()
      const left = bounds.left + parseFloat(style.borderLeftWidth)
      const top = bounds.top + parseFloat(style.borderTopWidth)
      const right = left + node.clientWidth
      const bottom = top + node.clientHeight
      if (style.overflowX !== 'visible' && (box.x < left - 1 || box.x + box.width > right + 1)) return true
      if (style.overflowY !== 'visible' && (box.y < top - 1 || box.y + box.height > bottom + 1)) return true
    }
    return false
  }
  return [...document.querySelectorAll('.widget')].map(widget => {
    const outer = widget.getBoundingClientRect()
    const style = getComputedStyle(widget)
    const left = parseFloat(style.borderLeftWidth)
    const top = parseFloat(style.borderTopWidth)
    const frame = { x: outer.left + left, y: outer.top + top, width: outer.width - left - parseFloat(style.borderRightWidth), height: outer.height - top - parseFloat(style.borderBottomWidth) }
    const boxes = []
    let clipped = false
    const add = (box, element) => {
      boxes.push(box)
      clipped ||= clippedByAncestor(box, element, widget)
    }
    const walker = document.createTreeWalker(widget, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const text = walker.currentNode
      if (!text.textContent.trim() || !visible(text.parentElement) || text.parentElement.closest('svg')) continue
      const range = document.createRange()
      range.selectNodeContents(text)
      for (const box of range.getClientRects()) add(rect(box), text.parentElement)
    }
    for (const el of widget.querySelectorAll('svg, .meter')) {
      if (visible(el)) add(rect(el.getBoundingClientRect()), el.parentElement)
    }
    return { id: widget.dataset.widget, name: widget.dataset.app, frame, boxes, clipped }
  })
}

module.exports = { DEFAULTS, measureDensity, collectWidgetContent }
