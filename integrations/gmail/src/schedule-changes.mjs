const MAX_MESSAGES = 8
const MAX_CALENDAR_BYTES = 16384
const RECOVERY_SECONDS = 7 * 24 * 60 * 60

const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value)
const attachmentKey = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,1024}$/.test(value)
const historyId = value => typeof value === 'string' && /^\d{1,32}$/.test(value)
const pageToken = value => typeof value === 'string' && /^[A-Za-z0-9_+/=-]{1,2048}$/.test(value)
const invalid = () => Object.assign(Error('Invalid schedule change cursor'), { code: 'invalid_request' })

function encode(cursor) {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeScheduleCursor(value, accountKey) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(value)) throw invalid()
  let cursor
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) } catch { throw invalid() }
  if (!cursor || cursor.accountKey !== accountKey || !historyId(cursor.history)
    || !Number.isInteger(cursor.offset) || cursor.offset < 0
    || (cursor.page !== undefined && !pageToken(cursor.page))
    || (cursor.after !== undefined && (!Number.isInteger(cursor.after) || cursor.after < 0))) throw invalid()
  return cursor
}

function isoDateTime(value, params) {
  let zone, dateTimeType = false
  for (const parameter of params ? params.slice(1).split(';') : []) {
    if (!dateTimeType && /^VALUE=DATE-TIME$/i.test(parameter)) { dateTimeType = true; continue }
    const zoneMatch = /^TZID=(?:"([^"]+)"|([^"]+))$/i.exec(parameter)
    if (!zoneMatch || zone) return undefined
    zone = zoneMatch[1] ?? zoneMatch[2]
    if (zone.length > 128 || !/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/i.test(zone)) return undefined
  }
  const date = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value)
  if (!date || Boolean(date[7]) === Boolean(zone)) return undefined
  const [, year, month, day, hour, minute, second] = date
  const iso = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`
  const wall = Date.parse(iso)
  if (!Number.isFinite(wall) || new Date(wall).toISOString() !== iso) return undefined
  if (!zone) return iso

  let formatter
  try { formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }) }
  catch { return undefined }
  const offsetAt = instant => {
    const offset = formatter.formatToParts(instant).find(part => part.type === 'timeZoneName')?.value
    if (offset === 'GMT') return 0
    const match = /^GMT([+-])(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(offset ?? '')
    if (!match) return NaN
    const [, sign, hours, minutes, seconds = '0'] = match
    return (sign === '-' ? -1 : 1) * (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000
  }
  // Read the runtime's offsets on both sides of a nearby transition. A fold
  // maps to two instants and a gap maps to none. Never use embedded VTIMEZONE rules.
  const offsets = new Set()
  for (let hour = -36; hour <= 36; hour += 6) offsets.add(offsetAt(wall + hour * 3600000))
  const candidates = [...offsets].filter(Number.isFinite).map(offset => wall - offset)
    .filter(instant => instant + offsetAt(instant) === wall)
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : undefined
}

function calendarData(encoded, mimeMethod) {
  if (typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+={0,2}$/.test(encoded) || encoded.length > MAX_CALENDAR_BYTES * 2) return undefined
  const bytes = Buffer.from(encoded, 'base64url')
  if (bytes.length > MAX_CALENDAR_BYTES) return undefined
  let source
  try { source = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { return undefined }
  if (/[\x00-\x08\x0b-\x1f\x7f]/.test(source.replace(/\r\n/g, '\n'))) return undefined
  const lines = source.replace(/\r?\n[ \t]/g, '').trim().split(/\r?\n/)
  if (lines[0]?.toUpperCase() !== 'BEGIN:VCALENDAR' || lines.at(-1)?.toUpperCase() !== 'END:VCALENDAR') return undefined
  const calendar = new Map(), event = new Map()
  const components = ['VCALENDAR']
  let events = 0
  for (const line of lines.slice(1, -1)) {
    const property = /^([A-Z0-9-]+)((?:;(?:[^":]|"[^"]*")*)?):(.*)$/i.exec(line)
    if (!property) return undefined
    const [, rawName, params, value] = property
    const name = rawName.toUpperCase()
    const component = components.at(-1)
    if (name === 'BEGIN') {
      const child = value.toUpperCase()
      if (!/^[A-Z0-9-]+$/.test(child) || components.length >= 8) return undefined
      if (child === 'VEVENT' && (component !== 'VCALENDAR' || ++events !== 1)) return undefined
      components.push(child)
    } else if (name === 'END') {
      if (components.length === 1 || value.toUpperCase() !== component) return undefined
      components.pop()
    } else if (component === 'VCALENDAR' && ['METHOD', 'VERSION'].includes(name)) {
      if (calendar.has(name) || params) return undefined
      calendar.set(name, value.toUpperCase())
    } else if (component === 'VEVENT') {
      if (['RRULE', 'RDATE', 'EXRULE', 'EXDATE', 'RECURRENCE-ID', 'DURATION'].includes(name)) return undefined
      if (!['UID', 'ORGANIZER', 'SEQUENCE', 'DTSTART', 'DTEND'].includes(name)) continue
      if (event.has(name)) return undefined
      if (name === 'DTSTART' || name === 'DTEND') {
        const stamp = isoDateTime(value, params)
        if (!stamp) return undefined
        event.set(name, stamp)
      } else {
        if (params && name !== 'ORGANIZER') return undefined
        event.set(name, value)
      }
    }
  }
  const method = calendar.get('METHOD')
  const uid = event.get('UID')
  const organizer = /^mailto:([a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9.-]+)$/i.exec(event.get('ORGANIZER') ?? '')?.[1]
  const rawSequence = event.get('SEQUENCE') ?? (method === 'REQUEST' ? '0' : '')
  const sequence = Number(rawSequence)
  const startsAt = event.get('DTSTART'), endsAt = event.get('DTEND')
  if (components.length !== 1 || events !== 1 || calendar.get('VERSION') !== '2.0' || !['REQUEST', 'CANCEL'].includes(method)
    || (mimeMethod && mimeMethod.toUpperCase() !== method) || typeof uid !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(uid)
    || !organizer || organizer.length > 254 || !/^\d{1,10}$/.test(rawSequence) || sequence > 2147483647
    || (method === 'REQUEST' && (!startsAt || !endsAt))
    || (endsAt && (!startsAt || endsAt <= startsAt))) return undefined
  return { uid, organizer: organizer.toLowerCase(), sequence, method, ...(method === 'REQUEST' ? { startsAt, endsAt } : {}) }
}

async function messageEvent(read, messageId) {
  let message
  try { message = await read(`messages/${messageId}`, { format: 'full', fields: 'id,internalDate,labelIds,payload' }) }
  catch (error) {
    if (error.status === 404 || error.code === 'response_too_large') return undefined
    throw error
  }
  if (!message || message.id !== messageId || !message.payload) throw Error('Invalid Gmail message')
  const labels = message.labelIds ?? []
  if (labels.some(label => ['DRAFT', 'SPAM', 'TRASH'].includes(label))
    || (labels.includes('SENT') && !labels.includes('INBOX'))) return undefined
  const stamp = typeof message.internalDate === 'string' && /^\d{1,16}$/.test(message.internalDate) ? Number(message.internalDate) : NaN
  if (!Number.isFinite(stamp) || stamp > 8640000000000000) return undefined
  const parts = [message.payload], calendars = []
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (!part || parts.length > 128) return undefined
    const mime = String(part.mimeType).toLowerCase()
    if (mime === 'text/calendar') {
      calendars.push(part)
      if (calendars.length > 4) return undefined
    } else if (mime.startsWith('multipart/') && Array.isArray(part.parts)) {
      if (parts.length + part.parts.length > 128) return undefined
      parts.push(...part.parts)
    }
  }
  let selected
  for (const part of calendars) {
    const { data, attachmentId, size } = part.body ?? {}
    if (typeof size === 'number' && size > MAX_CALENDAR_BYTES) return undefined
    let encoded = data
    if (encoded === undefined && attachmentId !== undefined) {
      if (!attachmentKey(attachmentId) || !Number.isInteger(size) || size < 1) return undefined
      try { encoded = (await read(`messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`, {}, 32768)).data }
      catch (error) {
        if (error.status === 404 || error.code === 'response_too_large') return undefined
        throw error
      }
    }
    const contentType = part.headers?.find(header => String(header.name).toLowerCase() === 'content-type')?.value ?? ''
    const method = /;\s*method\s*=\s*"?([a-z]+)"?/i.exec(contentType)?.[1]
    const parsed = calendarData(encoded, method)
    if (!parsed || (selected && JSON.stringify(selected) !== JSON.stringify(parsed))) return undefined
    selected = parsed
  }
  return selected ? { messageId, ...selected, receivedAt: new Date(stamp).toISOString() } : undefined
}

/** Read one bounded page. The returned cursor names the next unread message. */
export async function readScheduleChanges(read, profile, accountKey, cursor) {
  if (!historyId(profile.historyId)) throw Error('Missing Gmail history checkpoint')
  const bootstrap = () => ({ accountKey, history: profile.historyId, offset: 0, page: undefined,
    after: Math.max(0, Math.floor(Date.now() / 1000) - RECOVERY_SECONDS) })
  cursor ??= bootstrap()
  const list = position => position.after !== undefined
    ? read('messages', { q: `after:${position.after} filename:ics`, maxResults: MAX_MESSAGES, pageToken: position.page })
    : read('history', { startHistoryId: position.history, historyTypes: 'messageAdded', maxResults: MAX_MESSAGES, pageToken: position.page,
      fields: 'history(messagesAdded(message(id)),id),historyId,nextPageToken' })
  let value
  try { value = await list(cursor) }
  catch (error) {
    if (cursor.after !== undefined || error.status !== 404) throw error
    cursor = bootstrap()
    value = await list(cursor)
  }
  const added = entry => {
    if (entry?.messagesAdded === undefined) return []
    if (!Array.isArray(entry.messagesAdded)) throw Error('Invalid Gmail history')
    return entry.messagesAdded.map(item => item?.message)
  }
  const listing = cursor.after !== undefined ? value?.messages : value?.history
  if (!value || (listing !== undefined && !Array.isArray(listing))) throw Error('Invalid Gmail page')
  const rows = cursor.after !== undefined ? (listing ?? []) : (listing ?? []).flatMap(added)
  if (!rows.every(item => id(item?.id))
    || (value.nextPageToken !== undefined && (!pageToken(value.nextPageToken) || value.nextPageToken === cursor.page))) throw Error('Invalid Gmail page')
  const ids = [...new Set(rows.map(row => row.id))]
  if (cursor.offset > ids.length) throw Error('Invalid Gmail page offset')
  const end = cursor.offset + MAX_MESSAGES
  const events = []
  for (const messageId of ids.slice(cursor.offset, end)) {
    const event = await messageEvent(read, messageId)
    if (event) events.push(event)
  }
  const next = ids.length > end ? { ...cursor, offset: end } :
    value.nextPageToken ? { ...cursor, offset: 0, page: value.nextPageToken } : undefined
  const history = cursor.after !== undefined ? cursor.history : value.historyId
  if (!next && (!historyId(history) || BigInt(history) < BigInt(cursor.history))) throw Error('Invalid Gmail history checkpoint')
  return { untrusted: true, cursor: encode(next ?? { accountKey, history, offset: 0 }), complete: !next, events }
}
