import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { runDesktopDelegation } from '../scripts/test-desktop-delegation-live.mjs'

test('Given real Durable and Code Mode When the synthetic coordinator delegates Then the Unix agent owns all worker execution', { timeout: 30000 }, async t => {
  const directory=await realpath(await mkdtemp(join(tmpdir(),'odk-desktop-harness-')))
  const socketPath=join(directory,'rpc.sock')
  const requestId='12345678-1234-4234-8234-123456789abc'
  const calls=[]
  const server=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part
    calls.push(JSON.parse(raw))
    res.end(JSON.stringify({ok:true,result:{taskId:requestId,requestId,status:calls.at(-1).method==='submit'?'running':'completed',revision:2,mutationOutcome:'known',verification:{passed:false,checks:[],summary:'Agent report only'},evidenceRefs:['evidence/final.png']}}))
  })
  await new Promise(resolve=>server.listen(socketPath,resolve))
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true})})
  for(const [phase,request] of [['start',{requestId,desktopId:'anonymous-chrome',goal:'Find a cable'}],['result',{taskId:requestId}]]){
    const result=await runDesktopDelegation({socket:socketPath,directory:join(directory,'harness'),phase,request})
    assert.equal(result.coordinator.synthetic,true)
    assert.equal(result.coordinator.paidModelCalls,0)
    assert.equal(result.modelCalls,2)
    assert.equal(result.nestedExecutions,1)
    assert.deepEqual(result.modelFacingTools,['codemode'])
    assert.equal(result.receipt.admissionOnly,phase==='start')
    assert.equal(result.receipt.reportedOnly,true)
    assert.equal(result.receipt.result.verification.passed,false)
  }
  assert.deepEqual(calls.map(c=>c.method),['submit','result'])
  assert.equal(calls[0].params.goal,'Find a cable')
})
