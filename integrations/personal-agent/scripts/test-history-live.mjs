import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { ModelRuntime } from '@earendil-works/pi-coding-agent'
import * as history from '../src/history-evidence.mjs'
import { createCurlCompletion } from './history-eval-curl.mjs'

const { HISTORY_EVIDENCE_BYTES, historyExcerpt, historyPage, rankHistory } = history

const { values } = parseArgs({ options: {
  live: { type: 'boolean' }, dataset: { type: 'string' }, 'judge-source': { type: 'string' }, output: { type: 'string' },
  provider: { type: 'string' }, model: { type: 'string' }, 'judge-provider': { type: 'string' }, 'judge-model': { type: 'string' },
  'curl-url': { type: 'string' }, 'reference-history': { type: 'string' },
  limit: { type: 'string' }, concurrency: { type: 'string' }, resume: { type: 'boolean' },
} })
const referenceUrl = values['reference-history'] ? pathToFileURL(resolve(values['reference-history'])) : undefined
const curlUrl = values['curl-url']
const protocol = { scope: 'longmemeval_s_history_ab', expectedQuestions: 500, evidenceBytesPerArm: HISTORY_EVIDENCE_BYTES,
  requestContextBytes: 48 * 1024, baselineMaxRequests: referenceUrl ? 3 : 1, adaptiveMaxRequests: 3, judgeRequestsPerQuestion: 2,
  answerOutputTokens: 1536, judgeOutputTokens: 64, timeoutMs: 45000, transientRetriesPerRequest: 1,
  finalAnswerContext: 'consolidated_exact_evidence' }
if (!values.live) { console.log(JSON.stringify(protocol)); process.exit(0) }
if (!values.dataset || !values['judge-source'] || !values.output || !values.model || Boolean(curlUrl) === Boolean(values.provider)) {
  throw Error('Specify --live --dataset=PUBLIC_CLEANED_S --judge-source=UPSTREAM_EVALUATE_QA --output=PRIVATE_JSONL --model=ID and either --provider=NAME or --curl-url=URL')
}
if (curlUrl && values['judge-provider']) throw Error('The curl judge uses the supplied Chat Completions URL')
const limit = Number(values.limit ?? protocol.expectedQuestions), concurrency = Number(values.concurrency ?? 8)
if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 24) throw Error('Invalid evaluation limits')
const sha = bytes => createHash('sha256').update(bytes).digest('hex')
const jsonBytes = value => Buffer.byteLength(JSON.stringify(value))
const output = resolve(values.output)
const [corpus, judgeSource, runner, feature, kernel, referenceFeature, referenceKernel, curlSource] = await Promise.all([
  readFile(resolve(values.dataset)), readFile(resolve(values['judge-source'])), readFile(new URL(import.meta.url)),
  readFile(new URL('../src/history-evidence.mjs', import.meta.url)), readFile(new URL('../src/memory-retrieval.mjs', import.meta.url)),
  referenceUrl && readFile(referenceUrl), referenceUrl && readFile(new URL('./memory-retrieval.mjs', referenceUrl)),
  curlUrl && readFile(new URL('./history-eval-curl.mjs', import.meta.url)),
])
const reference = referenceUrl && await import(referenceUrl.href)
if (reference && reference.HISTORY_EVIDENCE_BYTES !== HISTORY_EVIDENCE_BYTES) throw Error('Reference history uses a different evidence budget')
const dataset = JSON.parse(corpus.toString('utf8'))
if (dataset.length !== protocol.expectedQuestions || new Set(dataset.map(row => row.question_id)).size !== dataset.length
  || dataset.filter(row => row.question_id.endsWith('_abs')).length !== 30) throw Error('Expected 500 unique LongMemEval-S questions, including 30 abstentions')

