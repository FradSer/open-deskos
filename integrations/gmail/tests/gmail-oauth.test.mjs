import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { authorizeGmail, GMAIL_READONLY_SCOPE, parseDesktopClient, revokeGmail } from '../src/oauth.mjs'
const client = { clientId: 'example.apps.googleusercontent.com', clientSecret: 'private-client-secret' }
const tokenResponse = (overrides = {}) => new Response(JSON.stringify({ refresh_token: 'private-refresh', scope: GMAIL_READONLY_SCOPE, ...overrides }))
async function callback(url, params) {
  const destination = new URL(new URL(url).searchParams.get('redirect_uri'))
  destination.search = new URLSearchParams(params).toString()
  return fetch(destination)
}
const accept = async url => callback(url, { state: new URL(url).searchParams.get('state'), code: 'private-code' })

test('desktop login uses loopback state PKCE and only returns private refresh credentials', async () => {
  let authorization
  let redirect
  const credentials = await authorizeGmail({ ...client, timeoutMs: 1000,
    openBrowser: async url => {
      authorization = new URL(url)
      assert.equal(authorization.origin, 'https://accounts.google.com')
      assert.equal(authorization.searchParams.get('scope'), GMAIL_READONLY_SCOPE)
      assert.equal(authorization.searchParams.get('access_type'), 'offline')
      assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256')
      redirect = new URL(authorization.searchParams.get('redirect_uri'))
      assert.equal(redirect.hostname, '127.0.0.1')
      assert.ok(Number(redirect.port) > 0)
      assert.equal((await accept(url)).status, 200)
    }, fetch: async (url, request) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token')
      assert.equal(request.body.get('code'), 'private-code')
      assert.equal(createHash('sha256').update(request.body.get('code_verifier')).digest('base64url'), authorization.searchParams.get('code_challenge'))
      return tokenResponse({ access_token: 'must-not-persist' })
    } })
  assert.deepEqual(credentials, { schemaVersion: 1, ...client, refreshToken: 'private-refresh', scope: GMAIL_READONLY_SCOPE })
  await assert.rejects(fetch(redirect), /fetch failed/)
})

test('mismatched callback state cannot exchange tokens', async () => {
  let exchanged = false
  await assert.rejects(authorizeGmail({ ...client, timeoutMs: 1000,
    openBrowser: async url => { await callback(url, { state: 'wrong', code: 'sensitive' }) },
    fetch: async () => { exchanged = true; return tokenResponse() } }), /state did not match/)
  assert.equal(exchanged, false)
})

test('user denial never discloses provider error data', async () => {
  await assert.rejects(authorizeGmail({ ...client, timeoutMs: 1000,
    openBrowser: async url => { await callback(url, { state: new URL(url).searchParams.get('state'), error: 'access_denied-private-value' }) } }),
  error => error.message === 'Gmail authorization was denied or invalid.')
})

test('timeout closes listener even if browser startup never settles', async () => {
  let destination
  await assert.rejects(authorizeGmail({ ...client, timeoutMs: 30,
    openBrowser: url => { destination = new URL(url).searchParams.get('redirect_uri'); return new Promise(() => {}) } }), /timed out/)
  await assert.rejects(fetch(destination), /fetch failed/)
})

test('provider and browser exceptions cannot expose tokens', async () => {
  await assert.rejects(authorizeGmail({ ...client, timeoutMs: 1000,
    openBrowser: () => { throw Error('Gmail authorization private-refresh') } }), error => !error.message.includes('private-refresh'))
  await assert.rejects(authorizeGmail({ ...client, timeoutMs: 1000, openBrowser: accept,
    fetch: async () => { throw Error('private-refresh') } }), error => error.message === 'Gmail token exchange failed. Connect again.')
})

test('missing refresh token and broader scopes cannot become saved credentials', async () => {
  for (const overrides of [{ refresh_token: '' }, { scope: `${GMAIL_READONLY_SCOPE} https://mail.google.com/` }]) {
    await assert.rejects(authorizeGmail({ ...client, timeoutMs: 1000, openBrowser: accept,
      fetch: async () => tokenResponse(overrides) }), /required read-only refresh token/)
  }
})

test('only Google Desktop client exports are accepted', () => {
  assert.deepEqual(parseDesktopClient({ installed: { client_id: client.clientId, client_secret: client.clientSecret } }), client)
  assert.throws(() => parseDesktopClient({ web: { client_id: client.clientId } }), /Desktop app/)
})

test('revoke uses POST body and redacts errors', async () => {
  await revokeGmail('private-refresh', { fetch: async (url, request) => {
    assert.equal(url, 'https://oauth2.googleapis.com/revoke')
    assert.equal(request.method, 'POST')
    assert.equal(request.body.get('token'), 'private-refresh')
    return new Response('')
  } })
  await assert.rejects(revokeGmail('private-refresh', { fetch: async () => { throw Error('private-refresh') } }),
    error => error.message === 'Gmail revocation failed. Credentials were retained; try disconnect again.')
})


test('oversized token JSON and unsafe returned token values are rejected', async () => {
  for (const response of [new Response('x'.repeat(32769)), tokenResponse({ refresh_token: 'bad token' }), new Response('null')]) {
    await assert.rejects(authorizeGmail({ ...client, timeoutMs: 1000, openBrowser: accept, fetch: async () => response }), /Gmail (token exchange|authorization)/)
  }
})

