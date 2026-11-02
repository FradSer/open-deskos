import {test} from 'node:test'
import assert from 'node:assert/strict'
import {ModelRuntime} from '@earendil-works/pi-coding-agent'
import {createJevClient,checkJevAuthentication} from './helpers/isolated-provider.mjs'
import {mkdtemp,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

function credentials(values={}) {return {read:async id=>values[id],list:async()=>Object.entries(values).map(([providerId,value])=>({providerId,type:value.type})),modify:async()=>{throw Error('No mutation')},delete:async()=>{throw Error('No deletion')}}}

test('native Pi preserves custom OpenCode endpoint and stored key before environment',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'pi-provider-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const path=join(dir,'models.json');await writeFile(path,JSON.stringify({providers:{opencode:{baseUrl:'https://fixture.invalid/v1',models:[{id:'fixture',api:'openai-completions',contextWindow:4096,maxTokens:100,reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]}}}))
 const runtime=await ModelRuntime.create({modelsPath:path,allowModelNetwork:false,credentials:credentials({opencode:{type:'api_key',key:'synthetic-stored'}})})
 const model=runtime.getModel('opencode','fixture')
 assert.equal(model.baseUrl,'https://fixture.invalid/v1')
 assert.equal((await runtime.getAuth(model,{env:{OPENCODE_API_KEY:'synthetic-environment'}})).auth.apiKey,'synthetic-stored')
 let calls=0
 const result=await runtime.completeSimple(model,{messages:[{role:'user',content:'public fixture',timestamp:0}]},{maxRetries:0,fetch:async(url,options)=>{
  calls++;assert.equal(String(url),'https://fixture.invalid/v1/chat/completions');assert.equal(new Headers(options.headers).get('authorization'),'Bearer synthetic-stored')
  return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'ok'},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}})
 }})
 assert.equal(calls,1);assert.equal(result.stopReason,'stop')
})

test('Jev uses native classifier configuration and request auth including headers',async()=>{
 const runtime=await ModelRuntime.create({modelsPath:null,allowModelNetwork:false,credentials:credentials({opencode:{type:'api_key',key:'synthetic-stored'}})})
 runtime.registerProvider('opencode',{baseUrl:'https://native.invalid/classifier/',headers:{'x-config':'native'}})
 const ask=createJevClient({runtime,env:{ODK_JEV_PROVIDER:'opencode'},fetchImpl:async(url,options)=>{
  assert.equal(String(url),'https://native.invalid/classifier/systemone')
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer synthetic-stored')
  assert.equal(new Headers(options.headers).get('x-config'),'native')
  return Response.json({model:'jev-1.13',answers:{check:{type:'noul',noul:0.9}}})
 }})
 assert.equal((await ask({state:{},questions:{check:{type:'noul',instructions:'Check',criteria:{true:'yes',false:'no'}}}})).answers.check.noul,0.9)
})

test('an unspecified OpenCode classifier preserves the existing non-free model selection',async()=>{
 const runtime=await ModelRuntime.create({modelsPath:null,allowModelNetwork:false,credentials:credentials({opencode:{type:'api_key',key:'synthetic-stored'}})})
 let selected
 const nativeGet=runtime.getModelOfType.bind(runtime)
 runtime.getModelOfType=(kind,provider,id)=>{selected=id;return nativeGet(kind,provider,id)}
 const ask=createJevClient({runtime,env:{ODK_JEV_PROVIDER:'opencode'},fetchImpl:async()=>Response.json({model:'jev-1.13',answers:{check:{type:'noul',noul:0.9}}})})
 await ask({state:{},questions:{check:{type:'noul',instructions:'Check'}}})
 assert.equal(selected,'jev-1.13')
})

test('a separate Jev endpoint does not change the shared generation provider',async()=>{
 const runtime=await ModelRuntime.create({modelsPath:null,allowModelNetwork:false,credentials:credentials({opencode:{type:'api_key',key:'synthetic-stored'}})})
 runtime.registerProvider('opencode',{baseUrl:'https://generation.invalid/v1',headers:{'x-config':'native'}})
 const generationBefore=runtime.getModel('opencode','big-pickle')
 const classifierBefore=runtime.getModelOfType('classifier','opencode','jev-1.13-free')
 let requested
 const ask=createJevClient({runtime,env:{ODK_JEV_PROVIDER:'opencode',ODK_JEV_MODEL:'jev-1.13-free',ODK_JEV_BASE_URL:'https://judgment.invalid/v1'},fetchImpl:async(url,options)=>{
  requested=String(url)
  assert.equal(new Headers(options.headers).get('authorization'),'Bearer synthetic-stored')
  assert.equal(new Headers(options.headers).get('x-config'),'native')
  return Response.json({model:'jev-1.13-free',answers:{check:{type:'noul',noul:0.9}}})
 }})
 await ask({state:{},questions:{check:{type:'noul',instructions:'Check'}}})
 assert.equal(requested,'https://judgment.invalid/v1/systemone')
 assert.equal(runtime.getModel('opencode','big-pickle').baseUrl,generationBefore.baseUrl)
 assert.equal(runtime.getModelOfType('classifier','opencode','jev-1.13-free').baseUrl,classifierBefore.baseUrl)
})

