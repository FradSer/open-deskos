import {ModelRuntime, SettingsManager, getAgentDir} from '@earendil-works/pi-coding-agent'
import {getSupportedThinkingLevels, clampThinkingLevel} from '@earendil-works/pi-ai'

/** Native Pi model/auth control. Only the requesting channel receives login prompts. */
export function createPiConfig({createRuntime = () => ModelRuntime.create(),
  getSettings = () => SettingsManager.create(process.cwd(), getAgentDir(), {projectTrusted:false}),
  getSelection = () => undefined, isBusy = () => Boolean(false), onBusy = (_busy) => {}, onChange = async (_value) => {}} = {}) {
  let runtime, selected, thinking, login, pendingLoginOwner, changing = false, closed = false
  const native = () => runtime ??= createRuntime()
  const safe = value => typeof value === 'string' ? value.slice(0,2048) : ''
  async function snapshot(owner) {
    const models = await native()
    const current = getSelection() ?? {model:selected,thinkingLevel:thinking}
    const available = await models.getAvailable()
    return {providers:models.getProviders().filter(p=>p.auth?.apiKey?.login || p.auth?.oauth?.login).map(p=>({id:p.id,name:p.name,
      methods:[...(p.auth.apiKey?.login?['api_key']:[]),...(p.auth.oauth?.login?['oauth']:[])]})),
      models:available.slice(0,1000).map(m=>({provider:m.provider,id:m.id,name:m.name})),
      ...(current.model?{selected:{provider:current.model.provider,id:current.model.id},thinkingLevel:current.thinkingLevel,
        thinkingLevels:getSupportedThinkingLevels(current.model)}:{}),
      ...(login?.owner===owner?{login:login.public}:{}),busy:isBusy() || changing}
  }
  function cancel(owner) {
    if(pendingLoginOwner===owner){pendingLoginOwner=undefined;onBusy(false);return}
    if (login?.owner!==owner) throw Error('Login belongs to another connection')
    clearTimeout(login.timer);login.controller.abort();login.reject?.(Error('Login cancelled'));login=undefined;onBusy(false)
  }
  async function settle(flow) {
    // The flow resolves a checkpoint on a prompt, notification, or completion.
    await flow.checkpoint
  }
  function wake(flow) {flow.wake?.()}
  async function request(command, owner) {
    if (closed || !command || typeof command!=='object' || Array.isArray(command)
      || Object.keys(command).some(k=>!['action','provider','model','level','method','value'].includes(k))
      || Object.values(command).some(v=>typeof v!=='string' || v.length>3000)) throw Error('Invalid Pi command')
    if (command.action==='list') return snapshot(owner)
    if (command.action==='cancel') {cancel(owner);return snapshot(owner)}
    if (command.action==='answer') {
      if (login?.owner!==owner || !login.resolve) throw Error('No login prompt')
      const flow=login, resolve=flow.resolve
      if(flow.public.prompt?.type==='select' && !flow.public.prompt.options.some(option=>option.id===command.value)) throw Error('Invalid login selection')
      flow.resolve=undefined;flow.reject=undefined;flow.public={state:'working'}
      flow.checkpoint=new Promise(resolve=>{flow.wake=resolve})
      resolve(command.value);await settle(flow);return snapshot(owner)
    }
    if (isBusy() || changing || login && !['done','error'].includes(login.public.state)) throw Error('Personal Agent is busy')
    if(login && ['done','error'].includes(login.public.state))login=undefined
    changing=true
    onBusy(true)
    if(command.action==='login')pendingLoginOwner=owner
    let models
    try {models=await native()} catch(error){changing=false;onBusy(false);throw error}
    if (command.action==='login') {
      try {
      if(closed || pendingLoginOwner!==owner)throw Error('Login cancelled')
      pendingLoginOwner=undefined
      const provider=models.getProvider ? models.getProvider(command.provider) : models.getProviders().find(p=>p.id===command.provider)
      if (!['api_key','oauth'].includes(command.method) || !provider?.auth?.[command.method==='api_key'?'apiKey':'oauth']?.login) throw Error('Login method unavailable')
      const flow={owner,controller:new AbortController(),public:{state:'working'},resolve:undefined,reject:undefined,checkpoint:undefined,wake:undefined,timer:undefined,task:undefined}
      flow.checkpoint=new Promise(resolve=>{flow.wake=resolve});login=flow
      flow.timer=setTimeout(()=>{flow.controller.abort();flow.reject?.(Error('Login expired'));wake(flow)},300000)
      flow.timer.unref?.()
      flow.task=models.login(provider.id,command.method,{
        signal:flow.controller.signal,
        prompt(prompt) {
          if(flow.controller.signal.aborted) return Promise.reject(Error('Login cancelled'))
          flow.public={...flow.public,state:'prompt',prompt:{type:prompt.type,message:safe(prompt.message),
            ...(prompt.type==='select'?{options:prompt.options.slice(0,100).map(o=>({id:o.id,label:safe(o.label)}))}:{})}}
          const pending=new Promise((resolve,reject)=>{flow.resolve=resolve;flow.reject=reject})
          const abort=()=>{flow.reject?.(Error('Login prompt cancelled'));flow.resolve=undefined;flow.reject=undefined;flow.public={state:'working'};wake(flow)}
          prompt.signal?.addEventListener('abort',abort,{once:true})
          wake(flow)
          return pending.finally(()=>prompt.signal?.removeEventListener('abort',abort))
        },
        notify(event) {
          // Provider text is bounded. No credential result or entered value is retained.
          const url=event.type==='auth_url'?event.url:event.type==='device_code'?event.verificationUri:undefined
          const link=url && /^https:\/\//.test(url)?url.slice(0,2048):undefined
          flow.public={...flow.public,event:{type:event.type,message:safe(event.type==='device_code'?event.userCode:event.type==='auth_url'?event.instructions:event.message),...(link?{url:link}:{})}}
          wake(flow)
        },
      }).then(async()=>{
        if(flow.controller.signal.aborted)return
        await onChange({authentication:true})
        flow.public={state:'done'}
      },()=>{flow.public={state:'error',message:'Pi login failed. Retry or use Pi /login on the agent host.'}}).catch(()=>{
        flow.public={state:'error',message:'Login saved. The agent could not refresh. Check its configuration.'}
      }).finally(()=>{clearTimeout(flow.timer);flow.resolve=undefined;flow.reject=undefined;if(login===flow)onBusy(false);wake(flow)})
      changing=false
      await settle(flow);return snapshot(owner)
      } finally {changing=false;if(!login || login.owner!==owner || ['done','error'].includes(login.public.state))onBusy(false)}
    }
    try {
      const settings=getSettings()
      if (command.action==='model') {
        const model=(await models.getAvailable()).find(m=>m.provider===command.provider && m.id===command.model)
        if(!model)throw Error('Pi model unavailable')
        const level=clampThinkingLevel(model,settings.getModelThinkingLevel?.(model.provider,model.id) ?? settings.getDefaultThinkingLevel?.() ?? 'off')
        await onChange({model,thinkingLevel:level});selected=model;thinking=level
        if(settings.setDefaultModelAndProvider)settings.setDefaultModelAndProvider(model.provider,model.id)
        else {settings.setDefaultProvider(model.provider);settings.setDefaultModel(model.id)}
      } else if(command.action==='thinking') {
        const current=getSelection() ?? {model:selected}
        if(!current.model || !getSupportedThinkingLevels(current.model).includes(command.level))throw Error('Thinking level unavailable')
        await onChange({model:current.model,thinkingLevel:command.level});thinking=command.level
        settings.setDefaultThinkingLevel(command.level)
        settings.setModelThinkingLevel?.(current.model.provider,current.model.id,command.level)
      } else throw Error('Unknown Pi command')
      await settings.flush()
      if(settings.drainErrors?.().length)throw Error('Pi settings could not be saved')
    } finally {changing=false;onBusy(false)}
    return snapshot(owner)
  }
  return {request,disconnect(owner){if(login?.owner===owner || pendingLoginOwner===owner)cancel(owner)},get busy(){return changing || Boolean(login && !['done','error'].includes(login.public.state))},
    async close(){closed=true;pendingLoginOwner=undefined;onBusy(false);if(login){const flow=login;cancel(flow.owner);clearTimeout(flow.timer);await flow.task}}}
}
