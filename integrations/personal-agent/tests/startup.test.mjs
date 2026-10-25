import { endpoint as privateEndpoint, fixtureToken } from './helpers/private-channel.mjs'
import { pathToFileURL } from 'node:url'
import { once } from 'node:events'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile, readFile, lstat, cp, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect, createServer } from 'node:net'

// main() publishes this placeholder before any configuration stage reports, then publishes one
// status per configuration stage. A read during startup therefore returns an intermediate report
// instead of the failure message the callers assert on, so the harness waits for the status to
// stop changing rather than racing `initialize`.
const STARTUP_PLACEHOLDER = 'Configure Open DeskOS workspace, STT credential and Pi authentication; restart service'
const STABLE_SAMPLES = 3
const residentRole = { skip: process.platform === 'win32' ? 'Windows runs the CM5 display client; resident startup belongs to CM5' : false }

function readStatus(client, timeout = 2000) {
  return new Promise(resolve => {
    const onData = data => {
      for (const line of String(data).split('\n')) {
        if (!line.trim()) continue
        let frame
        try { frame = JSON.parse(line) } catch { continue }
        clearTimeout(timer)
        client.off('data', onData)
        return resolve(frame)
      }
    }
    const timer = setTimeout(() => { client.off('data', onData); resolve(undefined) }, timeout)
    client.on('data', onData)
    client.write('{"v":1,"type":"status"}\n')
  })
}

async function startupStatus(t, env = {}) {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes(STARTUP_PLACEHOLDER), 'main.mjs no longer publishes the pre-initialization status this harness waits out')
  const dir = await mkdtemp(join(tmpdir(), 'voice-start-'))
  const endpoint = privateEndpoint(dir, 'startup')
  const childEnv = { PATH: process.env.PATH, HOME: dir, USERPROFILE: dir, XDG_RUNTIME_DIR: dir,
    LOCALAPPDATA: join(dir, 'local'), APPDATA: join(dir, 'appdata'),
    SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    ...(process.platform === 'win32' ? { ODK_PERSONAL_AGENT_AUDIO_DEVICE: 'Offline fixture microphone' } : {}), ...env }
  const args = []
  if (process.platform === 'win32') {
    // Redirect only the resident's endpoint names so the real entry cannot bind a running service's pipe.
    const socketUrl = new URL('../src/socket.mjs', import.meta.url).href
    const mainUrl = new URL('../src/main.mjs', import.meta.url).href
    const wrapper = join(dir, 'private-socket.mjs')
    await writeFile(wrapper, `export * from ${JSON.stringify(socketUrl)};
export const personalAgentEndpoint = () => ${JSON.stringify(endpoint)};
export const personalAgentControlEndpoint = () => ${JSON.stringify(endpoint + '-control')};
`)
    const preload = join(dir, 'private-endpoints.mjs')
    await writeFile(preload, `import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) { if (context.parentURL === ${JSON.stringify(mainUrl)} && specifier === './socket.mjs') return { url: ${JSON.stringify(pathToFileURL(wrapper).href)}, shortCircuit: true }; return next(specifier, context); } });
`)
    args.push('--import', pathToFileURL(preload).href)
  }
  const child = spawn(process.execPath, [...args, 'src/main.mjs'], { cwd: new URL('..', import.meta.url), env: childEnv, stdio: 'ignore' })
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) { const closed = once(child, 'close'); child.kill('SIGKILL'); await closed }
    await rm(dir, { recursive: true, force: true })
  })
  let client
  for (let n = 0; n < 400; n++) {
    client = await new Promise(resolve => {
      const socket = connect(process.platform === 'win32' ? endpoint : join(dir, 'odk-personal-agent/agent.sock'))
      socket.once('error', () => resolve(undefined))
      socket.once('connect', () => resolve(socket))
    })
    if (client || child.exitCode !== null) break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.ok(client, 'resident socket available without configuration')
  t.after(() => client.destroy())
  if (process.platform === 'win32') {
    const token = (await readFile(join(childEnv.LOCALAPPDATA, 'odk', 'local-channel.token'), 'utf8')).trim()
    client.write(JSON.stringify({v:1,token}) + '\n')
  }
  let status = await readStatus(client)
  assert.ok(status, 'resident reported a status table')
  let stable = 0
  const deadline = Date.now() + 15000
  while (stable < STABLE_SAMPLES && child.exitCode === null && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
    const next = await readStatus(client)
    stable = next && next.message !== STARTUP_PLACEHOLDER && next.message === status.message && next.state === status.state ? stable + 1 : 0
    if (next) status = next
  }
  return status
}

