import { parsePluginInput } from '../../src/agent-plugins/prompt.mjs'
import { assistant, fixtureModel } from './pi-fixture.mjs'
import { reportData, reportProcedure } from '../fixtures/agent-learning-reports.mjs'

/** Scripted provider for the acceptance runner's own contract tests, never live quality evidence. */
export function createOfflineAcceptanceRuntime(phase) {
  return { getAvailable: async () => [fixtureModel], getModel: () => fixtureModel, registerProvider() {},
    streamSimple: (model, context, options) => {
      if (options.maxTokens > model.maxTokens) throw Error('Acceptance exceeded the model output limit')
      const result = Promise.resolve().then(() => {
        if (phase() === 'provider-health:generation') return assistant('READY')
        const all = JSON.stringify(context.messages)
        const user = context.messages.findLast(message => message.role === 'user')
        const raw = typeof user?.content === 'string' ? user.content : user?.content?.filter(part => part.type === 'text').map(part => part.text).join('\n') ?? ''
        if (all.includes('Check the current Personal Agent task after') || all.includes('Extract reusable procedural lessons only')) {
          const input = parsePluginInput(raw.slice('Personal Bot request:\n'.length))
          if ('existingExperience' in input) {
            const source = input.receipts.find(receipt => receipt.tool === 'agent_mcp_call' && receipt.text.includes(reportProcedure))
            return assistant(JSON.stringify({ lessons: source && phase() === 'saved-training' ? [{ title: 'Desk report conversion', body: reportProcedure,
              evidence: [{ id: source.id, quote: reportProcedure }] }] : [] }))
          }
          const computed = input.receipts.find(receipt => receipt.kind === 'computation' && receipt.status === 'succeeded'
            && /RESULT=-?\d/.test(receipt.text.split('\nObserved output:\n')[1]?.split('\nDiagnostics (JSON):\n')[0] ?? ''))
          const source = computed ?? input.receipts.find(receipt => receipt.kind !== 'computation' && receipt.status === 'succeeded'
            && ['agent_package_install', 'agent_identity_save', 'agent_start', 'agent_input', 'agent_mcp_call'].includes(receipt.tool))
          const completed = source && !input.answer.includes('Procedure unavailable')
          return assistant(JSON.stringify({ status: completed ? 'passed' : 'needs_review', summary: completed ? 'Fixture receipts checked.' : 'Procedure is unavailable.', checks: [{
            requirement: 'Requested fixture outcome', scope: computed ? 'derivation' : source?.admissionOnly ? 'admission' : 'completion', status: completed ? 'passed' : 'needs_review',
            evidence: completed ? [{ id: source.id, quote: source.text.slice(0, 100) }] : [],
          }] }))
        }
        const child = raw.includes('Host-admitted workflow: agent_execute')
        if (context.messages.at(-1).role !== 'toolResult') {
          let code
          if (phase().startsWith('install-')) {
            const id = phase() === 'install-skill' ? 'report-helper' : 'learning-reports'
            code = `const c=await tools.agent_package_candidate({id:${JSON.stringify(id)}});text(await tools.agent_package_install({id:${JSON.stringify(id)},revision:c.value.revision}));`
          } else if (phase() === 'save-identity') {
            code = 'text(await tools.agent_identity_save({id:"reporter",name:"Reporter",role:"Use the report-helper Skill to analyze reports and return RESULT=<number>.",avatar:"book"}));'
          } else if (!child) {
            const id = phase() === 'saved-training' ? 'training' : phase() === 'saved-restart' ? 'restart' : 'temporary'
            const request = JSON.stringify(`Analyze learning-reports report ${id} and return RESULT=<number>.`)
            code = phase() === 'saved-restart'
              ? `const list=await tools.agent_list({});const task=list.value.tasks.find(task=>task.identity?.id==="reporter"&&!['starting','running','cancelling'].includes(task.state));if(!task)throw Error("Saved fixture task unavailable");text(await tools.agent_input({taskId:task.taskId,request:${request}}));`
              : `text(await tools.agent_start({request:${request},${id === 'temporary' ? 'role:"Analyze the requested synthetic report."' : 'identityId:"reporter"'}}));`
          } else {
            const id = phase().split(':')[0].startsWith('holdout-') ? phase().split(':')[0] : phase() === 'saved-training' ? 'training' : phase() === 'saved-restart' ? 'restart' : 'temporary'
            code = `const e=await tools.experience_list({});if(e.entries.length)text(await tools.experience_read({id:e.entries[0].id}));text(await tools.agent_skill_read({id:"report-helper"}));`
            if (!raw.includes('Supplied current synthetic report (JSON):')) code += `const d=await tools.agent_mcp_tools({id:"learning-reports"});text(await tools.agent_mcp_call({id:"learning-reports",revision:d.value.revision,tool:"read_report",arguments:{id:${JSON.stringify(id)}}}));`
          }
          return assistant([{ type: 'toolCall', id: `fixture-${Math.random().toString(16).slice(2)}`, name: 'codemode', arguments: { code } }], 'toolUse')
        }
        if (context.messages.at(-1).isError) throw Error(`Acceptance fixture tool failed: ${JSON.stringify(context.messages.at(-1).content)}`)
        if (!child) return assistant('Requested fixture operation accepted.')
        if (!all.includes(reportProcedure)) return assistant('Procedure unavailable.')
        const id = phase().split(':')[0].startsWith('holdout-') ? phase().split(':')[0] : phase() === 'saved-training' ? 'training' : phase() === 'saved-restart' ? 'restart' : 'temporary'
        const output = JSON.stringify(context.messages.at(-1).content).match(/RESULT=(-?\d+(?:\.\d+)?)/)
        if (output) return assistant(`RESULT=${output[1]}`)
        const code = `const samples=${JSON.stringify(reportData(id).samples)};const values=samples.filter(value=>value!==null);text("RESULT="+values.reduce((sum,value)=>sum+value-7,0)/values.length/5);`
        return assistant([{ type: 'toolCall', id: `calculation-${Math.random().toString(16).slice(2)}`, name: 'codemode', arguments: { code } }], 'toolUse')
      })
      void result.catch(error => console.error(error.message))
      return { async *[Symbol.asyncIterator]() { const message = await result; yield { type: 'done', reason: message.stopReason, message } }, result: () => result }
    } }
}
