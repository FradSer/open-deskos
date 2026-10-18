const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { installGeometryFixtures } = require('./helpers/live-fixtures')

if (process.platform === 'darwin') app.dock.hide()
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-agent-home-'))
app.setPath('userData', profile)
installGeometryFixtures(ipcMain)
ipcMain.removeHandler('odk-personal-bot-status')
let initial = { state: 'idle', jev: {status:'verified'}, briefing: { state: 'empty', items: [], generatedAt: Date.now(), omittedSources: 0 } }
ipcMain.handle('odk-personal-bot-status', () => initial)
let win
let micToggles = 0
let sentText = []
let sentReplyTo = []
let textAccepted = true
let completeBeforeReceipt = false
ipcMain.handle('odk-personal-bot-text', async (_event, text, replyTo) => {
  sentText.push(text);sentReplyTo.push(replyTo)
  if (completeBeforeReceipt) {
    publishStatus({ state: 'thinking', transcript: text, message: 'Working' })
    publishStatus({ state: 'idle', transcript: text, message: 'Already completed' })
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return { accepted: textAccepted }
})
ipcMain.handle('odk-personal-bot-toggle', () => { micToggles++; return { accepted: true } })
const timer = setTimeout(() => finish(1), 60000)
const evaluate = script => win.webContents.executeJavaScript(script)
function finish(code) {
  clearTimeout(timer)
  if (win && !win.webContents.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
async function resize(width, height) {
  win.setContentSize(width, height)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  })
  await evaluate(`window.dispatchEvent(new Event('resize'))`)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await evaluate(`innerWidth === ${width} && innerHeight === ${height} && devicePixelRatio === 1 && __odkGrid?.width === ${width} && __odkGrid?.height === ${height}`)) return
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.fail(`Agent viewport did not settle at ${width}x${height}`)
}
function publishStatus(frame) { win.webContents.send('odk-personal-bot-status', {jev:{status:'verified'},...frame}) }
async function send(briefing) {
  publishStatus({ state: 'idle', message: '', briefing })
  await evaluate(`new Promise(resolve => setTimeout(resolve, 30))`)
}
async function assertOverviewRefreshIndicator({ ownerConversation = false } = {}) {
  const retained = {state:'idle',message:'',jev:{status:'verified'}}
  if (ownerConversation) {
    Object.assign(retained,{transcript:'What is on my desk?',message:'Your existing answer stays here.'})
    publishStatus({...retained,state:'thinking'})
    publishStatus(retained)
    await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.match(await evaluate(`document.querySelector('.agent-conversation').textContent`),/Your existing answer stays here/)
  }
  await evaluate(`window.overviewChatNodes=[...document.querySelector('.agent-conversation').children];window.overviewChatText=document.querySelector('.agent-conversation').textContent;window.overviewPresence=document.querySelector('.dash-presence')`)
  for (const theme of ['instrument','pixel','border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}');document.fonts.ready`)
    for (const [width,height] of [[1920,1280],[480,854],[320,480]]) {
      await resize(width,height)
      let position
      for (const state of ['empty','loading','live','stale','error','unavailable']) {
        const items=['live','stale','loading'].includes(state)?[{text:'Synthetic desk reading.',sources:[{id:'desk',label:'Desk',state:'live'}]}]:[]
        publishStatus({...retained,briefing:{state,items,generatedAt:1000,omittedSources:0}})
        await evaluate('new Promise(r=>setTimeout(r,30))')
        assert.equal(await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');return c.textContent===window.overviewChatText&&c.children.length===window.overviewChatNodes.length&&window.overviewChatNodes.every((n,i)=>c.children[i]===n)})()`),true,'automatic Overview refresh never appends conversation text')
        const result=await evaluate(`(()=>{const n=document.querySelector('.dash-presence'),r=n.getBoundingClientRect(),w=document.querySelector('.dash-wd').getBoundingClientRect(),s=getComputedStyle(n),spinner=getComputedStyle(n,'::after'),probe=document.createElement('span');probe.style.color='var(--odk-accent-red)';document.body.append(probe);const red=getComputedStyle(probe).color;probe.remove();return {same:n===window.overviewPresence,display:s.display,width:r.width,height:r.height,left:r.left,top:r.top,near:r.left>=w.right&&r.left-w.right<40,center:Math.abs(r.top+r.height/2-w.top-w.height/2),background:s.backgroundColor,red,animation:spinner.animationName,border:spinner.borderTopWidth,busy:document.querySelector('#dash-narrative').getAttribute('aria-busy')==='true',narrative:document.querySelector('#dash-narrative').textContent}})()`)
        assert.equal(result.same,true,'the indicator node survives refresh')
        assert.ok(result.display!=='none'&&result.width>=12&&result.height>=12&&result.near&&result.center<1,JSON.stringify({theme,width,state,...result}))
        if(!position)position={left:result.left,top:result.top,width:result.width,height:result.height}
        assert.deepEqual({left:result.left,top:result.top,width:result.width,height:result.height},position,'spinner keeps the dot footprint')
        if(state==='loading') {assert.equal(result.animation,'odk-overview-refresh');assert.equal(result.border,'2px');assert.equal(result.busy,true);assert.equal(result.narrative,'Synthetic desk reading.')}
        else {assert.equal(result.animation,'none');assert.equal(result.background,result.red)}
        if((width===480 || width===1920)&&['empty','loading','error'].includes(state))fs.writeFileSync(path.join(os.tmpdir(),'odk-overview-'+theme+'-'+state+'-'+width+'.png'),(await win.webContents.capturePage()).toPNG())
      }
    }
  }
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),true)
  publishStatus({...retained,briefing:{state:'loading',items:[],generatedAt:1000,omittedSources:0}})
  await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.dash-presence'),'::after').animationName`),'none')
  assert.equal(await evaluate(`document.querySelector('#dash-narrative').textContent`),'Personal Agent has no new desk briefing.')
  assert.equal(await evaluate(`document.querySelector('#dash-narrative').getAttribute('aria-busy')`),'true')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[]})
  assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`),false)
  await evaluate('delete window.overviewChatNodes;delete window.overviewChatText;delete window.overviewPresence')
  await resize(1920,1280);await evaluate("window.odkTheme.set('instrument')")
}

async function assertJevStartupStatus() {
  const states = [
    ['checking', 'Checking Jev authentication…', 'Checking Jev…'],
    ['verified', 'Jev authentication verified.', 'Ready'],
    ['missing_credential', 'Jev credentials are missing. Add them in the service configuration, then restart the Personal Agent service.', 'Jev not configured'],
    ['auth_rejected', 'Jev authentication was rejected. Check the service credentials, then restart the Personal Agent service.', 'Jev authentication rejected'],
    ['unavailable', 'Jev authentication could not be checked. Check network and service settings, then restart the Personal Agent service.', 'Jev unavailable'],
    [undefined, 'Jev authentication has not been checked.', 'Jev not checked'],
  ]
  for (const [status, text, caption] of states) {
    const frame = {state:'idle', jev:status ? {status} : undefined}
    for (let repeat=0;repeat<2;repeat++) {
      publishStatus(frame)
      await evaluate('new Promise(r=>setTimeout(r,20))')
      assert.deepEqual(await evaluate(`({count:document.querySelectorAll('.agent-jev-status').length,outside:!document.querySelector('.agent-jev-status')?.closest('.agent-conversation'),text:document.querySelector('.agent-jev-status')?.textContent,caption:document.querySelector('.agent-state').textContent})`),{count:1,outside:true,text,caption})
      if (repeat===0) await evaluate(`window.jevTextNode=document.querySelector('.agent-jev-status').firstChild;window.jevCaptionNode=document.querySelector('.agent-state').firstChild`)
      else assert.equal(await evaluate(`document.querySelector('.agent-jev-status').firstChild===window.jevTextNode&&document.querySelector('.agent-state').firstChild===window.jevCaptionNode`),true,'replayed status does not replace live-region text or announce a new notification')
    }
  }
  await evaluate('delete window.jevTextNode;delete window.jevCaptionNode')
  for (const theme of ['instrument','pixel','border-beam']) {
    publishStatus({state:'idle',jev:{status:'unavailable'}})
    await evaluate('new Promise(r=>setTimeout(r,20))')
    await resize(480,854)
    await evaluate(`window.odkTheme.set('${theme}')`)
    assert.equal(await evaluate('document.documentElement.dataset.theme'),theme)
    await evaluate('document.fonts.ready')
    const layout=await evaluate(`(()=>{const s=document.querySelector('.agent-jev-status'),c=document.querySelector('.agent-composer'),r=s.getBoundingClientRect();return {font:parseFloat(getComputedStyle(s).fontSize),width:r.width,composer:c.getBoundingClientRect().bottom,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
    assert.ok(layout.font>=14 && layout.width>0 && layout.composer<=854 && !layout.overflow,JSON.stringify(layout))
    const image=await win.webContents.capturePage();fs.writeFileSync(path.join(os.tmpdir(),'odk-jev-startup-'+theme+'-480.png'),image.toPNG())
  }
  await resize(320,480)
  publishStatus({state:'idle',jev:{status:'checking'}})
  await evaluate('new Promise(r=>setTimeout(r,30))')
  const compactStatus=await evaluate(`(()=>{const r=document.querySelector('.agent-jev-status').getBoundingClientRect(),c=document.querySelector('.agent-conversation').getBoundingClientRect(),f=document.querySelector('.agent-composer').getBoundingClientRect();return {top:r.top,bottom:r.bottom,conversationTop:c.top,conversationHeight:c.height,composerBottom:f.bottom,viewport:innerHeight}})()`)
  assert.ok(compactStatus.top>=0&&compactStatus.bottom<=compactStatus.conversationTop&&compactStatus.conversationHeight>=40&&compactStatus.composerBottom<=compactStatus.viewport,JSON.stringify(compactStatus))
  fs.writeFileSync(path.join(os.tmpdir(),'odk-jev-startup-checking-320.png'),(await win.webContents.capturePage()).toPNG())
  await resize(1920,1280)
  await evaluate("window.odkTheme.set('instrument')")
  publishStatus({state:'idle',jev:{status:'verified'}})
  await evaluate('new Promise(r=>setTimeout(r,30))')
  fs.writeFileSync(path.join(os.tmpdir(),'odk-jev-startup-verified-1920.png'),(await win.webContents.capturePage()).toPNG())
}

async function assertNotificationMessagesAreIndependent() {
  const notification = message => ({ state: 'idle', transcript: 'Question 中文', message: 'Final response', notifications: [{ id: message, message }] })
  publishStatus(notification('滴滴订单结果尚未确认'))
  publishStatus(notification('滴滴订单状态已更新'))
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
  const messageLayout = await evaluate(`(() => {
    const conversation = document.querySelector('.agent-conversation')
    const replies = [...conversation.querySelectorAll('.agent-message-assistant')]
    const last = replies.slice(-2)
    return { display: getComputedStyle(conversation).display, gap: getComputedStyle(conversation).rowGap,
      texts: replies.map(node => node.querySelector('.agent-message-body').textContent),
      visibleGap: last.length === 2 ? last[1].getBoundingClientRect().top - last[0].getBoundingClientRect().bottom : 0 }
  })()`)
  assert.equal(messageLayout.display, 'grid', 'conversation lays out independent messages as separate rows')
  assert.equal(messageLayout.gap, '20px', 'conversation visibly separates messages')
  assert.ok(messageLayout.visibleGap >= 20, 'the latest two messages have visible space between them')
  assert.deepEqual(messageLayout.texts.slice(-3), ['Final response', '滴滴订单结果尚未确认', '滴滴订单状态已更新'])
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-assistant').length`), 3, 'each notification creates one assistant message')
  publishStatus(notification('滴滴订单状态已更新'))
  await evaluate(`new Promise(r => setTimeout(r, 20))`)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-assistant').length`), 3, 'replayed notification events do not duplicate messages')
}

async function assertRemoteConversationHistory() {
  const remote={state:'partial',messages:[{id:'synthetic-remote-update',text:'A remote Pi reports a conclusion. <img src=x onerror=alert(1)>',sources:[{machine:'synthetic-Mac',sessionId:'synthetic-session',project:'/synthetic/project',revision:'a'.repeat(64),control:'report_only',availability:'unavailable'}]}],omitted:8,heldCount:0,hasMore:true}
  const frame={state:'idle',transcript:'Question 中文',message:'Final response',remote}
  publishStatus(frame)
  await evaluate('new Promise(resolve=>setTimeout(resolve,30))')
  publishStatus(frame)
  await evaluate('new Promise(resolve=>setTimeout(resolve,30))')
  const observed=await evaluate(`(()=>{const all=[...document.querySelectorAll('.agent-message-assistant')],remote=all.filter(node=>node.textContent.includes('A remote Pi reports'));return {count:remote.length,text:remote[0]?.textContent,images:remote[0]?.querySelectorAll('img').length,details:remote[0]?.querySelector('details')?.textContent,coverage:document.querySelector('.agent-remote-coverage')?.textContent}})()`)
  assert.equal(await evaluate(`!!document.querySelector('.agent-earlier-updates') && !document.querySelector('.agent-earlier-updates').open`),true,'legacy reports are retained in a closed Earlier task updates group')
  assert.equal(observed.count,1,'replayed retained frames do not duplicate the same conversation synthesis')
  assert.equal(observed.images,0,'remote text is never HTML')
  assert.match(observed.details,/synthetic-Mac.*synthetic-session.*Report only/)
  assert.match(observed.coverage,/More task updates.*partial.*8 sources/s)
  for (const [change, expected] of [
    [{hasMore:false,omitted:1}, 'Some task updates are not available yet.'],
    [{hasMore:false,omitted:0,expiredMessages:1}, 'Some earlier task updates have expired.'],
    [{hasMore:false,omitted:0,total:2}, 'Earlier task updates are available. Ask to see them.'],
  ]) {
    publishStatus({...frame,remote:{...remote,...change}})
    await evaluate('new Promise(resolve=>setTimeout(resolve,20))')
    assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage > [role="status"]').textContent`),expected)
  }
  assert.equal(await evaluate(`(()=>{const s=document.querySelector('.agent-jev-status'),c=document.querySelector('.agent-conversation');c.scrollTop=c.scrollHeight;const r=s.getBoundingClientRect(),h=document.querySelector('.agent-head').getBoundingClientRect();return !s.closest('.agent-conversation')&&r.top>=h.top&&r.bottom<=h.bottom&&r.top>=0})()`),true,'Jev authentication stays visible above a long scrolled conversation')
  const updates = ['训练第一轮完成了，我可以帮你对照报告继续看。', 'v8 已完成实现，回归结果还需要确认。']
  const messages = updates.map((text, index) => ({ ...remote.messages[0], id: `synthetic-short-${index}`, text, presentation: 'assistant_update' }))
  const updated = { ...frame, remote: { ...remote, messages: [...messages].reverse().concat(remote.messages), heldCount: 1 } }
  publishStatus(updated)
  await evaluate('new Promise(resolve=>setTimeout(resolve,30))')
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.agent-update .agent-message-body')].map(n=>n.firstChild.textContent)`), updates)
  assert.equal(await evaluate(`document.querySelector('.agent-update-sources').open`), false)
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  assert.equal(await evaluate('document.hasFocus()'),true,'the hidden keyboard fixture owns emulated focus')
  await evaluate(`document.querySelector('.agent-update .agent-update-sources > summary').focus()`)
  for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
  await evaluate('new Promise(resolve=>setTimeout(resolve,20))')
  assert.equal(await evaluate(`document.querySelector('.agent-update .agent-update-sources').open`),true,'Sources opens with the keyboard')
  for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
  await evaluate('new Promise(resolve=>setTimeout(resolve,20))')
  await evaluate(`window.retainedSource=document.querySelector('.agent-update .agent-update-sources > summary'); retainedSource.focus({preventScroll:true}); document.querySelector('.agent-conversation').scrollTop=0`)
  publishStatus(updated)
  await evaluate('new Promise(resolve=>setTimeout(resolve,30))')
  assert.equal(await evaluate(`document.activeElement===retainedSource && document.querySelectorAll('.agent-update').length===2`),true,'reconnect keeps focus and message identity')
  for(const theme of ['instrument','pixel','border-beam']) {
    await evaluate(`window.odkTheme.set(${JSON.stringify(theme)})`)
    for(const [width,height] of [[1920,1280],[960,640],[320,480]]) {
      await resize(width,height)
      const geometry=await evaluate(`(()=>{const region=document.querySelector('.agent-conversation'),summary=region.querySelector('.agent-update .agent-update-sources > summary');return {width:region.clientWidth,overflow:region.scrollWidth-region.clientWidth,touch:summary.getBoundingClientRect().height,font:parseFloat(getComputedStyle(summary).fontSize),composer:document.querySelector('.agent-composer').getBoundingClientRect().bottom}})()`)
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.agent-earlier-updates')).overflowY`),'visible','history does not create a second scroll container')
      assert.ok(geometry.overflow<=1,JSON.stringify(geometry));assert.ok(geometry.touch>=44,JSON.stringify(geometry));assert.ok(geometry.font>=14,JSON.stringify(geometry));assert.ok(geometry.composer<=height,JSON.stringify(geometry))

    }
  }
  await evaluate(`document.querySelector('.agent-earlier-updates > summary').click()`);assert.match(await evaluate(`document.querySelector('.agent-earlier-updates').textContent`),/A remote Pi reports/);
  await evaluate(`document.querySelector('.agent-earlier-updates > summary').click()`);
  await resize(320,480);await evaluate(`document.querySelector('.agent-conversation').scrollTop=0`);
  const scrollBefore=await evaluate(`document.querySelector('.agent-conversation').scrollTop`);
  publishStatus(updated);await evaluate('new Promise(resolve=>setTimeout(resolve,30))');
  assert.equal(await evaluate(`document.querySelector('.agent-conversation').scrollTop`),scrollBefore,'repeated frames retain the reading position');
  const newer={...updated,remote:{...updated.remote,messages:[{...messages[0],id:'synthetic-short-new',text:'新一轮检查已开始，结果还没有回来。'},...updated.remote.messages]}}
  publishStatus(newer);await evaluate('new Promise(resolve=>setTimeout(resolve,30))')
  assert.equal(await evaluate(`document.querySelector('.agent-conversation').scrollTop`),scrollBefore,'a new update does not pull the reader away')
  assert.equal(await evaluate(`document.querySelector('.agent-latest').hidden`),false)
  await evaluate(`document.querySelector('.agent-latest').click()`);assert.equal(await evaluate(`document.querySelector('.agent-latest').hidden`),true);
  await resize(1920,1280)
}


async function assertThreadCoverageRestore() {
  const source={key:'a2'.repeat(32),revision:'b2'.repeat(32),threadId:'c2'.repeat(32),machine:'Synthetic Mac',sessionId:'synthetic-coverage-session',project:'/synthetic/coverage',control:'report_only',availability:'live'}
  const item={id:'d2'.repeat(32),at:9000,text:'Synthetic completed task for coverage checks',presentation:'assistant_update',sources:[source]}
  for(const remote of [{state:'stale',omitted:0},{state:'partial',omitted:1},{state:'live',omitted:0}]) {
    const complete=remote.state==='live'
    publishStatus({state:'idle',remote:{...remote,messages:[item],replies:[],total:1}});await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage').hidden`),complete)
    await evaluate(`document.querySelector('[data-remote-id="${item.id}"] .agent-session-open').click()`)
    assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage').hidden`),true)
    await evaluate(`document.querySelector('.agent-thread-all').click()`)
    assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage').hidden`),complete,'All messages restores the current coverage notice without a new frame')
    await evaluate(`document.querySelector('[data-source-key="${source.key}"]').click();document.querySelector('.agent-reply-cancel').click()`)
    assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage').hidden`),complete,'Cancel reply restores the current coverage notice without a new frame')
  }
}

async function assertThreadProjectionUpdate() {
  const source={key:'a1'.repeat(32),revision:'b1'.repeat(32),threadId:'c1'.repeat(32),machine:'Synthetic Mac',sessionId:'synthetic-alias-session',project:'/synthetic/alias',control:'report_only',availability:'live'}
  const item={id:'d1'.repeat(32),at:7000,text:'Synthetic completed task with a remapped thread',presentation:'assistant_update',sources:[source]}
  const oldReply={id:'34567890-1234-4123-8123-123456789abc',threadId:source.threadId,sessionId:source.sessionId,text:'Earlier owner reply',replyTo:{messageId:item.id,sourceKey:source.key,sourceRevision:source.revision},status:'delivered',at:7001}
  const frame={state:'idle',remote:{state:'live',messages:[item],replies:[oldReply],total:1}}
  publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,30))')
  await evaluate(`window.__projectionArticle=document.querySelector('[data-remote-id="${item.id}"]');document.querySelector('[data-source-key="${source.key}"]').click();document.querySelector('textarea').value='Keep alias draft'`)
  const canonical={...source,threadId:'e1'.repeat(32)}
  const projected={...frame,remote:{...frame.remote,messages:[{...item,sources:[canonical]}]}}
  publishStatus(projected);await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.equal(await evaluate(`document.querySelector('[data-remote-id="${item.id}"]').dataset.threadId`),canonical.threadId,'same immutable message receives the new canonical thread projection')
  assert.equal(await evaluate(`document.querySelector('[data-remote-id="${item.id}"]')===window.__projectionArticle`),true,'projection updates retain the article identity')
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${item.id}"]').length`),1)
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'Keep alias draft')
  assert.equal(await evaluate(`document.querySelector('[data-reply-id="${oldReply.id}"]').hidden`),false,'an earlier owner reply follows its exact source projection for display')
  await evaluate(`document.querySelector('.agent-composer').requestSubmit();new Promise(r=>setTimeout(r,30))`)
  const reference={messageId:item.id,sourceKey:source.key,sourceRevision:source.revision}
  assert.deepEqual(sentReplyTo.at(-1),reference,'thread projection never changes the immutable wire reference')
  const reply={id:'23456789-1234-4123-8123-123456789abc',threadId:canonical.threadId,sessionId:source.sessionId,text:'Keep alias draft',replyTo:reference,status:'delivered',at:8000}
  publishStatus({...projected,remote:{...projected.remote,replies:[reply,oldReply]}});await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.equal(await evaluate(`document.querySelector('[data-reply-id="${reply.id}"]').hidden`),false,'the canonical durable reply stays in the selected thread')
  await evaluate(`document.querySelector('[data-remote-id="${item.id}"] .agent-session-open').click()`)
  assert.equal(await evaluate(`document.querySelector('[data-reply-id="${reply.id}"]').hidden`),false,'the original session action also uses the new projection')
  await evaluate(`document.querySelector('.agent-thread-all').click()`)
}