test('main prompt wiring forwards the live snapshot callback, bound reply and host owner identity', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  const mainBody=source.slice(source.indexOf('async function main()'))
  const roleGuard=mainBody.indexOf("if (platform === 'win32') throw Error('Windows must use the CM5 display client')"),migrationStart=mainBody.indexOf('await migratePersonalAgentState(env)')
  assert.ok(roleGuard>=0&&migrationStart>=0&&roleGuard<migrationStart,'Windows refuses the resident before migration or channel creation')
  const wiring = source.match(/prompt:\s*([^\n]+),\n/)[1]
  let received
  const runtime = { agent: { prompt: (...args) => { received = args; return Promise.resolve('done') } } }
  const prompt = Function('runtime', `return (${wiring})`)(runtime)
  const snapshot = () => {}
  const reply = {threadId: 'fixture-thread', sessionId: 'fixture-session'}
  const owner = {id:'00000000-0000-0000-0000-000000000081',bind:()=>{}}
  assert.equal(await prompt('request', snapshot, reply, owner), 'done')
  assert.deepEqual(received, ['request', snapshot, reply, owner])
  assert.equal(await prompt('request', snapshot), 'done')
  assert.deepEqual(received, ['request', snapshot, undefined, undefined])
})

test('unconfigured resident stays reachable and reports configuration error', residentRole, async t => {
  assert.equal((await startupStatus(t)).state, 'error')
})

test('the system workspace starts Agent validation without voice credentials', residentRole, async t => {
  const status = await startupStatus(t, { ODK_WORKSPACE: '/configured/desk-checkout' })
  assert.match(status.message, /writable checkout/)
})

test('obsolete bot-specific workspace is not a fallback', residentRole, async t => {
  const status = await startupStatus(t, { ODK_PERSONAL_AGENT_WORKSPACE: '/obsolete/checkout' })
  assert.match(status.message, /Set ODK_WORKSPACE /)
})

// The bridge declares its port once. Deriving the endpoint from that value is what lets a desk drop
// the second declaration entirely, and an unusable value must never be rounded down to the cloud.
test('the bridge port alone configures the device-local endpoint without a credential', residentRole, async t => {
  const status = await startupStatus(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_STT_PORT: '17840',
  })
  assert.match(status.message, /writable checkout/)
  assert.doesNotMatch(status.message, /ODK_PERSONAL_AGENT_STT_KEY_FILE/)
})

test('an unusable bridge port disables voice without reaching a remote endpoint', async t => {
  const { runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_STT_PORT: 'not-a-port',
  }, 'linux')
  assert.equal(runtime.stt.unavailable, true)
  assert.match(runtime.stt.message, /ODK_STT_PORT/)
  assert.doesNotMatch(runtime.stt.message, /not-a-port/)
})

async function keyFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-key-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const path = join(dir, 'stt.key')
  await writeFile(path, 'device-local-bearer', { mode: 0o600 })
  return path
}

test('plain HTTP loopback STT URL is accepted for device-local speech', residentRole, async t => {
  const status = await startupStatus(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_KEY_FILE: await keyFile(t),
    ODK_PERSONAL_AGENT_STT_URL: 'http://127.0.0.1:17840/inference',
  })
  assert.match(status.message, /writable checkout/)
})