// Parse upstream literals as data. The evaluator does not execute downloaded code.
const judgeFunction = judgeSource.toString('utf8').split('def get_anscheck_prompt(')[1]?.split('if __name__')[0] ?? ''
const templates = [...judgeFunction.matchAll(/^[ \t]+template = ("(?:[^"\\]|\\.)*")[ \t]*$/gm)].map(match => JSON.parse(match[1]))
if (templates.length !== 5 || templates.some(template => template.split('{}').length !== 4)) throw Error('Unexpected upstream judging templates')
const judgePrompt = (row, answer) => {
  const index = row.question_id.endsWith('_abs') ? 4
    : ({ 'temporal-reasoning': 1, 'knowledge-update': 2, 'single-session-preference': 3 }[row.question_type] ?? 0)
  const fields = [row.question, row.answer, answer]
  let field = 0
  return templates[index].replace(/\{\}/g, () => String(fields[field++]))
}

async function piCompletion() {
  const entry = import.meta.resolve('@earendil-works/pi-coding-agent')
  const { InMemoryCodingAgentModelsStore } = await import(new URL('./core/models-store.js', entry))
  const runtime = await ModelRuntime.create({ modelsPath: join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent'), 'models.json'),
    modelsStore: new InMemoryCodingAgentModelsStore(), refreshOnCreate: false, allowModelNetwork: false })
  const answerModel = runtime.getModel(values.provider, values.model)
  const judgeModel = runtime.getModel(values['judge-provider'] ?? values.provider, values['judge-model'] ?? values.model)
  if (!answerModel || !judgeModel || !(await runtime.getAuth(answerModel)) || !(await runtime.getAuth(judgeModel))) throw Error('Configured answer or judge model unavailable')
  return { answerModel, judgeModel, complete: runtime.completeSimple.bind(runtime) }
}

const { answerModel, judgeModel, complete } = curlUrl ? {
  answerModel: { provider: 'curl-chat', id: values.model },
  judgeModel: { provider: 'curl-chat', id: values['judge-model'] ?? values.model },
  complete: createCurlCompletion(curlUrl, protocol.timeoutMs),
} : await piCompletion()

const manifest = { kind: 'protocol', ...protocol,
  datasetSha256: sha(corpus), judgeSourceSha256: sha(judgeSource), runnerSha256: sha(runner), historySha256: sha(feature), retrievalSha256: sha(kernel),
  ...(reference ? { referenceHistorySha256: sha(referenceFeature), referenceRetrievalSha256: sha(referenceKernel) } : {}),
  ...(curlUrl ? { curlSourceSha256: sha(curlSource), endpointSha256: sha(curlUrl) } : {}),
  answerModel: [answerModel.provider, answerModel.id], judgeModel: [judgeModel.provider, judgeModel.id],
}
const receipts = new Map()
const errorHistory = {}
const receiptKey = row => [row.questionId, row.arm, row.kind].join(':')
function recordReceipt(row) {
  const key = receiptKey(row)
  if (!['answer', 'grade'].includes(row.kind) || (receipts.has(key) && !receipts.get(key).error)) throw Error('Invalid or duplicate evaluation receipt')
  if (row.error) errorHistory[row.error] = (errorHistory[row.error] ?? 0) + 1
  receipts.set(key, row)
}
if (values.resume) {
  const [first, ...lines] = (await readFile(output, 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line))
  if (JSON.stringify(first) !== JSON.stringify(manifest)) throw Error('Evaluation protocol changed. Use a new output file.')
  for (const row of lines) recordReceipt(row)
} else await writeFile(output, JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 })

let writes = Promise.resolve(), calls = 0, failures = 0
let completed = 0, inFlight = 0, failStop = false, consecutiveFailures = 0, retryAfter = 0
const controller = new AbortController()
const cancel = () => controller.abort()
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)

