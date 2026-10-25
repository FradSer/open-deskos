import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { requestTask } from '../src/task-protocol.mjs'

const integration = fileURLToPath(new URL('..', import.meta.url))

// Mirrors a released host: the integration is reached only through a stable
// symlink to the active release, never through the dated release directory.
async function host(t) {
  const dir = await mkdtemp(join(tmpdir(), 'task-entry-'))
  const root = join(dir, 'development')
  const socket = join(dir, 'run/control.sock')
  for (const path of [root, join(dir, 'state'), join(dir, 'run')]) await mkdir(path, { recursive: true, mode: 0o700 })
  const config = join(dir, 'pi-tasks.json')
  await writeFile(config, `${JSON.stringify({ roots: [root], stateDir: join(dir, 'state'), socketPath: socket })}\n`, { mode: 0o600 })
  await symlink(integration, join(dir, 'current'), 'dir')
  const paths = { dir, config, socket, entry: join(dir, 'current/src/task-daemon.mjs'), clients: new Set(), children: new Set() }
  t.after(async () => {
    for (const client of paths.clients) client.destroy()
    for (const child of paths.children) await stopChild(child)
    await rm(dir, { recursive: true, force: true })
  })
  return paths
}

async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise(resolve => child.once('exit', resolve))
  async function wait(ms) {
    let timer
    try { return await Promise.race([exited.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms) })]) }
    finally { clearTimeout(timer) }
  }
  child.kill('SIGTERM')
  if (!await wait(2000)) {
    child.kill('SIGKILL')
    assert.equal(await wait(2000), true, 'owned daemon did not exit; preserve its directory')
  }
}

