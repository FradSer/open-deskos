const { test } = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { mount } = require('../src/renderer/core/personal-agent-avatar')
function fixture() {
  const document = new EventEmitter(), motion = new EventEmitter(), calls = [], instances = []
  document.hidden = false; motion.matches = false
  for (const target of [document, motion]) { target.addEventListener = target.on; target.removeEventListener = target.off }
  const host = { dataset: {}, replaceChildren() {}, innerHTML: '' }
  const sdk = { poses: new Proxy({}, { get: (_t, key) => key + '-pose' }), create(_host, options) {
    const controller = { play(key) { calls.push(['play',key]); return {ok:true} }, pause() { calls.push(['pause']) }, destroy() { calls.push(['destroy']) } }
    instances.push({controller,options});return controller
  } }
  const avatar = mount(host, { sdk, document, motion })
  return {avatar,host,calls,instances,document,motion}
}
test('Onee follows the entire service flow without restarting repeated frames', async () => {
  const f=fixture()
  for(const [state,phase] of [['starting','preparing'],['recording','listening'],['transcribing','transcribing'],['thinking','thinking']]) {
    f.avatar.update({state});assert.equal(f.host.dataset.phase,phase)
    const count=f.calls.length;f.avatar.update({state});assert.equal(f.calls.length,count)
  }
  f.avatar.update({state:'thinking',message:'Partial answer'});assert.equal(f.host.dataset.phase,'replying')
  f.avatar.update({state:'idle',message:'Final answer'});assert.equal(f.host.dataset.phase,'complete')
  f.instances.at(-1).options.onAnimationEnd('response-complete');await Promise.resolve();assert.equal(f.host.dataset.phase,'idle')
  f.avatar.update({state:'error'});assert.equal(f.host.dataset.phase,'error')
  f.avatar.update({state:'unavailable'});assert.equal(f.host.dataset.phase,'unavailable')
  f.avatar.destroy()
})
test('Onee reacts once to new reports, preserves work, and ignores stale completion callbacks', () => {
  const f=fixture();f.avatar.update({state:'idle',remote:{messages:[{id:'old'}]}})
  assert.equal(f.host.dataset.phase,'idle')
  f.avatar.update({state:'idle',remote:{messages:[{id:'old'},{id:'new'}]}});assert.equal(f.host.dataset.phase,'notification')
  f.avatar.update({state:'thinking'});f.instances.at(-1).options.onAnimationEnd('new-report')
  assert.equal(f.host.dataset.phase,'thinking')
  f.avatar.update({state:'idle',agents:{state:'live',tasks:[{state:'running'}]}});assert.equal(f.host.dataset.phase,'working')
  f.avatar.destroy()
})
test('Onee pauses in the background, changes static poses for reduced motion, and releases everything', () => {
  const f=fixture();f.avatar.update({state:'recording'})
  f.document.hidden=true;f.document.emit('visibilitychange');assert.equal(f.host.dataset.playback,'paused')
  const pausedPlays=f.calls.filter(call=>call[0]==='play').length;f.avatar.update({state:'recording'});assert.equal(f.calls.filter(call=>call[0]==='play').length,pausedPlays,'hidden status replay cannot resume animation')
  f.document.hidden=false;f.document.emit('visibilitychange');assert.equal(f.host.dataset.playback,'playing')
  f.motion.matches=true;f.motion.emit('change');assert.equal(f.host.dataset.playback,'reduced')
  f.avatar.update({state:'thinking'});assert.equal(f.instances.at(-1).options.defaultExpression,'thinking-pose')
  const callback=f.instances.at(-1).options.onAnimationEnd;f.avatar.destroy();const count=f.calls.length
  f.avatar.update({state:'idle'});callback('response-complete');f.document.emit('visibilitychange');f.motion.emit('change')
  assert.equal(f.calls.length,count);assert.equal(f.document.listenerCount('visibilitychange'),0);assert.equal(f.motion.listenerCount('change'),0)
})
test('Onee preserves input feedback and falls back safely when the engine fails', () => {
  const f=fixture();f.avatar.update({state:'idle'});f.avatar.engage(true);assert.equal(f.host.dataset.phase,'attentive')
  const token=f.avatar.intent('sending');f.avatar.engage(true);assert.equal(f.host.dataset.phase,'sending');f.avatar.update({state:'thinking'});f.avatar.fail(token);assert.equal(f.host.dataset.phase,'thinking')
  const failed=f.avatar.intent('sending');f.avatar.fail(failed);assert.equal(f.host.dataset.phase,'error');f.avatar.destroy()
  const host={dataset:{},replaceChildren(){},innerHTML:''}
  const avatar=mount(host,{sdk:{create(){throw Error('unavailable') }},document:new EventEmitter(),motion:new EventEmitter()})
  assert.match(host.innerHTML,/onee.svg/);assert.equal(host.dataset.playback,'unavailable');assert.doesNotThrow(()=>avatar.update({state:'thinking'}));avatar.destroy()
})


