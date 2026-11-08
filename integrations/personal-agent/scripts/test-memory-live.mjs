import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { createHistoryEvidence } from '../src/history-evidence.mjs'
import { createMem0Backend } from '../src/mem0.mjs'
import { createMemoryStore } from '../src/memory.mjs'
import { readProactiveFile } from '../src/proactive-private.mjs'
import { createCurlCompletion } from './history-eval-curl.mjs'

const { values } = parseArgs({ options: {
  dataset: { type: 'string' }, question: { type: 'string' }, 'bm25-cache': { type: 'string' },
  'answer-url': { type: 'string' }, 'answer-model': { type: 'string' },
} })
if (!values.dataset || !values.question || Boolean(values['answer-url']) !== Boolean(values['answer-model'])) {
  throw Error('Select a public LongMemEval dataset and question ID. Select both answer parameters to test generation.')
}
const input = JSON.parse(await readFile(values.dataset, 'utf8'))
const row = input.find(row => row.question_id === values.question)
assert(row, 'Unknown benchmark question')
const config = JSON.parse(readProactiveFile(process.env.ODK_PERSONAL_AGENT_MEM0_CONFIG, 32768))
config.vector_store = {
  provider: 'qdrant',
  config: { collection_name: 'odk_mem0_acceptance', embedding_model_dims: config.vector_store.config.embedding_model_dims },
}
const stateDir = await realpath(await mkdtemp(join(tmpdir(), 'odk-mem0-acceptance-')))
const configFile = join(stateDir, 'mem0.json')
let backend
const launch = () => createMem0Backend({ stateDir, env: { ...process.env, ODK_PERSONAL_AGENT_MEM0_CONFIG: configFile } })
try {
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 })
  if (values['bm25-cache']) {
    await mkdir(join(stateDir, 'personal-agent', 'mem0'), { recursive: true, mode: 0o700 })
    await cp(values['bm25-cache'], join(stateDir, 'personal-agent', 'mem0', 'embedding-cache'), { recursive: true })
  }
  const legacyFile = join(stateDir, 'legacy.json')
  const original = JSON.stringify({ drink: 'oolong tea after lunch' })
  await writeFile(legacyFile, original, { mode: 0o600 })
  backend = launch()
  const notesFor = () => createMemoryStore({ scope: backend.scope(stateDir, 'notes'), stateDir, legacyFile })
  const notes = notesFor()
  assert.equal(await notes.read(), original)
  assert.equal((await notes.search('what tea after lunch?')).entries[0].value, 'oolong tea after lunch')
  notes.beginTurn('remember drink: water after lunch')
  await notes.update({ category: 'drink', value: 'water after lunch' })
  notes.beginTurn('forget drink')
  await notes.forget({ category: 'drink' })
  await backend.close()
  backend = launch()
  assert.equal(await notesFor().read(), '{}')
  assert.equal(await readFile(legacyFile, 'utf8'), original)
  console.log(JSON.stringify({ notes: 'native migration, search, update, delete and restart passed' }))

  const history = backend.scope(stateDir, 'public-history')
  const order = row.haystack_dates.map((raw, index) => {
    const parts = /^(\d{4})\/(\d{2})\/(\d{2}) \(\w{3}\) (\d{2}):(\d{2})$/.exec(raw)
    assert(parts, 'Unknown benchmark date format')
    return { index, date: `${parts[1]}-${parts[2]}-${parts[3]}T${parts[4]}:${parts[5]}:00Z` }
  }).sort((a, b) => a.date.localeCompare(b.date))
  let facts = 0
  for (const [ordinal, { index, date }] of order.entries()) {
    const messages = row.haystack_sessions[index].map(({ role, content }) => ({ role, content }))
    const result = await history.ingest(String(index + 1), messages, { created_at: date },
      `The messages were recorded at ${date}. Use this as their observation date. Preserve distinct events, completed actions, plans, and estimates.`)
    facts += result.length
    if ((ordinal + 1) % 10 === 0 || ordinal + 1 === order.length) console.log(JSON.stringify({ indexed: ordinal + 1, total: order.length, facts }))
  }
  const started = performance.now()
  const { preview } = await createHistoryEvidence(history, row.question)
  const retrievalMs = performance.now() - started
  const selected = new Set(preview.map(hit => row.haystack_session_ids[Number(hit.source) - 1]))
  const goldSources = new Set(row.answer_session_ids)
  assert(facts > 0 && preview.length > 0)
  const output = {
    questionId: row.question_id, sessions: order.length, facts, recalled: preview.length, retrievalMs,
    referenceSources: goldSources.size, recalledReferenceSources: [...goldSources].filter(id => selected.has(id)).length,
  }
  if (values['answer-url']) {
    const complete = createCurlCompletion(values['answer-url'], 45000)
    const result = await complete({ id: values['answer-model'] }, {
      systemPrompt: 'Use the dated memories as evidence. Verify that each value belongs to the requested event. Keep completed trips separate from estimates and plans. If evidence is insufficient, say you do not know. Answer concisely.',
      messages: [{ role: 'user', content: JSON.stringify({ question: row.question, questionDate: row.question_date, evidence: preview }) }],
    }, { maxTokens: 1536, signal: AbortSignal.timeout(45000) })
    output.answer = result.content.filter(part => part.type === 'text').map(part => part.text).join('')
    output.model = result.model
    output.reference = row.answer
    output.answerMs = performance.now() - started
  }
  console.log(JSON.stringify(output))
} finally {
  try { await backend?.close() } finally { await rm(stateDir, { recursive: true, force: true }) }
}
