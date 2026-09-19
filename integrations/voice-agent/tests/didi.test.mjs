import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRideEngine } from '../src/didi/engine.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'didi-test-'));
  const calls = []; let failCreate = false; let now = 100; let statusCode = 0; const timers = [];
  const call = async (name,args) => {
    calls.push({name,args});
    if(name==='maps_textsearch') return [{display_name:args.keywords,location:{lng:1,lat:2}}];
    if(name==='taxi_estimate') return {traceId:'trace',items:[{productName:'快车',productCategory:'1',priceText:'20元'}]};
    if(name==='taxi_create_order') { assert.equal(JSON.parse(await readFile(join(dir,'state.json'),'utf8')).phase,'submitting'); if(failCreate) throw Error('secret'); return {orderId:'order',statusCode:0}; }
    if(name==='taxi_query_order') return {orderId:args.order_id || 'unrelated',statusCode};
    if(name==='taxi_cancel_order') return {success:true};
    return {};
  };
  const options = {stateFile:join(dir,'state.json'),call,now:()=>now,setTimer:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimer:()=>{}};
  const engine=await createRideEngine(options); t.after(async()=>{await engine.close();await rm(dir,{recursive:true,force:true});});
  async function quote() { await engine.search({keywords:'A',city:'北京市'});await engine.search({keywords:'B',city:'北京市'});await engine.estimate({from_lng:'1',from_lat:'2',from_name:'A',to_lng:'1',to_lat:'2',to_name:'B'});return engine.propose({productCategory:'1'}); }
  return {engine,quote,calls,options,timers,dir,fail:()=>{failCreate=true;},expire:()=>{now+=300001;},status:(s)=>{statusCode=s;}};
}
test('only subsequent host confirmation permits one create; state is private',async t=>{
 const f=await fixture(t);const p=await f.quote();await assert.rejects(f.engine.submit());f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();await assert.rejects(f.engine.submit());assert.equal(f.calls.filter(x=>x.name==='taxi_create_order').length,1);assert.equal((await stat(join(f.dir,'state.json'))).mode&0o777,0o600);
});
test('expired and changed quotes revoke confirmation',async t=>{
 const f=await fixture(t);let p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);f.expire();await assert.rejects(f.engine.submit());p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.quote();await assert.rejects(f.engine.submit());
});
test('ambiguous create blocks retry and never adopts an unrelated account order after restart',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);f.fail();await f.engine.submit();assert.equal(f.engine.snapshot().phase,'unknown');await f.engine.close();const restarted=await createRideEngine(f.options);await restarted.status();assert.equal(restarted.snapshot().phase,'unknown');assert.equal(restarted.snapshot().order,null);await assert.rejects(restarted.submit());await assert.rejects(restarted.estimate({}));await restarted.close();
});
test('cancel separately requires current user confirmation',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();const c=await f.engine.proposeCancel({reason:'计划改变'});await assert.rejects(f.engine.cancel());f.engine.beginTurn(c.confirmationPhrase);await f.engine.cancel();assert.equal(f.engine.snapshot().phase,'terminal');await assert.rejects(f.engine.cancel());
});
test('poll intervals and terminal stop',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();assert.equal(f.timers.at(-1).ms,30000);f.status(2);await f.engine.status();assert.equal(f.timers.at(-1).ms,60000);f.status(5);await f.engine.status();assert.equal(f.engine.snapshot().phase,'terminal');
});
test('concurrent submissions consume only one authorization',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);const results=await Promise.allSettled([f.engine.submit(),f.engine.submit()]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.calls.filter(c=>c.name==='taxi_create_order').length,1);
});
test('second controller cannot own same state, and sandbox cannot change persisted identity',async t=>{
 const f=await fixture(t);await assert.rejects(createRideEngine(f.options));await f.engine.close();await assert.rejects(createRideEngine({...f.options,sandbox:false}));
});
test('fresh process cannot open a state file owned by resident controller',async t=>{
 const f=await fixture(t);const moduleUrl=new URL('../src/didi/engine.mjs',import.meta.url).href;
 const script=`import {createRideEngine} from ${JSON.stringify(moduleUrl)};try { await createRideEngine({stateFile:process.argv[1],call:async()=>({})});process.exitCode=2; } catch { process.stdout.write('locked'); }`;
 const result=await promisify(execFile)(process.execPath,['--input-type=module','-e',script,f.options.stateFile]);assert.equal(result.stdout,'locked');
});
test('cancel uncertainty cannot silently permit another cancellation',async t=>{
 const f=await fixture(t);await f.engine.close();const engine=await createRideEngine({...f.options,call:async(name,args)=>{if(name==='taxi_cancel_order')throw Error('lost');return f.options.call(name,args);}});
 await engine.search({keywords:'A',city:'北京市'});await engine.search({keywords:'B',city:'北京市'});await engine.estimate({from_lng:'1',from_lat:'2',from_name:'A',to_lng:'1',to_lat:'2',to_name:'B'});const p=await engine.propose({productCategory:'1'});engine.beginTurn(p.confirmationPhrase);await engine.submit();const c=await engine.proposeCancel();engine.beginTurn(c.confirmationPhrase);await engine.cancel();await engine.status();assert.equal(engine.snapshot().phase,'cancel_unknown');await assert.rejects(engine.proposeCancel());await engine.close();
});
test('unrecognized status cannot terminate an order or permit duplicate creation',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();f.status('UNRECOGNIZED');await f.engine.status();assert.equal(f.engine.snapshot().phase,'unknown');await assert.rejects(f.engine.estimate({}));
});
test('malformed or mismatched returned identity cannot overwrite trusted order ID',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();await f.engine.close();
 for(const orderId of [null,'','other',123]) {
 const engine=await createRideEngine({...f.options,call:async()=>({orderId,statusCode:0})});await assert.rejects(engine.status());assert.equal(engine.snapshot().order.orderId,'order');assert.equal(engine.snapshot().phase,'active');await engine.close();
 }
});
test('malformed status types never authorize terminal state',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();
 for(const status of [[5],{},true,null]) {f.status(status);await f.engine.status();assert.equal(f.engine.snapshot().phase,'unknown');await assert.rejects(f.engine.estimate({}));}
});
test('cancel uncertainty stays sticky across unknown then active statuses',async t=>{
 const f=await fixture(t);await f.engine.close();const engine=await createRideEngine({...f.options,call:async(name,args)=>{if(name==='taxi_cancel_order')throw Error('lost');return f.options.call(name,args);}});
 await engine.search({keywords:'A',city:'北京市'});await engine.search({keywords:'B',city:'北京市'});await engine.estimate({from_lng:'1',from_lat:'2',from_name:'A',to_lng:'1',to_lat:'2',to_name:'B'});const p=await engine.propose({productCategory:'1'});engine.beginTurn(p.confirmationPhrase);await engine.submit();const c=await engine.proposeCancel();engine.beginTurn(c.confirmationPhrase);await engine.cancel();
 f.status('UNRECOGNIZED');await engine.status();assert.equal(engine.snapshot().phase,'cancel_unknown');f.status(0);await engine.status();assert.equal(engine.snapshot().phase,'cancel_unknown');await assert.rejects(engine.proposeCancel());await engine.close();
});
test('unsearched endpoints are rejected',async t=>{const f=await fixture(t);await assert.rejects(f.engine.estimate({from_lng:'1',from_lat:'2',from_name:'invented',to_lng:'1',to_lat:'2',to_name:'B'}));});

