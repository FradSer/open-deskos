'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { parseApiSources, isPublicAddress, createUserAppApi } = require('../src/user-app-api')
const revision = 'a'.repeat(32)
const source = { url: 'https://clock.example/time?zone=UTC', refreshMs: 10000 }
const app = { id: 'clock', revision, api: { clock: source } }
function fixture(overrides = {}) {
  let calls = 0, now = 100
  const api = createUserAppApi({ store: { getContent: async () => ({ ok: true, app }) },
    requestJson: async () => { calls++; return { datetime: String(now) } }, now: () => now, ...overrides })
  return { api, count: () => calls, tick: () => { now += 10001 } }
}
test('declarations allow only bounded named public HTTPS sources', () => {
  assert.deepEqual(parseApiSources({ clock: source }), { clock: source })
  for (const url of ['http://clock.example/', 'https://user:pass@clock.example/', 'https://localhost/', 'https://127.0.0.1/', 'https://10.0.0.1/', 'https://[::1]/', 'https://clock.example:8443/', 'https://clock.example/#fragment']) {
    assert.throws(() => parseApiSources({ clock: { ...source, url } }), /invalid-api/)
  }
  for (const api of [[], null, { clock: { ...source, refreshMs: 1 } }, { clock: { ...source, headers: {} } }, { constructor: source }]) assert.throws(() => parseApiSources(api), /invalid-api/)
})
test('address checks reject local, mapped, reserved and multicast ranges', () => {
  for (const ip of ['127.0.0.1','10.1.2.3','169.254.169.254','100.64.1.1','192.168.1.1','0.0.0.0','224.0.0.1','192.0.2.1','198.18.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','ff02::1','2001:db8::1']) assert.equal(isPublicAddress(ip), false, ip)
  for (const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111']) assert.equal(isPublicAddress(ip), true, ip)
})
test('current installed declarations authorize reads, deduplicate and cache them', async () => {
  const f = fixture()
  const [a,b] = await Promise.all([f.api.read('clock',revision,'clock'),f.api.read('clock',revision,'clock')])
  assert.equal(a.state,'live'); assert.deepEqual(a,b); assert.equal(f.count(),1)
  await f.api.read('clock',revision,'clock'); assert.equal(f.count(),1)
  assert.equal((await f.api.read('clock','b'.repeat(32),'clock')).error,'revision-changed')
  assert.equal((await f.api.read('clock',revision,'unknown')).error,'source-not-declared')
  f.tick(); const next = await f.api.read('clock',revision,'clock'); assert.notEqual(a.retrievedAt,next.retrievedAt); assert.equal(f.count(),2)
  await f.api.close()
  assert.equal((await f.api.read('clock',revision,'clock')).error,'runtime-stopped')
})
test('a failed refresh retains previous data with explicit stale state', async () => {
  let fail = false
  const f = fixture({ requestJson: async () => { if (fail) throw Error('network'); return { time: 1 } } })
  const first = await f.api.read('clock',revision,'clock'); fail=true; f.tick()
  const stale = await f.api.read('clock',revision,'clock')
  assert.equal(stale.state,'stale'); assert.deepEqual(stale.data,first.data); assert.equal(stale.retrievedAt,first.retrievedAt)
  assert.equal(stale.error,'api-unavailable'); await f.api.close()
})

test('DNS rebinding and mixed public/private answers never start HTTPS', async () => {
  const { requestPublicJson } = require('../src/user-app-api')
  for (const addresses of [[{ address:'127.0.0.1',family:4 }],[{address:'8.8.8.8',family:4},{address:'169.254.169.254',family:4}]]) {
    let requests = 0
    await assert.rejects(requestPublicJson(source.url,{ lookup:async()=>addresses,get:()=>{requests++} }),/address-blocked/)
    assert.equal(requests,0)
  }
})
test('HTTPS pins checked DNS, refuses redirects, malformed and oversized responses', async () => {
  const { requestPublicJson } = require('../src/user-app-api')
  const { PassThrough } = require('node:stream')
  const { EventEmitter } = require('node:events')
  for (const [status, type, body, error] of [[200,'application/json','{"utc":1}',null],[302,'application/json','{}','response-rejected'],[200,'text/html','{}','response-rejected'],[200,'application/json','broken','invalid-json'],[200,'application/json',' '.repeat(65537),'response-too-large']]) {
    let used
    const get = (_url, options, callback) => {
      used=options; const request=new EventEmitter()
      queueMicrotask(()=>{const response=new PassThrough();response.statusCode=status;response.headers={'content-type':type};callback(response);response.end(body)})
      return request
    }
    const call=requestPublicJson(source.url,{ lookup:async()=>[{address:'8.8.8.8',family:4}],get })
    if(error) await assert.rejects(call,new RegExp(error));else assert.deepEqual(await call,{utc:1})
    used.lookup('clock.example',{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');assert.equal(family,4)})
    assert.equal(used.agent,false);assert.equal(used.autoSelectFamily,false)
  }
})
test('timeout and runtime closure settle pending reads without publishing late results', async () => {
  let release
  const slow = new Promise(resolve=>{release=resolve})
  const f=fixture({requestJson:()=>slow,timeoutMs:10})
  const read=f.api.read('clock',revision,'clock')
  assert.equal((await read).error,'api-timeout')
  release({utc:1});await f.api.close()
  const g=fixture({requestJson:(_url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')))),timeoutMs:1000})
  const pending=g.api.read('clock',revision,'clock')
  await new Promise(resolve=>setImmediate(resolve))
  await g.api.close();assert.equal((await pending).error,'runtime-stopped')
})
test('a revision change during a request prevents old source publication', async () => {
  let active=app,release
  const f=fixture({store:{getContent:async()=>({ok:true,app:active})},requestJson:()=>new Promise(resolve=>{release=resolve})})
  const pending=f.api.read('clock',revision,'clock');await new Promise(resolve=>setImmediate(resolve))
  active={...app,revision:'b'.repeat(32)};release({utc:1})
  assert.equal((await pending).error,'revision-changed');await f.api.close()
})

test('configured public DNS resolves through fixed HTTPS and retains address checks', async () => {
  const { lookupPublicDns } = require('../src/user-app-api')
  let requested
  const request=async(url,options)=>{requested={url,options};return {Status:0,Answer:[{type:5,data:'alias.example'},{type:1,data:'8.8.8.8'}]}}
  assert.deepEqual(await lookupPublicDns('clock.example',{request}),[{address:'8.8.8.8',family:4}])
  assert.equal(requested.url,'https://1.1.1.1/dns-query?name=clock.example&type=A')
  assert.equal(requested.options.accept,'application/dns-json')
  await assert.rejects(lookupPublicDns('clock.example',{request:async()=>({Status:0,Answer:[{type:1,data:'127.0.0.1'}]})}),/address-blocked/)
  await assert.rejects(lookupPublicDns('clock.example',{request:async()=>({Status:3})}),/dns-unavailable/)
})