test('a configured Jev gateway rejects a conflicting native authentication address before dispatch',async()=>{
 const runtime=await ModelRuntime.create({modelsPath:null,allowModelNetwork:false,credentials:credentials({opencode:{type:'api_key',key:'synthetic-stored'}})})
 const nativeAuth=runtime.getAuth.bind(runtime)
 runtime.getAuth=async(...args)=>{const result=await nativeAuth(...args);return {...result,auth:{...result.auth,baseUrl:'https://auth.invalid/v1'}}}
 let dispatched=false
 const ask=createJevClient({runtime,env:{ODK_JEV_PROVIDER:'opencode',ODK_JEV_BASE_URL:'https://judgment.invalid/v1'},fetchImpl:async()=>{
  dispatched=true
  throw Error('Unexpected dispatch')
 }})
 await assert.rejects(ask({state:{},questions:{check:{type:'noul',instructions:'Check'}}}),error=>error.code==='configuration')
 assert.equal(dispatched,false)
})

test('a non-loopback plaintext Jev gateway cannot receive provider credentials',async()=>{
 let dispatched=false
 const runtime=await ModelRuntime.create({modelsPath:null,allowModelNetwork:false,credentials:credentials({opencode:{type:'api_key',key:'synthetic-stored'}})})
 const ask=createJevClient({runtime,env:{ODK_JEV_PROVIDER:'opencode',ODK_JEV_BASE_URL:'http://gateway.invalid/v1'},fetchImpl:async()=>{dispatched=true;throw Error('Unexpected dispatch')}})
 await assert.rejects(ask({state:{},questions:{check:{type:'noul',instructions:'Check'}}}),error=>error.code==='configuration')
 assert.equal(dispatched,false)
})

test('Jev uses Pi stored provider credentials instead of removed ODK key files',async()=>{
 const runtime=await ModelRuntime.create({modelsPath:null,allowModelNetwork:false,credentials:credentials({typesafe:{type:'api_key',key:'native-stored'}})})
 const ask=createJevClient({runtime,env:{ODK_JEV_KEY_FILE:'/must-not-read',TYPESAFE_API_KEY:'ambient'},fetchImpl:async(url,options)=>{
  assert.equal(String(url),'https://api.typesafe.ai/v1/systemone');assert.equal(new Headers(options.headers).get('authorization'),'Bearer native-stored')
  return Response.json({model:'jev-latest',answers:{check:{type:'noul',noul:0.5}}})
 }})
 await ask({state:{},questions:{check:{type:'noul',instructions:'Check'}}})
})

test('native Go authentication accepts the same environment alias as Pi',async()=>{
 const runtime=await ModelRuntime.create({modelsPath:null,refreshOnCreate:false,credentials:credentials()})
 assert.equal((await runtime.getAuth('opencode-go',{env:{OPENCODE_API_KEY:'native-go'}})).auth.apiKey,'native-go')
})

test('disabled and unsupported Jev configurations never dispatch',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;throw Error('No request')}
 assert.deepEqual(await checkJevAuthentication({env:{ODK_JEV_PROVIDER:'disabled'},fetchImpl}),{status:'disabled'})
 for(const provider of ['disabled','opencode-go','arbitrary'])assert.throws(()=>createJevClient({env:{ODK_JEV_PROVIDER:provider},fetchImpl}))
 assert.equal(calls,0)
})

test('Jev deadline cancels native authentication before any HTTP dispatch',async()=>{
 let authAborted=false,requests=0
 const runtime={getModelOfType:()=>({api:'typesafe-system-one',id:'jev-latest',provider:'typesafe'}),
  getAuth:(_model,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{authAborted=true;reject(signal.reason)},{once:true}))}
 const status=await checkJevAuthentication({runtime,env:{ODK_JEV_TIMEOUT_MS:'1000'},fetchImpl:async()=>{requests++;throw Error('No dispatch')}})
 assert.deepEqual(status,{status:'unavailable',reason:'timeout'});assert.equal(authAborted,true);assert.equal(requests,0)
})

test('Jev delegates classification to native Pi and rejects non-successful stop reasons',async()=>{
 let calls=0
 const selected={id:'jev-latest',provider:'typesafe',api:'typesafe-system-one'}
 const runtime={getModelOfType:()=>selected,getAuth:async()=>({auth:{apiKey:'fixture'}}),classify:async(model,context,options)=>{
  calls++;assert.equal(model,selected);assert.equal(context.questions.check.type,'bool')
  assert.equal(typeof context.questions.check.instructions,'string');assert.equal(options.maxRetries,0)
  return {model:'jev-latest',stopReason:calls===1?'stop':'error',answers:{check:{type:'bool',probability:0.9}},errorMessage:'PRIVATE_PROVIDER_DETAIL'}
 }}
 const ask=createJevClient({runtime})
 assert.equal((await ask({state:{},questions:{check:{type:'noul',instructions:{question:'Check'},criteria:{true:'yes',false:'no'}}}})).answers.check.noul,0.9)
 await assert.rejects(ask({state:{},questions:{check:{type:'noul',instructions:'Check'}}}),error=>!error.message.includes('PRIVATE_PROVIDER_DETAIL'))
 assert.equal(calls,2)
})

test('native classifier response streams remain bounded for success and error bodies',async()=>{
 for(const status of [200,500])for(const declared of [false,true]) {
  let cancelled=false, chunks=0
  const ask=createJevClient({env:{TYPESAFE_API_KEY:'fixture'},fetchImpl:async()=>new Response(new ReadableStream({
   pull(controller){if(chunks++<3)controller.enqueue(new Uint8Array(20000));else controller.close()},cancel(){cancelled=true},
  }),{status,headers:declared?{'content-length':'40000'}:{}})})
  await assert.rejects(ask({state:{},questions:{check:{type:'noul',instructions:'Check',criteria:{true:'yes',false:'no'}}}}),error=>error.code==='invalid_response')
  assert.equal(cancelled,true)
 }
})