async function assertDuplicateRemoteIds() {
  const id='9'.repeat(64)
  const source={key:'8'.repeat(64),revision:'7'.repeat(64),threadId:'6'.repeat(64),machine:'Synthetic Mac',sessionId:'synthetic-legacy-session',project:'/synthetic/legacy',control:'report_only',availability:'live'}
  const other={...source,key:'5'.repeat(64),revision:'4'.repeat(64),threadId:'3'.repeat(64),sessionId:'synthetic-other-session'}
  const first={id,at:4000,text:'Synthetic legacy snapshot one',sources:[source]}
  const second={id,at:5000,text:'Synthetic legacy snapshot two',sources:[other]}
  const publish=async messages=>{publishStatus({state:'idle',remote:{state:'live',messages,replies:[],total:messages.length}});await evaluate('new Promise(r=>setTimeout(r,30))')}
  await publish([second,first])
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${id}"]').length`),2,'legacy duplicate IDs preserve distinct immutable source snapshots')
  await evaluate(`document.querySelector('.agent-earlier-updates').open=true;document.querySelector('[data-source-key="${other.key}"]').click()`)
  assert.match(await evaluate(`document.querySelector('.agent-reply-context').textContent`),/synthetic-other/)
  await evaluate(`document.querySelector('.agent-reply-cancel').click()`)
  const ambiguous={...first,at:6000,text:'Synthetic conflicting snapshot with the same reference'}
  await publish([ambiguous,second,first]);await publish([ambiguous,second,first])
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${id}"]').length`),3,'replayed snapshots do not duplicate or hide legacy records')
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('[data-source-key="${source.key}"]')].map(b=>b.disabled)`),[true,true],'the same reference with conflicting bodies is not actionable')
  assert.equal(await evaluate(`document.querySelector('[data-source-key="${other.key}"]').disabled`),false,'a distinct exact reference remains actionable')
  assert.match(await evaluate(`document.querySelector('.agent-conversation').textContent`),/Reply reference is ambiguous/)
  await evaluate(`document.querySelector('[data-source-key="${source.key}"]').dispatchEvent(new MouseEvent('click'))`)
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true,'synthetic clicks cannot bypass an ambiguous reference')
}

async function assertSessionReplies({ geometry = true } = {}) {
  const first={key:'b'.repeat(64),revision:'c'.repeat(64),threadId:'d'.repeat(64),machine:'Synthetic Mac',sessionId:'training-'+ '1'.repeat(220),project:'/synthetic/training',control:'report_only',availability:'live'}
  const second={...first,key:'e'.repeat(64),revision:'f'.repeat(64),threadId:'1'.repeat(64),sessionId:'22222222-2222-4222-8222-222222222222',project:'/synthetic/v8'}
  const item={id:'a'.repeat(64),at:1000,text:'合成示例：训练与 v8 模型都有新的完成结果。',presentation:'assistant_update',verification:'reported_unverified',synthesisVerification:'passed',sources:[first,second]}
  const frame={state:'idle',remote:{state:'live',messages:[item],replies:[],total:1}}
  publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${item.id}"] .agent-session-reply').length`),2,'multiple sessions require explicit reply choices')
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true,'incoming updates do not silently select a target')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  await evaluate(`document.querySelector('[data-source-key="${second.key}"]').focus()`)
  for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
  assert.match(await evaluate(`document.querySelector('.agent-reply-context').textContent`),/22222222/)
  await evaluate(`document.querySelector('textarea').value='Keep this draft';document.querySelector('.agent-reply-cancel').focus()`)
  for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'Keep this draft')
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true)
  await evaluate(`document.querySelector('[data-source-key="${first.key}"]').click()`)
  textAccepted=false
  await evaluate(`document.querySelector('.agent-composer').requestSubmit();new Promise(r=>setTimeout(r,30))`)
  const expected={messageId:item.id,sourceKey:first.key,sourceRevision:first.revision}
  assert.deepEqual(sentReplyTo.at(-1),expected)
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'Keep this draft')
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),false,'refusal retains the exact reference')
  publishStatus({state:'unavailable'});await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelector('.agent-send').disabled`),true)
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),false)
  textAccepted=true;publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,20))')
  await evaluate(`document.querySelector('.agent-composer').requestSubmit();new Promise(r=>setTimeout(r,30))`)
  assert.deepEqual(sentReplyTo.at(-1),expected)
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'')
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true)
  const owner={id:'12345678-1234-4123-8123-123456789abc',threadId:first.threadId,sessionId:first.sessionId,text:'Keep this draft',replyTo:expected,status:'delivered',at:2000}
  const completed={...item,id:'2'.repeat(64),at:3000,threadId:first.threadId,text:'合成示例：同一训练会话的后续检查已完成。',sources:[first]}
  const updated={...frame,remote:{...frame.remote,messages:[completed,item],replies:[owner],total:2}}
  publishStatus(updated);await evaluate('new Promise(r=>setTimeout(r,30))');publishStatus(updated);await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelectorAll('[data-reply-id="${owner.id}"]').length`),1,'durable owner replies do not duplicate on reconnect')
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.agent-conversation > [data-thread-id="${first.threadId}"]')].map(n=>n.querySelector('.agent-message-body').firstChild.textContent)`),['Keep this draft',completed.text])
  for(const theme of geometry ? ['instrument','pixel','border-beam'] : []) {
    await evaluate(`window.odkTheme.set('${theme}');document.fonts.ready`)
    for(const [width,height] of [[1920,1280],[480,854],[320,480]]) {
      await resize(width,height)
      await evaluate(`document.querySelector('[data-source-key="${first.key}"]').click()`)
      const geometry=await evaluate(`(()=>{const c=document.querySelector('.agent-composer').getBoundingClientRect(),r=document.querySelector('.agent-reply-context').getBoundingClientRect(),l=document.querySelector('.agent-conversation'),b=document.querySelector('.agent-reply-cancel').getBoundingClientRect();return {composer:c.bottom,reference:r.bottom,composerTop:c.top,touch:b.height,overflow:l.scrollWidth-l.clientWidth,bodyOverflow:document.documentElement.scrollWidth-innerWidth,region:l.clientHeight,panel:document.querySelector('.agent-panel').getBoundingClientRect().height,head:document.querySelector('.agent-head').getBoundingClientRect().height,nav:document.querySelector('.agent-thread-nav').getBoundingClientRect().height,refHeight:r.height,gap:getComputedStyle(document.querySelector('.agent-panel')).gap,flex:getComputedStyle(l).flex}})()`)
      console.log('SESSION_REPLY_GEOMETRY',JSON.stringify({theme,width,...geometry}))
      assert.ok(geometry.composer<=height&&geometry.reference<=geometry.composerTop&&geometry.touch>=44&&geometry.overflow<=1&&geometry.bodyOverflow<=1&&geometry.region>=40,JSON.stringify({theme,width,...geometry}))
      await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')
      fs.writeFileSync(path.join(os.tmpdir(),`odk-session-reply-${theme}-${width}.png`),(await win.webContents.capturePage()).toPNG())
    }
  }
  await evaluate(`document.querySelector('.agent-reply-cancel').click();document.querySelector('.agent-thread-all').click();document.querySelector('textarea').value='Ordinary after reply';document.querySelector('.agent-composer').requestSubmit();new Promise(r=>setTimeout(r,30))`)
  assert.equal(sentReplyTo.at(-1),undefined,'ordinary sends never inherit the old reference')
  await resize(1920,1280)
}

