import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../', import.meta.url))
const selected = /^(?:proactive(?:-|\.)|intents?[-.]|openui-|private-|gmail-recommendation-source\.|schedule-conflict)/
const tests = (await readdir(new URL('../tests/', import.meta.url)))
  .filter(name => name.endsWith('.test.mjs') && selected.test(name)).sort()
if (!tests.length) throw Error('No recommendation tests found')
if (process.argv.includes('--list')) {
  process.stdout.write(tests.join('\n') + '\n')
} else {
  const child = spawn(process.execPath, ['--test', '--test-timeout=120000', ...tests.map(name => `tests/${name}`)], { cwd, stdio: 'inherit' })
  child.on('error', () => { console.error('Recommendation tests could not start'); process.exitCode = 1 })
  child.on('exit', code => { process.exitCode = code ?? 1 })
}
