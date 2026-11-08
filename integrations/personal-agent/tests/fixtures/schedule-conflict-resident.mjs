// Child fixture. The provider HTTP boundary is synthetic; the MCP server and resident are real.
import assert from 'node:assert/strict'
import { access, cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { mock } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { PersonalAgentService } from '../../src/service.mjs'
import { ProactiveWatch } from '../../src/recommendations/index.mjs'
import { defaultProactiveConfig } from '../../src/recommendations/index.mjs'
import { proposalStateStore } from '../../src/recommendations/index.mjs'
import { createConfiguredScheduleConflict } from '../../src/recommendations/index.mjs'
import { listen } from '../../src/socket.mjs'

const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-schedule-e2e-')))
const socketPath = join(directory, 'agent.sock')
const token = 'synthetic-schedule-fixture-channel-token'
const readingId = 'calendar.fixture'
const gmailAccount = 'owner@example.test'
const organizer = 'host@example.test'
const uid = 'test-meeting@example.test'
const marker = 'UNTRUSTED_MAIL_DO_NOT_PROJECT'
const start = Math.floor(Date.now() / 1000) * 1000
const minute = 60000
const iso = milliseconds => new Date(milliseconds).toISOString()
const stamp = milliseconds => iso(milliseconds).replace(/[-:]/g, '').replace('.000Z', 'Z')
const messages = new Map()
const phases = {
  revised: { id: 'bb2233', sequence: 2, offset: 30 },
  cancelled: { id: 'cc3344', sequence: 3, method: 'CANCEL' },
  expiring: { id: 'dd4455', sequence: 4, offset: 2 },
}
const send = value => process.stdout.write(JSON.stringify(value) + '\n')
let forbiddenCalls = 0
const forbidden = async () => {
  forbiddenCalls++
  assert.fail('The schedule fixture forbids models, owner turns, recording and execution')
}
const checkpoint = proposalStateStore(join(directory, 'checkpoint', 'proposals.json'))
let server, service, watch, providerFailure, gmailReads = 0, calendarReads = 0, providerAccount = gmailAccount

function addMessage({ id, sequence, offset, method = 'REQUEST' }) {
  assert(!messages.has(id), 'Fixture phase may run only once')
  const arrival = Date.now()
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'METHOD:' + method, 'BEGIN:VEVENT', 'UID:' + uid, 'ORGANIZER:mailto:' + organizer,
    'SEQUENCE:' + sequence]
  if (method === 'REQUEST') lines.push('DTSTART:' + stamp(arrival + offset * minute), 'DTEND:' + stamp(arrival + (offset + 15) * minute))
  lines.push('SUMMARY:' + marker, 'DESCRIPTION:' + marker, 'END:VEVENT', 'END:VCALENDAR')
  messages.set(id, { history: String(100 + sequence), message: { id, labelIds: ['INBOX'], internalDate: String(arrival), payload: {
    mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: Buffer.from(marker).toString('base64url') } },
      { mimeType: 'text/calendar', body: { data: Buffer.from(lines.join('\r\n')).toString('base64url') } },
    ],
  } } })
}

async function fakeGmail(input, options) {
  try {
    const url = new URL(input)
    if (url.href === 'https://oauth2.googleapis.com/token') {
      assert.equal(options.method, 'POST')
      assert.equal(options.body.get('refresh_token'), 'fixture-refresh-token')
      return Response.json({ access_token: 'fixture-gmail-token', token_type: 'Bearer', expires_in: 3600 })
    }
    assert.equal(url.origin, 'https://gmail.googleapis.com')
    assert.equal(options.method, 'GET')
    assert.equal(options.headers.Authorization, 'Bearer fixture-gmail-token')
    const prefix = '/gmail/v1/users/me/'
    assert(url.pathname.startsWith(prefix))
    const route = url.pathname.slice(prefix.length)
    const historyId = [...messages.values()].at(-1).history
    if (route === 'profile') return Response.json({ emailAddress: providerAccount, historyId })
    if (route === 'messages') {
      gmailReads++
      assert.match(url.searchParams.get('q'), /^after:\d+ filename:ics$/)
      return Response.json({ messages: [...messages.keys()].map(id => ({ id })) })
    }
    if (route === 'history') {
      gmailReads++
      const after = Number(url.searchParams.get('startHistoryId'))
      assert(after >= 101 && after <= Number(historyId), 'Restart must use the saved history cursor')
      return Response.json({ historyId, history: [...messages.values()].filter(entry => Number(entry.history) > after)
        .map(({ history, message }) => ({ id: history, messagesAdded: [{ message: { id: message.id } }] })) })
    }
    const message = messages.get(route.split('/')[1])?.message
    assert(route.startsWith('messages/') && message, 'Unexpected Gmail fixture route')
    assert.equal(url.searchParams.get('format'), 'full')
    return Response.json(message)
  } catch (error) {
    providerFailure = error
    throw error
  }
}

