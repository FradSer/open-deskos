import { agentLivePlan, createLivePlan, normalizeLiveModel, finalizeAgentAcceptanceFile } from '../tests/helpers/agent-live-contract.mjs'
import { generationDeadlineMs } from '../src/proactive-generation-session.mjs'
import { openLiveHostRelay } from '../tests/helpers/agent-live-relay.mjs'

const args = process.argv.slice(2)
if (args.length === 1 && args[0] === '--plan') {
  console.log(JSON.stringify(agentLivePlan))
} else {
  if (!args.includes('--live') || args.some(arg => !['--live', '--host-relay', '--task-evaluation'].includes(arg) && !['--output=', '--max-requests=', '--max-output-tokens=', '--deadline-ms=', '--continue-from='].some(prefix => arg.startsWith(prefix)))
    || ['--output=', '--max-requests=', '--max-output-tokens=', '--deadline-ms=', '--continue-from='].some(prefix => args.filter(arg => arg.startsWith(prefix)).length > 1)
    || (args.includes('--task-evaluation') && args.some(arg => arg.startsWith('--continue-from=')))) {
    throw Error('Usage: node scripts/test-agent-runtime-live.mjs --plan | --live [--output=NEW_DIRECTORY] [--host-relay] [--task-evaluation | --continue-from=EVIDENCE_DIRECTORY] [--max-requests=N] [--max-output-tokens=N] [--deadline-ms=N]')
  }
  const { spawn, execFileSync } = await import('node:child_process')
  const { createHash } = await import('node:crypto')
  const { mkdir, mkdtemp, readFile, readdir, stat } = await import('node:fs/promises')
  const { homedir, tmpdir } = await import('node:os')
  const { dirname, join, resolve } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  let relay
  try {
    const plan = createLivePlan({ maxRequests: Number(args.find(arg => arg.startsWith('--max-requests='))?.slice(15) ?? agentLivePlan.maxRequests),
      maxOutputTokens: Number(args.find(arg => arg.startsWith('--max-output-tokens='))?.slice('--max-output-tokens='.length) ?? agentLivePlan.maxOutputTokens),
      deadlineMs: Number(args.find(arg => arg.startsWith('--deadline-ms='))?.slice(14) ?? agentLivePlan.deadlineMs) })
    const pluginTimeoutMs = generationDeadlineMs(process.env.ODK_AGENT_PLUGIN_TIMEOUT_MS)
    const continuationDirectory = args.find(arg => arg.startsWith('--continue-from='))?.slice(16)
    if (continuationDirectory === '') throw Error('Continuation evidence directory is required')
    const continuation = continuationDirectory ? await (await import('../tests/helpers/agent-live-continuation.mjs')).loadLiveContinuation(continuationDirectory) : undefined
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
    const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent')
    const settings = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'))
    const catalog = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'))
    const provider = settings.defaultProvider, source = catalog.providers?.[provider]
    const selected = source?.models?.find(model => model.id === settings.defaultModel)
    if (!selected || typeof source?.apiKey !== 'string' || !source.apiKey || source.apiKey.startsWith('!')) throw Error('A configured custom model with a literal or environment credential is required')
    const jevKey = process.env.TYPESAFE_API_KEY?.trim()
    if (!jevKey) throw Error('TYPESAFE_API_KEY is required for this explicit live run')
    const api = selected.api ?? source.api
    if (!['openai-responses', 'openai-completions', 'anthropic-messages'].includes(api)) throw Error('This verifier requires a fetch-based custom model API')
    const { model, pricingKnown } = await normalizeLiveModel({ modelsPath: join(agentDir, 'models.json'), provider, selected, source, limit: plan.maxOutputTokens })
    const providerConfig = Object.fromEntries(['name', 'baseUrl', 'api', 'headers', 'authHeader'].filter(key => source[key] !== undefined).map(key => [key, source[key]]))
    providerConfig.apiKey = process.env[source.apiKey] || source.apiKey
    if (args.includes('--host-relay')) {
      relay = await openLiveHostRelay(selected.baseUrl ?? source.baseUrl)
      providerConfig.baseUrl = relay.baseUrl
      model.baseUrl = relay.baseUrl
      providerConfig.headers = { ...providerConfig.headers, ...relay.headers }
    }
    const requested = args.find(arg => arg.startsWith('--output='))?.slice(9)
    const output = requested ? resolve(requested) : await mkdtemp(join(tmpdir(), 'odk-agent-live-'))
    if (requested) await mkdir(output, { mode: 0o700 })
    async function fingerprint() {
      const files = ['integrations/personal-bot/package.json', 'integrations/personal-bot/pnpm-lock.yaml', 'runtime/shell/package.json', 'runtime/shell/pnpm-lock.yaml',
        ...['scripts/test-agent-runtime-live.mjs', 'tests/acceptance/agent-runtime-live.mjs', 'tests/helpers/agent-live-contract.mjs', 'tests/helpers/agent-live-relay.mjs', 'tests/helpers/agent-live-plugin-evidence.mjs', 'tests/helpers/agent-live-continuation.mjs',
          'tests/fixtures/agent-learning-reports.mjs', 'tests/fixtures/agent-learning-server.mjs',
          'tests/fixtures/live-jev-response.mjs'].map(path => `integrations/personal-bot/${path}`)]
      async function scan(directory) {
        for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
          const path = `${directory}/${entry.name}`
          if (entry.isSymbolicLink()) throw Error('Source aliases are unavailable for live verification')
          if (entry.isDirectory()) await scan(path)
          else if (/\.(?:mjs|js|json)$/.test(entry.name)) files.push(path)
        }
      }
      await scan('integrations/personal-bot/src'); await scan('runtime/shell/src')
      if (files.length > 4096) throw Error('Source fingerprint limit exceeded')
      const result = {}
      for (const path of files.sort()) {
        if ((await stat(join(root, path))).size > 8 * 1024 * 1024) throw Error('Source file exceeds its fingerprint limit')
        result[path] = createHash('sha256').update(await readFile(join(root, path))).digest('hex')
      }
      return result
    }
    const fingerprints = await fingerprint()
    const envelope = { provider, providerConfig, model, pricingKnown, jevKey, plan, pluginTimeoutMs, fingerprints, continuation, taskEvaluation: args.includes('--task-evaluation'), hostValidationRequired: true, transport: relay ? 'private_host_relay' : 'direct',
      candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() }
    const container = `odk-agent-live-${process.pid}-${createHash('sha256').update(output).digest('hex').slice(0, 12)}`
    console.log(JSON.stringify({ evidence: output, container, maxRequests: plan.maxRequests, maxOutputTokens: plan.maxOutputTokens, deadlineMs: plan.deadlineMs, transport: envelope.transport }))
    const child = spawn('docker', ['run', '--rm', '-i', '--name', container, '--user', `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`, '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      '--mount', `type=bind,src=${root},dst=/candidate,readonly`, '--mount', `type=bind,src=${output},dst=/evidence`,
      '--workdir', '/candidate/integrations/personal-bot', 'node:24-trixie-slim', 'node', 'tests/acceptance/agent-runtime-live.mjs'], { stdio: ['pipe', 'pipe', 'pipe'] })
    // Credentials travel only over stdin. Provider errors and transcript output never become host logs.
    child.stdout.on('data', () => {})
    child.stderr.on('data', () => {})
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(envelope))
    let forcedCleanup = false
    const timer = setTimeout(() => {
      forcedCleanup = true
      const cleanup = spawn('docker', ['rm', '--force', container], { stdio: 'ignore', timeout: 10000 })
      cleanup.once('error', () => {})
    }, plan.deadlineMs + 30000)
    child.once('error', () => { clearTimeout(timer); void relay?.close().catch(() => {}); console.error('Isolated live verification could not start'); process.exitCode = 1 })
    child.once('exit', async code => {
      clearTimeout(timer)
      let passed = false
      try {
        await relay?.close()
        const file = join(output, 'report.json')
        const final = await finalizeAgentAcceptanceFile(file, { exitCode: code, fingerprints, fingerprint, forcedCleanup })
        passed = final.passed
      } catch { /* A missing or changed report cannot establish acceptance. */ }
      process.exitCode = passed ? 0 : 1
      console.log(JSON.stringify({ finished: true, passed, forcedCleanup, evidence: output }))
    })
  } catch {
    await relay?.close().catch(() => {})
    console.error('Live verification setup failed; credentials and provider responses are not logged')
    process.exitCode = 1
  }
}
