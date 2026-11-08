import { isAbsolute, normalize } from 'node:path'
import { createScheduleConflict } from './schedule-conflict.mjs'
import { createGoogleCalendarReader } from './schedule-conflict-google-calendar.mjs'
import { readProactiveFile } from '../proactive-private.mjs'
import { createPrivateMcpObserver } from './private-mcp-observer.mjs'
import { createGmailRecommendationSource } from './gmail-recommendation-source.mjs'
import { createPrivateProposalSources } from './private-proposal-sources.mjs'

const unavailable = () => Error('Private recommendation configuration is unavailable or invalid.')
const object = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every(key => keys.includes(key))
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)

/** Owner configuration selects fixed reviewed profiles, never executable plugin code. */
export function validatePrivateRecommendationConfig(value) {
  if (!object(value, ['version', 'sources', 'scheduleConflict']) || value.version !== 1 || !Array.isArray(value.sources)
    || value.sources.length > 8 || new Set(value.sources.map(source => source?.id)).size !== value.sources.length) throw unavailable()
  const sources = value.sources.map(source => {
    if (!object(source, ['id', 'goal', 'query', 'maxMessages', 'replyLabel']) || source.id !== 'gmail' || !text(source.goal, 1000)
      || (source.replyLabel !== undefined && !text(source.replyLabel, 240))
      || (source.query !== undefined && !text(source.query, 1024))
      || (source.maxMessages !== undefined && (!Number.isInteger(source.maxMessages) || source.maxMessages < 1 || source.maxMessages > 8))) throw unavailable()
    return { id: source.id, goal: source.goal, query: source.query ?? 'in:inbox', maxMessages: source.maxMessages ?? 3, replyLabel: source.replyLabel ?? '准备回复' }
  })
  const selection = value.scheduleConflict
  if (selection === undefined) return { version: 1, sources }
  const mailbox = /^[^\s@<>]+@[^\s@<>]+$/
  if (!object(selection, ['gmailAccount', 'calendarReadingId', 'timeZone', 'googleCalendar'])
      || !text(selection.gmailAccount, 320) || !mailbox.test(selection.gmailAccount)
      || typeof selection.calendarReadingId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(selection.calendarReadingId)
      || (selection.timeZone !== undefined && !text(selection.timeZone, 80))) throw unavailable()
  const timeZone = selection.timeZone ?? 'UTC'
  try { new Intl.DateTimeFormat('en', { timeZone }) } catch { throw unavailable() }
  const google = selection.googleCalendar
  if (google !== undefined && (!object(google, ['calendarId', 'credentialsFile'])
      || !text(google.calendarId, 320) || !mailbox.test(google.calendarId)
      || !text(google.credentialsFile, 1024) || !isAbsolute(google.credentialsFile)
      || normalize(google.credentialsFile) !== google.credentialsFile)) throw unavailable()
  return { version: 1, sources, scheduleConflict: {
    gmailAccount: selection.gmailAccount.toLowerCase(), calendarReadingId: selection.calendarReadingId, timeZone,
    ...(google ? { googleCalendar: { calendarId: google.calendarId, credentialsFile: google.credentialsFile } } : {}),
  } }
}

/** No selection means no background connector observation. */
export function loadPrivateRecommendationConfig(env = process.env) {
  if (env.ODK_PRIVATE_RECOMMENDATIONS_FILE === undefined) return { version: 1, sources: [] }
  try {
    return validatePrivateRecommendationConfig(JSON.parse(readProactiveFile(env.ODK_PRIVATE_RECOMMENDATIONS_FILE, 16384)))
  } catch { throw unavailable() }
}

/** Construct independent sessions without starting them or changing the installed catalog. */
export function createConfiguredScheduleConflict({ config, catalog, env = process.env, openSession = undefined }) {
  const selection = validatePrivateRecommendationConfig(config).scheduleConflict
  if (!selection) return undefined
  if (typeof catalog?.package !== 'function') throw unavailable()
  const observer = createPrivateMcpObserver({ catalog, connectorId: 'gmail',
    readOnlyTools: ['gmail_schedule_changes'], env, ...(openSession ? { openSession } : {}) })
  const calendarRead = selection.googleCalendar
    ? createGoogleCalendarReader({ ...selection.googleCalendar, readingId: selection.calendarReadingId })
    : undefined
  return createScheduleConflict({ selection, observer, calendarRead })
}

/** Construct independent sessions without starting them or changing the installed catalog. */
export function createConfiguredPrivateSources({ config, catalog, env = process.env, openSession = undefined, routines = undefined }) {
  const selected = validatePrivateRecommendationConfig(config)
  if (selected.sources.length && typeof catalog?.package !== 'function') throw unavailable()
  const entries = selected.sources.map(selection => {
    const observer = createPrivateMcpObserver({ catalog, connectorId: selection.id,
      readOnlyTools: ['gmail_status', 'gmail_search', 'gmail_read'], env, ...(openSession ? { openSession } : {}) })
    return { id: selection.id, goal: selection.goal, label: '核对这封邮件，再确认下一步', replyLabel: selection.replyLabel,
      source: createGmailRecommendationSource({ observer, query: selection.query, maxMessages: selection.maxMessages }) }
  })
  return createPrivateProposalSources(entries, routines)
}
