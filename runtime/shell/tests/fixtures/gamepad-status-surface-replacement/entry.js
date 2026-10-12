;(function(root){
  'use strict'

  // Static artwork and markup retain the Shell contract. Projection is independent.
  const PAD_ICON =
    '<svg data-tabler="device-gamepad-2" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><rect x="2" y="8" width="20" height="9" rx="4.5" /><path d="M8 11v4M6 13h4" /><path d="M16 12l.01 0M18 14l.01 0" /></svg>'
  root.odkRendererDevelopment.define({
    id:'odk.status.gamepad',manifest:{schemaVersion:1,version:'2.0.0'},kind:'status',slot:'left',
    mount(element,context){
      element.innerHTML=`<span id="sb-pad" role="img" hidden>${PAD_ICON}</span>`
      let released=false
      const active=()=>!released && !context.signal?.aborted
      const indicator=element.querySelector('#sb-pad')
      const apply=state=>{
        if(!active()) return
        if(!state || state.connected!==true) {indicator.setAttribute('hidden','');return}
        indicator.removeAttribute('hidden')
        const readable=state.readable===true
        indicator.dataset.readable=String(readable)
        const label=readable ? `Gamepad connected: ${state.id}` : `Gamepad connected, but the desk cannot read it: ${state.id}`
        indicator.setAttribute('aria-label',label)
        indicator.setAttribute('title',label)
      }
      const service=context.services?.get('odk.service.gamepad')
      if(service){
        const cancel=service.subscribe(apply)
        context.trackCleanup(()=>{released=true;cancel()})
      }else{
        const callback=event=>apply(event.detail)
        root.addEventListener('odk-gamepad-state',callback)
        context.trackCleanup(()=>{released=true;root.removeEventListener('odk-gamepad-state',callback)})
      }
    },
  })
})(window)