function start(entry, paths, preload = undefined) {
  const { dir, config } = paths
  const child = spawn(process.execPath, [...(preload ? ['--import', preload] : []), entry], {
    env: { PATH: process.env.PATH, HOME: dir, XDG_RUNTIME_DIR: dir, ODK_TASK_CONFIG: config },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  paths.children.add(child)
  return child
}

function connector(socket, clients) {
  return new Promise(resolve => {
    const client = connect(socket)
    client.once('connect', () => { clients.add(client); resolve(client) })
    client.once('error', () => { client.destroy(); resolve(undefined) })
  })
}

async function listSessions(socketPath) {
  // The daemon closes a one-shot request after replying, including a startup
  // reply. Retry on a fresh connection using the same bounded product client.
  return requestTask(socketPath, { version: 1, requestId: 'entry-check', command: 'list' })
}

async function waitForPublished(descriptor) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try { return JSON.parse(await readFile(descriptor, 'utf8')) } catch { await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  throw new Error(`the running host published no endpoint descriptor at ${descriptor}`)
}

test('the task daemon serves its socket when started through a release symlink', { skip: process.platform === 'win32' ? 'Unix Hosted Pi server fixture; Windows agent clients run separately' : false }, async t => {
  const paths = await host(t)
  const child = start(paths.entry, paths)
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  let client
  for (let attempt = 0; attempt < 400 && !client && child.exitCode === null; attempt++) {
    client = await connector(paths.socket, paths.clients)
    if (!client) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(client, `daemon served no control socket; stderr: ${stderr}`)
  assert.equal(child.exitCode, null, 'daemon exited instead of serving the socket')
  let response
  for (let attempt = 0; attempt < 40 && response?.ok !== true; attempt++) {
    response = await listSessions(paths.socket)
    if (response.ok !== true) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(response.ok, true, `serving daemon rejected a list request: ${JSON.stringify(response)}`)
  assert.deepEqual(response.tasks, [])
})

// The desk's Console path discovers this host through the published descriptor, and a descriptor left
// behind by a stopped host claims a socket that is not there — the same lie either way for an
// operator looking at a Console that reports no host.
test('the running daemon publishes its endpoint and withdraws it on shutdown', { skip: process.platform === 'win32' ? 'Unix Hosted Pi server fixture; Windows agent clients run separately' : false }, async t => {
  const paths = await host(t)
  const descriptor = join(paths.dir, 'odk/hosted-pi/endpoint.json')
  const child = start(paths.entry, paths)
  let client
  for (let attempt = 0; attempt < 400 && !client && child.exitCode === null; attempt++) {
    client = await connector(paths.socket, paths.clients)
    if (!client) await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(client, 'daemon served no control socket')
  await waitForPublished(descriptor)
  assert.equal((await listSessions(paths.socket)).ok, true)
  // The host serves before it publishes, so discovery never promises a socket that cannot answer;
  // the descriptor therefore appears just after the first successful request.
  const published = await waitForPublished(descriptor)
  assert.equal(published.socketPath, paths.socket, 'the descriptor must name the socket the daemon bound')
  assert.equal(published.version, 1)
  assert.equal((await stat(descriptor)).mode & 0o777, 0o600)
  child.kill('SIGTERM')
  assert.equal(await new Promise(resolve => child.once('exit', resolve)), 0)
  assert.equal(existsSync(descriptor), false, 'a stopped host must not leave a descriptor behind')
})

test('importing the task daemon without running it starts no daemon', async t => {
  const paths = await host(t)
  const wrapper = join(paths.dir, 'wrapper.mjs')
  await writeFile(wrapper, `await import(${JSON.stringify(pathToFileURL(paths.entry).href)})\n`)
  const child = start(wrapper, paths)
  const exit = await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    new Promise(resolve => setTimeout(() => resolve('still-running'), 10000)),
  ])
  child.kill()
  assert.equal(exit, 0, 'importing the module must not start a daemon')
  assert.ok(!existsSync(paths.socket), 'importing the module created a control socket')
})

test('CLI shutdown during service initialization cleans the late service without publishing', { skip: process.platform === 'win32' ? 'Unix Hosted Pi server fixture; Windows agent clients run separately' : false }, async t => {
  const paths = await host(t)
  const serviceUrl = new URL('../src/task-service.mjs', import.meta.url).href
  const mockSource = `export async function createTaskService() {
    process.stdout.write('TASK_INIT_PENDING\\n');
    await new Promise(resolve => process.once('SIGTERM', resolve));
    return { handle() {}, disconnect() {}, close() { process.stdout.write('TASK_SERVICE_CLOSED\\n'); } };
  }`
  const preload = 'data:text/javascript,' + encodeURIComponent(`
    import { registerHooks } from 'node:module';
    registerHooks({ load(url, context, next) {
      const result = next(url, context);
      if (url !== ${JSON.stringify(serviceUrl)}) return result;
      const original = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
      return { ...result, source: original.replace('export async function createTaskService(', 'async function originalTaskService(') + ${JSON.stringify(mockSource)} };
    } });
  `)
  const child = start(paths.entry, paths, preload)
  let stdout = ''
  let stderr = ''
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Initialization marker missing: ${stderr}`)), 15000)
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
      if (stdout.includes('TASK_INIT_PENDING')) { clearTimeout(timer); resolve(undefined) }
    })
  })
  assert.equal(existsSync(paths.socket), true)
  child.kill('SIGTERM')
  let deadline
  const exit = await Promise.race([
    exited,
    new Promise((_, reject) => { deadline = setTimeout(() => reject(Error(`Shutdown did not finish: ${stderr}`)), 15000) }),
  ]).finally(() => clearTimeout(deadline))
  assert.deepEqual(exit, { code: 0, signal: null })
  assert.equal(stdout.split('TASK_SERVICE_CLOSED').length - 1, 1)
  assert.equal(existsSync(join(paths.dir, 'odk/hosted-pi/endpoint.json')), false)
  const client = await connector(paths.socket, paths.clients)
  client?.destroy()
  assert.equal(client, undefined, 'a stopped daemon must not accept clients')
})

test('resident unit passes the canonical local task configuration to the actual helper', { skip: process.platform === 'win32' ? 'Unix service fixture' : false }, async t => {
  const paths = await host(t)
  const canonical = join(paths.dir, '.config/odk/pi-tasks.json')
  await mkdir(join(paths.dir, '.config/odk'), {recursive:true,mode:0o700})
  await writeFile(canonical, await readFile(paths.config), {mode:0o600})
  const unit = await readFile(join(integration, 'systemd/odk-personal-agent.service'), 'utf8')
  const configured = /^Environment=ODK_TASK_CONFIG=(.+)$/m.exec(unit)?.[1]?.replace('%h', paths.dir)
  const daemon = start(paths.entry, {...paths,config:canonical})
  let connection
  for(let n=0;n<200 && !connection && daemon.exitCode===null;n++) {connection=await connector(paths.socket, paths.clients);if(!connection)await new Promise(resolve=>setTimeout(resolve,25))}
  assert(connection);connection.destroy()
  const child = spawn(process.execPath,[join(integration,'src/task-cli.mjs')], {env:{PATH:process.env.PATH,HOME:paths.dir,...(configured?{ODK_TASK_CONFIG:configured}:{})},stdio:['pipe','pipe','pipe']})
  let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stdin.end(JSON.stringify({version:1,requestId:'resident-local-list',command:'list'})+'\n')
  const exit=await new Promise(resolve=>child.once('exit',resolve))
  assert.equal(exit,0,'the resident helper must inherit the same canonical config as the daemon')
  assert.equal(JSON.parse(output).ok,true)
})

test('the installed local helper has its own canonical configuration and stable release path', { skip: process.platform === 'win32' ? 'Unix executable helper fixture' : false }, async t => {
 const paths=await host(t)
 const template=await readFile(join(integration,'systemd/pi-task-control.sh'),'utf8')
 const helper=join(paths.dir,'control')
 await writeFile(helper,template.replaceAll('__ODK_TASK_CONFIG__',paths.config).replaceAll('__ODK_NODE_BIN__',process.execPath.slice(0,process.execPath.lastIndexOf('/'))).replaceAll('__ODK_PERSONAL_AGENT_DIR__',join(paths.dir,'current')),{mode:0o700})
 const daemon=start(paths.entry,paths)
 let connection
 for(let n=0;n<200 && !connection && daemon.exitCode===null;n++) {connection=await connector(paths.socket, paths.clients);if(!connection)await new Promise(resolve=>setTimeout(resolve,25))}
 assert(connection);connection.destroy()
 const child=spawn(helper,[],{env:{PATH:process.env.PATH,HOME:paths.dir},stdio:['pipe','pipe','pipe']})
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stdin.end(JSON.stringify({version:1,requestId:'self-configured-helper',command:'list'})+'\n')
 assert.equal(await new Promise(resolve=>child.once('exit',resolve)),0)
 assert.equal(JSON.parse(output).ok,true)
})