// The bridge ignores a bearer, so requiring a credential file for it is configuration the device
// cannot justify. A desk that transcribes through the bridge must start without one.
test('the device-local loopback bridge needs no STT credential at all', residentRole, async t => {
  const status = await startupStatus(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_URL: 'http://127.0.0.1:17840/inference',
  })
  assert.match(status.message, /writable checkout/)
  assert.doesNotMatch(status.message, /ODK_PERSONAL_AGENT_STT_KEY_FILE/)
})

test('region language tags disable voice with supported language guidance', async t => {
  const { runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_KEY_FILE: await keyFile(t),
    ODK_PERSONAL_AGENT_STT_LANGUAGE: 'zh-CN',
  }, 'linux')
  assert.equal(runtime.stt.unavailable, true)
  assert.match(runtime.stt.message, /ODK_PERSONAL_AGENT_STT_LANGUAGE/)
  assert.doesNotMatch(runtime.stt.message, /zh-CN/)
})

test('oversize transcription prompts disable voice with safe guidance', async t => {
  const { runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_KEY_FILE: await keyFile(t),
    ODK_PERSONAL_AGENT_STT_PROMPT: 'private-context'.repeat(100),
  }, 'linux')
  assert.equal(runtime.stt.unavailable, true)
  assert.match(runtime.stt.message, /ODK_PERSONAL_AGENT_STT_PROMPT/)
  assert.match(runtime.stt.message, /1024/)
  assert.doesNotMatch(runtime.stt.message, /private-context/)
})

test('main wires validated transcription context including empty opt-out', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'voice-context-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  const initializeSource = source.match(/async function initialize\(env, report, onRideUpdate, platform = process\.platform(?:, getWatch = undefined)?(?:, signal = undefined)?(?:, onAgentUpdate = undefined)?(?:, onRemoteUpdate = undefined)?\) \{[\s\S]*?\n\}/)[0]
  const { transcriptionLanguage, transcriptionPrompt, transcriptionProvider, isLoopbackUrl, isDeviceLocalStt } = await import('../src/transcribe.mjs')
  const { prepareHostDirectories } = await import('../src/host-paths.mjs')
  const initialize = Function('access', 'createPersonalAgent', 'join', 'homedir', 'prepareHostDirectories', 'transcriptionLanguage', 'transcriptionPrompt', 'transcriptionProvider', 'isLoopbackUrl', 'isDeviceLocalStt', 'loadPersonalConfig', 'attachRemoteConversation', `return (${initializeSource})`)(
    async () => {}, async () => ({}), join, () => '/test-home', prepareHostDirectories, transcriptionLanguage, transcriptionPrompt, transcriptionProvider, isLoopbackUrl, isDeviceLocalStt, async () => ({ profile: 'coding' }), async () => undefined,
  )
  for (const prompt of [undefined, '', ' My TypeScript project。 ']) {
    const runtime = await initialize({
      ODK_WORKSPACE: '/test-checkout', ODK_PERSONAL_AGENT_STT_KEY_FILE: '/test-key', ODK_PERSONAL_AGENT_STT_PROMPT: prompt,
      XDG_RUNTIME_DIR: dir, XDG_STATE_HOME: join(dir, 'state'), LOCALAPPDATA: join(dir, 'local'),
      ODK_PERSONAL_AGENT_AUDIO_DEVICE: 'Offline fixture microphone',
    }, () => {})
    assert.equal(runtime.stt.prompt, transcriptionPrompt(prompt))
  }
})

