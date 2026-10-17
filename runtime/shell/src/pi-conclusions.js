'use strict'
const { createHash } = require('node:crypto')
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')
function latestAssistantConclusion(events) {
  const latest=events.findLast(event=>event?.kind==='assistant' && typeof event.text==='string')
  return latest?.stopReason===undefined?latest:events.findLast(event=>event?.kind==='assistant' && typeof event.text==='string' && event.stopReason==='stop')
}
/** Read-only reports retain reporting-machine identity, including colliding session UUIDs. */
function conclusionPage(machines, { cursor = null, limit = 16 } = {}) {
  if ((cursor !== null && (typeof cursor !== 'string' || !/^[a-f0-9]{64}$/.test(cursor))) || !Number.isInteger(limit) || limit < 1 || limit > 16) throw Error('Invalid conclusion page')
  const records = []
  for (const [machine, source] of machines) for (const [sessionId, entry] of source.sessions) {
    const event = latestAssistantConclusion(entry.events)
    const conclusion = event?.text?.slice(0, 2048) ?? ''
    const key = hash([machine, sessionId])
    const record = { key, machine, sessionId, project: entry.session.cwd ?? '', state: entry.session.status,
      updatedAt: entry.session.updatedAt ?? 0, conclusion, control: 'report_only',
      historyTruncated: true, truncated: event?.truncated === true || (event?.text?.length ?? 0) > 2048,
      execution: 'reported_unverified', conclusionOutcome:event?.stopReason==='stop'?'reported_finished':'unknown',eventId:event?.eventId??null,conclusionIsLatestAssistant:event===entry.events.findLast(item=>item.kind==='assistant'), latestEventIsAssistant: entry.events.at(-1)?.kind === 'assistant' }
    records.push({ ...record, revision: hash({...record,updatedAt:undefined}) })
  }
  records.sort((a,b) => a.key.localeCompare(b.key))
  const start = cursor === null ? 0 : records.findIndex(record => record.key === cursor) + 1
  if (cursor !== null && start === 0) return { ok:false, reason:'cursor_expired', records:[], total:records.length }
  const page = records.slice(start, start + limit), remaining = Math.max(0, records.length - start - page.length)
  return { ok:true, records:page, total:records.length, omitted:remaining, nextCursor:remaining ? page.at(-1).key : null }
}
module.exports = { conclusionPage, latestAssistantConclusion }
