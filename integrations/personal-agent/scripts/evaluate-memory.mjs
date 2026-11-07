import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { createMemoryIndex } from '../src/memory-retrieval.mjs'

const mean = values => values.reduce((sum, value) => sum + value, 0) / (values.length || 1)
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0
const digest = value => createHash('sha256').update(value).digest('hex')

/** Evaluate the production retrieval kernel on published, timestamped sessions.
 * This adapter never imports transcripts into private notes or learned experience.
 * @param {any[]} dataset
 * @param {{topK?: number}} [options]
 */
export function evaluateMemoryRetrieval(dataset, { topK = 5 } = {}) {
  if (!Array.isArray(dataset) || !dataset.length || dataset.length > 5000 || !Number.isInteger(topK) || topK < 1 || topK > 32) throw Error('Invalid memory evaluation input')
  const rows = [], skipped = [], seen = new Set()
  for (const item of dataset) {
    if (typeof item.question_id !== 'string' || seen.has(item.question_id) || typeof item.question !== 'string' || !item.question.trim()
      || !Array.isArray(item.haystack_sessions) || !Array.isArray(item.haystack_session_ids) || !Array.isArray(item.haystack_dates)
      || item.haystack_sessions.length !== item.haystack_session_ids.length || item.haystack_sessions.length !== item.haystack_dates.length
      || !Array.isArray(item.answer_session_ids) || typeof item.question_type !== 'string') throw Error('Invalid memory evaluation record')
    seen.add(item.question_id)
    if (item.question_id.endsWith('_abs')) { skipped.push({ id: item.question_id, reason: 'abstention_requires_answer_evaluation' }); continue }
    const gold = new Set(item.answer_session_ids)
    if (!gold.size || [...gold].some(id => !item.haystack_session_ids.includes(id))) throw Error('Invalid memory evaluation evidence')
    // Exclude question answers, evidence ids, and has_answer labels from the index.
    const entries = item.haystack_sessions.map((session, index) => {
      if (!Array.isArray(session) || session.some(turn => typeof turn.content !== 'string' || !['user', 'assistant'].includes(turn.role))) throw Error('Invalid memory evaluation session')
      return { id: item.haystack_session_ids[index], title: String(item.haystack_dates[index]),
        body: session.map(turn => `${turn.role}: ${turn.content}`).join('\n') }
    })
    const started = performance.now(), index = createMemoryIndex(entries), built = performance.now()
    const ranked = index.search(item.question), searched = performance.now()
    const measure = records => {
      const selected = records.slice(0, topK), ids = selected.map(entry => entry.id)
      const hits = new Set(ids.filter(id => gold.has(id))).size, rank = ids.findIndex(id => gold.has(id))
      return { recall: hits / gold.size, allEvidence: Number(hits === gold.size), hit: Number(hits > 0), reciprocalRank: rank < 0 ? 0 : 1 / (rank + 1),
        contextBytes: selected.reduce((sum, entry) => sum + Buffer.byteLength(`${entry.title}\n${entry.body}`), 0) }
    }
    rows.push({ id: item.question_id, type: item.question_type, sessions: entries.length, duplicateSourceIds: entries.length - new Set(entries.map(entry => entry.id)).size, evidenceSessions: gold.size,
      indexMs: built - started, searchMs: searched - built,
      ranked: measure(ranked), first: measure(entries), recent: measure([...entries].reverse()),
      substring: measure(entries.filter(entry => `${entry.title}\n${entry.body}`.toLowerCase().includes(item.question.toLowerCase()))) })
  }
  function aggregate(group) {
    return { cases: group.length, arms: Object.fromEntries(['ranked', 'first', 'recent', 'substring'].map(arm => [arm,
      Object.fromEntries(['recall', 'allEvidence', 'hit', 'reciprocalRank', 'contextBytes'].map(metric => [metric, mean(group.map(row => row[arm][metric]))]))])) }
  }
  return { version: 1, scope: 'retrieval_kernel_only', topK, ...aggregate(rows), skipped,
    byType: Object.fromEntries([...new Set(rows.map(row => row.type))].sort().map(type => [type, aggregate(rows.filter(row => row.type === type))])),
    latencyMs: { indexP50: percentile(rows.map(row => row.indexMs), 0.5), indexP95: percentile(rows.map(row => row.indexMs), 0.95),
      searchP50: percentile(rows.map(row => row.searchMs), 0.5), searchP95: percentile(rows.map(row => row.searchMs), 0.95) }, rows }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { dataset: { type: 'string' }, output: { type: 'string' }, 'top-k': { type: 'string', default: '5' } } })
  if (!values.dataset || !values.output) throw Error('Usage: test:memory:evaluate --dataset=PATH --output=NEW_PATH [--top-k=5]')
  const input = await readFile(resolve(values.dataset))
  if (input.length > 512 * 1024 * 1024) throw Error('Memory evaluation corpus is too large')
  const report = evaluateMemoryRetrieval(JSON.parse(input.toString('utf8')), { topK: Number(values['top-k']) })
  report['provenance'] = { datasetSha256: digest(input), runnerSha256: digest(await readFile(new URL(import.meta.url))),
    retrievalSha256: digest(await readFile(new URL('../src/memory-retrieval.mjs', import.meta.url))), node: process.version,
    datasetSource: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned', generatedAt: new Date().toISOString() }
  await writeFile(resolve(values.output), JSON.stringify(report, null, 2), { mode: 0o600, flag: 'wx' })
  const { rows: _rows, skipped, ...summary } = report
  console.log(JSON.stringify({ ...summary, skipped: skipped.length }))
}
