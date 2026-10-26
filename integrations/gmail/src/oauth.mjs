import { createServer } from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { spawn } from 'node:child_process'
import { validateGmailCredentials } from './credentials.mjs'

export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
class GmailOAuthError extends Error {}

/** Open Google authorization in the operating system browser. */
export async function openSystemBrowser(url) {
  const command = process.platform === 'win32' ? 'rundll32' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore', detached: true, shell: false })
    child.once('error', () => reject(Error('Could not open the system browser.')))
    child.once('spawn', () => { child.unref(); resolve(undefined) })
  })
}

/** Validate the installed-app client export, without returning provider source data. */
export function parseDesktopClient(value) {
  const client = value?.installed
  try {
    validateGmailCredentials({ schemaVersion: 1, clientId: client?.client_id, clientSecret: client?.client_secret, refreshToken: 'validation-only', scope: GMAIL_READONLY_SCOPE })
  } catch { throw Error('Use a Google Desktop app OAuth client file.') }
  return { clientId: client.client_id, clientSecret: client.client_secret }
}

/** Authorize a desktop account. Tokens stay in the returned private credential object. */
export async function authorizeGmail({ clientId, clientSecret, openBrowser = openSystemBrowser, fetch: fetchImpl = globalThis.fetch, timeoutMs = 180000 }) {
  parseDesktopClient({ installed: { client_id: clientId, client_secret: clientSecret } })
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) throw Error('Invalid Gmail authorization timeout.')
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  let finish
  const callback = new Promise((resolve, reject) => { finish = { resolve, reject } })
  // Register rejection handling before launching an asynchronous browser operation.
  callback.catch(() => {})
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (req.method !== 'GET' || url.pathname !== '/') { res.writeHead(404).end(); return }
    const states = url.searchParams.getAll('state')
    const incoming = Buffer.from(states[0] || '')
    const expected = Buffer.from(state)
    if (states.length !== 1 || incoming.length !== expected.length || !timingSafeEqual(incoming, expected)) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Authorization failed. Return to Open DeskOS.')
      finish.reject(new GmailOAuthError('Gmail authorization state did not match.'))
      return
    }
    const codes = url.searchParams.getAll('code')
    if (url.searchParams.has('error') || codes.length !== 1 || !codes[0]) {
      res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Authorization cancelled. Return to Open DeskOS.')
      finish.reject(new GmailOAuthError('Gmail authorization was denied or invalid.'))
      return
    }
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Return to Open DeskOS. You can close this browser tab.')
    finish.resolve(codes[0])
  })
  let timer
  try {
    await new Promise((resolve, reject) => {
      server.once('error', () => reject(Error('Could not start the Gmail authorization listener.')))
      server.listen(0, '127.0.0.1', () => resolve(undefined))
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw Error('Could not start the Gmail authorization listener.')
    const redirectUri = `http://127.0.0.1:${address.port}`
    timer = setTimeout(() => finish.reject(new GmailOAuthError('Gmail authorization timed out.')), timeoutMs)
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code',
      scope: GMAIL_READONLY_SCOPE, state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'consent', access_type: 'offline' }).toString()
    // Race browser startup against the same deadline as the callback.
    await Promise.race([Promise.resolve().then(() => openBrowser(url.href)), callback.then(() => undefined)])
    const code = await callback
    let response
    let token
    try {
      response = await fetchImpl(TOKEN_ENDPOINT, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId,
          client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code' }) })
      if (!response.ok) throw Error('provider')
      const reader = response.body?.getReader()
      if (!reader) throw Error('body')
      let size = 0
      const chunks = []
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.byteLength
          if (size > 32768) throw Error('limit')
          chunks.push(Buffer.from(value))
        }
      } finally { await reader.cancel().catch(() => {}) }
      token = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!token || typeof token !== 'object' || Array.isArray(token)) throw Error('schema')
    } catch { throw new GmailOAuthError('Gmail token exchange failed. Connect again.') }
    if (typeof token.refresh_token !== 'string' || !token.refresh_token
      || typeof token.scope !== 'string' || token.scope.trim() !== GMAIL_READONLY_SCOPE) {
      throw new GmailOAuthError('Gmail authorization did not grant the required read-only refresh token.')
    }
    return validateGmailCredentials({ schemaVersion: 1, clientId, clientSecret, refreshToken: token.refresh_token, scope: GMAIL_READONLY_SCOPE })
  } catch (error) {
    // Never forward browser, transport, or provider error strings that may contain credentials.
    if (error instanceof GmailOAuthError) throw error
    throw Error('Gmail authorization failed. Check the system browser and connect again.')
  } finally {
    clearTimeout(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(() => resolve(undefined)))
  }
}

/** Revoke the Google grant before removing private credentials. */
export async function revokeGmail(refreshToken, { fetch: fetchImpl = globalThis.fetch } = {}) {
  try {
    const response = await fetchImpl('https://oauth2.googleapis.com/revoke', { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }), signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw Error('provider')
  } catch { throw Error('Gmail revocation failed. Credentials were retained; try disconnect again.') }
}
