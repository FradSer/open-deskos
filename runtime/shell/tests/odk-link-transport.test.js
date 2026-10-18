'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createOdkLinkTransport } = require('../src/odk-link-client')

test('Open DeskOS Link exposes raw transport without constructing a client', async () => {
  const requests = []
  const transport = createOdkLinkTransport({ socketPath: '/fixture/link.sock', platform: 'linux',
    send: async (...args) => { requests.push(args); return { machines: ['fixture'] } } })
  assert.equal(requests.length, 0)
  assert.equal(transport.socketPath, '/fixture/link.sock')
  const controller = new AbortController()
  assert.deepEqual(await transport.request({ v: 1, type: 'machines' }, { signal: controller.signal }), { machines: ['fixture'] })
  assert.deepEqual(requests[0].slice(0, 3), ['/fixture/link.sock', { v: 1, type: 'machines' }, undefined])
  assert.equal(requests[0][3].signal, controller.signal)
  assert.equal(requests[0][3].token, '')
  controller.abort()
  assert.equal(await transport.request({ v: 1, type: 'machines' }, { signal: controller.signal }), null)
  assert.equal(requests.length, 1)
})

test('raw Open DeskOS Link transport retains token handshake inputs', async () => {
  const transport = createOdkLinkTransport({ socketPath: '\\\\.\\pipe\\fixture-link', platform: 'win32', token: 'fixture-only',
    send: async (_endpoint, _record, _timeout, channel) => channel })
  const channel = await transport.request({ v: 1, type: 'machines' })
  assert.equal(channel.token, 'fixture-only')
  assert.equal(channel.platform, 'win32')
})

test('Main grants raw Open DeskOS Link transport alongside the default constructor', () => {
  const main = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8')
  assert.ok(/'source\.odk-link':\s*\{\s*create:\s*createOdkLinkClient,\s*createTransport:\s*createOdkLinkTransport,\s*options:/.test(main))
})

test('completion subscription rejects malformed hints and abort joins its only socket', {skip:require('./not-ported').posixOnlyReason('unix-socket'),timeout:3000}, async t=>{
  const net=require('node:net'),os=require('node:os')
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'odk-completion-abort-')),endpoint=path.join(root,'s.sock')
  const peers=new Set(),requests=[],hints=[]
  const server=net.createServer(peer=>{peers.add(peer);peer.on('error',()=>{});peer.once('close',()=>peers.delete(peer));peer.on('data',chunk=>{requests.push(JSON.parse(chunk));peer.write('{"v":1,"type":"completion","text":"private"}\nnot-json\n'+JSON.stringify({v:2,type:'completion'})+'\n'+JSON.stringify({v:1,type:'completion',body:'x'.repeat(300)})+'\n')})})
  server.listen(endpoint);await new Promise(r=>server.once('listening',r))
  t.after(async()=>{for(const peer of peers)peer.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true})})
  const controller=new AbortController(),transport=createOdkLinkTransport({socketPath:endpoint,reconnectDelayMs:10000})
  const subscription=transport.subscribeCompletions(hint=>hints.push(hint),{signal:controller.signal})
  const stop=()=>subscription.stop()
  try {
    const end=Date.now()+1000;while(!requests.length&&Date.now()<end)await new Promise(r=>setTimeout(r,5))
    assert.deepEqual(requests,[{v:1,type:'subscribe-completions'}]);await new Promise(r=>setTimeout(r,20));assert.deepEqual(hints,[])
    controller.abort();await stop();await new Promise(r=>setTimeout(r,20));assert.equal(peers.size,0);assert.equal(requests.length,1)
    const alreadyAborted=new AbortController();alreadyAborted.abort()
    await transport.subscribeCompletions(()=>assert.fail('late callback'),{signal:alreadyAborted.signal}).stop()
    assert.equal(requests.length,1)
  } finally {await stop()}
})

test('a connected legacy runtime cannot leave completion notification availability pending forever', {skip:require('./not-ported').posixOnlyReason('unix-socket'),timeout:3000}, async t=>{
  const net=require('node:net'),os=require('node:os')
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'odk-completion-legacy-')),endpoint=path.join(root,'s.sock'),peers=new Set(),requests=[]
  const server=net.createServer(peer=>{peers.add(peer);peer.on('error',()=>{});peer.once('close',()=>peers.delete(peer));peer.on('data',chunk=>requests.push(JSON.parse(chunk)))})
  server.listen(endpoint);await new Promise(r=>server.once('listening',r))
  t.after(async()=>{for(const peer of peers)peer.destroy();await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true})})
  const subscription=createOdkLinkTransport({socketPath:endpoint,reconnectDelayMs:5,completionTimeoutMs:30}).subscribeCompletions(()=>assert.fail('legacy runtime did not acknowledge'))
  try {
    await new Promise(r=>setTimeout(r,100));assert.equal(peers.size,0,'unsupported runtime connection is bounded and closed')
    assert.deepEqual(subscription.snapshot(),{state:'unsupported'})
    assert.deepEqual(requests,[{v:1,type:'subscribe-completions'}],'unsupported protocol does not retry or poll')
  } finally {await (typeof subscription==='function'?subscription():subscription.stop())}
})