async function persist(receipt) {
  writes = writes.then(() => appendFile(output, JSON.stringify(receipt) + '\n'))
  await writes
  recordReceipt(receipt)
  consecutiveFailures = receipt.error ? consecutiveFailures + 1 : 0
  if (consecutiveFailures >= 8 || ['authorization', 'model_or_endpoint_unavailable', 'curl_unavailable'].includes(receipt.error)) failStop = true
}
const get = (questionId, arm, kind) => receipts.get(receiptKey({ questionId, arm, kind }))
const resultText = message => message.content.filter(part => part.type === 'text').map(part => part.text).join('').trim()
const newUsage = () => ({ requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, toolCalls: 0, toolRounds: 0, wallMs: 0, maximumContextBytes: 0, servedModels: [] })
function failureCode(error) {
  const reason = String(error?.message ?? error)
  if (controller.signal.aborted) return 'aborted'
  if (/rate limit|429/i.test(reason)) return 'rate_limit'
  if (/timeout|timed out|aborted due to timeout/i.test(reason)) return 'timeout'
  if (/401|403|unauthoriz|invalid api key/i.test(reason)) return 'authorization'
  if (/\b404\b/.test(reason)) return 'model_or_endpoint_unavailable'
  if (/temporary transport|connection reset|\b(?:500|502|503|504|ECONNRESET|EAI_AGAIN|EOF)\b/i.test(reason)) return 'temporary_transport'
  if (/^evaluation:/.test(reason)) return reason.slice('evaluation:'.length)
  return 'provider_or_transport'
}

async function providerRequest(model, context, maxTokens, usage) {
  controller.signal.throwIfAborted()
  const bytes = jsonBytes(context)
  if (bytes > protocol.requestContextBytes) throw Error('evaluation:context_limit')
  usage.maximumContextBytes = Math.max(usage.maximumContextBytes, bytes)
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(protocol.timeoutMs)])
  const start = performance.now()
  usage.requests++; calls++; inFlight++
  try {
    const message = await complete(model, context, { maxTokens, maxRetries: 0, reasoning: 'off', temperature: 0, signal })
    for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) usage[key] += message.usage?.[key] ?? 0
    if (message.model && !usage.servedModels.includes(message.model)) usage.servedModels.push(message.model)
    if (['error', 'aborted'].includes(message.stopReason)) {
      signal.throwIfAborted()
      throw Error(message.errorMessage || 'Provider did not return a response')
    }
    if (message.stopReason === 'length') throw Error('evaluation:truncated_response')
    return message
  } catch (error) {
    signal.throwIfAborted()
    throw error
  } finally {
    inFlight--
    usage.wallMs += performance.now() - start
  }
}

async function request(model, context, maxTokens, usage) {
  for (let attempt = 0; ; attempt++) {
    while (Date.now() < retryAfter) await delay(retryAfter - Date.now(), undefined, { signal: controller.signal })
    try { return await providerRequest(model, context, maxTokens, usage) }
    catch (error) {
      const cooldown = { rate_limit: 15000, timeout: 1500, temporary_transport: 5000 }[failureCode(error)]
      if (!cooldown) throw error
      retryAfter = Math.max(retryAfter, Date.now() + cooldown)
      if (attempt >= protocol.transientRetriesPerRequest) throw error
    }
  }
}

function evidenceSources(row) {
  return row.haystack_sessions.map((session, i) => ({
    // Upstream IDs can contain answer markers. Use the same neutral labels in both arms.
    id: String(i + 1), conversationId: 'conversation-' + (i + 1), date: row.haystack_dates[i],
    body: session.map(({ role, content }) => role + ': ' + content).join('\n'),
  }))
}

function baselineContext(sources, query) {
  const ranked = rankHistory(sources).search(query).slice(0, 10)
  if (!ranked.length) return []
  const perSource = Math.floor((HISTORY_EVIDENCE_BYTES - ranked.length - 2) / ranked.length)
  return ranked.map(item => {
    const match = historyExcerpt(item, query)
    // Include the strongest passage and nearby original text from each source.
    const header = { conversationId: item.conversationId, date: item.date, offset: match.offset }
    let available = perSource - jsonBytes(header) - 36
    let page = historyPage(item.body, match.offset, available)
    while (jsonBytes({ ...header, ...page }) > perSource) {
      available = Math.floor(available * 0.8)
      page = historyPage(item.body, match.offset, available)
    }
    return { ...header, ...page }
  })
}

