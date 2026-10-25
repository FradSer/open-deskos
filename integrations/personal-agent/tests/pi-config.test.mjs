import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createPiConfig} from '../src/pi-config.mjs'

test('native login stores through Pi, never exposes secrets, and blocks concurrent owners', async () => {
  let key, busy = false
  const model = {provider:'native',id:'chat',name:'Chat',reasoning:false}
  const runtime = {getProviders:()=>[{id:'native',name:'Native',auth:{apiKey:{login(){}}}}], getAvailable:async()=>key?[model]:[],
    login:async (_provider,_type,interaction)=>{key=await interaction.prompt({type:'secret',message:'API key'});return {type:'api_key',key}},
    getModel:()=>model}
  const settings={setDefaultModel(){},setDefaultProvider(){},setDefaultThinkingLevel(){},flush:async()=>{}}
  const config=createPiConfig({createRuntime:async()=>runtime,getSettings:()=>settings,isBusy:()=>busy,onChange:async()=>{}})
  const a={},b={}
  const pending=await config.request({action:'login',provider:'native',method:'api_key'},a)
  assert.equal(pending.login.prompt.type,'secret')
  await assert.rejects(config.request({action:'answer',value:'wrong'},b))
  const done=await config.request({action:'answer',value:'synthetic-secret'},a)
  assert.equal(done.login.state,'done');assert.equal(key,'synthetic-secret')
  assert(!JSON.stringify(done).includes('synthetic-secret'))
  busy=true;await assert.rejects(config.request({action:'model',provider:'native',model:'chat'},a))
  await config.close()
})

test('native choices persist model defaults and reject unsupported thinking',async()=>{
 const selected=[];const settings={setDefaultProvider:p=>selected.push(p),setDefaultModel:m=>selected.push(m),flush:async()=>{}}
 const model={provider:'native',id:'chat',name:'Chat',reasoning:false}
 const runtime={getProviders:()=>[],getAvailable:async()=>[model],getModel:()=>model}
 const config=createPiConfig({createRuntime:async()=>runtime,getSettings:()=>settings,isBusy:()=>false,onChange:async value=>selected.push(value.model.id)})
 await config.request({action:'model',provider:'native',model:'chat'},{})
 assert.deepEqual(selected,['chat','native','chat'])
 await assert.rejects(config.request({action:'thinking',level:'high'},{}))
 await config.close()
})

test('cold concurrent logins reserve admission before runtime creation',async()=>{
 let release,calls=0
 const gate=new Promise(resolve=>{release=resolve})
 const runtime={getProviders:()=>[{id:'fixture',name:'Fixture',auth:{apiKey:{login(){}}}}],getAvailable:async()=>[],login:async(_p,_m,i)=>{calls++;await i.prompt({type:'secret',message:'Key'})}}
 const config=createPiConfig({createRuntime:async()=>{await gate;return runtime},isBusy:()=>false})
 const first=config.request({action:'login',provider:'fixture',method:'api_key'},{})
 await assert.rejects(config.request({action:'login',provider:'fixture',method:'api_key'},{}),/busy/)
 release();assert.equal((await first).login.state,'prompt');assert.equal(calls,1)
 await config.close()
})

test('settings persistence errors are reported instead of claiming a saved default',async()=>{
 const model={provider:'fixture',id:'chat',reasoning:false}
 const runtime={getAvailable:async()=>[model],getProviders:()=>[]}
 const config=createPiConfig({createRuntime:async()=>runtime,isBusy:()=>false,onChange:async()=>{},getSettings:()=>({setDefaultModelAndProvider(){},flush:async()=>{},drainErrors:()=>[Error('unwritable')]})})
 await assert.rejects(config.request({action:'model',provider:'fixture',model:'chat'},{}),/could not be saved/)
 await config.close()
})

