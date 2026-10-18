import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createJevClient,checkJevAuthentication} from '../src/jev-client.mjs'

test('OpenCode Jev uses the Console System One endpoint and its own credential',async()=>{
 let count=0
 const ask=createJevClient({env:{ODK_JEV_PROVIDER:'opencode',OPENCODE_API_KEY:'synthetic-console',TYPESAFE_API_KEY:'synthetic-typesafe'},fetchImpl:async(url,options)=>{
  count++;assert.equal(url,'https://opencode.ai/inference/systemone/v1/systemone');assert.equal(options.headers.authorization,'Bearer synthetic-console')
  const body=JSON.parse(options.body);assert.equal(body.model,'jev-1.13');assert.deepEqual(body.state,{sample:'public'})
  return new Response(JSON.stringify({model:'jev-1.13',answers:{check:{type:'noul',noul:0.9}}}))
 }})
 await ask({state:{sample:'public'},questions:{check:{type:'noul',instructions:'Check the public sample'}}});assert.equal(count,1)
})

const module = () => import('../src/provider-endpoints.mjs')
test('fixed API-family endpoints separate Console and Go without System One fallback',async()=>{
 const {resolveProviderEndpoint: endpoint}=await module()
 for(const [provider,prefix] of [['opencode','https://opencode.ai/inference'],['opencode-go','https://opencode.ai/inference/go']]) {
  assert.equal(endpoint(provider,'openai-completions'),prefix+'/openai/v1')
  assert.equal(endpoint(provider,'openai-responses'),prefix+'/openai/v1')
  assert.equal(endpoint(provider,'anthropic-messages'),prefix+'/anthropic')
 }
 assert.equal(endpoint('opencode','google-generative-ai'),'https://opencode.ai/inference/google/v1beta')
 for(const [provider,role] of [['opencode-go','systemone'],['opencode-go','google-generative-ai'],['other','systemone'],['opencode','arbitrary']])assert.throws(()=>endpoint(provider,role),e=>e.code==='configuration')
})
test('credentials do not fall through between TypeSafe, Console and Go',async()=>{
 const {resolveProviderCredential: key}=await module()
 const env={TYPESAFE_API_KEY:'synthetic-typesafe',OPENCODE_API_KEY:'synthetic-console',OPENCODE_GO_API_KEY:'synthetic-go'}
 for(const [provider,expected] of [['typesafe',env.TYPESAFE_API_KEY],['opencode',env.OPENCODE_API_KEY],['opencode-go',env.OPENCODE_GO_API_KEY]])assert.equal(key(provider,{env}),expected)
 assert.throws(()=>key('opencode-go',{env:{OPENCODE_API_KEY:'synthetic-console'}}),e=>e.code==='missing_credential')
 assert.throws(()=>key('opencode',{env:{OPENCODE_GO_API_KEY:'synthetic-go',TYPESAFE_API_KEY:'synthetic-typesafe'}}),e=>e.code==='missing_credential')
 assert.throws(()=>key('typesafe',{env:{OPENCODE_API_KEY:'synthetic-console'}}),e=>e.code==='missing_credential')
 assert.throws(()=>key('opencode',{env:{OPENCODE_API_KEY:'synthetic\nsecret'}}),e=>e.code==='configuration'&&!e.message.includes('secret'))
})
test('provider private files use the existing private-file contract',async t=>{
 const {mkdtemp,realpath,writeFile,rm,chmod}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {protectProactivePath}=await import('../src/proactive-private.mjs'),{resolveProviderCredential:key}=await module()
 const dir=await realpath(await mkdtemp(join(tmpdir(),'odk-provider-')));protectProactivePath(dir);t.after(()=>rm(dir,{recursive:true,force:true}))
 const file=join(dir,'provider.key');await writeFile(file,'synthetic-console\n',{mode:0o600});protectProactivePath(file)
 assert.equal(key('opencode',{env:{ODK_OPENCODE_KEY_FILE:file}}),'synthetic-console')
 assert.throws(()=>key('opencode-go',{env:{ODK_OPENCODE_KEY_FILE:file}}),e=>e.code==='missing_credential')
 if(process.platform!=='win32'){await chmod(file,0o644);assert.throws(()=>key('opencode',{env:{ODK_OPENCODE_KEY_FILE:file}}),e=>e.code==='credential_unavailable')}
})
test('disabled Jev is explicit, performs no request, and cannot become verified',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('must not fetch')}
 assert.deepEqual(await checkJevAuthentication({env:{ODK_JEV_PROVIDER:'disabled'},fetchImpl}),{status:'disabled'})
 for(const provider of ['disabled','opencode-go','arbitrary'])assert.throws(()=>createJevClient({env:{ODK_JEV_PROVIDER:provider,OPENCODE_API_KEY:'synthetic'},fetchImpl}),e=>e.code==='configuration')
 assert.equal(calls,0)
 const controller=new AbortController();controller.abort();await assert.rejects(checkJevAuthentication({env:{ODK_JEV_PROVIDER:'disabled'},fetchImpl,signal:controller.signal}))
})
test('default TypeSafe transport and typed response validation remain active',async()=>{
 const ask=createJevClient({env:{TYPESAFE_API_KEY:'synthetic'},fetchImpl:async(url,options)=>{
  assert.equal(url,'https://api.typesafe.ai/v1/systemone');assert.equal(JSON.parse(options.body).model,'jev-latest')
  return new Response(JSON.stringify({model:'jev-fixture',answers:{wrong:{type:'noul',noul:1}}}))
 }})
 await assert.rejects(ask({state:{},questions:{wanted:{type:'noul',instructions:'check'}}}),e=>e.code==='invalid_response')
})
function runtimeFixture({stored=[],auth}={}) {
 const registrations=[],keys=[],authCalls=[]
 const models=['openai-completions','openai-responses','anthropic-messages','google-generative-ai'].map((api,i)=>({id:'model-'+i,api,baseUrl:'https://old.invalid',provider:'opencode',input:['text'],contextWindow:100,maxTokens:10,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}))
 return {registrations,keys,authCalls,getModels:provider=>provider==='opencode-go'?models.slice(0,3):models,listCredentials:async()=>stored,getAuth:async(...args)=>{authCalls.push(args);return auth},registerProvider:(...args)=>registrations.push(args),setRuntimeApiKey:async(...args)=>{keys.push(args)}}
}
test('runtime hook preserves SDK API families, explicit scoped credentials and idempotence',async()=>{
 const {configureProviderRuntime: configure}=await module(),runtime=runtimeFixture()
 await configure(runtime,'other/model',{env:{}});assert.equal(runtime.registrations.length,0)
 await configure(runtime,'opencode/model-0',{env:{OPENCODE_API_KEY:'synthetic-console'}})
 assert.equal(runtime.registrations.length,1);assert.deepEqual(runtime.keys,[['opencode','synthetic-console']])
 const models=runtime.registrations[0][1].models
 assert.deepEqual(models.map(m=>m.api),runtime.getModels('opencode').map(m=>m.api))
 assert.equal(models[0].baseUrl,'https://opencode.ai/inference/openai/v1');assert.equal(models[2].baseUrl,'https://opencode.ai/inference/anthropic')
 await configure(runtime,'opencode/model-0',{env:{OPENCODE_API_KEY:'synthetic-console'}});assert.equal(runtime.registrations.length,1)
 await configure(runtime,'opencode-go/model-0',{env:{OPENCODE_GO_API_KEY:'synthetic-go',OPENCODE_API_KEY:'synthetic-console'}})
 assert.equal(runtime.keys[1][1],'synthetic-go');assert.equal(runtime.registrations[1][1].models[0].baseUrl,'https://opencode.ai/inference/go/openai/v1')
})
test('runtime accepts exact stored SDK provider credentials and rejects shared ambient fallback',async()=>{
 const {configureProviderRuntime: configure}=await module()
 const runtime=runtimeFixture({stored:[{providerId:'opencode-go',type:'api_key'}],auth:{source:'stored credential',auth:{apiKey:'synthetic-stored-go'}}})
 await configure(runtime,'opencode-go/model-0',{env:{OPENCODE_API_KEY:'synthetic-console'}})
 assert.deepEqual(runtime.authCalls,[['opencode-go',{env:{OPENCODE_API_KEY:''}}]]);assert.equal(runtime.keys[0][1],'synthetic-stored-go')
 for(const value of [runtimeFixture(),runtimeFixture({stored:[{providerId:'opencode',type:'api_key'}]}),runtimeFixture({stored:[{providerId:'opencode-go',type:'api_key'}],auth:{source:'OPENCODE_API_KEY',auth:{apiKey:'synthetic-console'}}})]) {
  await assert.rejects(configure(value,'opencode-go/model-0',{env:{OPENCODE_API_KEY:'synthetic-console'}}),e=>e.code==='missing_credential');assert.equal(value.registrations.length,0)
 }
})
test('actual SDK runtime keeps OpenCode transports while overriding outdated model paths',async()=>{
 const {ModelRuntime}=await import('@earendil-works/pi-coding-agent'),{configureProviderRuntime:configure}=await module()
 const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,allowModelNetwork:false,credentials:{read:async()=>undefined,list:async()=>[],modify:async()=>{throw Error('No persisted credential mutation')},delete:async()=>{throw Error('No credential deletion')}}})
 const original=runtime.getProvider('opencode'),selected=runtime.getModels('opencode').find(model=>model.api==='openai-completions')
 assert(selected);await configure(runtime,'opencode/'+selected.id,{env:{OPENCODE_API_KEY:'synthetic-console'}})
 const model=runtime.getModel('opencode',selected.id),updated=runtime.getProvider('opencode')
 assert.equal(model.api,selected.api);assert.equal(model.baseUrl,(await module()).resolveProviderEndpoint('opencode',selected.api))
 assert.equal(typeof updated.streamSimple,typeof original.streamSimple)
 let dispatches=0
 const answer=await runtime.completeSimple(model,{messages:[{role:'user',content:'public synthetic sample',timestamp:0}]},{sessionId:'synthetic-session',maxRetries:0,fetch:async(url,options)=>{
  dispatches++;assert.equal(String(url),'https://opencode.ai/inference/openai/v1/chat/completions')
  const headers=new Headers(options.headers);assert.equal(headers.get('authorization'),'Bearer synthetic-console');assert.equal(headers.get('x-opencode-session'),'synthetic-session')
  return new Response('data: '+JSON.stringify({id:'synthetic',choices:[{index:0,delta:{content:'ok'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
 }})
 assert.equal(dispatches,1);assert.equal(answer.stopReason,'stop');assert.equal(answer.content[0].text,'ok')
 assert.equal((await runtime.getAuth('opencode')).auth.apiKey,'synthetic-console')
})
test('Jev model identifiers retain underscore compatibility in request and typed response',async()=>{
 const ask=createJevClient({env:{TYPESAFE_API_KEY:'synthetic',ODK_JEV_MODEL:'jev-fixture_v1'},fetchImpl:async(_url,options)=>{
  assert.equal(JSON.parse(options.body).model,'jev-fixture_v1')
  return new Response(JSON.stringify({model:'jev-fixture_v1',answers:{check:{type:'noul',noul:0.5}}}))
 }})
 assert.equal((await ask({state:{},questions:{check:{type:'noul',instructions:'Check'}}})).model,'jev-fixture_v1')
})
test('an explicitly empty credential cannot silently select another credential',async()=>{
 const {resolveProviderCredential:key}=await module()
 assert.throws(()=>key('opencode',{env:{OPENCODE_API_KEY:'  ',ODK_OPENCODE_KEY_FILE:'/synthetic/must-not-read'}}),e=>e.code==='configuration')
})
