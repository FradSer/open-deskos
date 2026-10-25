import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopAgentClient } from '../src/desktop-agent/client.mjs'
import { createDesktopAgentTools } from '../src/desktop-agent/tools.mjs'
import { normalizeCapabilityDeclarations, childCapabilityDeclarations, capabilityIntentAllows, createReviewedCapabilities } from '../src/reviewed-capabilities.mjs'
import { guardIntentTools } from '../src/intent-routing.mjs'
import { durableCapability } from '../src/durable-runtime.mjs'
const requestId = '12345678-1234-4234-8234-123456789abc'
async function fixture(t, handler) {
  const directory = await mkdtemp(join(tmpdir(), 'odk-desktop-'))
  const socketPath = join(directory, 'agent.sock')
  const server = http.createServer(handler)
  await new Promise(resolve => server.listen(socketPath, resolve))
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }) })
  return { socketPath }
}
test('Given a private agent When submitted and read Then exact bounded RPCs preserve independent verification', async t => {
  const calls=[]
  const config=await fixture(t, async (req,res) => {
    let body=''; for await(const chunk of req)body+=chunk
    calls.push({url:req.url,httpMethod:req.method,...JSON.parse(body)})
    res.end(JSON.stringify({ok:true,result:{taskId:requestId,status:'succeeded',revision:2,mutationOutcome:'known',verification:{passed:false,checks:[],summary:'Not independently checked'},evidenceRefs:[]}}))
  })
  const client=createDesktopAgentClient(config)
  const tools=createDesktopAgentTools(client)
  const start=tools.find(t=>t.name==='desktop_task_start')
  const result=await start.execute('call',{requestId,goal:'Find a cable',desktopId:'anonymous-chrome'})
  assert.equal(result.structuredContent.admissionOnly,true)
  assert.equal(result.structuredContent.result.verification.passed,false)
  assert.deepEqual(calls[0],{url:'/rpc',httpMethod:'POST',method:'submit',params:{requestId,goal:'Find a cable',desktopId:'anonymous-chrome'}})
  const durable=durableCapability(tools.find(t=>t.name==='desktop_task_result'))
  const observed=await durable.execute({taskId:requestId},{callId:'read'}, {})
  assert.equal(observed.structuredOutput.result.verification.passed,false)
  client.close()
})
test('Given a dropped response When submit fails Then unknown outcome is reported once', async t => {
  let calls=0
  const config=await fixture(t,(req)=>{calls++;req.socket.destroy()})
  const client=createDesktopAgentClient(config)
  await assert.rejects(client.request('submit',{requestId}), /outcome_unknown/)
  assert.equal(calls,1)
  client.close()
})
test('Given private intervention or arbitrary controls When tool arguments supplied Then dispatch is refused', async () => {
  let calls=0
  const tools=createDesktopAgentTools({request:async()=>{calls++}})
  const resume=tools.find(t=>t.name==='desktop_task_resume')
  for(const params of [{taskId:requestId,expectedRevision:1,secret:'private'},{taskId:requestId,humanConfirmed:true},{taskId:requestId,expectedRevision:-1}]) await assert.rejects(resume.execute('x',params),/arguments/)
  assert.equal(calls,0)
  assert.deepEqual(tools.map(t=>t.name),['desktop_task_start','desktop_task_status','desktop_task_result','desktop_task_cancel','desktop_task_resume'])
})
test('Given reviewed desktop When composed Then only desktop workflow has task controls and children inherit none', async () => {
  const desktop={socketPath:'/private/desktop-agent.sock'}
  const declarations=normalizeCapabilityDeclarations({profile:'personal',capabilities:{desktop}})
  assert.deepEqual(childCapabilityDeclarations(declarations),{})
  assert.equal(capabilityIntentAllows('desktop_task_start','desktop_work'),true)
  assert.equal(capabilityIntentAllows('desktop_task_start','agent_execute'),false)
  const runtime=await createReviewedCapabilities({declarations,stateDir:'/private/test'})
  const guarded=guardIntentTools(runtime.tools,()=> 'conversation')
  await assert.rejects(guarded[0].execute('x',{}),/unavailable/)
  await runtime.close()
  for(const bad of [{socketPath:'relative'},{socketPath:'/private/a',url:'https://evil'},{socketPath:'/private/a',timeoutMs:0}]) assert.throws(()=>normalizeCapabilityDeclarations({profile:'personal',capabilities:{desktop:bad}}))
})
test('Given excess or malformed responses When observed Then bounded failure exposes no body', async t => {
  for (const body of ['{malformed-private-data', JSON.stringify({ok:true,result:{privateMarker:'x'.repeat(128*1024)}})]) {
    const config=await fixture(t,(_req,res)=>res.end(body))
    const client=createDesktopAgentClient(config)
    await assert.rejects(client.request('result',{taskId:requestId}), error=>/observation_unavailable/.test(error.message)&&!error.message.includes('private'))
    client.close()
  }
})
test('Given explicit service refusal When received Then only its fixed code is exposed', async t => {
  const config=await fixture(t,(_req,res)=>res.end(JSON.stringify({ok:false,error:{code:'private_intervention_required',message:'sensitive-secret'}})))
  const client=createDesktopAgentClient(config)
  await assert.rejects(client.request('resume',{taskId:requestId,expectedRevision:1}), error=>error.message==='Desktop agent refused: private_intervention_required')
  client.close()
})
test('Given dispatched stalled submission When deadline expires Then outcome is unknown with no replay', async t => {
  let calls=0
  const config=await fixture(t,()=>{calls++})
  const client=createDesktopAgentClient({...config,timeoutMs:1000})
  await assert.rejects(client.request('submit',{requestId}),/outcome_unknown/)
  assert.equal(calls,1)
  client.close()
})
test('Given an aborted or closed client When called Then no request is dispatched', async () => {
  const client=createDesktopAgentClient({socketPath:'/nonexistent/private.sock'})
  const controller=new AbortController();controller.abort()
  await assert.rejects(client.request('status',{taskId:requestId},controller.signal))
  client.close()
  await assert.rejects(client.request('submit',{requestId}),/closed/)
})
test('Given desktop tools When routed through Durable Then admission remains separate and unrelated routes refuse', async t => {
  let calls=0
  const config=await fixture(t,async (req,res)=>{for await(const _ of req){};calls++;res.end(JSON.stringify({ok:true,result:{taskId:requestId,status:'queued',revision:1,mutationOutcome:'none'}}))})
  const runtime=await createReviewedCapabilities({declarations:{desktop:config},stateDir:'/private/test'})
  let intent='desktop_work'
  const tools=guardIntentTools(runtime.tools,()=>intent)
  const durable=durableCapability(tools[0])
  const output=await durable.execute({requestId,goal:'Search for a cable',desktopId:'anonymous-chrome'},{callId:'submission'}, {})
  assert.equal(output.structuredOutput.admissionOnly,true)
  assert.equal(output.structuredOutput.reportedOnly,true)
  intent='agent_execute'
  await assert.rejects(durable.execute({requestId,goal:'Search for a cable',desktopId:'anonymous-chrome'},{callId:'refused'}, {}),/unavailable/)
  assert.equal(calls,1)
  await runtime.close()
})
test('Given an oversized request When submitted Then no connection is opened', async () => {
  const client=createDesktopAgentClient({socketPath:'/nonexistent/private.sock'})
  await assert.rejects(client.request('submit',{goal:'x'.repeat(65536)}),/request exceeds limit/)
  client.close()
})