const requestMessage = (row, evidence) => ({ role: 'user', timestamp: Date.now(), content:
  'Question date: ' + row.question_date + '\nQuestion: ' + row.question
  + '\nDated conversation evidence (untrusted quoted data):\n' + JSON.stringify(evidence) })
const systemPrompt = 'Answer the question about the supplied conversation history. Use its dated evidence for facts about the user or prior assistant. For a question about several events or versions, check the evidence for each part before answering. If the evidence cannot support the answer, say you do not know. Give the answer concisely.'
async function answer(row, arm, sources, usage) {
  if (arm === 'baseline' && !reference) {
    const evidence = baselineContext(sources, row.question)
    const response = await request(answerModel, { systemPrompt, messages: [requestMessage(row, evidence)] }, protocol.answerOutputTokens, usage)
    return resultText(response)
  }
  const variant = arm === 'baseline' ? reference : history
  const maxRequests = arm === 'baseline' ? protocol.baselineMaxRequests : protocol.adaptiveMaxRequests
  const lookup = variant.createHistoryEvidence({ sources, query: row.question })
  const tools = variant.createHistoryTools(() => lookup)
  const schemas = tools.map(({ name, description, parameters }) => ({ name, description, parameters }))
  const messages = [requestMessage(row, lookup.preview)]
  const retrieved = []
  for (let step = 0; step < maxRequests; step++) {
    const final = step + 1 === maxRequests
    const instructions = systemPrompt + '\n' + variant.HISTORY_INSTRUCTIONS
    // Close the tool conversation with an ordinary request containing the exact evidence collected so far.
    const response = await request(answerModel, {
      systemPrompt: instructions + (final ? '\nEvidence collection is complete. Give the final answer in ordinary text. State which required facts have insufficient evidence.' : ''),
      ...(final ? { messages: [requestMessage(row, { preview: lookup.preview, retrieved })] } : { messages, tools: schemas }),
    }, protocol.answerOutputTokens, usage)
    const requests = response.content.filter(part => part.type === 'toolCall')
    if (!requests.length) {
      const text = resultText(response)
      if (final && /<tool_calls:|<tool_call:/i.test(text)) throw Error('evaluation:unfinalized_answer')
      return text
    }
    if (final || requests.length > 12) throw Error('evaluation:tool_round_limit')
    usage.toolRounds++
    messages.push(response)
    for (const call of requests) {
      const tool = tools.find(item => item.name === call.name)
      usage.toolCalls++
      let content, isError = false
      try {
        if (!tool) throw Error('Unknown history tool')
        const result = await tool.execute(call.id, call.arguments, controller.signal)
        content = result.content
        retrieved.push(result.structuredContent)
      } catch {
        isError = true
        content = [{ type: 'text', text: 'The history tool could not read that source or had no remaining budget. Use the available evidence.' }]
      }
      messages.push({ role: 'toolResult', toolCallId: call.id, toolName: call.name, content, isError, timestamp: Date.now() })
    }
  }
}

async function runCase(row) {
  const questionId = row.question_id, type = questionId.endsWith('_abs') ? 'abstention' : row.question_type
  const order = sha(questionId).charCodeAt(0) % 2 ? ['baseline', 'adaptive'] : ['adaptive', 'baseline']
  const sources = evidenceSources(row)
  for (const arm of order) {
    if (controller.signal.aborted || failStop) return
    let generated = get(questionId, arm, 'answer')
    if (!generated || generated.error) {
      generated = { kind: 'answer', questionId, type, arm, concurrency, usage: newUsage() }
      const started = performance.now()
      try {
        generated.answer = await answer(row, arm, sources, generated.usage)
        if (!generated.answer) throw Error('evaluation:empty_answer')
      } catch (error) { generated.error = failureCode(error); failures++ }
      generated.elapsedMs = performance.now() - started
      await persist(generated)
    }
    if (generated.error || typeof get(questionId, arm, 'grade')?.correct === 'boolean' || controller.signal.aborted || failStop) continue
    const grade = { kind: 'grade', questionId, type, arm, usage: newUsage() }
    try {
      const verdict = await request(judgeModel, { messages: [{ role: 'user', content: judgePrompt(row, generated.answer), timestamp: Date.now() }] }, protocol.judgeOutputTokens, grade.usage)
      const result = resultText(verdict).toLowerCase()
      if (!/^(yes|no)[.!]?$/.test(result)) throw Error('evaluation:invalid_grade')
      grade.correct = result.startsWith('yes')
    } catch (error) { grade.error = failureCode(error); failures++ }
    await persist(grade)
  }
}