// The transcription provider is a declared request shape, so a cloud desk says so
// in its own configuration instead of having a URL pattern decide for it.
async function initializeFor(t, env, platform) {
  const dir = await mkdtemp(join(tmpdir(), 'voice-provider-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  const initializeSource = source.match(/async function initialize\(env, report, onRideUpdate, platform = process\.platform(?:, getWatch = undefined)?(?:, signal = undefined)?(?:, onAgentUpdate = undefined)?(?:, onRemoteUpdate = undefined)?\) \{[\s\S]*?\n\}/)[0]
  const { transcriptionLanguage, transcriptionPrompt, transcriptionProvider, isLoopbackUrl, isDeviceLocalStt } = await import('../src/transcribe.mjs')
  const { prepareHostDirectories } = await import('../src/host-paths.mjs')
  const initialize = Function('access', 'createPersonalAgent', 'join', 'homedir', 'prepareHostDirectories', 'transcriptionLanguage', 'transcriptionPrompt', 'transcriptionProvider', 'isLoopbackUrl', 'isDeviceLocalStt', 'loadPersonalConfig', 'attachRemoteConversation', `return (${initializeSource})`)(
    async () => {}, async () => ({}), join, () => '/test-home', prepareHostDirectories, transcriptionLanguage, transcriptionPrompt, transcriptionProvider, isLoopbackUrl, isDeviceLocalStt, async () => ({ profile: 'coding' }), async () => undefined,
  )
  const reports = []
  return { reports, runtime: await initialize({ XDG_RUNTIME_DIR: dir, XDG_STATE_HOME: join(dir, 'state'), LOCALAPPDATA: join(dir, 'local'),
      ODK_PERSONAL_AGENT_AUDIO_DEVICE: 'Offline fixture microphone', ...env }, message => reports.push(message), () => {}, platform) }
}

test('the cloud provider declares its own endpoint, model and credential', async t => {
  const credentialFile = await keyFile(t)
  const { reports, runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_PROVIDER: 'aliyun',
    ALIYUNCS_TOKEN: 'device-local-bearer',
  }, 'linux')
  assert.equal(runtime.stt.provider, 'aliyun')
  assert.equal(runtime.stt.model, 'qwen3-asr-flash', 'the cloud desk declares the model it expects, not a name only the multipart endpoint knows')
  assert.equal(runtime.stt.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation')
  assert.equal(runtime.stt.keyFile, undefined, 'the cloud credential is its own environment value, not a key file')
  assert.ok(reports.every(message => !message.includes('ALIYUNCS_TOKEN')), 'optional voice checks do not set the Agent error state')
  // The multipart provider keeps its own credential, model and endpoint.
  const openai = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_KEY_FILE: credentialFile,
  }, 'linux')
  assert.equal(openai.runtime.stt.provider, 'openai')
  assert.equal(openai.runtime.stt.model, 'whisper-1')
  assert.equal(openai.runtime.stt.url, 'https://api.openai.com/v1/audio/transcriptions')
  assert.ok(openai.reports.every(message => !message.includes('ALIYUNCS_TOKEN')))
})

test('missing voice credentials do not block the Agent used by Overview', async t => {
  const { runtime } = await initializeFor(t, { ODK_WORKSPACE: '/configured/desk-checkout', ODK_PERSONAL_AGENT_STT_PROVIDER: 'aliyun' }, 'linux')
  assert.ok(runtime.agent)
  assert.equal(runtime.stt.unavailable, true)
  assert.match(runtime.stt.message, /ALIYUNCS_TOKEN/)
})

test('an undeclared transcription provider is rejected with safe guidance', async t => {
  const { runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_PROVIDER: 'dashscope',
  }, 'linux')
  assert.equal(runtime.stt.unavailable, true)
  assert.match(runtime.stt.message, /ODK_PERSONAL_AGENT_STT_PROVIDER/)
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes('transcriptionProvider'), 'the provider is validated before it is used')
})

test('the cloud provider without its credential never reaches the endpoint', async t => {
  const { runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_PROVIDER: 'aliyun',
  }, 'linux')
  assert.equal(runtime.stt.unavailable, true)
  assert.equal(runtime.stt.url, undefined)
})