test('the bundled asset is the upstream Onee model and the Shell keeps strict CSP', () => {
  const fs=require('node:fs'),path=require('node:path')
  const dir=path.join(__dirname,'../src/renderer')
  require('node:child_process').execFileSync(process.execPath,[path.join(__dirname,'../scripts/build-onee-avatar.mjs')])
  const model=JSON.parse(fs.readFileSync(path.join(dir,'avatars/onee.avatar.json'),'utf8'))
  assert.equal(model.name,'Onee');assert.equal(model.body.primary.type,'cone')
  assert.equal(model.body.primary.width,250);assert.equal(model.body.primary.tipRoundness,2)
  assert.equal(model.expressions['angry-brows'].colors.body,'#ba3636');assert.equal(model.expressions['uneasy-left'].colors.body,'#adc3ff');
  assert.equal(model.colors.body,'#dbe2f5');assert.ok(Math.abs(model.expressions.neutral.eyes.left.width-13.3890625)<1e-9)
  const index=fs.readFileSync(path.join(dir,'index.html'),'utf8')
  assert.doesNotMatch(index,/unsafe-eval|unsafe-inline/)
  assert.doesNotMatch(fs.readFileSync(path.join(dir,'avatars/onee-sdk.js'),'utf8'),/new Function\s*\(|\beval\s*\(/)
})

test('enabling reduced motion during a finite reaction returns to the actual idle state', () => {
  const f=fixture();f.avatar.update({state:'thinking'});f.avatar.update({state:'idle',message:'Done'})
  assert.equal(f.host.dataset.phase,'complete')
  f.motion.matches=true;f.motion.emit('change');assert.equal(f.host.dataset.phase,'idle')
  f.avatar.update({state:'idle'});assert.equal(f.host.dataset.phase,'idle');assert.equal(f.host.dataset.playback,'reduced');f.avatar.destroy()
})

test('rejected input and unrelated idle frames cannot celebrate an earlier answer', () => {
  const f=fixture()
  f.avatar.update({state:'idle',ownerTurnId:'previous',message:'Previous answer'})
  f.avatar.fail(f.avatar.intent('sending'))
  assert.equal(f.host.dataset.phase,'error')
  f.avatar.update({state:'idle',ownerTurnId:'previous',message:'Previous answer'})
  assert.equal(f.host.dataset.phase,'idle','rejected input has no completed service turn')
  f.avatar.update({state:'thinking',ownerTurnId:'next',message:'Previous answer'})
  f.avatar.update({state:'idle',ownerTurnId:'previous',message:'Previous answer'})
  assert.equal(f.host.dataset.phase,'idle','an older turn cannot complete current work')
  f.avatar.update({state:'thinking',ownerTurnId:'next',message:'Partial answer'})
  f.avatar.update({state:'idle',ownerTurnId:'next',message:'Final answer'})
  assert.equal(f.host.dataset.phase,'complete')
  f.avatar.destroy()
  const voice=fixture()
  voice.avatar.update({state:'idle',ownerTurnId:'previous',message:'Same answer'})
  voice.avatar.update({state:'recording'})
  voice.avatar.update({state:'transcribing'})
  voice.avatar.update({state:'thinking',ownerTurnId:'next',message:''})
  voice.avatar.update({state:'idle',ownerTurnId:'next',message:'Same answer'})
  assert.equal(voice.host.dataset.phase,'complete','a voice turn acquires its identity after recording')
  voice.avatar.destroy()
})