app.whenReady().then(async () => {
  let selectedPreload = path.join(__dirname, '../src/preload.js')
  if (process.argv.includes('--session-reply-legacy-host')) {
    const original = fs.readFileSync(selectedPreload,'utf8')
    assert.ok(original.includes('  supportsReplyTo: true,'))
    selectedPreload = path.join(profile,'legacy-single-argument-preload.cjs')
    fs.writeFileSync(selectedPreload,original.replace('  supportsReplyTo: true,\n','').replace("sendText: (text, replyTo) => replyTo === undefined ? ipcRenderer.invoke('odk-personal-bot-text', text) : ipcRenderer.invoke('odk-personal-bot-text', text, replyTo)","sendText: text => ipcRenderer.invoke('odk-personal-bot-text', text)"),{mode:0o600,flag:'wx'})
  }
  win = new BrowserWindow({ width: 1920, height: 1280, show: false, frame: false, useContentSize: true,
    webPreferences: { preload: selectedPreload, sandbox: true, contextIsolation: true,
      nodeIntegration: false, offscreen: true, backgroundThrottling: false } })
  await win.loadFile(path.join(__dirname, '../src/renderer/index.html'))
  win.webContents.debugger.attach('1.3')
  await win.webContents.debugger.sendCommand('Page.enable')
  win.webContents.setZoomFactor(1)
  // Hidden windows can start at 1x1 before their first layout on Linux.
  await resize(1920, 1280)
  await evaluate('document.fonts.ready')
  assert.equal(await evaluate(`!!document.querySelector('#personal-agent textarea')`), true, 'resident Agent has a composer')
  assert.equal(await evaluate(`document.querySelector('[data-page-id="today"]').parentElement.id`), 'home-summary', 'briefing retains its plugin host')
  assert.equal(await evaluate(`document.querySelector('#home-summary').closest('[data-page-id="home"]')?.parentElement.id`), 'pages-track', 'Overview belongs to the first paged canvas')
  assert.equal(await evaluate(`document.querySelector('#dots').closest('#status-bar')`), null, 'dots stay below Widgets')
  assert.equal(await evaluate(`document.querySelectorAll('[data-widget="odk.tile.clock"], [data-widget="odk.tile.almanac"]').length`), 0, 'separate time and date Widgets are removed')
  if (process.argv.includes('--session-reply-legacy-host')) {
    const source={key:'b'.repeat(64),revision:'c'.repeat(64),threadId:'d'.repeat(64),machine:'Synthetic Mac',sessionId:'synthetic-session',project:'/synthetic',control:'report_only',availability:'live'}
    publishStatus({state:'idle',remote:{state:'live',messages:[{id:'a'.repeat(64),text:'Synthetic completion',presentation:'assistant_update',sources:[source]}],replies:[]}})
    await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelector('.agent-session-reply').disabled`),true,'an old single-argument bridge cannot reply')
    await evaluate(`document.querySelector('.agent-session-reply').dispatchEvent(new MouseEvent('click'));document.querySelector('textarea').value='Ordinary legacy request';document.querySelector('.agent-composer').requestSubmit();new Promise(r=>setTimeout(r,30))`)
    assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true)
    assert.deepEqual(sentText,['Ordinary legacy request']);assert.deepEqual(sentReplyTo,[undefined])
    console.log('PASS legacy single-argument host never silently drops a reply reference');finish(0);return
  }
  if (process.argv.includes('--session-reply-coverage-only')) {
    await assertThreadCoverageRestore();console.log('PASS thread exit restores current coverage');finish(0);return
  }
  if (process.argv.includes('--session-reply-state-only')) {
    await assertSessionReplies({geometry:false});await assertDuplicateRemoteIds();await assertThreadProjectionUpdate();await assertThreadCoverageRestore();console.log('PASS reply state, identities, projections and coverage');finish(0);return
  }
  if (process.argv.includes('--session-reply-projection-only')) {
    await assertThreadProjectionUpdate();console.log('PASS canonical thread projection updates in place');finish(0);return
  }
  if (process.argv.includes('--session-reply-duplicate-only')) {
    await assertDuplicateRemoteIds();console.log('PASS legacy duplicate message identities and ambiguous references');finish(0);return
  }
  if (process.argv.includes('--session-reply-only')) {
    await assertSessionReplies();await assertDuplicateRemoteIds();await assertThreadProjectionUpdate();console.log('PASS explicit session replies, durable thread, retained draft and compact themes');finish(0);return
  }
  if (process.argv.includes('--agent-reference-only')) {
    const failures=[]
    for(const theme of ['instrument','pixel','border-beam','liquid-glass']){
      for(const [width,height] of [[1280,800],[1920,1280],[960,640],[480,854],[320,480]]){
        await resize(width,height)
        await evaluate(`(async()=>{await odkTheme.set('${theme}');window.dispatchEvent(new Event('resize'));await document.fonts.ready;await new Promise(r=>setTimeout(r,100))})()`)
        const layout=await evaluate(`(()=>{
          const avatar=document.querySelector('.agent-avatar').getBoundingClientRect(),identity=document.querySelector('.agent-identity'),pill=identity.querySelector('summary').getBoundingClientRect(),panel=document.querySelector('.agent-panel').getBoundingClientRect(),conversation=document.querySelector('.agent-conversation').getBoundingClientRect(),composer=document.querySelector('.agent-composer').getBoundingClientRect();
          return {centered:Math.abs(avatar.x+avatar.width/2-(panel.x+panel.width/2))<1,stacked:pill.top>=avatar.bottom-1,editor:!identity.hidden&&pill.height>=44,composer:composer.bottom<=panel.bottom&&composer.right<=panel.right&&composer.width>=panel.width-45,conversation:conversation.height>=40&&conversation.bottom<=composer.top,noStateFooter:document.querySelector('.agent-state').closest('.agent-head')!==null};
        })()`)
        for(const [name,ok] of Object.entries(layout))if(!ok)failures.push(theme+' '+width+': '+name)
      }
    }
    assert.deepEqual(failures,[],'Reference Agent layout')
    await resize(1280,800)
    await evaluate(`(async()=>{await odkTheme.set('instrument');window.dispatchEvent(new Event('resize'));await new Promise(r=>setTimeout(r,80))})()`)
    for(let i=0;i<16;i++)publishStatus({state:'idle',notifications:[{id:'reference-'+i,message:'A real notification fixture '+i+'. '+ 'Content remains readable. '.repeat(6)}]})
    await evaluate('new Promise(r=>setTimeout(r,60))')
    const scroll=await evaluate(`(()=>{const list=document.querySelector('.agent-conversation'),composer=document.querySelector('.agent-composer');window.referenceComposerY=composer.getBoundingClientRect().y;list.scrollTop=0;list.dispatchEvent(new Event('scroll'));return {overflow:list.scrollHeight>list.clientHeight,latest:!document.querySelector('.agent-latest').hidden,fixed:Math.abs(composer.getBoundingClientRect().y-referenceComposerY)<1}})()`)
    assert.ok(scroll.overflow&&scroll.latest&&scroll.fixed,JSON.stringify(scroll))
    await evaluate(`document.querySelector('.agent-latest').click()`)
    assert.equal(await evaluate(`(()=>{const n=document.querySelector('.agent-conversation');return n.scrollHeight-n.clientHeight-n.scrollTop<2})()`),true)
    const summary=await evaluate(`(()=>{const n=document.querySelector('.agent-identity summary');n.focus();return document.activeElement===n})()`)
    assert.equal(summary,true)
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'char',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'})
    await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13})
    await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelector('.agent-identity').open`),true,await evaluate(`JSON.stringify({active:document.activeElement.outerHTML,focused:document.hasFocus()})`))
    await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value='Mori';document.querySelector('.agent-identity-form').requestSubmit()`)
    assert.equal(await evaluate(`document.querySelector('.agent-name').textContent==='Mori'&&document.activeElement===document.querySelector('.agent-composer textarea')`),true)
    for(const theme of ['instrument','pixel','border-beam','liquid-glass']){
      await resize(320,480)
      await evaluate(`(async()=>{await odkTheme.set('${theme}');window.dispatchEvent(new Event('resize'));document.querySelector('.agent-identity-form [name="name"]').value='中文'.repeat(20);document.querySelector('.agent-identity-form').requestSubmit();await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.querySelector('.agent-identity summary').focus()})()`)
      for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
      const popup=await evaluate(`(()=>{const form=document.querySelector('.agent-identity-form'),save=form.querySelector('button'),r=form.getBoundingClientRect(),s=save.getBoundingClientRect(),p=document.querySelector('#personal-agent').getBoundingClientRect();return {open:document.querySelector('.agent-identity').open,inside:r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom,hit:document.elementFromPoint(s.x+s.width/2,s.y+s.height/2)===save,save:{x:s.x+s.width/2,y:s.y+s.height/2},bounds:[r.top,r.bottom,p.top,p.bottom]}})()`)
      assert.ok(popup.open&&popup.inside&&popup.hit,theme+': '+JSON.stringify(popup))
      for(let tab=0;tab<3;tab++)for(const type of ['keyDown','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
      assert.equal(await evaluate(`document.activeElement===document.querySelector('.agent-identity-form button')`),true)
      for(const type of ['mousePressed','mouseReleased'])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...popup.save})
      await evaluate('new Promise(r=>setTimeout(r,20))')
      assert.equal(await evaluate(`!document.querySelector('.agent-identity').open&&document.activeElement===document.querySelector('.agent-composer textarea')`),true)
    }
    await resize(1280,800)
    await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value='Personal Agent';document.querySelector('.agent-identity-form').requestSubmit();window.dispatchEvent(new Event('resize'))`)
    const errorDetail='Suggestions unavailable: private proposal state could not be saved. No proposal action will run.'
    publishStatus({state:'idle',proposalError:errorDetail})
    await evaluate('new Promise(r=>setTimeout(r,40))')
    const statusLayout=await evaluate(`(()=>{const summary=document.querySelector('.agent-identity summary');return {height:summary.getBoundingClientRect().height,label:summary.getAttribute('aria-label'),name:document.querySelector('.agent-name').textContent,status:document.querySelector('.agent-state').textContent,detail:document.querySelector('.agent-status-detail')?.textContent}})()`)
    assert.ok(statusLayout.height<=64,JSON.stringify(statusLayout))
    assert.ok(statusLayout.label.includes(statusLayout.name)&&statusLayout.label.includes(statusLayout.status),JSON.stringify(statusLayout))
    assert.equal(statusLayout.detail,errorDetail)
    console.log('AGENT_REFERENCE_PASS')
    finish(0)
    return
  }
  if (process.argv.includes('--overview-refresh-only')) {
    await assertOverviewRefreshIndicator({ownerConversation:true})
    console.log('PASS Overview red dot, refresh spinner and conversation isolation')
    finish(0);return
  }
  if (process.argv.includes('--jev-startup-only')) {
    await assertJevStartupStatus()
    console.log('PASS Jev startup checking, results, repeat frames and compact themes')
    finish(0);return
  }
  if (process.argv.includes('--personal-agent-messages-only')) {
    publishStatus({ state: 'thinking', transcript: 'Question 中文', message: 'Partial response' })
    await evaluate(`new Promise(r => setTimeout(r, 30))`)
    publishStatus({ state: 'idle', transcript: 'Question 中文', message: 'Final response' })
    await evaluate(`new Promise(r => setTimeout(r, 30))`)
    await assertNotificationMessagesAreIndependent()
    await assertRemoteConversationHistory()
    console.log('PASS Personal Agent keeps each reply and notification separate with a 20px gap')
    finish(0)
    return
  }
  await assertOverviewRefreshIndicator()
  const compactSegments = [{ text: 'You have ' }, { text: '3 active sessions', icon: 'sessions' },
    { text: ' and ' }, { text: '2 plants at 63% moisture', icon: 'plants' },
    { text: ' today. Taipei is ' }, { text: '26°C and overcast', icon: 'weather' }, { text: '.' }]
  const compact = { state: 'live', generatedAt: Date.now(), omittedSources: 0, items: [{
    text: compactSegments.map(s => s.text).join(''), segments: compactSegments,
    sources: [{ id: 'desk', label: 'Desk readings', state: 'live', updatedAt: Date.now() }],
  }] }
  await send(compact)
  assert.equal(await evaluate(`document.querySelectorAll('.dash-fact svg').length`), 3)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.dash-icon svg')).color === getComputedStyle(document.querySelector('.dash-fact')).color`), false, 'only icons carry source color')
  assert.ok(await evaluate(`document.querySelector('.dash-unit')?.getBoundingClientRect().width < parseFloat(getComputedStyle(document.querySelector('.dash-fact')).fontSize)`), 'Celsius unit uses compact typography')
  await send({ ...compact, items: [{ text: 'Weather 25°C.', segments: [{ text: 'Weather 25°C.', icon: 'weather' }], sources: compact.items[0].sources }] })
  assert.equal(await evaluate(`document.querySelector('.dash-token').textContent`), 'Weather', 'complete weather label stays attached')
  assert.equal(await evaluate(`document.querySelector('.dash-temperature')?.textContent`), '25°C', 'temperature and unit stay together')
  await evaluate(`window.odkTheme.set('pixel')`)
  assert.ok(await evaluate(`document.querySelector('.dash-unit-degree') && getComputedStyle(document.querySelector('.dash-unit')).fontFamily.includes('Zpix')`), 'Pixel Celsius uses pixel font and square degree')
  await evaluate(`window.odkTheme.set('instrument')`)
  await send(compact)
  assert.equal(await evaluate(`document.querySelector('#dash-narrative').tagName`), 'P')
  assert.equal(await evaluate(`document.querySelector('.dash-foot, .dash-provenance, #dash-agent-status, #dash-source-list')`), null)
  assert.ok(await evaluate(`(() => { const n=document.querySelector('#dash-narrative'), d=document.querySelector('.dash'), c=getComputedStyle(d); return Math.abs(n.getBoundingClientRect().width-(d.clientWidth-parseFloat(c.paddingLeft)-parseFloat(c.paddingRight))) < 2 })()`), 'home uses full content width')

  for (const [change, direction] of [['+1.23%', 'up'], ['-0.63%', 'down'], ['-100.00%', 'down'], ['0.00%', undefined]]) {
    const text = `${change} Futu holdings today.`
    const frame = { ...compact, items: [{ text, segments: [{ text, icon: 'portfolio' }], sources: [{ id: 'futu', label: 'Futu holdings', state: 'live' }] }] }
    await send(frame)
    assert.equal(await evaluate(`document.querySelector('.dash-change')?.textContent`), change)
    assert.equal(await evaluate(`document.querySelector('.dash-change')?.dataset.direction`), direction)
    if (direction) assert.equal(await evaluate(`getComputedStyle(document.querySelector('.dash-change')).color === getComputedStyle(document.querySelector('.dash-fact')).color`), false)
    await send({ ...frame, state: 'loading' })
    assert.equal(await evaluate(`document.querySelector('.dash-change')?.dataset.direction`), undefined)
  }
  await send(compact)

  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    for (const [width, height] of [[1920, 1280], [1920, 1080], [1280, 800], [1280, 776], [960, 640], [480, 854], [320, 480]]) {
      await resize(width, height)
      await evaluate(`(async () => { await odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); await document.fonts.ready; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))) })()`)
      await send(compact)
      const geometry = await evaluate(`(() => {
        const bar = document.querySelector('#status-bar'), pi = document.querySelector('#sb-pi-status')
        const metrics = odkLayout.compute(innerWidth, innerHeight)
        const cell = document.querySelector('[data-widget="odk.tile.weather"]').getBoundingClientRect()
        const pane = document.querySelector('#pages-viewport')
        return { statusHeight: bar.clientHeight, expectedHeight: metrics.statusH,
          icon: parseFloat(getComputedStyle(document.querySelector('#sb-net svg')).width), expectedIcon: metrics.barIcon,
          capsule: parseFloat(getComputedStyle(pi).borderTopWidth),
          time: parseFloat(getComputedStyle(document.querySelector('.sb-time')).fontSize),
          summaryBorder: parseFloat(getComputedStyle(document.querySelector('#home-summary')).borderTopWidth),
          squares: [...document.querySelectorAll('.widget')].filter(tile => odkGridPlacement.spanCells(tile.style.gridColumn) === 1 && odkGridPlacement.spanCells(tile.style.gridRow) === 1).map(tile => { const r = tile.getBoundingClientRect(); return Math.abs(r.width - r.height) }),
          cell: [cell.width, cell.height], columns: window.__odkGrid.cols, unit: window.__odkGrid.cellDim,
          paneWidth: pane.clientWidth, spans: ['odk.tile.pi-sessions','odk.tile.pomodoro'].map(id => document.querySelector('[data-widget="'+id+'"]').dataset.span),
          overflow: document.querySelector('.widget-grid').scrollWidth > pane.clientWidth }
      })()`)
      assert.equal(geometry.statusHeight, geometry.expectedHeight, theme + ' original State Bar height')
      assert.equal(geometry.icon, geometry.expectedIcon, theme + ' original State Bar icons')
      assert.ok(geometry.capsule >= 1, 'Pi retains its outlined capsule')
      assert.ok(geometry.time >= 20, 'clock retains original display typography')
      assert.ok(Math.abs(geometry.cell[0] - geometry.cell[1]) < 1, '1x1 is square')
      assert.ok(geometry.squares.every(delta => delta < 1), 'every 1x1 Widget is square')
      assert.equal(geometry.summaryBorder, 0, 'Overview has no border in any theme')
      assert.equal(geometry.overflow, false, 'right grid has no horizontal overflow')
      assert.ok(geometry.columns <= 3, 'right grid never exceeds three columns')
      if (width >= 1280) {
        const fit = await evaluate(`(() => {
          const pane = document.querySelector('#pages-viewport').getBoundingClientRect()
          const tiles = [...document.querySelectorAll('[data-page-id="home"] .widget')].map(tile => tile.getBoundingClientRect())
          const gap = parseFloat(getComputedStyle(document.querySelector('[data-page-id="home"] .widget-grid')).gap)
          return { agentWidth: document.querySelector('#personal-agent').getBoundingClientRect().width,
            leftMargin: Math.min(...tiles.map(r => r.left)) - pane.left,
            rightMargin: pane.right - Math.max(...tiles.map(r => r.right)),
            overviewLeft: document.querySelector('#home-summary').getBoundingClientRect().left,
            overviewRight: document.querySelector('#home-summary').getBoundingClientRect().right,
            gridLeft: Math.min(...tiles.map(r => r.left)), gridRight: Math.max(...tiles.map(r => r.right)),
            bottomMargin: pane.bottom - Math.max(...tiles.map(r => r.bottom)),
            topMargin: Math.min(...tiles.map(r => r.top)) - pane.top, gap }
        })()`)
        assert.ok(fit.agentWidth >= width * 0.35 && fit.agentWidth < width * 0.6, 'Agent uses spare width beside the square canvas: ' + JSON.stringify(fit))
        if (width === 1920) assert.ok(Math.abs(fit.leftMargin - 32) <= 1 && Math.abs(fit.rightMargin - 32) <= 1, 'square canvas has balanced 32 pixel side margins: ' + JSON.stringify(fit))
        if (width === 1920) assert.ok(fit.bottomMargin >= 16 && fit.bottomMargin < 19, 'reference canvas leaves one margin plus integer-cell rounding: ' + JSON.stringify(fit))
        assert.equal(fit.topMargin, geometry.unit + 32, 'Overview occupies the first row with one gap before Widgets')
        assert.equal(fit.gap, 16, 'Widget grid uses consistent expanded spacing')
        assert.ok(Math.abs(fit.overviewLeft - fit.gridLeft) <= 1 && Math.abs(fit.overviewRight - fit.gridRight) <= 1, 'Overview spans the same three columns as Widgets: ' + JSON.stringify(fit))
        if (width === 1920 && height === 1280) {
          assert.ok(await evaluate(`document.querySelector('#home-summary').scrollHeight <= document.querySelector('#home-summary').clientHeight + 1`), 'reference Overview shows its short briefing without scrolling')
        }
        const visibleHome = await evaluate(`(() => {
          const pane = document.querySelector('#pages-viewport').getBoundingClientRect()
          return Array.from(document.querySelectorAll('[data-page-id="home"] .widget')).filter(tile => {
            const r = tile.getBoundingClientRect()
            return r.left >= pane.left && r.right <= pane.right && r.top >= pane.top && r.bottom <= pane.bottom
          }).length
        })()`)
        const homeWidgetCount = await evaluate(`window.DESKTOP_LAYOUT.pages.find(page => page.id === 'home').widgets.length`)
        assert.equal(visibleHome, homeWidgetCount, `all ${homeWidgetCount} Home Widgets are fully visible on desktop panels`)
        assert.ok(await evaluate(`(() => { const page=document.querySelector('[data-page-id="home"]'); page.scrollTop=100; return page.scrollTop===0 && getComputedStyle(page).overflowY==='clip' })()`), 'Home cannot scroll vertically')
        assert.equal(geometry.columns, 3, 'wide right pane uses at most three columns')
        assert.ok(geometry.unit >= 186, 'home uses readable square units')
        assert.equal(await evaluate(`window.__odkGrid.rows`), 2, 'Widget region has two rows')
        assert.ok(await evaluate(`document.querySelector('#pages-viewport').clientHeight >= 3 * window.__odkGrid.cellDim + 64 && document.querySelector('#pages-viewport').clientHeight < 3 * window.__odkGrid.cellDim + 67`), 'Overview and two Widget rows fit the three-row canvas')
        assert.deepEqual(geometry.spans, ['kept', 'kept'], 'original instrument proportions survive')
        if (width === 1920) assert.ok(await evaluate(`Array.from(document.querySelectorAll('.widget')).every(tile => tile.getBoundingClientRect().bottom <= tile.closest('.page').getBoundingClientRect().bottom)`), 'reference panel shows complete Widget pages')
      }
      const header = await evaluate(`(() => {
        const day = document.querySelector('.dash-wd').getBoundingClientRect()
        const date = document.querySelector('.dash-date').getBoundingClientRect()
        return { align: getComputedStyle(document.querySelector('.dash-head')).alignItems, sameRow: date.top < day.bottom, centers: Math.abs((day.top + day.bottom) / 2 - (date.top + date.bottom) / 2) }
      })()`)
      assert.equal(header.align, 'center')
      assert.equal(header.sameRow, true, theme + ' ' + width + ' weekday and date share one row')
      if (header.sameRow) assert.ok(header.centers < 1, theme + ' ' + width + ' header centers align')
      const sentence = await evaluate(`(() => {
        const dash = document.querySelector('.dash')
        const paragraph = document.querySelector('#dash-narrative')
        return { text: paragraph.textContent, icons: paragraph.querySelectorAll('svg').length,
          overflow: dash.scrollWidth > dash.clientWidth + 1,
          fits: dash.scrollHeight <= dash.clientHeight + 1,
          attached: [...paragraph.querySelectorAll('.dash-token')].every(token => token.getClientRects().length === 1),
          warmColors: [...paragraph.querySelectorAll('.dash-icon[data-kind="weather"], .dash-icon[data-kind="sessions"]')].map(n => {
            const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
            const ctx = canvas.getContext('2d'); ctx.fillStyle = getComputedStyle(n).color; ctx.fillRect(0, 0, 1, 1)
            const [red, green, blue] = ctx.getImageData(0, 0, 1, 1).data
            return red > blue + 10
          }),
          iconColors: [...paragraph.querySelectorAll('.dash-icon')].map(n => getComputedStyle(n).color),
          facts: [...paragraph.querySelectorAll('.dash-fact')].map(n => getComputedStyle(n).color),
          context: getComputedStyle(paragraph.querySelector('.dash-context')).color,
          pixel: [...paragraph.querySelectorAll('svg')].every(n => n.getAttribute('fill') === 'currentColor') }
      })()`)
      assert.equal(sentence.text, compact.items[0].text)
      assert.equal(sentence.icons, 3)
      assert.ok(sentence.warmColors.every(Boolean), 'weather and Pi use warm accents without blue')
      assert.equal(new Set(sentence.iconColors).size, 3, 'weather, sessions and plants have distinct restrained colors')
      assert.equal(sentence.attached, true, 'icons stay with their text')
      assert.equal(sentence.overflow, false)
      assert.ok(sentence.facts.every(color => color !== sentence.context))
      if (width >= 960) assert.equal(sentence.fits, true, theme + ' ' + width + ' compact sentence fits')
      assert.equal(sentence.pixel, theme === 'pixel')
      await send({ ...compact, state: 'loading' })
      assert.equal(await evaluate(`document.querySelectorAll('.dash-icon[data-state="live"]').length`), 0, 'retained values have no live color')
      assert.equal(await evaluate(`new Set([...document.querySelectorAll('.dash-icon')].map(n => getComputedStyle(n).color)).size`), 3, 'retained source icons retain their category colors')
      const statement = '<script>literal</script> 状态更新。' + 'Long source context with mixed 中文 readings. '.repeat(8)
      const frame = { state: 'live', generatedAt: Date.now(), omittedSources: 1, items: [{ text: statement,
        sources: [{ id: 'mail', label: 'Mail ' + '长标题'.repeat(30), state: 'stale', updatedAt: Date.now() - 60000 }] }] }
      await send(frame)
      const result = await evaluate(`(() => {
        const dash = document.querySelector('.dash');
        const text = document.querySelector('[data-briefing="agent-0"]');
        const status = document.querySelector('#dash-narrative');
        return { literal: text.textContent, script: !!text.querySelector('script'),
          overflow: dash.scrollWidth > dash.clientWidth + 1,
          controls: dash.querySelectorAll('details, summary, button, a, [tabindex]').length,
          footer: !!dash.querySelector('.dash-foot, #dash-agent-status, #dash-source-list'), live: status.getAttribute('aria-live'),
          storedFallback: dash.textContent.includes('You have') };
      })()`)
      assert.equal(result.literal, statement)
      assert.equal(result.script, false)
      assert.equal(result.overflow, false, `${theme} ${width}: no horizontal overflow`)
      assert.equal(result.controls, 0)
      assert.equal(result.footer, false)
      assert.equal(result.live, 'polite')
      assert.equal(result.storedFallback, false)
      for (const state of ['loading', 'empty', 'unavailable', 'error', 'stale']) {
        await send({ ...frame, state, items: ['loading', 'stale'].includes(state) ? frame.items : [] })
        assert.equal(await evaluate(`document.querySelector('#dash-narrative').dataset.state`), state)
        assert.ok(await evaluate(`document.querySelector('#dash-narrative').textContent.length > 0`))
      }
      publishStatus({ state: 'error', message: '' })
      await evaluate(`new Promise(r => setTimeout(r, 30))`)
      assert.ok(await evaluate(`parseFloat(getComputedStyle(document.querySelector('.agent-state')).fontSize) >= 14`), 'Agent recovery feedback clears the text floor')
      assert.equal(await evaluate(`document.querySelector('.agent-state').getAttribute('role')`), 'status')
      assert.match(await evaluate(`document.querySelector('.agent-state').textContent`), /try again/)
      console.log(`PASS Agent home: ${theme} ${width}x${height} literal text, no metadata controls, availability, wrapping`)
    }
  }
  await evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); new Promise(r => setTimeout(r, 80))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[1].classList.contains('active')`), true)
  await evaluate(`document.querySelectorAll('.dot')[0].click(); new Promise(r => setTimeout(r, 80))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[0].classList.contains('active')`), true)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await resize(1280, 800)
    await evaluate(`window.odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); new Promise(r => setTimeout(r, 100))`)
    await send(compact)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-agent-home-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  await resize(1536, 1024)
  await evaluate(`window.dispatchEvent(new Event('resize')); new Promise(r => setTimeout(r, 100))`)
  await send(compact)
  const firstCard = await evaluate(`(() => { const r = document.querySelector('#home-summary').getBoundingClientRect(); return { x: r.x, height: r.height, unit: window.__odkGrid.cellDim, border: parseFloat(getComputedStyle(document.querySelector('#home-summary')).borderTopWidth) } })()` )
  assert.equal(firstCard.height, firstCard.unit, 'Overview is exactly one grid row high')
  assert.equal(firstCard.border, 0, 'Overview stays borderless')
  const swipe = await evaluate(`(() => { const r = document.querySelector('#home-summary').getBoundingClientRect(); return { x: Math.round(r.right - 30), y: Math.round(r.top + 24), end: Math.round(r.left + 30) } })()`)
  win.webContents.sendInputEvent({ type: 'mouseDown', x: swipe.x, y: swipe.y, button: 'left', clickCount: 1 })
  win.webContents.sendInputEvent({ type: 'mouseMove', x: swipe.end, y: swipe.y, button: 'left' })
  win.webContents.sendInputEvent({ type: 'mouseUp', x: swipe.end, y: swipe.y, button: 'left', clickCount: 1 })
  await evaluate(`new Promise(r => setTimeout(r, 280))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[1].classList.contains('active')`), true, 'swiping Overview changes the whole Home page')
  assert.ok(await evaluate(`document.querySelector('#home-summary').getBoundingClientRect().right <= document.querySelector('#pages-viewport').getBoundingClientRect().left`), 'next page excludes Overview')
  assert.equal(await evaluate(`document.querySelectorAll('#pages-track > .page:not([data-page-id="home"]) #home-summary').length`), 0)
  await evaluate(`document.querySelectorAll('.dot')[0].click(); new Promise(r => setTimeout(r, 280))`)
  assert.equal(await evaluate(`document.querySelector('#home-summary').getBoundingClientRect().x`), firstCard.x, 'Overview returns with Home')
  assert.equal(await evaluate(`document.querySelector('#home-summary details, #home-summary summary')`), null, 'paging never restores source controls')
  assert.equal(await evaluate(`document.querySelectorAll('#pages-track [data-plugin="odk.page.dashboard"]').length`), 1)
  assert.equal(await evaluate(`getComputedStyle(document.querySelector('.widget[data-interaction="display-only"]')).backgroundColor`), 'rgba(0, 0, 0, 0)')
  await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value = 'Mori 中文'; document.querySelector('.agent-identity-form [name="icon"]').value = 'leaf'; document.querySelector('.agent-identity-form').requestSubmit()`)
  publishStatus({ state: 'thinking', transcript: 'Question 中文', message: 'Partial' })
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
  await evaluate(`window.agentStreamBubble = document.querySelector('.agent-message-bubble'); window.agentStreamBody = document.querySelector('.agent-message-assistant .agent-message-body')`)
  publishStatus({ state: 'thinking', transcript: 'Question 中文', message: 'Partial response' })
  publishStatus({ state: 'unavailable', message: '' })
  publishStatus({ state: 'thinking', transcript: 'Question 中文', message: 'Reconnected response' })
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`), 1, 'reconnect keeps the streaming turn')
  publishStatus({ state: 'idle', transcript: 'Question 中文', message: 'Final response' })
  await evaluate(`new Promise(r => setTimeout(r, 30))`)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`), 1)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-assistant').length`), 1)
  assert.equal(await evaluate(`document.querySelector('.agent-message-assistant .agent-message-body').textContent.includes('Final response')`), true)
  assert.equal(await evaluate(`document.querySelector('.agent-message-bubble') === window.agentStreamBubble && document.querySelector('.agent-message-assistant .agent-message-body') === window.agentStreamBody && getComputedStyle(window.agentStreamBubble).backgroundColor !== 'rgba(0, 0, 0, 0)'`), true, 'streaming and reconnect retain the same message background and body')
  await assertJevStartupStatus()
  await assertNotificationMessagesAreIndependent()
  await assertRemoteConversationHistory()
  await evaluate(`delete window.agentStreamBubble; delete window.agentStreamBody`)
  assert.equal(await evaluate(`document.querySelector('.agent-name').textContent === 'Mori 中文' && document.querySelector('.agent-message-assistant').getAttribute('aria-label') === 'Mori 中文' && document.querySelector('.agent-composer textarea').getAttribute('aria-label').includes('Mori 中文')`), true)
  assert.equal(await evaluate(`document.querySelectorAll('.agent-message-name, .agent-caption, .agent-message time, .agent-message-avatar').length`), 0, 'name is shown once and messages have no timestamps or avatars')
  assert.equal(await evaluate(`document.querySelector('.agent-avatar').innerHTML === document.querySelector('.agent-input-avatar').innerHTML`), true)
  assert.equal(await evaluate(`document.querySelector('#personal-bot-status').hidden && !document.querySelector('#home-desk').inert`), true)
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Typed question'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 30))`)
  assert.deepEqual(sentText, ['Typed question'])
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), '')
  completeBeforeReceipt = true
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Fast turn'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 80))`)
  assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`), 'Ready', 'receipt cannot overwrite a completed status')
  completeBeforeReceipt = false
  textAccepted = false
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Keep draft'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), 'Keep draft')
  assert.match(await evaluate(`document.querySelector('.agent-state').textContent`), /not confirmed/)
  publishStatus({ state: 'recording', message: '' })
  await evaluate(`new Promise(r => setTimeout(r, 30));`)
  await evaluate(`document.querySelector('.agent-mic').click(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(micToggles, 1, 'home Stop toggles the active recording')
  publishStatus({ state: 'idle', transcript: 'Question 中文', message: 'Final response' })
  await evaluate(`new Promise(r => setTimeout(r, 30));`)
  await evaluate(`document.querySelector('.agent-mic').click(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(micToggles, 2, 'next home mic starts another voice turn')
  const identity = await evaluate(`document.querySelector('.agent-name').textContent`)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await resize(320, 480)
    await evaluate(`odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); document.querySelector('.agent-identity-form [name="name"]').value = '中文'.repeat(20); document.querySelector('.agent-identity-form').requestSubmit(); new Promise(r => setTimeout(r, 60))`)
    const nameLayout = await evaluate(`(() => { const panel = document.querySelector('.agent-panel').getBoundingClientRect(), composer = document.querySelector('.agent-composer').getBoundingClientRect(); return { fits: composer.bottom <= panel.bottom && composer.right <= panel.right, conversation: document.querySelector('.agent-conversation').clientHeight } })()`)
    assert.ok(nameLayout.fits && nameLayout.conversation >= 40, JSON.stringify({ theme, nameLayout }))
    assert.equal(await evaluate(`(() => { window.dispatchEvent(new CustomEvent('odk-gamepad-state', { detail: { connected: true, readable: true, id: 'Fixture pad' } })); const bar = document.querySelector('#status-bar').getBoundingClientRect(), pad = document.querySelector('#sb-pad').getBoundingClientRect(), pi = document.querySelector('#sb-pi-status').getBoundingClientRect(); return pad.width > 0 && pad.bottom <= bar.bottom && pad.right <= bar.right && (pi.right <= pad.left || pad.right <= pi.left) })()`), true, 'compact gamepad and Pi status remain inside separate bounds')
    await evaluate(`window.dispatchEvent(new CustomEvent('odk-gamepad-state', { detail: { connected: false } }))`)
  }
  await resize(1536, 1024)
  await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value = ${JSON.stringify(identity)}; document.querySelector('.agent-identity-form').requestSubmit(); window.dispatchEvent(new Event('resize')); new Promise(r => setTimeout(r, 60))`)
  await evaluate(`document.querySelectorAll('.dot')[1].click()` )
  await evaluate(`document.querySelector('.agent-composer textarea').focus(); document.querySelector('.agent-composer textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`)
  assert.equal(await evaluate(`document.querySelectorAll('.dot')[1].classList.contains('active')`), true)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}'); document.querySelectorAll('.dot')[0].click(); new Promise(r => setTimeout(r, 100))`)
    assert.equal(await evaluate(`document.querySelector('.agent-name').textContent`), identity)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-stress-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  await resize(1920, 1280)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); void document.body.offsetHeight; document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
    await send(compact)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-failure-grid-' + theme + '.png'), (await win.webContents.capturePage()).toPNG())
  }
  await assertSessionReplies()
  await assertDuplicateRemoteIds()
  await assertThreadProjectionUpdate()
  await assertThreadCoverageRestore()
  console.log('PASS resident Agent identity, typed input, streaming, retained draft, first-page briefing and independent Agent')
  console.log('PASS keyboard and pointer paging remain usable; fixture capture saved')
  finish(0)
}).catch(error => { console.error(error); finish(1) })
