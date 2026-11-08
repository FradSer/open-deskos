import { registerHooks } from 'node:module'
import { appendFileSync, readFileSync } from 'node:fs'

const { ODK_MCP_GMAIL_ROUTINE_E2E_CLOCK: clockFile, ODK_MCP_GMAIL_ROUTINE_E2E_TRACE: trace } = process.env
if (!clockFile || !trace) throw Error('Gmail routine acceptance requires private clock and trace files')
const marker = 'clockNow = Date.now'
registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context)
    if (!url.endsWith('/recommendations/gmail-routines.mjs')) return result
    const source = String(result.source)
    if (!source.includes(marker)) throw Error('Gmail routine schedule clock port changed')
    return { ...result, source: source.replace(marker, 'clockNow = globalThis.odkRoutineTestClock') }
  },
})
globalThis.odkRoutineTestClock = () => {
  const { at, start } = JSON.parse(readFileSync(clockFile, 'utf8'))
  return start === undefined ? at : at + Math.max(0, Date.now() - start)
}

const fetchLive = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const { hostname, pathname } = new URL(input instanceof Request ? input.url : input)
  const endpoint = hostname === 'gmail.googleapis.com' && pathname.endsWith('/history') ? 'gmail_history'
    : hostname === 'gmail.googleapis.com' && pathname.endsWith('/labels') ? 'gmail_labels'
      : hostname === 'gmail.googleapis.com' && pathname.endsWith('/profile') ? 'gmail_profile'
        : pathname.endsWith('/chat/completions') ? 'model' : undefined
  if (!endpoint) return fetchLive(input, init)
  try {
    const response = await fetchLive(input, init)
    appendFileSync(trace, JSON.stringify({ endpoint, status: response.status }) + '\n', { mode: 0o600 })
    return response
  } catch (error) {
    appendFileSync(trace, JSON.stringify({ endpoint, status: 0 }) + '\n', { mode: 0o600 })
    throw error
  }
}
