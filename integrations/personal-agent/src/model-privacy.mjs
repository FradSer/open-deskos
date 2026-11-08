import { randomBytes } from 'node:crypto'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'

const SECRET_FIELD = /^(?:api[_-]?key|client[_-]?secret|(?:access|refresh|auth|session)[_-]?token|password|passwd|secret|token)$/i
const ALIAS = /\{\{ODK_[a-f0-9]{24}_[A-Z]+_\d+\}\}/g
const SECRET = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk[-_][A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{12,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35}|ya29\.[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g
const ASSIGNMENT = /(\b(?:api[_-]?key|client[_-]?secret|(?:access|refresh|auth|session)[_-]?token|password|passwd|secret|token)["']?\s*[:=]\s*)(?:"((?:\\.|[^"\\\r\n]){1,512})"|'((?:\\.|[^'\\\r\n]){1,512})'|([A-Za-z0-9][^\s"',;}\])]{3,511}))/gi
const EMAIL = /[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+/gi
const PHONE_FIELD = /^(?:phone|tel|telephone|mobile|phone[_-]?number|电话|电话号码|手机号|手机号码)$/i
const PHONE_NUMBER = /^\+?\d[\d(). -]{5,24}\d$/
const PHONE = /((?:\b(?:phone|tel|telephone|mobile|phone[_-]?number)|电话|电话号码|手机号|手机号码)["']?\s*[:：=]\s*["']?)(\+?\d[\d(). -]{5,24}\d)/gi

// Map JSON values without changing schema objects that do not contain a match.
function mapJson(value, text, key = '') {
  if (typeof value === 'string') return text(value, key)
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items = value.map(item => mapJson(item, text, key))
    return items.some((item, index) => item !== value[index]) ? items : value
  }
  let changed = false
  const entries = Object.entries(value).map(([name, old]) => {
    const mappedName = text(name)
    const mappedValue = mapJson(old, text, name)
    changed ||= mappedName !== name || mappedValue !== old
    return [mappedName, mappedValue]
  })
  return changed ? { ...Object.fromEntries(entries), ...Object.fromEntries(Object.getOwnPropertySymbols(value).map(symbol => [symbol, value[symbol]])) } : value
}

/** A reversible map for one request. It stays on the device and is never logged. */
function createMask() {
  const prefix = '{{ODK_' + randomBytes(12).toString('hex') + '_'
  const originals = new Map()
  const aliases = new Map()
  const replace = (kind, value) => {
    if (!originals.has(value)) {
      const alias = prefix + kind + '_' + (originals.size + 1) + '}}'
      originals.set(value, alias)
      aliases.set(alias, value)
    }
    return originals.get(value)
  }
  function mask(text, key = '') {
    if (typeof text !== 'string' || !text.trim()) return text
    if (SECRET_FIELD.test(key)) return replace('SECRET', text)
    if (PHONE_FIELD.test(key) && PHONE_NUMBER.test(text.trim())) return replace('PHONE', text)
    return text.replace(ASSIGNMENT, (_match, label, double, single, bare) => {
      if (double !== undefined) return label + '"' + replace('SECRET', double) + '"'
      if (single !== undefined) return label + "'" + replace('SECRET', single) + "'"
      return label + replace('SECRET', bare)
    }).replace(/(\bBearer\s+)([A-Za-z0-9._~+/-]{12,}=*)/gi, (_match, label, value) => label + replace('SECRET', value))
      .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, (match, scheme) => scheme + replace('SECRET', match.slice(scheme.length, -1)) + '@')
      .replace(SECRET, value => replace('SECRET', value))
      .replace(EMAIL, value => replace('EMAIL', value))
      .replace(PHONE, (_match, label, value) => label + replace('PHONE', value))
  }
  function tail(text) {
    const start = text.lastIndexOf('{{')
    if (start >= 0) {
      const suffix = text.slice(start)
      if (suffix.length < 72 && !suffix.includes('}}') && (prefix.startsWith(suffix) || suffix.startsWith(prefix))) return start
    }
    return text.endsWith('{') ? text.length - 1 : text.length
  }
  function restore(text, json = false) {
    return text.replace(ALIAS, alias => {
      const value = aliases.get(alias)
      return value === undefined ? alias : json ? JSON.stringify(value).slice(1, -1) : value
    })
  }
  return { mask, restore, tail, get active() { return aliases.size > 0 } }
}

function maskPart(part, mask) {
  if (part.type === 'text') return { ...part, text: mask(part.text) }
  if (part.type === 'toolCall') return { ...part, arguments: mapJson(part.arguments, mask) }
  if (part.type === 'thinking') {
    const thinking = mask(part.thinking)
    // A signature binds the original reasoning. Preserve intact provider blocks.
    if (thinking !== part.thinking || mask(part.thinkingSignature) !== part.thinkingSignature) {
      const { thinkingSignature, redacted, ...safe } = part
      return { ...safe, thinking }
    }
  }
  return part
}

function maskedChat(context, mask) {
  const tools = values => values.map(tool => ({ ...tool, description: mask(tool.description), parameters: mapJson(tool.parameters, mask) }))
  const messages = context.messages?.map(message => ({
    ...message,
    content: typeof message.content === 'string' ? mask(message.content) : message.content.map(part => maskPart(part, mask)),
    ...(message.sections ? { sections: mapJson(message.sections, mask) } : {}),
    ...(message.toolsAdded ? { toolsAdded: tools(message.toolsAdded) } : {}),
  }))
  return { ...context,
    ...(context.systemPrompt ? { systemPrompt: mask(context.systemPrompt) } : {}),
    ...(context.tools ? { tools: tools(context.tools) } : {}),
    ...(messages ? { messages } : {}),
  }
}

function restorePart(part, privacy, partial = false) {
  const show = text => privacy.restore(partial ? text.slice(0, privacy.tail(text)) : text)
  if (part.type === 'text') return { ...part, text: show(part.text) }
  if (part.type === 'thinking') return { ...part, thinking: show(part.thinking) }
  if (part.type === 'toolCall') return { ...part, arguments: mapJson(part.arguments, value => show(value)) }
  return part
}

function restoreMessage(message, privacy, partial = false) {
  return { ...message, content: message.content.map(part => restorePart(part, privacy, partial)) }
}

function restoreStream(source, privacy, model) {
  const stream = createAssistantMessageEventStream()
  const pending = new Map()
  void (async () => {
    try {
      for await (const event of source) {
        if (event.type === 'done') { stream.push({ ...event, message: restoreMessage(event.message, privacy) }); return }
        if (event.type === 'error') { stream.push({ ...event, error: restoreMessage(event.error, privacy) }); return }
        const partial = restoreMessage(event.partial, privacy, true)
        if ('delta' in event) {
          const key = event.type + ':' + event.contentIndex
          const text = (pending.get(key) ?? '') + event.delta
          const end = privacy.tail(text)
          pending.set(key, text.slice(end))
          const delta = privacy.restore(text.slice(0, end), event.type === 'toolcall_delta')
          if (delta) stream.push({ ...event, delta, partial })
        } else if (event.type === 'text_end' || event.type === 'thinking_end' || event.type === 'toolcall_end') {
          const type = event.type === 'toolcall_end' ? 'toolcall_delta' : event.type === 'text_end' ? 'text_delta' : 'thinking_delta'
          const key = type + ':' + event.contentIndex
          const leftover = pending.get(key)
          if (leftover) stream.push({ type, contentIndex: event.contentIndex, delta: leftover, partial })
          pending.delete(key)
          if (event.type === 'toolcall_end') stream.push({ ...event, partial, toolCall: restorePart(event.toolCall, privacy) })
          else stream.push({ ...event, partial, content: privacy.restore(event.content) })
        } else stream.push({ ...event, partial })
      }
      stream.end(restoreMessage(await source.result(), privacy))
    } catch {
      stream.push({ type: 'error', reason: 'error', error: { role: 'assistant', content: [],
        provider: model.provider, api: model.api, model: model.id, timestamp: Date.now(), stopReason: 'error',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        errorMessage: 'The model privacy layer could not restore the response.' } })
    } finally { stream.end() }
  })()
  return stream
}

/** Filter model content before provider dispatch without changing request auth. */
export function modelRequest(method, request, model, context, options, rest) {
  const privacy = createMask()
  let outbound
  try {
    if (method === 'classify') outbound = { ...context, state: mapJson(context.state, privacy.mask), questions: mapJson(context.questions, privacy.mask) }
    else if (method === 'generateImages') outbound = { ...context, input: context.input.map(part => maskPart(part, privacy.mask)) }
    else outbound = maskedChat(context, privacy.mask)
  } catch { throw Error('The model privacy layer could not mask the request.') }
  const response = request(model, privacy.active ? outbound : context, options, ...rest)
  if (!privacy.active) return response
  if (method === 'stream' || method === 'streamSimple') return restoreStream(response, privacy, model)
  return Promise.resolve(response).then(result => {
    if (method === 'classify') return { ...result, answers: mapJson(result.answers, value => privacy.restore(value)) }
    if (method === 'generateImages') return { ...result, output: result.output.map(part => restorePart(part, privacy)) }
    return restoreMessage(result, privacy)
  })
}
