const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
export const historyId = value => typeof value === 'string' && /^\d{1,32}$/.test(value)
const token = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\x00-\x1f\x7f]/.test(value)
const batchSize = 4

export function validLabelCursor(cursor) {
  return cursor && typeof cursor === 'object' && !Array.isArray(cursor)
    && Object.keys(cursor).every(key => ['historyId', 'pageToken', 'offset', 'recovering'].includes(key))
    && historyId(cursor.historyId) && (cursor.pageToken === undefined || token(cursor.pageToken))
    && (cursor.offset === undefined || (Number.isSafeInteger(cursor.offset) && cursor.offset > 0))
    && (cursor.recovering === undefined || cursor.recovering === true)
}

export async function readLabelChanges(read, profile, labelId, since, cursor) {
  async function list(position) {
    const { historyId: startHistoryId, pageToken, recovering } = position
    if (recovering) return read('messages', { labelIds: labelId, q: 'after:' + Math.max(0, Math.floor(since / 1000) - 1),
      pageToken, maxResults: batchSize, fields: 'messages(id),nextPageToken' })
    return read('history', { labelId, startHistoryId, pageToken, maxResults: batchSize, historyTypes: ['messageAdded', 'labelAdded'],
      fields: 'history(messagesAdded(message(id)),labelsAdded(message(id),labelIds)),historyId,nextPageToken' })
  }
  let result
  try { result = await list(cursor) } catch (error) {
    if (cursor.recovering || error.status !== 404 || !historyId(profile.historyId)) throw error
    // Capture the high-water mark before the fallback scan so concurrent mail is picked up by history.
    cursor = { historyId: profile.historyId, recovering: true }
    result = await list(cursor)
  }
  const { nextPageToken, historyId: latest } = result
  if (nextPageToken !== undefined && (!token(nextPageToken) || nextPageToken === cursor.pageToken)) throw Error('Invalid Gmail continuation')
  const listing = cursor.recovering ? result.messages : result.history
  if (listing !== undefined && !Array.isArray(listing)) throw Error('Invalid Gmail listing')
  const ids = [...new Set((listing ?? []).flatMap(row => cursor.recovering ? [row.id] : [
    ...(row.messagesAdded ?? []).map(change => change.message.id),
    ...(row.labelsAdded ?? []).filter(change => change.labelIds.includes(labelId)).map(change => change.message.id),
  ]))]
  if (!ids.every(id)) throw Error('Invalid Gmail message identity')
  const offset = cursor.offset ?? 0
  if (offset > ids.length) throw Error('Invalid Gmail page offset')
  const end = offset + batchSize
  const checkpoint = cursor.recovering ? cursor.historyId : latest
  const next = end < ids.length ? { ...cursor, offset: end }
    : nextPageToken ? { historyId: cursor.historyId, pageToken: nextPageToken, ...(cursor.recovering ? { recovering: true } : {}) } : undefined
  if (!next && (!historyId(checkpoint) || BigInt(checkpoint) < BigInt(cursor.historyId))) throw Error('Invalid Gmail history checkpoint')
  return { ids: ids.slice(offset, end), cursor: next ?? { historyId: checkpoint }, complete: !next, untrusted: true }
}