test('a Windows host declares its DirectShow microphone or says what is missing', async t => {
  const credentialFile = await keyFile(t)
  const { reports, runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_KEY_FILE: credentialFile,
    ODK_PERSONAL_AGENT_AUDIO_DEVICE: 'Microphone (2- USB Audio Device)',
  }, 'win32')
  assert.ok(reports.every(message => !message.includes('DirectShow')))
  assert.ok(runtime.stt.url, 'a declared Windows microphone still reaches the transcription configuration')
  for (const device of [undefined, '', 'default']) {
    const missing = await initializeFor(t, {
      ODK_WORKSPACE: '/configured/desk-checkout',
      ODK_PERSONAL_AGENT_STT_KEY_FILE: credentialFile,
      ODK_PERSONAL_AGENT_AUDIO_DEVICE: device,
    }, 'win32')
    assert.equal(missing.runtime.stt.unavailable, true)
    assert.match(missing.runtime.stt.message, /DirectShow/)
  }
})

test('plain HTTP STT URL outside loopback disables voice', async t => {
  const { runtime } = await initializeFor(t, {
    ODK_WORKSPACE: '/configured/desk-checkout',
    ODK_PERSONAL_AGENT_STT_KEY_FILE: await keyFile(t),
    ODK_PERSONAL_AGENT_STT_URL: 'http://192.168.1.10:17840/inference',
  }, 'linux')
  assert.equal(runtime.stt.unavailable, true)
  assert.match(runtime.stt.message, /ODK_PERSONAL_AGENT_STT_URL/)
})


