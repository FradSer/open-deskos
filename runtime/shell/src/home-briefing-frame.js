const STATES = new Set(['loading', 'live', 'empty', 'unavailable', 'error', 'stale'])
const SOURCE_STATES = new Set(['live', 'stale', 'unavailable', 'unconfigured', 'unauthorized', 'error'])
const ICONS = new Set(['sessions', 'plants', 'weather', 'mail', 'calendar', 'tasks', 'reading', 'portfolio', 'quota', 'apps', 'status'])
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit && !/[\x00-\x08\x0b-\x1f]/.test(value)
const time = value => Number.isFinite(value) && value >= 0 && value <= 8640000000000000

function parseHomeBriefing(frame) {
  const unavailable = () => ({ state: 'unavailable', items: [], generatedAt: 0, omittedSources: 0 })
  if (!frame || !STATES.has(frame.state) || !time(frame.generatedAt)
    || !Number.isSafeInteger(frame.omittedSources) || frame.omittedSources < 0
    || !Array.isArray(frame.items) || frame.items.length > 4) return unavailable()
  const compact = frame.items.some(item => item?.segments !== undefined)
  if (compact && (frame.items.length > 2 || frame.items.reduce((sum, item) => sum + (item?.text?.length || 0), 0) > 240)) return unavailable()
  const items = []
  for (const item of frame.items) {
    if (!item || !text(item.text, 600) || !Array.isArray(item.sources) || !item.sources.length || item.sources.length > 8) return unavailable()
    if (compact && (!Array.isArray(item.segments) || !item.segments.length || item.segments.length > 12
      || !item.segments.some(segment => ICONS.has(segment?.icon))
      || item.segments.some(segment => !segment || Object.keys(segment).some(key => !['text', 'icon'].includes(key))
        || !text(segment.text, 240) || (segment.icon !== undefined && !ICONS.has(segment.icon)))
      || item.segments.map(segment => segment.text).join('') !== item.text)) return unavailable()
    const sources = []
    for (const source of item.sources) {
      if (!source || typeof source.id !== 'string' || !ID.test(source.id) || !text(source.label, 128)
        || !SOURCE_STATES.has(source.state) || (source.updatedAt !== undefined && !time(source.updatedAt))) return unavailable()
      sources.push({ id: source.id, label: source.label, state: source.state,
        ...(source.updatedAt !== undefined ? { updatedAt: source.updatedAt } : {}) })
    }
    items.push({ text: item.text, sources, ...(compact ? { segments: item.segments.map(segment => ({ ...segment })) } : {}) })
  }
  if ((frame.state === 'empty' && items.length) || (frame.state === 'live' && !items.length)) return unavailable()
  let coverage
  if (frame.coverage !== undefined) {
    const keys = ['totalSources', 'readSources', 'failedSources', 'incompleteSources', 'selectedSources']
    if (!frame.coverage || keys.some(key => !Number.isSafeInteger(frame.coverage[key]) || frame.coverage[key] < 0)
      || frame.coverage.readSources > frame.coverage.totalSources
      || keys.slice(2).some(key => frame.coverage[key] > frame.coverage.readSources)) return unavailable()
    coverage = Object.fromEntries(keys.map(key => [key, frame.coverage[key]]))
  }
  return { state: frame.state, generatedAt: frame.generatedAt, omittedSources: frame.omittedSources, items, ...(coverage ? { coverage } : {}) }
}

module.exports = { parseHomeBriefing }