const config = grant => ({ version: 1, sources: [], ...(grant ? { scheduleConflict: { gmailAccount, calendarReadingId: readingId, timeZone: 'UTC' } } : {}) })
const catalog = { package: async () => ({ revision: 'a'.repeat(64), snapshot: {
  schemaVersion: 1, kind: 'mcp', id: 'gmail', name: 'Gmail',
  policy: { privateData: true, ownerOnly: true }, transport: { type: 'stdio', command: process.execPath, args: [] },
} }) }

async function openSession(createGmailServer, credentialsFile) {
  const runtime = createGmailServer({ credentialsFile, fetchImpl: fakeGmail })
  const client = new Client({ name: 'odk-joined-fixture', version: '1' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await runtime.server.connect(serverTransport)
  try { await client.connect(clientTransport) } catch (error) { await runtime.close(); throw error }
  return {
    tools: async signal => (await client.listTools({}, { signal })).tools,
    call: (name, args, signal) => client.callTool({ name, arguments: args }, undefined, { signal }),
    async close() { await client.close(); await runtime.close() },
  }
}

function assertBoundaries() {
  if (providerFailure) throw providerFailure
  assert.equal(forbiddenCalls, 0)
  assert(!JSON.stringify(service.status).includes(marker), 'Private mail text entered the resident status')
}

async function boot(grant, createGmailServer, credentialsFile) {
  const scheduleConflict = createConfiguredScheduleConflict({ config: config(grant), catalog,
    openSession: () => openSession(createGmailServer, credentialsFile) })
  service = new PersonalAgentService({ record: forbidden, transcribe: forbidden, prompt: forbidden })
  watch = new ProactiveWatch({
    config: defaultProactiveConfig(), scheduleConflict, now: Date.now, loadState: checkpoint.load, saveState: checkpoint.save,
    generate: forbidden, execute: forbidden,
    read: async id => {
      assert.equal(id, readingId)
      calendarReads++
      return { id, kind: 'service', state: 'live', value: { asOf: iso(Date.now()), coverageStart: iso(start - 60 * minute),
        coverageEnd: iso(start + 180 * minute), events: [
          { uid, organizer, sequence: 0, startsAt: iso(start - 30 * minute), endsAt: iso(start - 15 * minute), busy: true },
          { uid: 'busy', organizer, sequence: 0, startsAt: iso(start + minute), endsAt: iso(start + 120 * minute), busy: true },
        ] } }
    },
    publish: frame => service.propose(frame),
  })
  service.attachWatch(watch)
  server = await listen(socketPath, service, { token })
  watch.start()
  await watch.inflight
}

async function stop() {
  await server?.close()
  await watch?.close()
  server = undefined
  watch = undefined
}

try {
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: start })
  const source = new URL('../../../gmail/src/', import.meta.url)
  let gmail = source
  try { await access(new URL('../node_modules/@modelcontextprotocol/sdk/package.json', source)) } catch {
    // Mount unchanged Gmail source with the resident SDK when Gmail dependencies are absent.
    await cp(fileURLToPath(source), join(directory, 'gmail'), { recursive: true })
    await symlink(fileURLToPath(new URL('../../node_modules', import.meta.url)), join(directory, 'node_modules'), 'dir')
    gmail = pathToFileURL(join(directory, 'gmail') + '/')
  }
  const { createGmailServer } = await import(new URL('server.mjs', gmail).href)
  const { writeGmailCredentials, GMAIL_SCOPE } = await import(new URL('credentials.mjs', gmail).href)
  const credentialsFile = join(directory, 'gmail-grant.json')
  writeGmailCredentials(credentialsFile, { schemaVersion: 1, clientId: 'test.apps.googleusercontent.com', clientSecret: 'fixture-secret',
    refreshToken: 'fixture-refresh-token', scope: GMAIL_SCOPE })
  addMessage({ id: 'aa1122', sequence: 1, offset: 20 })
  await boot(true, createGmailServer, credentialsFile)
  assert.equal(watch.proposals.filter(p => p.status === 'pending').length, 1)
  assertBoundaries()
  send({ type: 'ready', socketPath, token })
  for await (const line of createInterface({ input: process.stdin })) {
    const { requestId, type, phase, grant = true, ms, account } = JSON.parse(line)
    try {
      if (type === 'tick') {
        if (phase) {
          assert(Object.hasOwn(phases, phase), 'Unknown fixture phase')
          addMessage(phases[phase])
        }
        await watch.tick()
      } else if (type === 'advance') {
        assert(Number.isSafeInteger(ms) && ms >= 0 && ms <= 120000)
        mock.timers.tick(ms)
        await watch.inflight
      } else if (type === 'restart') {
        providerAccount = account === 'wrong' ? 'wrong@example.test' : gmailAccount
        await stop()
        await boot(grant, createGmailServer, credentialsFile)
      } else assert(type === 'status' || type === 'shutdown', 'Unknown fixture command')
      assertBoundaries()
      send({ requestId, ok: true, gmailReads, calendarReads,
        proposals: service.status.proposals?.map(({ id, status, offered, presented, sources }) => ({ id, status, offered, presented, sources })) ?? [] })
      if (type === 'shutdown') break
    } catch (error) {
      send({ requestId, ok: false, error: error.message })
    }
  }
} finally {
  await stop()
  mock.timers.reset()
  await rm(directory, { recursive: true, force: true })
}