test('Windows display entry keeps text available without a microphone or inference configuration', {
  skip: process.platform !== 'win32' ? 'Requires the native Windows display entry and private named pipes' : false,
  timeout: 20000,
}, async t => {
  const directory=await mkdtemp(join(tmpdir(),'odk-display-entry-'))
  const local=privateEndpoint(directory,'display'),upstream=privateEndpoint(directory,'central')
  const token=fixtureToken,commands=[],frames=[],peers=new Set()
  let child,client,fixtureError,stderr=''
  const server=createServer(peer=>{
    peers.add(peer);peer.on('error',()=>{})
    let pending=''
    peer.on('data',chunk=>{
      pending+=chunk
      try {
        let end
        while((end=pending.indexOf('\n'))>=0) {
          const command=JSON.parse(pending.slice(0,end));pending=pending.slice(end+1)
          assert.equal(command.v,1);assert.ok(['host_apps_hello','status','text'].includes(command.type));commands.push(command)
          if(command.type==='host_apps_hello') {
            assert.equal(command.host.platform,'win32')
            peer.write(JSON.stringify({v:1,type:'host_apps_ready'})+'\n')
            continue
          }
          if(command.type==='text') {
            assert.equal(command.text,'Synthetic central text request')
            peer.write(JSON.stringify({v:1,type:'text_receipt',requestId:command.requestId,accepted:true})+'\n')
          }
          peer.write(JSON.stringify({v:1,type:'status',state:'idle',textInput:true,replyInput:true,
            transcript:command.type==='text'?command.text:'',message:command.type==='text'?'Synthetic central answer':''})+'\n')
        }
      } catch(error){fixtureError=error;peer.destroy()}
    })
  })
  t.after(async()=>{
    client?.destroy();for(const peer of peers)peer.destroy()
    if(child&&child.exitCode===null&&child.signalCode===null){const ended=once(child,'close');child.kill('SIGKILL');await ended}
    if(server.listening)await new Promise(resolve=>server.close(resolve))
    await rm(directory,{recursive:true,force:true})
  })
  server.listen(upstream);await once(server,'listening')
  const displayUrl=new URL('../src/display-client.mjs',import.meta.url).href
  const relayUrl=new URL('../src/display-relay.mjs',import.meta.url).href
  assert.match(await readFile(new URL(displayUrl),'utf8'),/from '\.\/display-relay\.mjs'/)
  const wrapper=join(directory,'private-relay.mjs'),preload=join(directory,'private-display-hook.mjs')
  await writeFile(wrapper,`import {createDisplayRelay as actual} from ${JSON.stringify(relayUrl)};
import {connect} from 'node:net';
export const createDisplayRelay=options=>actual({...options,endpoint:${JSON.stringify(local)},stateDir:${JSON.stringify(directory)},token:${JSON.stringify(token)},connect:()=>connect(${JSON.stringify(upstream)}),reconnectMs:60000});
`)
  await writeFile(preload,`import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(context.parentURL===${JSON.stringify(displayUrl)}&&specifier==='./display-relay.mjs')return {url:${JSON.stringify(pathToFileURL(wrapper).href)},shortCircuit:true};
 if(specifier.startsWith('@earendil-works/')||['agent.mjs','transcribe.mjs','jev-client.mjs','judgment-client.mjs'].some(name=>specifier.endsWith('/'+name)))throw Error('Display must not load inference');
 return next(specifier,context);
}});
`)
  const env={PATH:directory,HOME:directory,USERPROFILE:directory,LOCALAPPDATA:join(directory,'local'),APPDATA:join(directory,'appdata'),
    SystemRoot:process.env.SystemRoot,WINDIR:process.env.WINDIR,ODK_PERSONAL_AGENT_MAIN_SSH:'odk-cm5-agent'}
  child=spawn(process.execPath,['--import',pathToFileURL(preload).href,'src/display-client.mjs'],
    {cwd:new URL('..',import.meta.url),env,stdio:['ignore','ignore','pipe']})
  child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(0,2000)})
  const deadline=Date.now()+10000
  while(!client&&Date.now()<deadline&&child.exitCode===null) {
    client=await new Promise(resolve=>{const peer=connect(local);peer.once('error',()=>{peer.destroy();resolve(undefined)});peer.once('connect',()=>resolve(peer))})
    if(!client)await new Promise(resolve=>setTimeout(resolve,25))
  }
  assert.ok(client,'private display entry should start without microphone or provider configuration: '+stderr)
  let pending=''
  client.on('data',chunk=>{try{pending+=chunk;let end;while((end=pending.indexOf('\n'))>=0){frames.push(JSON.parse(pending.slice(0,end)));pending=pending.slice(end+1)}}catch(error){fixtureError=error}})
  client.write(JSON.stringify({v:1,token})+'\n'+JSON.stringify({v:1,type:'status'})+'\n')
  async function waitFor(predicate) {
    const end=Date.now()+5000
    while(!frames.some(predicate)){if(fixtureError)throw fixtureError;assert.equal(child.exitCode,null,stderr);assert.ok(Date.now()<end,'display frame deadline');await new Promise(resolve=>setTimeout(resolve,10))}
    return frames.find(predicate)
  }
  await waitFor(frame=>frame.type==='status'&&frame.state==='idle'&&frame.textInput===true)
  const requestId='11111111-1111-4111-8111-111111111111'
  client.write(JSON.stringify({v:1,type:'text',requestId,text:'Synthetic central text request'})+'\n')
  assert.equal((await waitFor(frame=>frame.type==='text_receipt'&&frame.requestId===requestId)).accepted,true)
  assert.equal((await waitFor(frame=>frame.message==='Synthetic central answer')).transcript,'Synthetic central text request')
  assert.equal(commands.filter(command=>command.type==='text').length,1)
  assert.equal(stderr,'','the display did not load forbidden provider or recording paths')
  await assert.rejects(lstat(join(env.LOCALAPPDATA,'odk','display-captures')),{code:'ENOENT'},'no recording was started')
  const resident=spawn(process.execPath,['src/main.mjs'],{cwd:new URL('..',import.meta.url),env,stdio:['ignore','ignore','pipe']})
  let refusal='';resident.stderr.on('data',chunk=>{refusal=(refusal+chunk).slice(0,2000)})
  t.after(async()=>{if(resident.exitCode===null&&resident.signalCode===null){const ended=once(resident,'close');resident.kill('SIGKILL');await ended}})
  const [code]=await once(resident,'close')
  assert.equal(code,1);assert.match(refusal,/Personal Agent startup failed; check runtime directory and configuration/)
})


