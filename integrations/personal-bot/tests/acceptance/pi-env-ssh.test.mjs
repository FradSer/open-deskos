import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { Connection, localDaemon, sshArguments } from '@earendil-works/pi-env'
import { createReadTool } from '@earendil-works/pi-durable/tools'
import { createPiExecutionTarget, createPiSshConnection, openDurableRuntime } from '../../src/durable-runtime.mjs'
import { assistant, fixtureModel } from '../helpers/pi-fixture.mjs'
import { taskRequest } from '../../src/task-client.mjs'

// Explicit runner: uv installs the pinned fixture dependency. No real host,
// service installation, owner credential, model provider, or live capture is used.
test('Durable RemoteExecutionEnv uses real SSH and refuses untrusted host keys', { timeout: 60000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'odk-pi-ssh-')))
  const remote = join(directory, 'target'), client = join(directory, 'client')
  await mkdir(remote, { mode: 0o700 }); await mkdir(client, { mode: 0o700 })
  const previousClientOnly = process.env.ODK_FIXTURE_CLIENT_ONLY
  const previousPath = process.env.PATH
  let runtime, target, connection, server, exited
  t.after(async () => {
    try { await runtime?.close() }
    finally {
      try { await target?.close() }
      finally {
        connection?.close()
        if (server && server.exitCode === null && server.signalCode === null) {
          server.stdin.end()
          const timer = setTimeout(() => server.kill('SIGTERM'), 3000)
          try { await exited } finally { clearTimeout(timer) }
        }
        if (previousClientOnly === undefined) delete process.env.ODK_FIXTURE_CLIENT_ONLY
        else process.env.ODK_FIXTURE_CLIENT_ONLY = previousClientOnly
        if (previousPath === undefined) delete process.env.PATH
        else process.env.PATH = previousPath
        await rm(directory, { recursive: true, force: true })
      }
    }
  })
  const fixtureEnv = { ...process.env }
  delete fixtureEnv.ODK_FIXTURE_CLIENT_ONLY
  server = spawn('uv', ['run', '--no-config', '--script', fileURLToPath(new URL('../helpers/pi-env-ssh-fixture.py', import.meta.url)),
    '--root', remote, '--daemon', localDaemon()], { stdio: ['pipe', 'pipe', 'pipe'], env: fixtureEnv })
  exited = once(server, 'exit')
  let diagnostics = ''
  server.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4096) })
  const lines = createInterface({ input: server.stdout })
  const [line] = await Promise.race([once(lines, 'line'), exited.then(() => { throw Error(`SSH fixture stopped during startup: ${diagnostics}`) })])
  const ready = JSON.parse(line)
  const knownHostsFile = join(client, 'known_hosts'), configFile = join(client, 'ssh_config')
  const hostKeyAlias = 'odk-pi-loopback-fixture'
  await writeFile(configFile, 'Host *\n  SendEnv ODK_FIXTURE_CLIENT_ONLY\n', { mode: 0o600 })
  await writeFile(knownHostsFile, `${hostKeyAlias} ${ready.hostKey}\n`, { mode: 0o600 })
  const sshTarget = { host: '127.0.0.1', user: 'fixture', port: ready.port, identityFile: ready.identity, knownHostsFile, hostKeyAlias, configFile }
  process.env.ODK_FIXTURE_CLIENT_ONLY = 'client-only-fixture'
  // Negative control proves that this config forwards the actual client value
  // unless the application removes it from the transport's environment.
  const raw = new Connection({ command: ['ssh', ...sshArguments(sshTarget), localDaemon()] })
  try { await assert.rejects(raw.info(), /code 125/) } finally { raw.close() }
  await assert.rejects(readFile(join(remote, 'daemon-starts.jsonl')), { code: 'ENOENT' })
  const open = onLog => createPiSshConnection({ target: sshTarget, daemonCommand: localDaemon(), onLog })
  let transportLog = ''
  connection = open(text => { transportLog += text })
  target = createPiExecutionTarget({ cwd: remote, remote: true, id: 'ssh-loopback-fixture', connection })
  const written = await target.env.writeFile('target-only.txt', 'SSH target fact', BACKGROUND_CONTEXT)
  assert.equal(written.ok, true, `${written.error?.message ?? ''}\n${transportLog}\n${diagnostics}`)
  assert.equal(await readFile(join(remote, 'target-only.txt'), 'utf8'), 'SSH target fact')
  await assert.rejects(readFile(join(client, 'target-only.txt')), { code: 'ENOENT' })
  let output = ''
  const executed = await target.env.exec([process.execPath, '-e', 'process.stdout.write(JSON.stringify({cwd:process.cwd(),clientOnly:process.env.ODK_FIXTURE_CLIENT_ONLY??null}))'], {
    onOutput: text => { output += text },
  }, BACKGROUND_CONTEXT)
  assert.equal(executed.ok, true)
  assert.equal(executed.value.exitCode, 0)
  assert.deepEqual(JSON.parse(output), { cwd: remote, clientOnly: null })
  const models = { getModel: () => fixtureModel, streamSimple: (_model, context) => {
    const result = context.messages.findLast(message => message.role === 'toolResult')
    if (result) { assert.equal(result.isError, false); assert.match(JSON.stringify(result.content), /SSH target fact/) }
    const message = result ? assistant('Target file read over SSH.') : assistant([{ type: 'toolCall', id: 'ssh-read', name: 'read', arguments: { path: 'target-only.txt' } }], 'toolUse')
    return { async *[Symbol.asyncIterator]() { yield { type: 'done', reason: message.stopReason, message } }, result: async () => message }
  } }
  runtime = await openDurableRuntime({ directory: join(client, 'durable'), cwd: remote, models,
    model: { provider: fixtureModel.provider, modelId: fixtureModel.id }, tools: [createReadTool()], codeMode: false, env: () => target.env })
  assert.equal(await runtime.prompt('Read the SSH target fixture.'), 'Target file read over SSH.')
  await runtime.close()
  assert.match(await readFile(join(client, 'durable', 'main.jsonl'), 'utf8'), /SSH target fact/)
  await assert.rejects(readFile(join(remote, 'main.jsonl')), { code: 'ENOENT' })
  await target.close(); connection.close()
  const ssh = execFileSync('/bin/sh', ['-c', 'command -v ssh'], { encoding: 'utf8' }).trim()
  const bin = join(client, 'bin')
  await mkdir(bin, { mode: 0o700 })
  await writeFile(join(bin, 'ssh'), `#!${process.execPath}\nimport {spawn} from 'node:child_process';
    const child=spawn(${JSON.stringify(ssh)},[...${JSON.stringify(sshArguments(sshTarget))},process.argv.at(-1)],{stdio:'inherit'});
    child.once('error',()=>{process.exitCode=1});child.once('exit',code=>{process.exitCode=code??1});`, { mode: 0o700 })
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`
  const task = await taskRequest({ id: 'mac', host: 'fixture@127.0.0.1', executable: '/fixture/control' }, { command: 'list', project: remote })
  assert.equal(task.task.command, 'list')
  assert.equal(task.task.project, remote)
  process.env.PATH = previousPath
  const starts = await readFile(join(remote, 'daemon-starts.jsonl'), 'utf8')
  for (const key of ['', `${hostKeyAlias} ${ready.wrongHostKey}\n`]) {
    await writeFile(knownHostsFile, key, { mode: 0o600 })
    let log = ''
    const refused = open(text => { log += text })
    try { await assert.rejects(refused.info()); assert.match(log, /host key verification failed|host identification has changed|No .* host key is known/i) }
    finally { refused.close() }
    assert.equal(await readFile(knownHostsFile, 'utf8'), key)
    assert.equal(await readFile(join(remote, 'daemon-starts.jsonl'), 'utf8'), starts)
  }
  server.stdin.end()
  assert.deepEqual(await exited, [0, null], diagnostics)
})