import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runGmailCli } from '../src/cli.mjs'

async function cliFixture(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'gmail-oauth-cli-')))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const clientPath = join(directory, 'client.json')
  const credentialsPath = join(directory, 'grant.json')
  await writeFile(clientPath, JSON.stringify({ installed: { client_id: client.clientId, client_secret: client.clientSecret } }))
  return { directory, clientPath, credentialsPath }
}

test('CLI refuses existing credentials before authorization', async t => {
  const { credentialsPath, clientPath } = await cliFixture(t)
  await writeFile(credentialsPath, 'existing')
  let authorized = false
  await assert.rejects(runGmailCli(['login', '--client', clientPath, '--credentials', credentialsPath], {
    authorize: async () => { authorized = true }, output: () => {}
  }), /already exist/)
  assert.equal(authorized, false)
})

test('CLI validates private destination before opening browser and never outputs tokens', async t => {
  const { credentialsPath, clientPath } = await cliFixture(t)
  const steps = []
  const output = []
  await runGmailCli(['login', '--client', clientPath, '--credentials', credentialsPath], {
    prepareDestination: path => { assert.equal(path, credentialsPath); steps.push('validate') },
    authorize: async value => { assert.deepEqual(value, client); steps.push('authorize'); return { secret: 'private-refresh' } },
    writeCredentials: (path, value) => { assert.equal(path, credentialsPath); assert.equal(value.secret, 'private-refresh'); steps.push('write') },
    output: text => output.push(text)
  })
  assert.deepEqual(steps, ['validate', 'authorize', 'write'])
  assert.equal(output.join('').includes('private-refresh'), false)
})

test('CLI destination rejection prevents browser authorization', async t => {
  const { credentialsPath, clientPath } = await cliFixture(t)
  let authorized = false
  await assert.rejects(runGmailCli(['login', '--client', clientPath, '--credentials', credentialsPath], {
    prepareDestination: () => { throw Error('unsafe destination') }, authorize: async () => { authorized = true }, output: () => {}
  }), /unsafe destination/)
  assert.equal(authorized, false)
})

test('CLI revocation failure retains credentials; success revokes before removal', async t => {
  const { credentialsPath } = await cliFixture(t)
  let removed = false
  const base = { readCredentials: () => ({ refreshToken: 'private-refresh' }), output: () => {},
    removeCredentials: () => { removed = true } }
  await assert.rejects(runGmailCli(['disconnect', '--credentials', credentialsPath], { ...base,
    revoke: async () => { throw Error('revocation failed') } }), /revocation failed/)
  assert.equal(removed, false)
  const steps = []
  await runGmailCli(['disconnect', '--credentials', credentialsPath], { ...base,
    revoke: async token => { assert.equal(token, 'private-refresh'); steps.push('revoke') },
    removeCredentials: (path, grant) => { assert.equal(path, credentialsPath); assert.deepEqual(grant, { refreshToken: 'private-refresh' }); steps.push('remove') } })
  assert.deepEqual(steps, ['revoke', 'remove'])
})

test('CLI login writes a validated private grant and local status remains explicit', async t => {
  const { credentialsPath, clientPath } = await cliFixture(t)
  const output = []
  const grant = { schemaVersion: 1, ...client, refreshToken: 'private-refresh', scope: GMAIL_READONLY_SCOPE }
  await runGmailCli(['login', '--client', clientPath, '--credentials', credentialsPath], {
    authorize: async () => grant, output: text => output.push(text)
  })
  await runGmailCli(['status', '--credentials', credentialsPath], { output: text => output.push(text) })
  assert.deepEqual(output, ['Gmail connected with read-only access.', 'Gmail credentials configured. Online access has not been checked.'])
  const { readGmailCredentials } = await import('../src/credentials.mjs')
  assert.deepEqual(readGmailCredentials(credentialsPath), grant)
})

test('CLI forget removes only its credential snapshot without claiming Google revocation', async t => {
  const { credentialsPath } = await cliFixture(t)
  const grant = { schemaVersion: 1, ...client, refreshToken: 'private-refresh', scope: GMAIL_READONLY_SCOPE }
  const output = []
  let removed = false
  await runGmailCli(['forget', '--credentials', credentialsPath], {
    readCredentials: () => grant,
    revoke: async () => { assert.fail('forget must never contact Google') },
    removeCredentials: (path, expected) => { assert.equal(path, credentialsPath); assert.equal(expected, grant); removed = true },
    output: text => output.push(text)
  })
  assert.equal(removed, true)
  assert.deepEqual(output, ['Local Gmail credentials removed. Google grant revocation has not been confirmed.'])
})

test('CLI permits a new login after forgetting local credentials', async t => {
  const { credentialsPath, clientPath } = await cliFixture(t)
  const grant = { schemaVersion: 1, ...client, refreshToken: 'private-refresh', scope: GMAIL_READONLY_SCOPE }
  const options = { authorize: async () => grant, output: () => {},
    revoke: async () => { assert.fail('forget must never contact Google') } }
  await runGmailCli(['login', '--client', clientPath, '--credentials', credentialsPath], options)
  await runGmailCli(['forget', '--credentials', credentialsPath], options)
  await runGmailCli(['login', '--client', clientPath, '--credentials', credentialsPath], options)
})
