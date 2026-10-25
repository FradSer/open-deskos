import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Opt-in real inference. Credentials travel only over stdin, never Docker env,
// command arguments, mounted user profiles, evidence files or generated logs.
const args = process.argv.slice(2)
if (!args.includes('--live') || args.some(arg => arg !== '--live' && !/^--(?:output|rounds)=/.test(arg))) {
  throw Error('Usage: node scripts/test-proactive-docker-live.mjs --live [--output=NEW_DIRECTORY] [--rounds=1..3]')
}
const rounds = Number(args.find(arg => arg.startsWith('--rounds='))?.slice(9) ?? 2)
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 3) throw Error('Invalid live verification round count')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const packageRoot = join(root, 'integrations/personal-agent')
const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi/agent')
const settings = JSON.parse(await readFile(join(agentDir, 'settings.json'), 'utf8'))
const catalog = JSON.parse(await readFile(join(agentDir, 'models.json'), 'utf8'))
const provider = settings.defaultProvider
const source = catalog.providers?.[provider]
const selected = source?.models?.find(model => model.id === settings.defaultModel)
if (!selected || typeof source?.apiKey !== 'string' || !source.apiKey || source.apiKey.startsWith('!')) {
  throw Error('This isolated verifier requires a configured custom model with a literal or environment API key')
}
const apiKey = process.env[source.apiKey] || source.apiKey
const jevKey = process.env.TYPESAFE_API_KEY?.trim()
if (!jevKey) throw Error('TYPESAFE_API_KEY is required for live verification')
const model = { ...selected, compat: { ...source.compat, ...selected.compat } }
const providerConfig = Object.fromEntries(['name', 'baseUrl', 'api', 'headers', 'authHeader'].filter(key => source[key] !== undefined).map(key => [key, source[key]]))
providerConfig.apiKey = apiKey
const configuredOutput = args.find(arg => arg.startsWith('--output='))?.slice(9)
const output = configuredOutput ? resolve(configuredOutput) : await mkdtemp(join(tmpdir(), 'odk-proactive-live-'))
if (configuredOutput) await mkdir(output, { mode: 0o700 })
const files = ['src/agent.mjs', 'src/durable-agent-session.mjs', 'src/proactive-generation.mjs', 'src/proactive-jev.mjs', 'src/proactive.mjs']
const fingerprints = Object.fromEntries(await Promise.all(files.map(async path => [path, createHash('sha256').update(await readFile(join(packageRoot, path))).digest('hex')])))
const envelope = { provider, providerConfig, model, jevKey, rounds, maxRequests: 32,
  candidate: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), fingerprints }
console.log(JSON.stringify({ evidence: output, rounds, maxRequests: envelope.maxRequests }))
const child = spawn('docker', ['run', '--rm', '-i', '--name', `odk-proactive-live-${process.pid}`, '--read-only',
  '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
  '--mount', `type=bind,src=${root},dst=/candidate,readonly`,
  '--mount', `type=bind,src=${output},dst=/evidence`,
  '--workdir', '/candidate/integrations/personal-agent', 'node:24-trixie-slim',
  'node', 'tests/acceptance/proactive-docker-live.mjs'], { stdio: ['pipe', 'inherit', 'inherit'] })
child.stdin.on('error', () => {})
child.stdin.end(JSON.stringify(envelope))
child.on('error', () => { console.error('Docker verification could not start'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