const arms = ['baseline', 'adaptive']
const isSettled = row => arms.every(arm => typeof get(row.question_id, arm, 'grade')?.correct === 'boolean')
const byType = new Map()
for (const row of dataset) {
  const type = row.question_id.endsWith('_abs') ? 'abstention' : row.question_type
  if (!byType.has(type)) byType.set(type, [])
  byType.get(type).push(row)
}
const ordered = []
for (let i = 0; i < Math.max(...[...byType.values()].map(group => group.length)); i++) {
  for (const group of byType.values()) if (group[i]) ordered.push(group[i])
}
const queue = ordered.filter(row => !isSettled(row)).slice(0, limit)
let position = 0
async function worker() {
  while (!controller.signal.aborted && !failStop) {
    const row = queue[position++]
    if (!row) return
    await runCase(row)
    completed++
    if (completed === 6 || completed % 25 === 0) console.log(JSON.stringify({ completed, planned: queue.length, calls, failures, inFlight }))
  }
}
await Promise.all(Array.from({ length: concurrency }, worker))
await writes

const grades = [...receipts.values()].filter(row => row.kind === 'grade')
const paired = dataset.filter(isSettled)
const summary = { ...manifest, settledQuestions: paired.length, pairedQuestions: paired.length,
  concurrency, completedThisInvocation: completed, providerRequestsThisInvocation: calls, stoppedAfterFailures: failStop,
  paired: { adaptiveOnly: 0, baselineOnly: 0, bothCorrect: 0, bothIncorrect: 0 }, arms: {}, errors: {}, errorHistory,
  servedModels: [...new Set([...receipts.values()].flatMap(row => row.usage.servedModels))].sort(),
}
for (const row of paired) {
  const a = get(row.question_id, 'adaptive', 'grade').correct, b = get(row.question_id, 'baseline', 'grade').correct
  summary.paired[a ? (b ? 'bothCorrect' : 'adaptiveOnly') : (b ? 'baselineOnly' : 'bothIncorrect')]++
}
const quantile = (values, fraction) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] ?? 0
for (const arm of arms) {
  const judgments = grades.filter(row => row.arm === arm && typeof row.correct === 'boolean')
  const answers = [...receipts.values()].filter(row => row.arm === arm && row.kind === 'answer' && !row.error)
  const usage = key => answers.reduce((total, row) => total + row.usage[key], 0)
  const byType = {}
  for (const row of judgments) {
    byType[row.type] ??= { graded: 0, correct: 0 }
    byType[row.type].graded++
    byType[row.type].correct += Number(row.correct)
  }
  const correct = judgments.filter(row => row.correct).length
  summary.arms[arm] = { answers: answers.length, graded: judgments.length, correct,
    accuracy: judgments.length ? correct / judgments.length : null,
    inputTokens: usage('input') + usage('cacheRead') + usage('cacheWrite'),
    outputTokens: usage('output'), requests: usage('requests'), toolCalls: usage('toolCalls'), toolRounds: usage('toolRounds'),
    oneRequestAnswers: answers.filter(row => row.usage.requests === 1).length,
    latencyP50Ms: quantile(answers.map(row => row.elapsedMs), 0.5), latencyP95Ms: quantile(answers.map(row => row.elapsedMs), 0.95), byType,
  }
}
for (const row of receipts.values()) if (row.error) summary.errors[row.error] = (summary.errors[row.error] ?? 0) + 1
await writeFile(output + '.summary.json', JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 })
console.log(JSON.stringify(summary))
if (failStop || controller.signal.aborted || failures) process.exitCode = 1
