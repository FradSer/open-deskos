;(function (root) {
  'use strict'
  const animations = { connecting:'curious', idle:'idle', attentive:'curious', preparing:'waking', sending:'working', listening:'listening', transcribing:'thinking', thinking:'thinking', working:'working', replying:'working', complete:'response-complete', notification:'new-report', error:'confused', unavailable:'sleeping' }
  const busy = new Set(['starting','sending','recording','transcribing','thinking'])
  function mount(host, { sdk = root.odkOneeSdk, document = root.document, motion = root.matchMedia?.('(prefers-reduced-motion: reduce)') } = {}) {
    let controller, destroyed=false, generation=0, revision=0, phase='connecting', base='connecting', engaged=false, initialized=false, previousState, reaction=false, mountedAnimation, mountedReduced
    const seen = new Set()
    let lastMessage='',lastTurn,activeTurn,turnBaselineMessage='',turnBaselineId
    const fallback = () => { host.innerHTML = '<img class="agent-avatar-fallback" src="avatars/onee.svg" alt="" />';host.dataset.playback='unavailable' }
    function paint(recreate=false) {
      if(destroyed)return
      const animation=animations[phase], reduced=motion?.matches===true
      host.dataset.avatar='onee';host.dataset.phase=phase
      try {
        if(!controller || recreate || reduced!==mountedReduced || (reduced && mountedAnimation!==animation)) {
          controller?.destroy();controller=undefined;host.replaceChildren();const current=++generation
          controller=sdk.create(host,{autoplay:false,...(reduced?{defaultExpression:sdk.poses[animation]}:{}),onAnimationEnd(key) {
            if(destroyed || current!==generation || !reaction || key!==animations[phase])return
            // Leave the SDK tick before starting another animation. Its end callback is synchronous.
            queueMicrotask(() => {
              if(destroyed || current!==generation || !reaction || key!==animations[phase])return
              reaction=false;restore()
            })
          }})
          mountedAnimation=undefined;mountedReduced=reduced
        }
        if(reduced) { mountedAnimation=animation;host.dataset.playback='reduced';return }
        if(mountedAnimation!==animation || (host.dataset.playback==='paused' && !document?.hidden)) {
          const result=controller.play(animation)
          if(result?.ok===false)throw Error(result.error?.message || 'Avatar playback unavailable')
          mountedAnimation=animation
        }
        if(document?.hidden) { controller.pause();host.dataset.playback='paused' }
        else host.dataset.playback='playing'
      } catch { controller?.destroy();controller=undefined;mountedAnimation=undefined;fallback() }
    }
    const choose = (next, finite=false) => { phase=finite && motion?.matches ? base : next;reaction=finite && !motion?.matches;paint() }
    const restore = () => { if(base==='idle' && engaged)choose('attentive');else choose(base) }
    function update(snapshot) {
      if(destroyed || !snapshot?.state)return
      revision++
      const state=snapshot.state
      if(busy.has(state) && (!busy.has(previousState) || snapshot.ownerTurnId && activeTurn && snapshot.ownerTurnId!==activeTurn)) {
        activeTurn=snapshot.ownerTurnId;turnBaselineMessage=lastMessage;turnBaselineId=lastTurn
      }
      if(busy.has(state) && !activeTurn && snapshot.ownerTurnId)activeTurn=snapshot.ownerTurnId
      base=({starting:'preparing',sending:'sending',recording:'listening',transcribing:'transcribing',thinking:snapshot.message?.trim()?'replying':'thinking',error:'error',unavailable:'unavailable',idle:'idle'})[state] || 'unavailable'
      if(base==='idle' && snapshot.agents?.state==='live' && snapshot.agents.tasks?.some(task=>['starting','running','cancelling'].includes(task.state)))base='working'
      let incoming=false
      const entries=[...(snapshot.remote?.messages || []).map(item=>`remote:${item.id}`),...(snapshot.notifications || []).map(item=>`notification:${item.id}`),...(snapshot.remote?.replies || []).filter(item=>item.status==='answered' && item.answer).map(item=>`reply:${item.id}`)]
      for(const key of entries) { if(!seen.has(key)){seen.add(key);if(initialized)incoming=true} }
      const completed=initialized && busy.has(previousState) && state==='idle' && Boolean(snapshot.message?.trim())
        && (!activeTurn || !snapshot.ownerTurnId || activeTurn===snapshot.ownerTurnId)
        && (snapshot.message.trim()!==turnBaselineMessage || activeTurn && activeTurn!==turnBaselineId)
      previousState=state;lastMessage=snapshot.message?.trim() || '';lastTurn=snapshot.ownerTurnId;initialized=true
      if(completed && base==='idle')choose('complete',true)
      else if(incoming && base==='idle')choose('notification',true)
      else if(!reaction || base!=='idle')restore()
      // Repeated idle frames keep a finite reaction running instead of restarting it.
    }
    const visibility = () => { if(!destroyed)paint() }
    const preference = () => { if(destroyed)return;if(motion?.matches && reaction){reaction=false;phase=base}paint(true) }
    document?.addEventListener?.('visibilitychange',visibility)
    motion?.addEventListener?.('change',preference)
    paint()
    return {
      update,
      engage(value) { if(destroyed)return;engaged=Boolean(value);if(base==='idle' && !reaction)restore() },
      intent(next) { if(destroyed)return;base=next;choose(next);return ++revision },
      fail(token) { if(!destroyed && token===revision){previousState=undefined;activeTurn=undefined;base='error';choose('error')} },
      destroy() { if(destroyed)return;destroyed=true;generation++;controller?.destroy();controller=undefined;document?.removeEventListener?.('visibilitychange',visibility);motion?.removeEventListener?.('change',preference);seen.clear();host.replaceChildren() },
    }
  }
  const api={mount}
  if(typeof module==='object' && module.exports)module.exports=api
  else root.odkPersonalAgentAvatar=api
})(typeof window==='object'?window:globalThis)
