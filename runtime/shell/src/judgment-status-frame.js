const modelId = value => typeof value === 'string' && value.length <= 256
  && (/^jev-[A-Za-z0-9_.-]{1,60}$/.test(value) || /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9][A-Za-z0-9._:/-]{0,190}$/.test(value))

function parseJudgmentStatus(value) {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['ready', 'unavailable'].includes(value.status) || !['model', 'jev'].includes(value.provider)
    || (value.model !== undefined && (!modelId(value.model) || (value.provider === 'jev' ? !value.model.startsWith('jev-') : value.model.startsWith('jev-'))))) {
    return { status: 'unavailable', provider: 'model' }
  }
  return { status: value.status, provider: value.provider, ...(value.model !== undefined ? { model: value.model } : {}) }
}

module.exports = { parseJudgmentStatus }