test('Given active order, When query is text-only, Then identity stays blocked and polling continues until structured recovery',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();await f.engine.close();
 let result={statusUnavailable:true,statusText:'订单已完成，取消成功。'};
 const engine=await createRideEngine({...f.options,call:async()=>result});t.after(()=>engine.close());
 const state=await engine.status();assert.equal(state.phase,'unknown');assert.equal(state.order.orderId,'order');assert.equal(state.order.statusCode,0);assert.equal(state.order.statusUnavailable,true);assert.equal(state.order.statusText,result.statusText);assert.equal(state.sandbox,true);assert.equal(f.timers.at(-1).ms,30000);
 await assert.rejects(engine.estimate({}));await assert.rejects(engine.proposeCancel());await assert.rejects(engine.cancel());
 result={statusUnavailable:true,statusText:'x'.repeat(5000)};await assert.rejects(engine.status());
 result={statusUnavailable:true,statusText:' '};await assert.rejects(engine.status());
 result={statusUnavailable:true,statusText:'到达',orderId:'other'};await assert.rejects(engine.status());assert.equal(engine.snapshot().order.orderId,'order');
 result={orderId:'order',statusCode:2};const recovered=await engine.status();assert.equal(recovered.phase,'active');assert.equal(recovered.order.statusUnavailable,undefined);assert.equal(recovered.order.statusText,undefined);assert.equal(f.timers.at(-1).ms,60000);await engine.close();
});

test('Given arrived order and text-only cancel response, Then uncertainty polls every 30 seconds across restart',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);await f.engine.submit();f.status(2);await f.engine.status();await f.engine.close();
 const options={...f.options,call:async(name,args)=>name==='taxi_cancel_order'?{content:[{type:'text',text:'取消成功'}]}:name==='taxi_query_order'?{statusUnavailable:true,statusText:'行程结束'}:f.options.call(name,args)};
 const engine=await createRideEngine(options);const proposal=await engine.proposeCancel();engine.beginTurn(proposal.confirmationPhrase);assert.equal((await engine.cancel()).phase,'cancel_unknown');
 assert.equal((await engine.status()).phase,'cancel_unknown');await assert.rejects(engine.proposeCancel());await engine.close();
 const restarted=await createRideEngine(options);t.after(()=>restarted.close());assert.equal(restarted.snapshot().order.orderId,'order');assert.equal(restarted.snapshot().order.statusUnavailable,true);assert.equal(f.timers.at(-1).ms,30000);await assert.rejects(restarted.estimate({}));await restarted.close();
});
test('Given ambiguous create, Then text-only account query never supplies order identity',async t=>{
 const f=await fixture(t);const p=await f.quote();f.engine.beginTurn(p.confirmationPhrase);f.fail();await f.engine.submit();await f.engine.close();
 const engine=await createRideEngine({...f.options,call:async()=>({statusUnavailable:true,statusText:'订单已完成'})});t.after(()=>engine.close());
 const state=await engine.status();assert.equal(state.order,null);assert.equal(state.phase,'unknown');assert.equal(state.reconciliation.identityVerified,false);assert.equal(state.reconciliation.currentOrder.statusUnavailable,true);assert.equal(f.timers.at(-1).ms,30000);await assert.rejects(engine.estimate({}));await engine.close();
});
