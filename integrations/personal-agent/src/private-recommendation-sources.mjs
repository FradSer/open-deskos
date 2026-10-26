import { readProactiveFile } from './proactive-private.mjs'
import { createPrivateMcpObserver } from './private-mcp-observer.mjs'
import { createGmailRecommendationSource } from './gmail-recommendation-source.mjs'
import { createPrivateProposalSources } from './private-proposal-sources.mjs'

const unavailable = () => Error('Private recommendation configuration is unavailable or invalid.')
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key))
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)

/** Owner configuration selects fixed reviewed profiles, never executable plugin code. */
export function validatePrivateRecommendationConfig(value) {
  if (!object(value, ['version', 'sources']) || value.version !== 1 || !Array.isArray(value.sources)
    || value.sources.length > 8 || new Set(value.sources.map(source => source?.id)).size !== value.sources.length) throw unavailable()
  const sources = value.sources.map(source => {
    if (!object(source, ['id', 'goal', 'query', 'maxMessages']) || source.id !== 'gmail' || !text(source.goal, 1000)
      || (source.query !== undefined && !text(source.query, 1024))
      || (source.maxMessages !== undefined && (!Number.isInteger(source.maxMessages) || source.maxMessages < 1 || source.maxMessages > 8))) throw unavailable()
    return { id: source.id, goal: source.goal, query: source.query ?? 'in:inbox', maxMessages: source.maxMessages ?? 3 }
  })
  return { version: 1, sources }
}

/** No selection means no background connector observation. */
export function loadPrivateRecommendationConfig(env = process.env) {
  if (env.ODK_PRIVATE_RECOMMENDATIONS_FILE === undefined) return { version: 1, sources: [] }
  try {
    return validatePrivateRecommendationConfig(JSON.parse(readProactiveFile(env.ODK_PRIVATE_RECOMMENDATIONS_FILE, 16384)))
  } catch { throw unavailable() }
}

/** Construct independent sessions without starting them or changing the installed catalog. */
export function createConfiguredPrivateSources({ config, catalog, env = process.env, openSession = undefined }) {
  const selected = validatePrivateRecommendationConfig(config)
  if (selected.sources.length && typeof catalog?.package !== 'function') throw unavailable()
  const entries = selected.sources.map(selection => {
    const observer = createPrivateMcpObserver({ catalog, connectorId: selection.id,
      readOnlyTools: ['gmail_status', 'gmail_search', 'gmail_read'], env, ...(openSession ? { openSession } : {}) })
    return { id: selection.id, goal: selection.goal, label: '核对这封邮件，再确认下一步',
      source: createGmailRecommendationSource({ observer, query: selection.query, maxMessages: selection.maxMessages }) }
  })
  return createPrivateProposalSources(entries)
}
