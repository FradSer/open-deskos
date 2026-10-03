import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,chmod,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDidiTransport, boundedDidiFetch } from '../src/didi/transport.mjs';

test('SDK initialized notification is covered by connection deadline',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'didi-connect-'));t.after(()=>rm(dir,{recursive:true,force:true}));const keyFile=join(dir,'key');await writeFile(keyFile,'test-only-key',{mode:0o600});let closed=false;
 const transport={start:async()=>{},close:async()=>{closed=true;},send:async message=>{if(message.method==='initialize')queueMicrotask(()=>transport.onmessage({jsonrpc:'2.0',id:message.id,result:{protocolVersion:'2025-03-26',capabilities:{},serverInfo:{name:'fake',version:'1'}}}));if(message.method==='notifications/initialized')await new Promise(()=>{});}};
 await assert.rejects(createDidiTransport({keyFile,connectTimeoutMs:25,transportFactory:()=>transport}));assert.equal(closed,true);
});

test('HTTP wrapper bounds streamed response bytes and forces redirect rejection',async()=>{
 let observed;
 const fetch=boundedDidiFetch(async(_url,init)=>{observed=init;return new Response('12345');},1000,4);
 const response=await fetch('https://example.invalid',{});await assert.rejects(response.text());assert.equal(observed.redirect,'error');assert.ok(observed.signal instanceof AbortSignal);
});

test('transport parses map text and taxi structured data, allowlists, and redacts exceptions',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'didi-transport-'));t.after(()=>rm(dir,{recursive:true,force:true}));const keyFile=join(dir,'key');await writeFile(keyFile,'test-only-key',{mode:0o600});let fail=false;let received;
 const client={connect:async()=>{},close:async()=>{},callTool:async({name})=>{if(fail)throw Error('https://mcp.didichuxing.com/?key=test-only-key');return name==='maps_textsearch'?{content:[{type:'text',text:'[]'}]}:{structuredContent:{traceId:'trace'}};}};
 const transport=await createDidiTransport({keyFile,clientFactory:()=>client,transportFactory:url=>{received=url;return {};}});assert.equal(received.pathname,'/mcp-servers-sandbox');assert.deepEqual(await transport.call('maps_textsearch',{}),[]);assert.deepEqual(await transport.call('taxi_estimate',{}),{traceId:'trace'});await assert.rejects(transport.call('arbitrary',{}));fail=true;await assert.rejects(transport.call('taxi_estimate',{}),error=>!error.message.includes('test-only-key')&&!error.message.includes('https'));await transport.close();await chmod(keyFile,0o644);await assert.rejects(createDidiTransport({keyFile,clientFactory:()=>client}));
});

test('Given text-only query, When SDK returns informational text, Then only query gets bounded unavailable fallback',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'didi-text-'));t.after(()=>rm(dir,{recursive:true,force:true}));const keyFile=join(dir,'key');await writeFile(keyFile,'test-only-key',{mode:0o600});
 let result={content:[{type:'text',text:'司机已经到达起点附近，请尽快上车。'}]};
 const client={connect:async()=>{},close:async()=>{},callTool:async()=>result};
 const transport=await createDidiTransport({keyFile,clientFactory:()=>client,transportFactory:()=>({})});t.after(()=>transport.close());
 assert.deepEqual(await transport.call('taxi_query_order',{}),{statusUnavailable:true,statusText:result.content[0].text});
 for(const name of ['taxi_create_order','taxi_estimate','taxi_cancel_order','taxi_get_driver_location']) await assert.rejects(transport.call(name,{}));
 result={content:[{type:'text',text:'x'.repeat(5000)}]};assert.equal((await transport.call('taxi_query_order',{})).statusText.length,4096);
 for(const invalid of [{content:[]},{content:[{type:'text',text:'  '}]},{content:[{type:'image',data:'abc'}]},{isError:true,content:[{type:'text',text:'失败'}]},{structuredContent:{},content:[{type:'text',text:'完成'}]}]) {
 result=invalid;
 if(invalid.structuredContent) assert.deepEqual(await transport.call('taxi_query_order',{}),{});
 else await assert.rejects(transport.call('taxi_query_order',{}));
 }
});