test('actual native Pi login and default settings persist without model inference',async t=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path')
 const {ModelRuntime,SettingsManager}=await import('@earendil-works/pi-coding-agent')
 const dir=await mkdtemp(join(tmpdir(),'pi-config-native-'));t.after(()=>rm(dir,{recursive:true,force:true}))
 const runtime=await ModelRuntime.create({authPath:join(dir,'auth.json'),modelsPath:null,allowModelNetwork:false})
 const config=createPiConfig({createRuntime:async()=>runtime,getSettings:()=>SettingsManager.create(dir,dir,{projectTrusted:false}),isBusy:()=>false,onChange:async()=>{}})
 t.after(()=>config.close());const owner={}
 const prompt=await config.request({action:'login',provider:'opencode',method:'api_key'},owner)
 assert.equal(prompt.login.prompt.type,'secret')
 const done=await config.request({action:'answer',value:'native-fixture-key'},owner)
 assert.equal(done.login.state,'done')
 assert.equal(JSON.parse(await readFile(join(dir,'auth.json'),'utf8')).opencode.key,'native-fixture-key')
 const typesafePrompt=await config.request({action:'login',provider:'typesafe',method:'api_key'},owner)
 assert.equal(typesafePrompt.login.prompt.type,'secret')
 await config.request({action:'answer',value:'typesafe-fixture-key'},owner)
 assert(runtime.getModelOfType('classifier','typesafe','jev-latest'))
 const menu=await config.request({action:'list'},owner)
 assert.equal(menu.models.some(model=>model.provider==='typesafe' || model.id.startsWith('jev-')),false)
 await assert.rejects(config.request({action:'model',provider:'typesafe',model:'jev-latest'},owner))
 const model=runtime.getModels('opencode')[0]
 await config.request({action:'model',provider:'opencode',model:model.id},owner)
 const restored=SettingsManager.create(dir,dir,{projectTrusted:false})
 assert.equal(restored.getDefaultProvider(),'opencode');assert.equal(restored.getDefaultModel(),model.id)
})


test('OAuth URLs survive a following manual-code prompt and cancellation',async()=>{
 const runtime={getProviders:()=>[{id:'fixture',name:'Fixture',auth:{oauth:{login(){}}}}],getAvailable:async()=>[],
  login:async(_p,_t,i)=>{i.notify({type:'auth_url',url:'https://auth.invalid/signin',instructions:'Sign in'});await i.prompt({type:'manual_code',message:'Paste the code'})}}
 const config=createPiConfig({createRuntime:async()=>runtime,isBusy:()=>false});const owner={}
 const state=await config.request({action:'login',provider:'fixture',method:'oauth'},owner)
 assert.equal(state.login.event.url,'https://auth.invalid/signin');assert.equal(state.login.prompt.type,'manual_code')
 await config.request({action:'cancel'},owner);await config.close()
})

test('closing while native runtime loads prevents a late login',async()=>{
 let release,calls=0;const gate=new Promise(resolve=>{release=resolve})
 const config=createPiConfig({createRuntime:async()=>{await gate;return {login:async()=>{calls++}}},isBusy:()=>false})
 const owner={},pending=config.request({action:'login',provider:'fixture',method:'oauth'},owner)
 config.disconnect(owner);release();await assert.rejects(pending,/cancelled/);assert.equal(calls,0);await config.close()
})

test('disconnect after a completed login cannot release an active model mutation',async()=>{
 let held=false,release,entered
 const gate=new Promise(resolve=>{release=resolve}),ready=new Promise(resolve=>{entered=resolve})
 const model={provider:'fixture',id:'chat',reasoning:false}
 const runtime={getProviders:()=>[{id:'fixture',name:'Fixture',auth:{apiKey:{login(){}}}}],getAvailable:async()=>[model],
  login:async(_p,_t,i)=>{await i.prompt({type:'secret',message:'Key'})}}
 const config=createPiConfig({createRuntime:async()=>runtime,isBusy:()=>false,onBusy:busy=>{held=busy},
  getSettings:()=>({setDefaultModelAndProvider(){},flush:async()=>{}}),onChange:async change=>{if(change.model){entered();await gate}}})
 const owner={}
 await config.request({action:'login',provider:'fixture',method:'api_key'},owner)
 await config.request({action:'answer',value:'synthetic-key'},owner)
 const mutation=config.request({action:'model',provider:'fixture',model:'chat'},owner)
 await ready;config.disconnect(owner);assert.equal(config.busy,true);assert.equal(held,true)
 release();await mutation;assert.equal(held,false);await config.close()
})