test('display client and relay load the installed Shell modules in a flattened release', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'odk-display-layout-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const bot = join(directory, 'integrations', 'personal-agent')
  await mkdir(bot, { recursive: true })
  await cp(new URL('../src', import.meta.url), join(bot, 'src'), { recursive: true })
  await cp(new URL('../package.json', import.meta.url), join(bot, 'package.json'))
  await mkdir(join(directory, 'src'), { recursive: true })
  let shell = new URL('../../../runtime/shell/', import.meta.url)
  try { await lstat(new URL('src/local-channel.js', shell)) } catch (error) {
    if (error.code !== 'ENOENT') throw error
    shell = new URL('../../../', import.meta.url)
  }
  await cp(new URL('package.json', shell), join(directory, 'package.json'))
  await cp(new URL('src/platform', shell), join(directory, 'src', 'platform'), { recursive: true })
  await cp(new URL('src/local-channel.js', shell), join(directory, 'src', 'local-channel.js'))
  await cp(new URL('src/user-app-files.js', shell), join(directory, 'src', 'user-app-files.js'))
  await assert.rejects(lstat(join(directory, 'runtime')), { code: 'ENOENT' })
  // Resolve the existing VAD dependency only. All product modules load from the release copy.
  const preload = join(directory, 'dependency-hook.mjs')
  await writeFile(preload, `import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 if(specifier==='@echogarden/fvad-wasm')return {url:${JSON.stringify(import.meta.resolve('@echogarden/fvad-wasm'))},shortCircuit:true};
 return next(specifier,context);
}});`)
  for (const [name, exported] of [['display-client', 'startDisplayClient'], ['display-relay', 'createDisplayRelay']]) {
    await t.test(name, async () => {
      const entry = pathToFileURL(join(bot, 'src', name + '.mjs')).href
      const child = spawn(process.execPath, ['--import', pathToFileURL(preload).href, '--input-type=module', '--eval',
        `import assert from 'node:assert/strict'; const module=await import(${JSON.stringify(entry)}); assert.equal(typeof module[${JSON.stringify(exported)}], 'function');`],
      { cwd: directory, env: { PATH: directory, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR }, stdio: ['ignore', 'ignore', 'pipe'] })
      t.after(async () => { if (child.exitCode === null && child.signalCode === null) { const ended=once(child,'close');child.kill('SIGKILL');await ended } })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 4000) })
      const [code] = await once(child, 'close')
      assert.equal(code, 0, stderr)
      assert.equal(stderr, '')
    })
  }
})

test('resident voice configuration forwards application identity and the cancellation callback', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  const wiring = source.match(/service\.reserveRemoteRecording = ([^\n]+)/)[1]
  const calls = [], runtime = { stt: { unavailable: false } }, piConfig = { busy: false }
  const reserve = Function('runtime', 'piConfig', 'originalReserve', `return (${wiring})`)(runtime, piConfig, (...args) => { calls.push(args); return true })
  const recording = {}, stop = () => {}, applications = { host: { name: 'Fixture display', platform: 'win32' } }, cancel = () => {}
  assert.equal(reserve(recording, stop, applications, cancel), true)
  assert.deepEqual(calls, [[recording, stop, applications, cancel]])
  piConfig.busy = true
  assert.equal(reserve(recording, stop, applications, cancel), false)
  piConfig.busy = false
  runtime.stt.unavailable = true
  assert.equal(reserve(recording, stop, applications, cancel), false)
  assert.equal(calls.length, 1)
})

test('native configuration preserves the current display binding for typed turns', async () => {
  const source = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8')
  const wiring = /service\.sendText=([^\n]+)/.exec(source)?.[1]
  assert.ok(wiring, 'native configuration text admission remains explicit')
  const calls = [], piConfig = { busy: false }
  const send = Function('piConfig', 'originalText', `return (${wiring})`)(piConfig, (...args) => { calls.push(args); return true })
  const reply = { messageId: 'fixture' }, applications = { host: { name: 'FixtureDisplay', platform: 'win32' } }
  assert.equal(send('Current owner request', reply, applications), true)
  assert.deepEqual(calls, [['Current owner request', reply, applications]])
  piConfig.busy = true
  assert.equal(send('Refused while configuring', reply, applications), false)
  assert.equal(calls.length, 1)
})
