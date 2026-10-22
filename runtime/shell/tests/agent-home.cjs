const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { capturePaintedPage } = require('./helpers/native-page-capture')
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
let micAccepted = true
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
ipcMain.handle('odk-personal-bot-toggle', () => { micToggles++; return { accepted: micAccepted } })
const timer = setTimeout(() => finish(1), 60000)
const evaluate = script => win.webContents.executeJavaScript(script)
function finish(code) {
  clearTimeout(timer)
  if (win && !win.webContents.isDestroyed() && win.webContents.debugger.isAttached()) win.webContents.debugger.detach()
  win?.destroy()
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
  app.exit(code)
}
async function capturePaintedFrame() { return (await capturePaintedPage(win)).toPNG() }
async function resize(width, height) {
  win.setContentSize(width, height)
  await win.webContents.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  })
  await evaluate(`window.dispatchEvent(new Event('resize'))`)
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if (await evaluate(`innerWidth === ${width} && innerHeight === ${height} && devicePixelRatio === 1 && __odkGrid?.width === ${width} && __odkGrid?.height === ${height}`)) {
      // The first pass changes --status-h. Measure the desk again after that style reaches layout.
      await evaluate(`document.fonts.ready.then(()=>new Promise(resolve=>{window.dispatchEvent(new Event('resize'));requestAnimationFrame(()=>requestAnimationFrame(resolve))}))`)
      return
    }
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
        const result=await evaluate(`(()=>{const n=document.querySelector('.dash-presence'),r=n.getBoundingClientRect(),w=document.querySelector('.dash-wd').getBoundingClientRect(),s=getComputedStyle(n),spinner=getComputedStyle(n,'::after'),probe=document.createElement('span');probe.style.color='var(--odk-accent-red)';document.body.append(probe);const red=getComputedStyle(probe).color;probe.remove();return {same:n===window.overviewPresence,display:s.display,width:r.width,height:r.height,left:r.left,top:r.top,near:r.left>=w.right&&r.left-w.right<40,clearance:r.left-w.right,center:Math.abs(r.top+r.height/2-w.top-w.height/2),background:s.backgroundColor,red,animation:spinner.animationName,border:spinner.borderTopWidth,busy:document.querySelector('#dash-narrative').getAttribute('aria-busy')==='true',narrative:document.querySelector('#dash-narrative').textContent}})()`)
        assert.equal(result.same,true,'the indicator node survives refresh')
        assert.ok(result.display!=='none'&&result.width>=16&&result.height>=16&&result.clearance>=8&&result.near&&result.center<1,JSON.stringify({theme,width,state,...result}))
        if(!position)position={left:result.left,top:result.top,width:result.width,height:result.height}
        assert.deepEqual({left:result.left,top:result.top,width:result.width,height:result.height},position,'spinner keeps the dot footprint')
        if(state==='loading') {assert.equal(result.animation,'odk-overview-refresh');assert.equal(result.border,'2px');assert.equal(result.busy,true);assert.equal(result.narrative,'Synthetic desk reading.')}
        else {assert.equal(result.animation,'none');assert.equal(result.background,result.red)}
        if((width===480 || width===1920)&&['empty','loading','error'].includes(state))fs.writeFileSync(path.join(os.tmpdir(),'odk-overview-'+theme+'-'+state+'-'+width+'.png'),(await capturePaintedPage(win)).toPNG())
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

async function assertOptionalJudgmentStatus() {
  const count=await evaluate(`document.querySelector('.agent-conversation').children.length`)
  for(const jev of ['unavailable','disabled','auth_rejected','missing_credential','checking']) {
    publishStatus({state:'idle',jev:{status:jev},judgment:{status:'ready',provider:'model',model:'synthetic/model-v1'}})
    await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`),'','ordinary judgment availability does not require Jev authentication')
    assert.equal(await evaluate(`document.querySelector('.agent-jev-status')`),null,'optional provider metadata stays out of the conversation')
  }
  publishStatus({state:'idle',jev:{status:'verified'},judgment:{status:'unavailable',provider:'model'}})
  await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`),'Connection unavailable')
  assert.equal(await evaluate(`document.querySelector('.agent-conversation').children.length`),count,'judgment status never inserts chat text')
  for(const theme of ['instrument','pixel','border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}');document.fonts.ready`)
    for(const [width,height]of [[1920,1280],[480,854],[320,480]]) {
      await resize(width,height)
      publishStatus({state:'idle',jev:{status:'disabled'},judgment:{status:'ready',provider:'model',model:'synthetic/model-v1'},briefing:{state:'error',generatedAt:1,omittedSources:0,items:[{text:'2 Synthetic sessions',segments:[{text:'2 Synthetic sessions',icon:'sessions'}],sources:[{id:'synthetic.sessions',label:'Synthetic sessions',state:'live'}]}]}})
      await evaluate('new Promise(r=>setTimeout(r,20))')
      assert.match(await evaluate(`document.querySelector('#dash-narrative').textContent`),/2 Synthetic sessions/)
      const layout=await evaluate(`(()=>{const s=document.querySelector('.agent-head').getBoundingClientRect(),c=document.querySelector('.agent-conversation').getBoundingClientRect(),f=document.querySelector('.agent-composer').getBoundingClientRect();return {visible:s.top>=0&&c.top<=s.top&&s.bottom<c.bottom,conversation:c.height,composer:f.bottom,overflow:document.documentElement.scrollWidth-innerWidth}})()`)
      assert.ok(layout.visible&&layout.conversation>=40&&layout.composer<=height&&layout.overflow<=1,JSON.stringify({theme,width,...layout}))
      if(theme==='instrument'&&[1920,320].includes(width)){await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))');fs.writeFileSync(path.join(os.tmpdir(),'odk-optional-judgment-'+width+'.png'),(await capturePaintedPage(win)).toPNG())}
    }
  }
  await resize(1920,1280)
}

async function assertJevStartupStatus() {
  const states = [['checking','Connecting…'],['verified',''],['disabled','Connection unavailable'],['missing_credential','Connection unavailable'],['auth_rejected','Connection unavailable'],['unavailable','Connection unavailable'],[undefined,'Connection unavailable']]
  const count=await evaluate(`document.querySelector('.agent-conversation').children.length`)
  for (const [status,caption] of states) {
    for (let repeat=0;repeat<2;repeat++) {
      publishStatus({state:'idle',jev:status?{status}:undefined})
      await evaluate('new Promise(r=>setTimeout(r,20))')
      assert.deepEqual(await evaluate(`({count:document.querySelectorAll('.agent-jev-status').length,caption:document.querySelector('.agent-state').textContent})`),{count:0,caption})
      if(repeat===0)await evaluate(`window.readinessCaptionNode=document.querySelector('.agent-state').firstChild`)
      else assert.equal(await evaluate(`document.querySelector('.agent-state').firstChild===window.readinessCaptionNode`),true,'replayed status preserves the same live-region text node')
    }
  }
  assert.equal(await evaluate(`document.querySelector('.agent-conversation').children.length`),count,'provider readiness never adds chat text')
  await evaluate('delete window.readinessCaptionNode')
  for(const theme of ['instrument','pixel','border-beam']){
    await resize(480,854);await evaluate(`odkTheme.set('${theme}');document.fonts.ready`)
    publishStatus({state:'idle',jev:{status:'unavailable'},judgment:{status:'ready',provider:'model',model:'synthetic/model'}})
    await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`),'')
    assert.equal(await evaluate(`document.querySelector('.agent-jev-status')`),null)
  }
  await resize(320,480)
  publishStatus({state:'idle',jev:{status:'checking'}});await evaluate('new Promise(r=>setTimeout(r,30))')
  const geometry=await evaluate(`(()=>{const h=document.querySelector('.agent-head').getBoundingClientRect(),c=document.querySelector('.agent-conversation').getBoundingClientRect(),f=document.querySelector('.agent-composer').getBoundingClientRect();return {header:h.bottom,conversation:c.top,height:c.height,composer:f.bottom}})()`)
  assert.ok(geometry.header>geometry.conversation&&geometry.height>=40&&geometry.composer<=480,JSON.stringify(geometry))
  await resize(1920,1280);await evaluate("odkTheme.set('instrument')")
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

async function assertSimpleConversation() {
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').placeholder`),'Message…','compact composer uses a single short placeholder')
  assert.match(await evaluate(`document.querySelector('.agent-composer textarea').getAttribute('aria-label')`),/Personal Agent/,'accessible input label retains the agent identity')
  const source={key:'1a'.repeat(32),revision:'2b'.repeat(32),threadId:'3c'.repeat(32),machine:'Synthetic Mac',sessionId:'synthetic-session-00000000-0000-4000-8000-000000000001',project:'/synthetic/training',taskName:'中文识别训练',control:'report_only',availability:'live'}
  const item={id:'4d'.repeat(32),at:1000,text:'合成示例：中文识别训练有新进展，验证集 CER 降到 37.35%，检查点已保存到 Drive。控制器仍依赖 Mac 在线，请保留原终端；独立测试还没做。',presentation:'assistant_update',sources:[source]}
  const frame={state:'idle',judgment:{status:'ready',provider:'model',model:'synthetic/test'},jev:{status:'disabled'},agents:{state:'live',tasks:[{taskId:'99999999-9999-4999-8999-999999999999',identity:{id:'synthetic-checker',name:'Synthetic design agent',avatar:'code',revision:'9'.repeat(64)},state:'running',updatedAt:new Date().toISOString()}]},remote:{state:'partial',messages:[item],replies:[],heldCount:1,expiredMessages:2}}
  publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,30))')
  const observed=await evaluate(`(()=>{const article=document.querySelector('[data-remote-id="${item.id}"]');return {primary:article.textContent,details:article.querySelectorAll('details,summary').length,task:article.querySelector('.agent-session-open').textContent}})()`)
  assert.doesNotMatch(observed.primary,/Session|synthetic-session|Synthetic Mac|Report only|Source:|Revision:/)
  assert.match(observed.primary,/中文识别训练有新进展/);assert.match(observed.primary,/Reply/)
  assert.equal(observed.details,0);assert.equal(observed.task,'中文识别训练')
  assert.equal(await evaluate(`document.querySelector('.agent-state').hidden`),true,'ready is quiet')
  assert.equal(await evaluate(`document.querySelector('.agent-status-dot')`),null)
  assert.equal(await evaluate(`document.querySelector('.agent-child-avatar svg')!==null`),true)
  assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage, .agent-history-earlier')`),null)
  publishStatus({...frame,state:'thinking'});await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`),'Thinking…')
  assert.equal(await evaluate(`document.querySelector('.agent-state').hidden`),false)
  publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${item.id}"] .agent-session-reply').length`),1,'single and multiple sources use one Reply per task row')
  await evaluate(`document.querySelector('.agent-session-reply').click()`)
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),false,'single-source reply retains its exact reference')
  await evaluate(`document.querySelector('.agent-reply-cancel').click()`)
  const second={...source,key:'5e'.repeat(32),revision:'6f'.repeat(32),threadId:'7a'.repeat(32),sessionId:'synthetic-second-session',project:'/synthetic/v8',taskName:'外壳模型调整'}
  const multi={...item,id:'8b'.repeat(32),at:2000,text:'合成示例：v8 模型完成，前留白缩到 10 mm、前两角改为 R12，可编辑模型包已生成。原键盘和触控板位置未改；实体下盖与触控板仍需试装。',sources:[source,second]}
  const next={...frame,remote:{...frame.remote,messages:[multi,item]}}
  publishStatus(next);await evaluate('new Promise(r=>setTimeout(r,30))')
  await evaluate(`document.querySelector('[data-remote-id="${multi.id}"] .agent-session-reply').focus({preventScroll:true})`)
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true,'multi-source Reply never selects the first source implicitly')
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${multi.id}"] .agent-session-open').length`),2)
  await evaluate(`document.querySelector('[data-remote-id="${multi.id}"] .agent-session-reply[data-source-key="${second.key}"]').click()`)
  assert.match(await evaluate(`document.querySelector('.agent-reply-session').textContent`),/外壳模型调整/)
  await evaluate(`document.querySelector('.agent-reply-cancel').click()`)
  const reply={id:'11111111-1111-4111-8111-111111111111',threadId:source.threadId,sessionId:source.sessionId,text:'请继续检查这个结果。',replyTo:{messageId:item.id,sourceKey:source.key,sourceRevision:source.revision},status:'answered',at:3000,answer:'合成示例：已完成检查。'}
  const replies={...next,remote:{...next.remote,replies:[reply]}}
  publishStatus(replies);await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.equal(await evaluate(`document.querySelector('.agent-reply-status').hidden`),true,'successful receipt does not repeat a status beside the owner message')
  for(const status of ['unknown','failed']){
    publishStatus({...replies,remote:{...replies.remote,replies:[{...reply,status}]}});await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`(()=>{const n=document.querySelector('.agent-reply-status'),r=n.getBoundingClientRect();return r.width>0&&r.height>0})()`),true,'uncertain and failed delivery remain visible')
  }
  publishStatus(replies);await evaluate('new Promise(r=>setTimeout(r,20))')
  await evaluate(`document.querySelectorAll('.agent-update-sources').forEach(d=>d.open=false)` )
  for(const theme of ['instrument','pixel','border-beam','liquid-glass']){
    await evaluate(`odkTheme.set('${theme}');document.fonts.ready`)
    for(const [width,height]of [[1920,1280],[1280,800],[480,854],[320,480]]){
      await resize(width,height);await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
      const geometry=await evaluate(`(()=>{const p=document.querySelector('.agent-panel').getBoundingClientRect(),c=document.querySelector('.agent-composer').getBoundingClientRect(),v=document.querySelector('.agent-conversation');return {viewport:innerWidth,panel:{left:p.left,right:p.right,width:p.width},overflow:v.scrollWidth>v.clientWidth+1,composer:c.bottom<=p.bottom&&c.right<=p.right,reply:[...document.querySelectorAll('.agent-session-reply')].filter(n=>getComputedStyle(n).display!=='none').every(n=>n.getBoundingClientRect().height>=44),scroller:getComputedStyle(v).overflowY}})()`)
      assert.ok(geometry.panel.left>=0&&geometry.panel.right<=width, 'Agent fits viewport: '+JSON.stringify(geometry));assert.equal(geometry.overflow,false);assert.equal(geometry.composer,true);assert.equal(geometry.reply,true);assert.equal(geometry.scroller,'auto')
      await assertSessionActionGeometry(item.id, theme, width)
      fs.writeFileSync(path.join(os.tmpdir(),`odk-simple-agent-${theme}-${width}.png`),(await capturePaintedPage(win)).toPNG())
    }
  }
  const longName='Android 客户端连接与设备输入验证'.repeat(3).slice(0,40)
  publishStatus({...frame,remote:{...frame.remote,messages:[{...item,sources:[{...source,taskName:longName}]}]}})
  await evaluate('new Promise(r=>setTimeout(r,30))')
  for(const theme of ['instrument','pixel','border-beam','liquid-glass']) for(const [width,height]of [[1920,1280],[1280,800],[480,854],[320,480]]) {
    await evaluate(`odkTheme.set('${theme}');document.fonts.ready`)
    await resize(width,height)
    const named=await evaluate(`(()=>{const c=document.querySelector('.agent-conversation'),n=document.querySelector('[data-remote-id="${item.id}"] .agent-session-open');return {text:n.textContent,overflow:c.scrollWidth-c.clientWidth,height:n.getBoundingClientRect().height}})()`)
    assert.equal(named.text,longName,'long task names update in place without changing the source reference')
    assert.ok(named.overflow<=1&&named.height>=44,JSON.stringify(named))
    await assertSessionActionGeometry(item.id, theme+' long-name', width)
  }
  publishStatus({...frame,remote:{...frame.remote,state:'unavailable'}});await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`),'Task updates unavailable','actual connection failure remains visible in the header')
}

async function assertSessionActionGeometry(id, theme, width) {
  const geometry = await evaluate(`(()=>{
    const article=document.querySelector('[data-remote-id="${id}"]'),task=article.querySelector('.agent-session-open'),reply=article.querySelector('.agent-session-reply');
    const t=task.getBoundingClientRect(),r=reply.getBoundingClientRect(),s=getComputedStyle(task),range=document.createRange();range.selectNodeContents(task);const text=range.getBoundingClientRect();
    return {padding:[parseFloat(s.paddingInlineStart),parseFloat(s.paddingInlineEnd)],textInset:[text.left-t.left,t.right-text.right],center:Math.abs(t.y+t.height/2-r.y-r.height/2),taskHeight:t.height,replyHeight:r.height};
  })()`)
  assert.ok(geometry.padding.every(value=>value>=12)&&geometry.textInset.every(value=>value>=12), 'Task text needs capsule padding: '+JSON.stringify({theme,width,...geometry}))
  assert.ok(geometry.center<=1&&geometry.taskHeight>=44&&geometry.replyHeight>=44, 'Task and Reply must align: '+JSON.stringify({theme,width,...geometry}))
}

async function assertCapsuleStack() {
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  for(const theme of ['instrument','pixel','border-beam','liquid-glass'])for(const [width,height] of [[1280,800],[480,854],[320,480]]) {
    await resize(width,height)
    await evaluate(`odkTheme.set('${theme}');document.fonts.ready`)
    publishStatus({state:'thinking'})
    await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))')
    const r=await evaluate(`(()=>{const avatar=document.querySelector('.agent-avatar'),identity=document.querySelector('.agent-identity'),name=document.querySelector('.agent-name'),state=document.querySelector('.agent-state'),pill=identity.querySelector('summary'),a=avatar.getBoundingClientRect(),n=name.getBoundingClientRect(),s=state.getBoundingClientRect(),p=pill.getBoundingClientRect();return {front:Number(getComputedStyle(avatar).zIndex)>Number(getComputedStyle(identity).zIndex),nameClear:n.top>=a.bottom+2,below:s.top>=n.bottom,contained:n.left>=p.left&&n.right<=p.right&&s.bottom<=p.bottom,caption:state.textContent,motion:pill.getAnimations().length}})()`)
    assert.ok(r.front&&r.nameClear&&r.below&&r.contained,theme+' '+width+': avatar in front, name clear, status below '+JSON.stringify(r))
    assert.equal(r.caption,'Thinking…');assert.equal(r.motion,0,'reduced motion remains static')
  }
  await resize(1280,360)
  await evaluate(`odkTheme.set('instrument');document.fonts.ready`)
  await evaluate(`document.querySelector('.agent-identity summary').click();new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  const overlap=await evaluate(`(()=>{const a=document.querySelector('.agent-avatar').getBoundingClientRect(),f=document.querySelector('.agent-identity-form').getBoundingClientRect();return {x:Math.ceil(Math.max(a.left,f.left)),y:Math.ceil(Math.max(a.top,f.top)),width:Math.floor(Math.min(a.right,f.right)-Math.max(a.left,f.left)),height:Math.floor(Math.min(a.bottom,f.bottom)-Math.max(a.top,f.top))}})()`)
  assert.ok(overlap.width>0&&overlap.height>8,'short panel exercises actual editor/avatar overlap')
  console.log('SHORT_EDITOR_CROP '+JSON.stringify(overlap))
  const editorPaint=(await capturePaintedPage(win,overlap)).toBitmap()
  let withoutAvatar
  try {
    await evaluate(`document.querySelector('.agent-avatar').style.visibility='hidden';new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
    withoutAvatar=(await capturePaintedPage(win,overlap)).toBitmap()
  } finally { await evaluate(`document.querySelector('.agent-avatar').style.removeProperty('visibility')`) }
  assert.equal(editorPaint.length,withoutAvatar.length,'editor comparison uses the same native crop')
  let occluded=0;for(let i=0;i<editorPaint.length;i+=4)if(editorPaint[i]!==withoutAvatar[i]||editorPaint[i+1]!==withoutAvatar[i+1]||editorPaint[i+2]!==withoutAvatar[i+2])occluded++
  assert.equal(occluded,0,'the opaque editor paints above the avatar on short panels')
  await evaluate(`document.querySelector('.agent-identity').open=false`)
  await resize(320,480)
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  publishStatus({state:'transcribing'})
  await evaluate(`new Promise(r=>requestAnimationFrame(r))`)
  assert.equal(await evaluate(`(()=>{const a=document.querySelector('.agent-identity summary').getAnimations();window.capsuleMotion=a[0];return a.length===1&&a[0].effect.getTiming().iterations===1&&a[0].effect.getTiming().duration<=300})()`),true,'status changes run one bounded capsule reaction '+JSON.stringify(await evaluate(`({hidden:document.hidden,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,caption:document.querySelector('.agent-state').textContent,animations:document.querySelector('.agent-identity summary').getAnimations().map(a=>({state:a.playState,timing:a.effect.getTiming()}))})`)))
  publishStatus({state:'transcribing'})
  await evaluate(`new Promise(r=>requestAnimationFrame(r))`)
  assert.equal(await evaluate(`document.querySelector('.agent-identity summary').getAnimations()[0]===window.capsuleMotion`),true,'identical frames preserve the current animation')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  assert.equal(await evaluate(`document.querySelector('.agent-identity summary').getAnimations().length`),0,'preference change cancels the reaction')
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  publishStatus({state:'error'})
  await evaluate(`new Promise(r=>requestAnimationFrame(r))`)
  await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`)
  assert.equal(await evaluate(`document.querySelector('.agent-identity summary').getAnimations().length`),0,'hidden document cancels the reaction')
  publishStatus({state:'thinking'})
  await evaluate(`new Promise(r=>requestAnimationFrame(r))`)
  assert.equal(await evaluate(`document.querySelector('.agent-identity summary').getAnimations().length`),0,'hidden updates remain static')
  await evaluate(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`)
  publishStatus({state:'transcribing'})
  await evaluate(`new Promise(r=>requestAnimationFrame(r))`)
  await evaluate(`window.releasedCapsule=document.querySelector('.agent-identity summary');odkRendererRuntime.setEnabled('odk.page.personal-agent',false)`)
  assert.equal(await evaluate(`releasedCapsule.getAnimations().length`),0,'release cancels the reaction')
  await evaluate(`odkRendererRuntime.setEnabled('odk.page.personal-agent',true)`)
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  publishStatus({state:'idle'})
  await evaluate(`new Promise(r=>requestAnimationFrame(r))`)
  assert.equal(await evaluate(`document.querySelector('.agent-state').hidden`),true,'idle hides redundant Ready text')
  await resize(1280,800);await evaluate(`odkTheme.set('liquid-glass');document.fonts.ready`)
  publishStatus({state:'thinking'})
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`)
  fs.writeFileSync(path.join(os.tmpdir(),'odk-agent-capsule-stack.png'),await capturePaintedFrame())
  console.log('AGENT_CAPSULE_STACK_PASS')
}

async function assertThreadOverlayInput() {
  const source={key:'a7'.repeat(32),revision:'b7'.repeat(32),threadId:'c7'.repeat(32),machine:'Synthetic Mac',sessionId:'synthetic-overlay-session',taskName:'Thread check',control:'report_only',availability:'live'}
  const messages=Array.from({length:16},(_,i)=>({id:(i+1).toString(16).padStart(64,'0'),at:1000+i,presentation:'assistant_update',text:'Thread result '+i+'. '+'Content remains readable. '.repeat(6),sources:[source]}))
  for(const theme of ['instrument','pixel','border-beam','liquid-glass'])for(const [width,height]of [[1280,800],[320,480]]) {
    await resize(width,height)
    await evaluate(`(async()=>{await odkTheme.set('${theme}');await document.fonts.ready})()`)
    publishStatus({state:'idle',remote:{state:'live',messages,total:messages.length,replies:[]}})
    await evaluate(`new Promise(r=>setTimeout(r,30))`)
    await evaluate(`document.querySelector('.agent-session-open').click()`)
    const band=await evaluate(`(()=>{const list=document.querySelector('.agent-conversation'),nav=document.querySelector('.agent-thread-nav'),r=nav.getBoundingClientRect(),first=list.querySelector('.agent-message:not([hidden])');list.scrollTop+=first.getBoundingClientRect().top-r.top+20;const x=r.right-24,y=r.top+r.height/2,button=nav.querySelector('button'),b=button.getBoundingClientRect();return {underlay:!!document.elementFromPoint(x,y)?.closest('.agent-conversation'),button:button.contains(document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)),surface:(getComputedStyle(button).backgroundColor!=='rgba(0, 0, 0, 0)'||getComputedStyle(button).backgroundImage!=='none')&&getComputedStyle(button).borderTopWidth==='1px',x,y,buttonX:b.x+b.width/2,buttonY:b.y+b.height/2,scrollTop:list.scrollTop,navTop:r.top}})()`)
    assert.ok(band.underlay&&band.button&&band.surface,theme+' '+width+': thread navigation passes input outside its readable button '+JSON.stringify(band))
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x:band.x,y:band.y,deltaX:0,deltaY:80})
    await evaluate(`new Promise(r=>setTimeout(r,80))`)
    assert.equal(await evaluate(`document.querySelector('.agent-conversation').scrollTop>${band.scrollTop}&&Math.abs(document.querySelector('.agent-thread-nav').getBoundingClientRect().top-${band.navTop})<1`),true,theme+' '+width+': native wheel scrolls behind thread navigation')
    for(const type of ['mousePressed','mouseReleased'])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,x:band.buttonX,y:band.buttonY})
    assert.equal(await evaluate(`document.querySelector('.agent-thread-nav').hidden`),true,'native All messages click exits the exact thread')
  }
}

async function assertRemoteConversationHistory() {
  const source={key:'b'.repeat(64),revision:'c'.repeat(64),threadId:'d'.repeat(64),machine:'Synthetic Mac',sessionId:'session',project:'/synthetic/legacy',control:'report_only',availability:'live'}
  const legacy={id:'e'.repeat(64),at:1000,text:'Legacy <img src=x onerror=alert(1)> report',sources:[source]}
  const item={...legacy,id:'f'.repeat(64),at:2000,presentation:'assistant_update',text:'消息链路已恢复。\n设备输入仍待核验。',sources:[{...source,taskName:'Android 客户端连接'}]}
  const frame={state:'idle',remote:{state:'partial',messages:[item,legacy],hasMore:true,omitted:8,total:4,heldCount:1}}
  publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.equal(await evaluate(`document.querySelector('.agent-conversation details, .agent-conversation summary, .agent-earlier-updates, .agent-remote-coverage, .agent-history-earlier')`),null,'conversation has messages rather than metadata disclosures')
  assert.equal(await evaluate(`document.querySelector('[data-remote-id="${legacy.id}"] img')`),null,'remote text remains literal')
  assert.equal(await evaluate(`document.querySelector('[data-remote-id="${legacy.id}"]').parentElement.className`),'agent-conversation','legacy messages share the same timeline')
  assert.equal(await evaluate(`document.querySelector('[data-remote-id="${item.id}"] .agent-session-open').textContent`),'Android 客户端连接')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  await evaluate(`document.querySelector('[data-remote-id="${item.id}"] .agent-session-open').focus()`)
  for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
  assert.equal(await evaluate(`document.querySelector('.agent-thread-nav').hidden`),false,'task name opens the exact thread by keyboard')
  assert.equal(await evaluate(`document.querySelector('.agent-thread-nav span').textContent`),'Android 客户端连接')
  await evaluate(`document.querySelector('.agent-thread-all').click()`)
  const button=await evaluate(`document.querySelector('[data-remote-id="${item.id}"] .agent-session-open').getBoundingClientRect().height`)
  assert.ok(button>=44)
  publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${item.id}"]').length`),1,'reconnect never duplicates the update')
}


async function assertThreadCoverageRestore() {
  const source={key:'a2'.repeat(32),revision:'b2'.repeat(32),threadId:'c2'.repeat(32),taskName:'Task connection',machine:'Synthetic Mac',sessionId:'synthetic-coverage-session',project:'/synthetic/coverage',control:'report_only',availability:'live'}
  const item={id:'d2'.repeat(32),at:9000,text:'Synthetic completed task for coverage checks',presentation:'assistant_update',sources:[source]}
  for(const state of ['stale','partial','live','unavailable']) {
    publishStatus({state:'idle',remote:{state,messages:[item],replies:[],total:1}});await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage')`),null)
    await evaluate(`document.querySelector('[data-remote-id="${item.id}"] .agent-session-open').click();document.querySelector('.agent-thread-all').click()`)
    assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`),({unavailable:'Task updates unavailable',stale:'Task updates may be out of date'}[state] || ''))
    await evaluate(`document.querySelector('[data-source-key="${source.key}"]').click();document.querySelector('.agent-reply-cancel').click()`)
    assert.equal(await evaluate(`document.querySelector('.agent-remote-coverage')`),null,'thread navigation never restores removed metadata')
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
  const other={...source,key:'5'.repeat(64),revision:'4'.repeat(64),threadId:'3'.repeat(64),sessionId:'synthetic-other-session',taskName:'Legacy second task'}
  const first={id,at:4000,text:'Synthetic legacy snapshot one',sources:[source]}
  const second={id,at:5000,text:'Synthetic legacy snapshot two',sources:[other]}
  const publish=async messages=>{publishStatus({state:'idle',remote:{state:'live',messages,replies:[],total:messages.length}});await evaluate('new Promise(r=>setTimeout(r,30))')}
  await publish([second,first])
  const reply={id:'34567890-1234-4123-8123-123456789abc',at:5500,threadId:other.threadId,sessionId:other.sessionId,text:'Follow up on the second task',replyTo:{messageId:id,sourceKey:other.key,sourceRevision:other.revision},status:'delivered'}
  publishStatus({state:'idle',remote:{state:'live',messages:[second,first],replies:[reply],total:2}});await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.match(await evaluate(`document.querySelector('[data-reply-id="${reply.id}"]').textContent`),/Legacy second task/,'durable reply labels resolve the complete source identity')
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${id}"]').length`),2,'legacy duplicate IDs preserve distinct immutable source snapshots')
  await evaluate(`document.querySelector('[data-source-key="${other.key}"]').click()`)
  assert.match(await evaluate(`document.querySelector('.agent-reply-context').textContent`),/Legacy second task/)
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
  const first={key:'b'.repeat(64),revision:'c'.repeat(64),threadId:'d1'.repeat(32),machine:'Synthetic Mac',sessionId:'training-'+ '1'.repeat(220),project:'/synthetic/training',taskName:'中文识别训练',control:'report_only',availability:'live'}
  const second={...first,key:'e'.repeat(64),revision:'f'.repeat(64),threadId:'d2'.repeat(32),sessionId:'22222222-2222-4222-8222-222222222222',project:'/synthetic/v8',taskName:'外壳模型调整'}
  const item={id:'a1'.repeat(32),at:1000,text:'合成示例：训练与 v8 模型都有新的完成结果。',presentation:'assistant_update',verification:'reported_unverified',synthesisVerification:'passed',sources:[first,second]}
  const frame={state:'idle',remote:{state:'live',messages:[item],replies:[],total:1}}
  publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,30))')
  assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${item.id}"] .agent-session-reply').length`),2,'multiple sessions require explicit reply choices')
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true,'incoming updates do not silently select a target')
  await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
  await evaluate(`document.querySelector('[data-remote-id="${item.id}"] [data-source-key="${second.key}"]').focus()`)
  for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
  assert.match(await evaluate(`document.querySelector('.agent-reply-context').textContent`),/外壳模型调整/)
  await evaluate(`document.querySelector('textarea').value='Keep this draft';document.querySelector('.agent-reply-cancel').focus()`)
  for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
  assert.equal(await evaluate(`document.querySelector('textarea').value`),'Keep this draft')
  assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),true)
  await evaluate(`document.querySelector('[data-remote-id="${item.id}"] [data-source-key="${first.key}"]').click()`)
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
  const completed={...item,id:'a2'.repeat(32),at:3000,threadId:first.threadId,text:'合成示例：同一训练会话的后续检查已完成。',sources:[first]}
  const updated={...frame,remote:{...frame.remote,messages:[completed,item],replies:[owner],total:2}}
  publishStatus(updated);await evaluate('new Promise(r=>setTimeout(r,30))');publishStatus(updated);await evaluate('new Promise(r=>setTimeout(r,20))')
  assert.equal(await evaluate(`document.querySelectorAll('[data-reply-id="${owner.id}"]').length`),1,'durable owner replies do not duplicate on reconnect')
  assert.deepEqual(await evaluate(`[...document.querySelectorAll('.agent-conversation > [data-thread-id="${first.threadId}"]')].map(n=>n.querySelector('.agent-message-body').firstChild.textContent)`),['Keep this draft',completed.text])
  for(const theme of geometry ? ['instrument','pixel','border-beam'] : []) {
    await evaluate(`window.odkTheme.set('${theme}');document.fonts.ready`)
    for(const [width,height] of [[1920,1280],[480,854],[320,480]]) {
      await resize(width,height)
      await evaluate(`document.querySelector('[data-remote-id="${item.id}"] [data-source-key="${first.key}"]').click()`)
      const geometry=await evaluate(`(()=>{const c=document.querySelector('.agent-composer').getBoundingClientRect(),r=document.querySelector('.agent-reply-context').getBoundingClientRect(),l=document.querySelector('.agent-conversation'),b=document.querySelector('.agent-reply-cancel').getBoundingClientRect();return {composer:c.bottom,reference:r.bottom,composerTop:c.top,touch:b.height,overflow:l.scrollWidth-l.clientWidth,bodyOverflow:document.documentElement.scrollWidth-innerWidth,region:l.clientHeight,panel:document.querySelector('.agent-panel').getBoundingClientRect().height,head:document.querySelector('.agent-head').getBoundingClientRect().height,nav:document.querySelector('.agent-thread-nav').getBoundingClientRect().height,refHeight:r.height,gap:getComputedStyle(document.querySelector('.agent-panel')).gap,flex:getComputedStyle(l).flex}})()`)
      console.log('SESSION_REPLY_GEOMETRY',JSON.stringify({theme,width,...geometry}))
      assert.ok(geometry.composer<=height&&geometry.reference<=geometry.composerTop&&geometry.touch>=44&&geometry.overflow<=1&&geometry.bodyOverflow<=1&&geometry.region>=40,JSON.stringify({theme,width,...geometry}))
      await evaluate('document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))')
      fs.writeFileSync(path.join(os.tmpdir(),`odk-session-reply-${theme}-${width}.png`),(await capturePaintedPage(win)).toPNG())
    }
  }
  await evaluate(`document.querySelector('.agent-reply-cancel').click();document.querySelector('.agent-thread-all').click();document.querySelector('textarea').value='Ordinary after reply';document.querySelector('.agent-composer').requestSubmit();new Promise(r=>setTimeout(r,30))`)
  assert.equal(sentReplyTo.at(-1),undefined,'ordinary sends never inherit the old reference')
  assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`),'Waiting for response…','an accepted unbound receipt without a status push keeps its waiting caption')
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
  if (process.argv.includes('--short-history-only')) {
    await resize(1920,5000)
    const replies=Array.from({length:26},(_,i)=>({id:`${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`,at:i+1,threadId:'a'.repeat(64),sessionId:'short-session',text:`Request ${i}`,answer:`Answer ${i}`,status:'answered',replyTo:{messageId:'b'.repeat(64),sourceKey:'source',sourceRevision:'c'.repeat(64)}}))
    publishStatus({state:'idle',remote:{state:'live',messages:[],replies:[...replies].reverse(),total:0}})
    await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message').length`),24)
    assert.equal(await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');return c.scrollHeight===c.clientHeight})()`),true,'latest batch fits without any scroll range')
    await evaluate(`document.querySelector('.agent-conversation').dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true}))`)
    await evaluate('new Promise(r=>setTimeout(r,50))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message').length`),48,'top wheel gesture loads history even without actual scrolling')
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await evaluate(`document.querySelector('.agent-conversation').focus({preventScroll:true})`)
    for(const type of ['keyDown','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Home',code:'Home',windowsVirtualKeyCode:36})
    await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message').length`),52,'Home loads the remaining retained batch')
    assert.equal(sentText.length,0)
    console.log('PASS short history wheel and keyboard loading without a history button');finish(0);return
  }
  if (process.argv.includes('--lazy-history-retention-only')) {
    const id = i => `${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`
    const src={key:'source',revision:'a'.repeat(64),machine:'synthetic',sessionId:'session',project:'/synthetic',control:'report_only',availability:'live',threadId:'a'.repeat(64)}
    const messages=Array.from({length:8},(_,i)=>({id:String(i).padStart(64,'a'),at:i*10,text:`Synthetic remote ${i}`,presentation:'assistant_update',sources:[src],verification:'reported_unverified',synthesisVerification:'passed'}))
    const replies=Array.from({length:32},(_,i)=>({id:id(i+1),at:i*10+1,threadId:src.threadId,sessionId:src.sessionId,text:`Synthetic reply ${i}`,answer:`Synthetic answer ${i}`,status:'answered',replyTo:{messageId:messages[0].id,sourceKey:src.key,sourceRevision:src.revision}}))
    const turns=Array.from({length:8},(_,i)=>({id:id(i+101),at:i*10+2,transcript:`Synthetic owner ${i}`,message:`Synthetic response ${i}`,state:'idle'}))
    publishStatus({state:'idle',remote:{state:'live',messages:[...messages].reverse(),replies:[...replies].reverse(),total:8},conversation:{revision:1,turns}})
    await evaluate('new Promise(r=>setTimeout(r,30))')
    const before=await evaluate(`({reply:!!document.querySelector('[data-reply-id="${replies[0].id}"]'),owner:!!document.querySelector('[data-owner-turn-id="${turns[0].id}"]')})`)
    publishStatus({state:'idle',remote:{state:'live',messages:[...messages].reverse(),replies:[{...replies[31],id:id(33),at:400},...replies.slice(1).reverse()],total:8},conversation:{revision:2,turns:[...turns.slice(1),{...turns[7],id:id(109),at:401}]}})
    await evaluate('new Promise(r=>setTimeout(r,30))')
    await evaluate(`(()=>{let count=0;const c=document.querySelector('.agent-conversation');while(count++<16){c.scrollTop=81;c.dispatchEvent(new Event('scroll'));c.scrollTop=0;c.dispatchEvent(new Event('scroll'))}})()`)
    const after=await evaluate(`({reply:!!document.querySelector('[data-reply-id="${replies[0].id}"]'),owner:!!document.querySelector('[data-owner-turn-id="${turns[0].id}"]')})`)
    assert.deepEqual(before,{reply:false,owner:false},'initially deferred old items have no DOM')
    assert.deepEqual(after,{reply:true,owner:true},'later snapshots cannot discard already received deferred history')
    const updatedReply={...replies[0],answer:'A later terminal answer for the same reply identity'}
    const sharedTurn={...turns[0],id:updatedReply.id,at:updatedReply.at,threadId:src.threadId,transcript:updatedReply.text,message:updatedReply.answer}
    publishStatus({state:'idle',remote:{state:'live',messages:[...messages].reverse(),replies:[updatedReply],total:8},conversation:{revision:3,turns:[sharedTurn]}})
    await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user[data-owner-turn-id="${updatedReply.id}"][data-reply-id="${updatedReply.id}"]').length`),1,'same owner and reply identity shares one article')
    assert.equal(await evaluate(`document.querySelector('.agent-message-assistant[data-owner-turn-id="${updatedReply.id}"] .agent-message-body').textContent`),updatedReply.answer,'a same-identity terminal answer updates its existing article')
    for(let batch=0;batch<5;batch++) {
      const nextReplies=Array.from({length:32},(_,i)=>({...replies[0],id:id(5001+batch*32+i),at:1000+batch*1000+i,text:`Reply-only ${batch}:${i}`}))
      publishStatus({state:'idle',remote:{state:'live',messages:[...messages].reverse(),replies:nextReplies.reverse(),total:8},conversation:{revision:4+batch,turns:[sharedTurn]}})
      await evaluate('new Promise(r=>setTimeout(r,5))')
    }
    assert.equal(await evaluate(`!!document.querySelector('.agent-message-user[data-owner-turn-id="${updatedReply.id}"]')&&!document.querySelector('[data-reply-id="${updatedReply.id}"]')`),true,'reply eviction releases its reply identity while the owner still retains the shared article')
    for(let batch=0;batch<18;batch++) {
      const base=5000+batch*1000
      const nextReplies=Array.from({length:32},(_,i)=>({...replies[0],id:id(1001+batch*32+i),at:base+i*10,text:`Bounded reply ${batch}:${i}`,answer:`Bounded reply answer ${batch}:${i}`}))
      const nextTurns=Array.from({length:8},(_,i)=>({...turns[0],id:id(3001+batch*8+i),at:base+i*35+1,transcript:`Bounded owner ${batch}:${i}`,message:`Bounded owner answer ${batch}:${i}`}))
      publishStatus({state:'idle',remote:{state:'live',messages:[...messages].reverse(),replies:nextReplies.reverse(),total:8},conversation:{revision:9+batch,turns:nextTurns}})
      await evaluate('new Promise(r=>setTimeout(r,5))')
    }
    await evaluate(`(()=>{let count=0;const c=document.querySelector('.agent-conversation');while(count++<64){c.scrollTop=81;c.dispatchEvent(new Event('scroll'));c.scrollTop=0;c.dispatchEvent(new Event('scroll'))}})()`)
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user[data-reply-id]').length`),128,'reply data and DOM keep the existing 128-entry bound')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user[data-owner-turn-id]').length`),128,'owner data and DOM keep the existing 128-entry bound')
    assert.equal(await evaluate(`!!document.querySelector('[data-reply-id="${replies[0].id}"], [data-owner-turn-id="${turns[0].id}"]')`),false,'entries beyond the original bounds expire')
    for(let i=0;i<2;i++) {
      const live={state:'thinking',ownerTurnId:id(60001+i),transcript:`Live owner ${i}`,message:`Live response ${i}`,conversation:{revision:30+i,turns:[]},remote:{state:'live',messages:[],replies:[],total:0}}
      publishStatus(live);await evaluate('new Promise(r=>setTimeout(r,20))')
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('.agent-message-user')).filter(row=>/^(Bounded owner|Live owner)/.test(row.querySelector('.agent-message-body').textContent)).length`),128,'a new live turn evicts the oldest mounted owner pair within the original bound')
      publishStatus(live);await evaluate('new Promise(r=>setTimeout(r,20))')
      assert.equal(await evaluate(`(()=>{const rows=[...document.querySelectorAll('.agent-message-user')].filter(row=>/^(Bounded owner|Live owner)/.test(row.querySelector('.agent-message-body').textContent));return rows.length===128&&new Set(rows.map(row=>row.querySelector('.agent-message-body').textContent)).size===128})()`),true,'later pushes cannot recreate an evicted owner pair or orphan its existing DOM')
      assert.equal(await evaluate(`Array.from(document.querySelectorAll('.agent-message-body')).filter(body=>body.textContent===${JSON.stringify(live.transcript)}||body.textContent===${JSON.stringify(live.message)}).length`),2,'the current live user and assistant remain mounted exactly once')
    }
    assert.equal(sentText.length,0)
    console.log('PASS deferred owner/reply history survives later snapshots within original 128-entry bounds')
    return finish(0)
  }
  if (process.argv.includes('--lazy-history-only')) {
    const id = i => `${String(i).padStart(8,'0')}-1111-4111-8111-111111111111`
    const source = i => ({key:`source-${i}`,revision:String(i).padStart(64,'a'),machine:'synthetic',sessionId:`session-${i%2}`,project:'/synthetic',control:'report_only',availability:'live',threadId:(i%2?'b':'a').repeat(64)})
    const messages = Array.from({length:8},(_,i)=>({id:String(i).padStart(64,'c'),at:(i*3+2)*10+1,text:`Remote ${i} 完成结果。`.repeat(12),presentation:'assistant_update',sources:[source(i)],verification:'reported_unverified',synthesisVerification:'passed'}))
    messages[0].at=10000
    const replies = Array.from({length:32},(_,i)=>({id:id(i+1),at:i*10,threadId:(i%2?'b':'a').repeat(64),sessionId:`session-${i%2}`,text:`Owner reply ${i}`,answer:`Answer ${i} 中文结果。`.repeat(12),status:'answered',replyTo:{messageId:messages[i%8].id,sourceKey:source(i%8).key,sourceRevision:source(i%8).revision}}))
    const turns = Array.from({length:8},(_,i)=>({id:id(i+101),at:(i*3+1)*10+2,threadId:(i%2?'b':'a').repeat(64),transcript:`Question ${i}`,message:`History ${i} 中文结果。`.repeat(12),state:'idle'}))
    const frame={state:'idle',remote:{state:'live',messages:[...messages].reverse(),replies:[...replies].reverse(),total:8},conversation:{revision:1,turns}}
    await evaluate(`window.createdMessages=0;window.lazyNodes=new WeakSet();window.lazyObserver=new MutationObserver(records=>{for(const r of records)for(const n of r.addedNodes)if(n.nodeType===1)for(const message of [...(n.matches('.agent-message')?[n]:[]),...n.querySelectorAll('.agent-message')])if(!window.lazyNodes.has(message)){window.lazyNodes.add(message);window.createdMessages++}});window.lazyObserver.observe(document.querySelector('.agent-conversation'),{childList:true,subtree:true})`)
    publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,40))')
    assert.ok(await evaluate(`document.querySelectorAll('.agent-message').length<=24&&window.createdMessages<=24`),'only twelve logical items create DOM, without mounting then hiding older messages')
    assert.equal(await evaluate(`!!document.querySelector('[data-reply-id="${replies[0].id}"]')`),false,'oldest reply has no DOM before loading')
    assert.equal(await evaluate(`document.querySelector('.agent-history-earlier')`),null)
    assert.equal(await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');return c.scrollHeight-c.clientHeight-c.scrollTop<2})()`),true,'opening follows latest without accidentally loading older items')
    messages[0].sources[0].threadId='f'.repeat(64)
    publishStatus(frame);await evaluate('new Promise(r=>setTimeout(r,20))')
    await evaluate(`document.querySelector('[data-remote-id="${messages[0].id}"] .agent-session-open').click()`)
    assert.equal(await evaluate(`!!document.querySelector('[data-reply-id="${replies[0].id}"]:not([hidden])')`),true,'a deferred reply follows its exact origin into a changed canonical thread')
    await evaluate(`document.querySelector('.agent-thread-all').click()`)
    await evaluate(`(()=>{document.querySelector('textarea').value='Draft 中文';window.retainedLazyNodes=[...document.querySelectorAll('.agent-message')];const c=document.querySelector('.agent-conversation');c.scrollTop=120;window.lazyAnchor=[...c.querySelectorAll('.agent-message')].find(n=>n.getBoundingClientRect().bottom>c.getBoundingClientRect().top);window.lazyTop=window.lazyAnchor.getBoundingClientRect().top;c.focus({preventScroll:true})})()`)
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    await evaluate(`window.beforeHomeLoad=document.querySelectorAll('.agent-message').length`)
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'})
    await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`window.retainedLazyNodes.every(n=>n.isConnected)&&Math.abs(window.lazyAnchor.getBoundingClientRect().top-window.lazyTop)<1&&document.querySelector('textarea').value==='Draft 中文'`),true,'earlier insertion preserves viewport anchor, existing nodes and draft')
    assert.ok(await evaluate(`document.querySelectorAll('.agent-message').length>window.beforeHomeLoad`),'Home loads an earlier batch through the focused conversation')
    await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');c.scrollTop=0;c.dispatchEvent(new Event('scroll'))})()`)
    await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.ok(await evaluate(`document.querySelectorAll('.agent-message').length>36`),'upward scrolling loads another batch')
    await evaluate(`document.querySelector('[data-remote-id="${messages[7].id}"] .agent-session-reply').click();document.querySelector('.agent-reply-cancel').click();window.beforeCancelLoad=document.querySelectorAll('.agent-message').length;const c=document.querySelector('.agent-conversation');c.scrollTop=81;c.dispatchEvent(new Event('scroll'));c.scrollTop=0;c.dispatchEvent(new Event('scroll'))`)
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message').length>window.beforeCancelLoad`),true,'cancel reply immediately restores all-thread history loading without a new push')
    await evaluate(`for(let i=0;i<16;i++){const c=document.querySelector('.agent-conversation');c.scrollTop=81;c.dispatchEvent(new Event('scroll'));c.scrollTop=0;c.dispatchEvent(new Event('scroll'))}`)
    assert.equal(await evaluate(`!!document.querySelector('[data-reply-id="${replies[0].id}"]')`),true)
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message').length`),88,'all three kinds eventually mount exactly once')
    assert.equal(await evaluate(`(()=>{const times=[...document.querySelectorAll('.agent-conversation > .agent-message')].map(n=>{if(n.dataset.remoteId)return ${JSON.stringify(messages)}.find(m=>m.id===n.dataset.remoteId).at;if(n.dataset.replyId)return ${JSON.stringify(replies)}.find(r=>r.id===n.dataset.replyId).at;const answer=/^Answer (\\d+)/.exec(n.querySelector('.agent-message-body').textContent);if(answer)return Number(answer[1])*10+0.5;return ${JSON.stringify(turns)}.find(t=>t.id===n.dataset.ownerTurnId)?.at});return times.every((at,i)=>i===0||at>=times[i-1])})()`),true,'remote updates, owner turns and replies share chronological order')
    const expected=messages[7]
    await evaluate(`document.querySelector('[data-remote-id="${expected.id}"] .agent-session-reply').click()`)
    assert.equal(await evaluate(`document.querySelector('.agent-reply-context').hidden`),false)
    assert.equal(await evaluate(`document.querySelector('textarea').value`),'Draft 中文')
    assert.equal(await evaluate(`([...document.querySelectorAll('.agent-message')].filter(n=>!n.hidden)).every(n=>JSON.parse(n.dataset.threadIds||'[]').includes('${'b'.repeat(64)}'))`),true,'reply selection keeps the exact source thread')
    assert.equal(sentText.length,0,'history and thread interactions never dispatch a request')
    await evaluate(`document.querySelector('.agent-reply-cancel').click();document.querySelector('.agent-thread-all').click();document.querySelector('.agent-latest').click()`)
    assert.equal(await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');return c.scrollHeight-c.clientHeight-c.scrollTop<2})()`),true)
    assert.equal(await evaluate(`document.querySelector('.agent-composer').closest('.agent-conversation')===null`),true)
    await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');c.scrollTop=120;window.liveAnchor=[...c.querySelectorAll('.agent-message')].find(n=>n.getBoundingClientRect().bottom>c.getBoundingClientRect().top);window.liveTop=window.liveAnchor.getBoundingClientRect().top})()`)
    const live={...frame,state:'thinking',ownerTurnId:id(201),transcript:'A current user request',message:'Actual live draft 中文'}
    publishStatus(live);await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`Math.abs(window.liveAnchor.getBoundingClientRect().top-window.liveTop)<1&&document.querySelector('.agent-latest').hidden===false&&document.querySelector('textarea').value==='Draft 中文'`),true,'incoming output preserves a reader position and draft')
    await evaluate(`document.querySelector('.agent-latest').click()`)
    publishStatus({...live,state:'idle',message:'Actual completed output 中文'.repeat(12)});await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');return c.scrollHeight-c.clientHeight-c.scrollTop<2})()`),true,'new output follows when already at latest')
    for (const theme of ['instrument','pixel','border-beam']) for (const [width,height] of [[1920,1280],[480,854]]) {
      await evaluate(`window.odkTheme.set('${theme}');document.fonts.ready`);await resize(width,height)
      await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
      assert.equal(await evaluate(`(()=>{const c=document.querySelector('.agent-conversation'),p=document.querySelector('.agent-panel').getBoundingClientRect(),f=document.querySelector('.agent-composer').getBoundingClientRect();return c.scrollWidth<=c.clientWidth+1&&f.bottom<=p.bottom+1&&f.right<=p.right+1&&getComputedStyle(c).overflowY==='auto'})()`),true,'long CJK history keeps one scroller and a fixed composer')
      try { fs.writeFileSync(path.join(os.tmpdir(),`odk-lazy-history-${theme}-${width}.png`),(await capturePaintedPage(win)).toPNG()) } catch(error) { throw Error(`Lazy capture ${theme} ${width}: ${error.message}`) }
    }
    const legacy={id:'e'.repeat(64),text:'Newly received legacy update without a timestamp',presentation:'assistant_update',sources:[source(80)],verification:'reported_unverified',synthesisVerification:'passed'}
    const dated=Array.from({length:12},(_,i)=>({...legacy,id:String(200+i).padStart(64,'d'),at:Date.now()-1000+i,text:`Dated update ${i}`}))
    const mixed={...frame,remote:{state:'live',messages:[legacy,...dated.reverse()],replies:[],total:13}}
    publishStatus(mixed);await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${legacy.id}"]').length`),1,'a newly received legacy update without at is not buried as epoch zero')
    publishStatus(mixed);await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelectorAll('[data-remote-id="${legacy.id}"]').length`),1,'repeated legacy snapshots retain one stable remote identity')
    await evaluate(`window.lazyObserver.disconnect()`)
    console.log('PASS lazy history bounded DOM, earlier batches, anchor, thread/reply and draft')
    return finish(0)
  }
  if (process.argv.includes('--central-history-only')) {
    const first='11111111-1111-4111-8111-111111111111',second='22222222-2222-4222-8222-222222222222',third='33333333-3333-4333-8333-333333333333'
    const turns=[{id:first,at:1000,transcript:'Synthetic earlier question',message:'Synthetic example: \u8fd9\u91cc\u663e\u793a\u4e2d\u592e\u4fdd\u5b58\u7684\u5bf9\u8bdd\u5185\u5bb9\u3002\u957f\u4e2d\u6587\u4f1a\u81ea\u52a8\u6362\u884c\uff0c\u4e0d\u4f1a\u6324\u51fa\u8f93\u5165\u6846\u3002'.repeat(3),state:'idle'},{id:second,at:2000,transcript:'Synthetic interrupted question',message:'Synthetic partial answer',state:'unconfirmed'}]
    const history={revision:1,turns,omittedCount:2}
    publishStatus({state:'idle',conversation:history});await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`),2,'central history restores ordinary owner turns')
    assert.match(await evaluate(`document.querySelector('.agent-conversation').textContent`),/Response not confirmed/)
    await evaluate(`window.historyNodes=[...document.querySelectorAll('.agent-message')];document.querySelector('textarea').value='Unsent local draft';document.querySelector('textarea').dispatchEvent(new Event('input',{bubbles:true}))`)
    publishStatus({state:'idle',conversation:history});await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`window.historyNodes.every(n=>n.isConnected)&&document.querySelectorAll('.agent-message-user').length===2&&document.querySelector('textarea').value==='Unsent local draft'`),true,'replay preserves message nodes and draft')
    const live={state:'thinking',ownerTurnId:third,transcript:'Synthetic current question',message:'New live answer',conversation:history}
    publishStatus(live);await evaluate('new Promise(r=>setTimeout(r,20))')
    const stale={...history,revision:2,turns:[...turns,{id:third,at:3000,transcript:live.transcript,message:'Old historical draft',state:'thinking'}]}
    publishStatus({...live,conversation:stale});await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelector('.agent-conversation').textContent.includes('Old historical draft')`),false,'history never replaces newer live text')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`),3)
    const finishedHistory={...stale,revision:3,turns:[...turns,{...stale.turns[2],state:'idle',message:'Canonical saved final answer'}]}
    publishStatus({...live,conversation:finishedHistory});await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelector('.agent-conversation').textContent.includes('Canonical saved final answer')`),true,'a saved terminal turn is not overwritten by a repeated cached thinking status')
    const threadId='a'.repeat(64),replyTo={messageId:'b'.repeat(64),sourceKey:'c'.repeat(64),sourceRevision:'d'.repeat(64)}
    const reply={id:third,text:live.transcript,threadId,replyTo,status:'unknown',at:3000,answer:'Synthetic central receipt answer'}
    const final={...live,state:'idle',replyTo,threadId,message:reply.answer,remote:{state:'live',messages:[],replies:[reply]},conversation:{...stale,revision:4,turns:[...turns,{...stale.turns[2],state:'idle',message:reply.answer,replyTo,threadId}]}}
    publishStatus(final);publishStatus(final);await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`),3,'durable replies share the central owner identity')
    assert.equal(await evaluate(`document.querySelectorAll('[data-reply-id="${third}"]').length`),1)
    assert.match(await evaluate(`document.querySelector('[data-reply-id="${third}"]').textContent`),/Delivery not confirmed/)
    assert.equal(await evaluate(`document.querySelector('textarea').value`),'Unsent local draft')
    const interrupted='44444444-4444-4444-8444-444444444444'
    publishStatus({state:'thinking',ownerTurnId:interrupted,transcript:'Synthetic interrupted live turn',message:'Synthetic unfinished draft',conversation:final.conversation});await evaluate('new Promise(r=>setTimeout(r,20))')
    publishStatus({state:'unavailable',ownerTurnId:interrupted,conversation:final.conversation});await evaluate('new Promise(r=>setTimeout(r,20))')
    const restarted={revision:5,turns:[...final.conversation.turns,{id:interrupted,at:4000,transcript:'Synthetic interrupted live turn',message:'Synthetic unfinished draft',state:'unconfirmed'}],omittedCount:2}
    publishStatus({state:'idle',conversation:restarted});await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelector('[data-owner-turn-id="${interrupted}"] .agent-history-state')?.textContent||[...document.querySelectorAll('[data-owner-turn-id="${interrupted}"]')].at(-1)?.querySelector('.agent-history-state')?.textContent`),'Response not confirmed. Check before retrying.','a restarted central turn overrides an old live lease with explicit uncertainty')
    assert.equal(await evaluate(`[...document.querySelectorAll('[data-owner-turn-id="${interrupted}"]')].at(-1).querySelector('.agent-message-body').getAttribute('aria-busy')`),'false')
    initial={state:'idle',jev:{status:'verified'},judgment:{status:'ready',provider:'model'},textInput:true,replyInput:true,briefing:{state:'empty',items:[],generatedAt:1000,omittedSources:0},remote:final.remote,conversation:restarted}
    const reopened=new Promise(resolve=>win.webContents.once('did-finish-load',resolve));win.webContents.reload();await reopened
    await resize(1920,1280);await evaluate('document.fonts.ready.then(()=>new Promise(r=>setTimeout(r,30)))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`),4,'a reopened display restores the same four canonical turns')
    assert.equal(await evaluate(`document.querySelectorAll('[data-reply-id="${third}"]').length`),1,'reopened history and durable reply share one row')
    assert.match(await evaluate(`document.querySelector('.agent-conversation').textContent`),/Response not confirmed/)
    publishStatus({state:'idle',ownerTurnId:first,transcript:turns[0].transcript,message:'Synthetic full live answer after replay. '+turns[0].message,conversation:restarted});await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelector('.agent-conversation').textContent.includes('Synthetic full live answer after replay')`),true,'actual same-identity terminal output may replace a cold history view')
    if(process.argv.includes('--adaptive-copy')) {
      const sizes=[]
      for(const theme of ['instrument','pixel','border-beam']) {
        await evaluate(`window.odkTheme.set('${theme}')`)
        for(const [width,height] of [[320,480],[480,854],[1280,776],[1920,1280]]) {
          await resize(width,height);await evaluate('document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
          const geometry=await evaluate(`(()=>{const panel=document.querySelector('#personal-agent'),body=document.querySelector('.agent-message'),input=document.querySelector('textarea'),log=document.querySelector('.agent-conversation'),composer=document.querySelector('.agent-composer').getBoundingClientRect();return {pane:panel.clientWidth,body:parseFloat(getComputedStyle(body).fontSize),input:parseFloat(getComputedStyle(input).fontSize),composerBottom:composer.bottom,overflow:log.scrollWidth-log.clientWidth,pageOverflow:document.documentElement.scrollWidth-innerWidth,targets:[...document.querySelectorAll('.agent-composer button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44&&b.getBoundingClientRect().width>=44)}})()`)
          assert.ok(geometry.body>=20&&geometry.body<=24&&geometry.input>=20&&geometry.input<=22,JSON.stringify({theme,width,...geometry}))
          assert.ok(geometry.composerBottom<=height&&geometry.overflow<=1&&geometry.pageOverflow<=1&&geometry.targets,JSON.stringify({theme,width,...geometry}))
          if(width===1280)assert.ok(geometry.pane<width/2,'type uses the actual Agent pane, not full screen width')
          sizes.push({theme,width,height,...geometry})
          fs.writeFileSync(path.join(os.tmpdir(),`odk-central-history-${theme}-${width}.png`),(await capturePaintedPage(win)).toPNG())
        }
      }
      assert.ok(sizes.find(s=>s.theme==='instrument'&&s.width===1920).body>sizes.find(s=>s.theme==='instrument'&&s.width===320).body,'type grows with pane space')
      console.log('CENTRAL_TYPE_MATRIX',JSON.stringify(sizes))
    }
    for(const width of [1920,320]) {
      await resize(width,width===320?480:1280);await evaluate('document.fonts.ready')
      assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('.agent-composer').getBoundingClientRect().bottom<=innerHeight`),true)
      fs.writeFileSync(path.join(os.tmpdir(),'odk-central-history-'+width+'.png'),(await capturePaintedPage(win)).toPNG())
    }
    console.log('PASS central history replay, live precedence, draft retention and exact durable identity')
    finish(0);return
  }
  if (process.argv.includes('--unbound-reply-remount-only') || process.argv.includes('--unbound-reply-remount-legacy-only')) {
    const ownerTurnId='33333333-3333-4333-8333-333333333333',threadId='e5'.repeat(32),text='Synthetic in-flight owner turn',answer='Synthetic restored answer'
    const source={key:'a1'.repeat(32),revision:'b2'.repeat(32),threadId,machine:'Synthetic Mac',sessionId:'synthetic-remount-session',project:'/synthetic',control:'configured',availability:'live'}
    const origin={id:'d4'.repeat(32),at:1000,text:'Synthetic completion',presentation:'assistant_update',sources:[source]}
    const legacy=process.argv.includes('--unbound-reply-remount-legacy-only')
    if (legacy) { delete origin.at;delete origin.presentation }
    const queued={id:ownerTurnId,threadId,sessionId:source.sessionId,text,replyTo:{messageId:origin.id,sourceKey:source.key,sourceRevision:source.revision},status:'queued',at:2000}
    const first={state:'thinking',ownerTurnId,transcript:text,message:'',remote:{state:'live',messages:[origin],replies:[queued]}}
    publishStatus(first);await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`),1,'a fresh mount with a combined owner/reply snapshot creates one owner bubble')
    if (legacy) assert.equal(await evaluate(`Boolean(document.querySelector('[data-remote-id="${origin.id}"]').compareDocumentPosition(document.querySelector('[data-reply-id="${ownerTurnId}"]'))&Node.DOCUMENT_POSITION_FOLLOWING)`),true,'legacy origin history precedes its replayed owner reply')
    const final={...first,state:'idle',replyTo:queued.replyTo,threadId,message:answer,remote:{...first.remote,replies:[{...queued,status:'unknown',answer}]}}
    publishStatus(final);publishStatus(final);await evaluate('new Promise(r=>setTimeout(r,20))')
    const restored=await evaluate(`(()=>{const all=[...document.querySelectorAll('.agent-message')];return {owners:all.filter(n=>n.classList.contains('agent-message-user')).length,answers:all.filter(n=>n.querySelector('.agent-message-body')?.textContent===${JSON.stringify(answer)}).length,answerThread:all.find(n=>n.querySelector('.agent-message-body')?.textContent===${JSON.stringify(answer)})?.dataset.threadId}})()`)
    assert.deepEqual(restored,{owners:1,answers:1,answerThread:threadId})
    console.log('PASS fresh-mount combined owner and durable reply snapshot without duplicates')
    finish(0);return
  }
  if (process.argv.includes('--unbound-reply-bridge-only')) {
    const source={key:'a1'.repeat(32),revision:'b2'.repeat(32),threadId:'c3'.repeat(32),machine:'Synthetic Mac',sessionId:'synthetic-unbound-session',project:'/synthetic',control:'configured',availability:'live'}
    const origin={id:'d4'.repeat(32),at:1000,text:'Synthetic completed task',presentation:'assistant_update',sources:[source]}
    const text='Synthetic AI-selected owner request',answer='Synthetic assistant answer'
    const remote={state:'live',messages:[origin],replies:[]}
    const initial={state:'thinking',ownerTurnId:'11111111-1111-4111-8111-111111111111',transcript:text,message:'',remote}
    publishStatus(initial);await evaluate('new Promise(r=>setTimeout(r,20))')
    await evaluate(`window.unboundOwner=[...document.querySelectorAll('.agent-message-user')].at(-1);window.unboundAnswer=[...document.querySelectorAll('.agent-message-assistant')].at(-1)`)
    assert.equal(await evaluate(`Boolean(document.querySelector('[data-remote-id="${origin.id}"]').compareDocumentPosition(unboundOwner)&Node.DOCUMENT_POSITION_FOLLOWING)`),true,'unrelated historical updates stay before the new ordinary owner turn')
    const queued={id:'11111111-1111-4111-8111-111111111111',threadId:source.threadId,sessionId:source.sessionId,text,replyTo:{messageId:origin.id,sourceKey:source.key,sourceRevision:source.revision},status:'queued',at:2000}
    publishStatus({...initial,remote:{...remote,replies:[queued]}});await evaluate('new Promise(r=>setTimeout(r,20))')
    publishStatus({...initial,state:'idle',replyTo:queued.replyTo,threadId:source.threadId,message:answer,remote:{...remote,replies:[{...queued,status:'unknown',answer}]}});await evaluate('new Promise(r=>setTimeout(r,20))')
    const rows=await evaluate(`(()=>{const messages=[...document.querySelectorAll('.agent-message')];return {owners:messages.filter(n=>n.classList.contains('agent-message-user')&&n.querySelector('.agent-message-body')?.textContent===${JSON.stringify(text)}).length,answerThread:messages.find(n=>n.querySelector('.agent-message-body')?.textContent===${JSON.stringify(answer)})?.dataset.threadId}})()`)
    console.log('UNBOUND_BRIDGE_OBSERVED',JSON.stringify(rows))
    assert.equal(rows.owners,1,'AI-selected durable reply must not duplicate the original owner bubble')
    assert.equal(rows.answerThread,source.threadId,'AI-selected answer belongs to the durable session thread')
    assert.equal(await evaluate(`document.querySelector('[data-reply-id="${queued.id}"]')===unboundOwner && [...document.querySelectorAll('.agent-message-assistant')].find(n=>n.querySelector('.agent-message-body')?.textContent===${JSON.stringify(answer)})===unboundAnswer`),true,'binding reuses both original nodes')
    assert.match(await evaluate(`document.querySelector('[data-reply-id="${queued.id}"] .agent-reply-status').textContent`),/Delivery not confirmed/,'an answer does not upgrade unknown transport delivery')
    const secondId='22222222-2222-4222-8222-222222222222',second={...queued,id:secondId,at:3000,status:'answered',answer:'Synthetic second answer'}
    publishStatus({...initial,ownerTurnId:secondId,remote:{...remote,replies:[{...queued,status:'unknown',answer}]}});await evaluate('new Promise(r=>setTimeout(r,20))')
    const final={...initial,state:'idle',ownerTurnId:secondId,replyTo:second.replyTo,threadId:source.threadId,message:second.answer,remote:{...remote,replies:[second,{...queued,status:'unknown',answer}]}}
    publishStatus(final);publishStatus(final);await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`),2,'same text in distinct owner executions is never deduplicated')
    publishStatus({state:'thinking',transcript:text,remote:final.remote});await evaluate('new Promise(r=>setTimeout(r,20))')
    assert.equal(await evaluate(`document.querySelectorAll('.agent-message-user').length`),3,'legacy input without execution identity never adopts historical text')
    console.log('PASS exact owner execution adoption, repeated frames and independent same-text turns')
    finish(0);return
  }
  if (process.argv.includes('--scroll-overlay-only')) {
    const evidence=process.env.ODK_AGENT_SCROLL_EVIDENCE
    await win.webContents.debugger.sendCommand('Emulation.setFocusEmulationEnabled',{enabled:true})
    for(const theme of ['instrument','pixel','border-beam','liquid-glass'])for(const [width,height]of [[1920,1280],[480,854],[320,480]]) {
      await resize(width,height);await evaluate(`odkTheme.set('${theme}');document.fonts.ready`)
      const examples=[['训练进展怎么样？','合成示例：中文识别训练有新进展：验证集 CER 降到 37.35%，最佳和最后检查点已保存到 Drive。控制器仍依赖 Mac 在线，请暂时保留原终端；独立测试还没做。'],['v8 模型有什么变更？','合成示例：v8 模型完成：前留白缩到 10 mm，前两角改为 R12，可编辑模型包已生成。原键盘和触控板位置未改；实体下盖与触控板仍需试装。']]
      for(let i=0;i<8;i++)publishStatus({state:'idle',ownerTurnId:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,transcript:examples[i%2][0],message:examples[i%2][1]})
      await evaluate('new Promise(r=>setTimeout(r,30))')
      // Start at the bottom before measuring the hidden overlay. A prior narrow case can already be at zero.
      await evaluate(`document.querySelector('.agent-conversation').scrollTop=document.querySelector('.agent-conversation').scrollHeight;new Promise(r=>setTimeout(r,30))`)
      const before=await evaluate(`(()=>{const c=document.querySelector('.agent-conversation'),b=document.querySelector('.agent-latest'),f=document.querySelector('.agent-composer');b.hidden=true;return {height:c.clientHeight,composer:f.getBoundingClientRect().top,width:c.clientWidth,top:c.firstElementChild.getBoundingClientRect().top,extent:c.scrollHeight-c.clientHeight}})()`)
      assert.ok(before.extent>40,'the scroll fixture must exceed the near-latest threshold: '+JSON.stringify({theme,width,extent:before.extent}))
      await evaluate(`(async()=>{const c=document.querySelector('.agent-conversation'),b=document.querySelector('.agent-latest'),end=performance.now()+2000;c.scrollTop=0;while(c.scrollTop!==0||b.hidden){if(performance.now()>end)throw Error('Native earlier scroll did not settle: '+JSON.stringify({scrollTop:c.scrollTop,scrollHeight:c.scrollHeight,clientHeight:c.clientHeight,distance:c.scrollHeight-c.clientHeight-c.scrollTop,overlayHidden:b.hidden}));await new Promise(r=>setTimeout(r,20))}})()`)
      const active=await evaluate(`(()=>{const c=document.querySelector('.agent-conversation'),b=document.querySelector('.agent-latest'),f=document.querySelector('.agent-composer'),r=b.getBoundingClientRect(),s=getComputedStyle(c),cr=c.getBoundingClientRect();return {height:c.clientHeight,composer:f.getBoundingClientRect().top,width:c.clientWidth,visible:!b.hidden,position:getComputedStyle(b).position,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)===b||b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),inside:r.top>=cr.top&&r.bottom<=cr.bottom,touch:r.height,scrolling:c.dataset.scrolling,color:s.scrollbarColor,overflow:c.scrollHeight>c.clientHeight,scrollTop:c.scrollTop,distance:c.scrollHeight-c.clientHeight-c.scrollTop}})()`)
      assert.equal(active.position,'absolute','Jump to latest is an overlay, not a flex row')
      assert.ok(active.visible&&active.hit&&active.inside&&active.touch>=44&&active.overflow,JSON.stringify({theme,width,...active}))
      assert.equal(active.height,before.height);assert.equal(active.composer,before.composer);assert.equal(active.width,before.width)
      assert.equal(active.scrolling,'true');assert.ok(!active.color.startsWith('rgba(0, 0, 0, 0)'),active.color)
      await evaluate('new Promise(r=>setTimeout(r,200))')
      const gutter=await evaluate(`(()=>{const c=document.querySelector('.agent-conversation'),r=c.getBoundingClientRect();return{x:Math.floor(r.right-6),y:Math.ceil(r.top),width:6,height:Math.floor(r.height)-1}})()`)
      const activeThumb=(await capturePaintedPage(win, gutter)).toBitmap()
      if(evidence&&[1920,320].includes(width))fs.writeFileSync(path.join(evidence,`scroll-overlay-${theme}-${width}-scrolling.png`),(await capturePaintedPage(win)).toPNG(),{mode:0o600})
      await evaluate(`(async()=>{const c=document.querySelector('.agent-conversation'),end=performance.now()+1200;while(c.dataset.scrolling==='true'){if(performance.now()>end)throw Error('Scrollbar idle did not settle');await new Promise(r=>setTimeout(r,20))}await new Promise(r=>setTimeout(r,60))})()`)
      const fading=await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).scrollbarColor`)
      assert.notEqual(fading,'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)','the scrollbar fades instead of disappearing immediately')
      await evaluate(`new Promise(r=>setTimeout(r,160))`)
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).scrollbarColor`),'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)','idle scrollbar fades to transparent')
      const idleThumb=(await capturePaintedPage(win, gutter)).toBitmap()
      let changed=0;for(let p=0;p<activeThumb.length;p+=4)if(activeThumb[p]!==idleThumb[p]||activeThumb[p+1]!==idleThumb[p+1]||activeThumb[p+2]!==idleThumb[p+2])changed++
      assert.ok(changed>=8,'the actual painted native thumb changes between scrolling and idle: '+JSON.stringify({theme,width,changed}))
      if(evidence&&[1920,320].includes(width))fs.writeFileSync(path.join(evidence,`scroll-overlay-${theme}-${width}-idle.png`),(await capturePaintedPage(win)).toPNG(),{mode:0o600})
      const point=await evaluate(`(()=>{const r=document.querySelector('.agent-conversation').getBoundingClientRect();return{x:r.left+20,y:r.top+r.height/2}})()`)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...point})
      assert.equal(await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).scrollbarColor`),'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)','hover does not keep the scrollbar visible')
      if(theme==='instrument'&&width===1920) {
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',...point,deltaX:0,deltaY:120})
        await evaluate(`(async()=>{const end=performance.now()+2000;while(document.querySelector('.agent-conversation').scrollTop===0){if(performance.now()>end)throw Error('Native wheel did not scroll');await new Promise(r=>setTimeout(r,20))}})()`)
        await evaluate(`document.querySelector('.agent-conversation').scrollTop=0;new Promise(r=>setTimeout(r,200))`)
        const thumb=await evaluate(`(()=>{const c=document.querySelector('.agent-conversation'),r=c.getBoundingClientRect();return{x:Math.floor(r.right-3),y:Math.ceil(r.top+16)}})()`)
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',...thumb})
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...thumb})
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,x:thumb.x,y:thumb.y+80})
        await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,x:thumb.x,y:thumb.y+80})
        await evaluate('new Promise(r=>setTimeout(r,40))')
        assert.ok(await evaluate(`document.querySelector('.agent-conversation').scrollTop>0`),'the visible native thumb remains draggable: '+JSON.stringify(thumb))
        await evaluate(`document.querySelector('.agent-conversation').scrollTop=0;new Promise(r=>setTimeout(r,30))`)
        await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:2})
        const finger={x:point.x+30,y:point.y+60,id:1}
        await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]})
        for(let step=1;step<=6;step++)await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...finger,y:finger.y-step*20}]})
        await win.webContents.debugger.sendCommand('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
        await evaluate(`(async()=>{const end=performance.now()+2000;while(document.querySelector('.agent-conversation').scrollTop===0){if(performance.now()>end)throw Error('Native touch did not scroll');await new Promise(r=>setTimeout(r,20))}})()`)
        await win.webContents.debugger.sendCommand('Emulation.setTouchEmulationEnabled',{enabled:false})
      }
      await evaluate(`document.querySelector('.agent-latest').focus()`)
      for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
      assert.equal(await evaluate(`(()=>{const c=document.querySelector('.agent-conversation');return c.scrollHeight-c.clientHeight-c.scrollTop<2&&document.querySelector('.agent-latest').hidden})()`),true)
      assert.equal(await evaluate(`document.activeElement===document.querySelector('.agent-conversation')`),true,'keyboard activation restores focus to the log')
    }
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).transitionDuration`),'0s')
    await evaluate(`document.querySelector('.agent-conversation').scrollTop=0;new Promise(r=>setTimeout(r,800))`)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).scrollbarColor`),'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'forced-colors',value:'active'}]})
    assert.equal(await evaluate(`matchMedia('(forced-colors: active)').matches`),true)
    assert.equal(await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).maskImage`),'none','forced colors retain an unmasked conversation')
    console.log('Scrollbar forced-colors:',await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).scrollbarColor`))
    console.log('PASS overlay latest control, scroll-only scrollbar, keyboard and reduced motion across four themes and sizes');finish(0);return
  }
  if (process.argv.includes('--simple-conversation-only')) {
    await assertSimpleConversation();console.log('PASS calm conversation, explicit source reply, retained receipts and compact themes');finish(0);return
  }
  if (process.argv.includes('--session-reply-legacy-host')) {
    const source={key:'b'.repeat(64),revision:'c'.repeat(64),threadId:'d'.repeat(64),machine:'Synthetic Mac',sessionId:'synthetic-session',project:'/synthetic',control:'report_only',availability:'live'}
    publishStatus({state:'idle',remote:{state:'live',messages:[{id:'a'.repeat(64),text:'Synthetic completion',presentation:'assistant_update',sources:[source]}],replies:[]}})
    await evaluate('new Promise(r=>setTimeout(r,30))')
    assert.equal(await evaluate(`document.querySelector('.agent-session-reply').disabled`),true,'an old single-argument bridge cannot reply')
    assert.equal(await evaluate(`document.querySelector('.agent-session-reply').disabled`),true,'the shared task-row Reply refuses an old bridge')
    await evaluate(`document.querySelector('.agent-session-reply').dispatchEvent(new MouseEvent('click'))`)
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
  if (process.argv.includes('--onee-preview-only')) {
    await evaluate(`odkTheme.set('instrument');document.fonts.ready`)
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'odk-onee-animation-'))
    const rect=await evaluate(`(()=>{const r=document.querySelector('.agent-head').getBoundingClientRect();return {x:Math.floor(r.x+r.width/2-160),y:Math.floor(r.y-8),width:320,height:240}})()`)
    let frame=0
    const stages=[{state:'idle'},{state:'starting'},{state:'recording'},{state:'transcribing'},{state:'thinking'},{state:'idle',agents:{state:'live',tasks:[{taskId:'synthetic',identity:{name:'Synthetic checker',avatar:'code'},state:'running'}]}},{state:'thinking',message:'Synthetic reply preview'},{state:'idle',message:'Synthetic completed reply'},{state:'error'},{state:'unavailable'},{state:'idle'}]
    for(const stage of stages) {
      publishStatus(stage)
      for(let sample=0;sample<8;sample++) {
        // These fixed timeline holds are for the animation recording, not readiness assertions.
        await new Promise(resolve=>setTimeout(resolve,125))
        fs.writeFileSync(path.join(directory,String(frame++).padStart(4,'0')+'.png'),(await capturePaintedPage(win,rect)).toPNG())
      }
    }
    console.log('ONEE_ANIMATION_FRAMES '+JSON.stringify({directory,frames:frame,fps:8,synthetic:true}))
    finish(0);return
  }
  if (process.argv.includes('--onee-flow-only')) {
    const until=async (script,label)=>{const deadline=Date.now()+4500;while(Date.now()<deadline){if(await evaluate(script))return;await new Promise(resolve=>setTimeout(resolve,20))}assert.fail(label)}
    await until(`typeof odkOneeSdk?.create==='function'&&!!document.querySelector('.agent-avatar .bs-avatar svg')`, 'local Onee engine loads under CSP')
    await evaluate(`window.oneeSvg=document.querySelector('.agent-avatar svg');window.oneePolicyErrors=[];document.addEventListener('securitypolicyviolation',event=>oneePolicyErrors.push(event.violatedDirective));window.oneePaths=()=>[...document.querySelectorAll('.agent-avatar svg path')].map(n=>n.getAttribute('d')).join('|');void 0`)
    for(const [state,phase]of [['starting','preparing'],['recording','listening'],['transcribing','transcribing'],['thinking','thinking']]) {
      const before=await evaluate('oneePaths()')
      publishStatus({state})
      await until(`document.querySelector('.agent-avatar').dataset.phase==='${phase}'`, 'Onee '+phase)
      await until(`oneePaths()!==${JSON.stringify(before)}`, 'Onee geometry animates '+phase)
      assert.equal(await evaluate(`document.querySelector('.agent-avatar svg')===oneeSvg`),true,'service frames preserve the live Onee scene')
    }
    publishStatus({state:'thinking',message:'Synthetic streaming reply'})
    await until(`document.querySelector('.agent-avatar').dataset.phase==='replying'`, 'Onee follows streamed output')
    publishStatus({state:'idle',message:'Synthetic completed reply'})
    await until(`document.querySelector('.agent-avatar').dataset.phase==='complete'`, 'completion reaction starts')
    await until(`document.querySelector('.agent-avatar').dataset.phase==='idle'`, 'completion reaction returns to idle')
    for(const state of ['error','unavailable']) {publishStatus({state});await until(`document.querySelector('.agent-avatar').dataset.phase==='${state}'`,'Onee '+state)}
    await evaluate(`Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))`)
    assert.equal(await evaluate(`document.querySelector('.agent-avatar').dataset.playback`),'paused')
    const paused=await evaluate('oneePaths()');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('oneePaths()'),paused,'background frame stays paused')
    await evaluate(`delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))`)
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    await until(`document.querySelector('.agent-avatar').dataset.playback==='reduced'`, 'reduced motion reacts to preference changes')
    publishStatus({state:'recording'});await until(`document.querySelector('.agent-avatar').dataset.phase==='listening'`, 'static listening pose')
    const reduced=await evaluate('oneePaths()');await evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');assert.equal(await evaluate('oneePaths()'),reduced,'reduced pose does not animate')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]})
    await until(`document.querySelector('.agent-avatar').dataset.playback==='playing'`, 'motion resumes with preference')
    publishStatus({state:'idle'});await until(`document.querySelector('.agent-avatar').dataset.phase==='idle'`, 'idle before rejected microphone')
    micAccepted=false;await evaluate(`document.querySelector('.agent-composer .agent-mic').click()`);await until(`document.querySelector('.agent-avatar').dataset.phase==='error'`, 'microphone rejection ends preparing animation');micAccepted=true
    publishStatus({state:'idle',message:''});await until(`document.querySelector('.agent-avatar').dataset.phase==='idle'`, 'idle before ordinary text')
    textAccepted=false;await evaluate(`document.querySelector('.agent-keys').click();document.querySelector('.agent-composer textarea').value='Synthetic refused request';document.querySelector('.agent-composer').requestSubmit()`)
    await until(`document.querySelector('.agent-avatar').dataset.phase==='error'`, 'ordinary rejected receipt ends sending animation')
    assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`),'Synthetic refused request','rejected send preserves draft');textAccepted=true
    assert.deepEqual(await evaluate('oneePolicyErrors'),[],'animation does not weaken or violate CSP')
    publishStatus({state:'thinking'});await evaluate(`document.fonts.ready.then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))`);fs.writeFileSync(path.join(os.tmpdir(),'odk-agent-capsule-thinking.png'),await capturePaintedFrame());
    publishStatus({state:'idle'});await evaluate('document.fonts.ready');fs.writeFileSync(path.join(os.tmpdir(),'odk-onee-flow.png'),await capturePaintedFrame())
    console.log('ONEE_FLOW_PASS: actual SVG motion, all request phases, completion, error, hidden pause, reduced motion and unchanged CSP')
    finish(0);return
  }
  if(process.argv.includes('--capsule-only')) { await assertCapsuleStack();finish(0);return }
  if (process.argv.includes('--agent-reference-only')) {
    await assertCapsuleStack()
    assert.equal(await evaluate(`document.querySelector('.agent-input-avatar')`),null,'the composer does not duplicate the animated avatar')
    assert.equal(await evaluate(`document.querySelector('.agent-identity summary').contains(document.querySelector('.agent-state'))`),true,'name and status share one capsule')
    await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]})
    publishStatus({state:'idle'})
    const failures=[]
    for(const theme of ['instrument','pixel','border-beam','liquid-glass']){
      for(const [width,height] of [[1280,800],[1920,1280],[960,640],[480,854],[320,480]]){
        await resize(width,height)
        await evaluate(`(async()=>{await odkTheme.set('${theme}');window.dispatchEvent(new Event('resize'));await document.fonts.ready;await new Promise(r=>setTimeout(r,100))})()`)
        const layout=await evaluate(`(()=>{
          const avatar=document.querySelector('.agent-avatar').getBoundingClientRect(),identity=document.querySelector('.agent-identity'),pill=identity.querySelector('summary').getBoundingClientRect(),panel=document.querySelector('.agent-panel').getBoundingClientRect(),conversation=document.querySelector('.agent-conversation').getBoundingClientRect(),composer=document.querySelector('.agent-composer').getBoundingClientRect();
          const head=document.querySelector('.agent-head'),headStyle=getComputedStyle(head),headBounds=head.getBoundingClientRect();
          const onee=document.querySelector('.agent-avatar .bs-avatar svg'),pillStyle=getComputedStyle(identity.querySelector('summary'));
          const bounds=onee.getBBox(),matrix=onee.getScreenCTM(),artTop=new DOMPoint(bounds.x,bounds.y).matrixTransform(matrix).y,artBottom=new DOMPoint(bounds.x,bounds.y+bounds.height).matrixTransform(matrix).y;
          return {visibleTop:Math.abs(artTop-conversation.top)<=6,artSize:Math.abs(onee.getBoundingClientRect().height-avatar.width)<1,unclipped:getComputedStyle(document.querySelector('.agent-avatar')).overflow==='visible',visibleOverlap:artBottom>pill.top&&artBottom-pill.top<avatar.height*0.25,onee:!!onee&&onee.getAttribute('viewBox')==='-150 -150 300 300'&&onee.querySelectorAll('path[d]').length>=4,sharedCapsule:(pillStyle.backgroundColor!=='rgba(0, 0, 0, 0)'||pillStyle.backgroundImage!=='none')&&pillStyle.borderTopWidth==='1px'&&identity.querySelector('summary').contains(document.querySelector('.agent-state')), centered:Math.abs(avatar.x+avatar.width/2-(panel.x+panel.width/2))<1,topAligned:Math.abs(avatar.top-conversation.top)<1,overlap:avatar.bottom-pill.top>=avatar.height*0.12&&avatar.bottom-pill.top<=avatar.height*0.2,transparent:headStyle.backgroundColor==='rgba(0, 0, 0, 0)'&&headStyle.backgroundImage==='none'&&headStyle.backdropFilter==='none',underlay:conversation.top<=headBounds.top&&conversation.bottom>headBounds.bottom,editor:!identity.hidden&&pill.height>=44,composer:composer.bottom<=panel.bottom&&composer.right<=panel.right&&composer.width>=panel.width-45,conversation:conversation.height>=40&&conversation.bottom<=composer.top,noStateFooter:document.querySelector('.agent-state').closest('.agent-head')!==null};
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
    for(const theme of ['instrument','pixel','border-beam','liquid-glass']){
      await evaluate(`(async()=>{await odkTheme.set('${theme}');await document.fonts.ready;await new Promise(r=>setTimeout(r,40));const list=document.querySelector('.agent-conversation'),first=list.querySelector('.agent-message');list.scrollTop+=first.getBoundingClientRect().top-list.getBoundingClientRect().top+20})()`)
      assert.match(await evaluate(`getComputedStyle(document.querySelector('.agent-conversation')).maskImage`),/linear-gradient.*rgba\(0, 0, 0, 0\).*rgb\(0, 0, 0\) 32px/,'the conversation has a transparent-to-solid top fade')
      const underlay=await evaluate(`(()=>{const list=document.querySelector('.agent-conversation'),head=document.querySelector('.agent-head'),r=head.getBoundingClientRect(),x=r.left+8,y=r.top+24,hit=document.elementFromPoint(x,y),pill=document.querySelector('.agent-identity summary'),p=pill.getBoundingClientRect();return {message:!!hit?.closest('.agent-message'),capsule:pill.contains(document.elementFromPoint(p.x+p.width/2,p.y+p.height/2)),x,y,scrollTop:list.scrollTop,header:r.top}})()`)
      assert.ok(underlay.message&&underlay.capsule,theme+': header allows message input while capsule stays interactive '+JSON.stringify(underlay))
      const fadeCrop=await evaluate(`(()=>{const r=document.querySelector('.agent-conversation').getBoundingClientRect();return{x:Math.ceil(r.left+4),y:Math.ceil(r.top),width:Math.min(180,Math.floor(r.width-8)),height:32}})()`)
      const faded=(await capturePaintedPage(win,fadeCrop)).toBitmap()
      let plain
      try {
        await evaluate(`document.querySelector('.agent-conversation').style.maskImage='none'`)
        plain=(await capturePaintedPage(win,fadeCrop)).toBitmap()
      } finally {
        await evaluate(`document.querySelector('.agent-conversation').style.removeProperty('mask-image')`)
      }
      let changed=0;for(let i=0;i<faded.length;i+=4)if(faded[i]!==plain[i]||faded[i+1]!==plain[i+1]||faded[i+2]!==plain[i+2])changed++
      assert.ok(changed>=16,theme+': the native image shows the top fade: '+changed)
      await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type:'mouseWheel',x:underlay.x,y:underlay.y,deltaX:0,deltaY:80})
      await evaluate('new Promise(r=>setTimeout(r,80))')
      assert.equal(await evaluate(`document.querySelector('.agent-conversation').scrollTop>${underlay.scrollTop}&&Math.abs(document.querySelector('.agent-head').getBoundingClientRect().top-${underlay.header})<1`),true,theme+': native wheel scrolls behind a stationary header')
    }
    fs.writeFileSync(path.join(os.tmpdir(),'odk-agent-header-overlay.png'),(await capturePaintedPage(win)).toPNG())
    await assertThreadOverlayInput()
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
    assert.equal(await evaluate(`document.querySelector('.agent-name').textContent==='Mori'&&document.activeElement===document.querySelector('.agent-composer .agent-mic')`),true,'saving the identity focuses the default voice field')
    assert.deepEqual(JSON.parse(await evaluate(`localStorage.getItem('odk.agent.identity')`)),{name:'Mori'},'saving the name does not persist the retired icon selector')
    for(const theme of ['instrument','pixel','border-beam','liquid-glass']){
      await resize(320,480)
      await evaluate(`(async()=>{await odkTheme.set('${theme}');window.dispatchEvent(new Event('resize'));document.querySelector('.agent-identity-form [name="name"]').value='中文'.repeat(20);document.querySelector('.agent-identity-form').requestSubmit();await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));document.querySelector('.agent-identity summary').focus()})()`)
      for(const type of ['keyDown','char','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Enter',code:'Enter',windowsVirtualKeyCode:13,...(type==='char'?{text:'\r'}:{})})
      const popup=await evaluate(`(()=>{const form=document.querySelector('.agent-identity-form'),save=form.querySelector('button'),r=form.getBoundingClientRect(),s=save.getBoundingClientRect(),p=document.querySelector('#personal-agent').getBoundingClientRect();return {open:document.querySelector('.agent-identity').open,inside:r.left>=p.left&&r.right<=p.right&&r.top>=p.top&&r.bottom<=p.bottom,hit:document.elementFromPoint(s.x+s.width/2,s.y+s.height/2)===save,save:{x:s.x+s.width/2,y:s.y+s.height/2},bounds:[r.top,r.bottom,p.top,p.bottom]}})()`)
      assert.ok(popup.open&&popup.inside&&popup.hit,theme+': '+JSON.stringify(popup))
      for(let tab=0;tab<2;tab++)for(const type of ['keyDown','keyUp'])await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9})
      assert.equal(await evaluate(`document.activeElement===document.querySelector('.agent-identity-form button')`),true)
      for(const type of ['mousePressed','mouseReleased'])await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...popup.save})
      await evaluate('new Promise(r=>setTimeout(r,20))')
      assert.equal(await evaluate(`!document.querySelector('.agent-identity').open&&document.activeElement===document.querySelector('.agent-composer .agent-mic')`),true)
    }
    await resize(1280,800)
    await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value='Personal Agent';document.querySelector('.agent-identity-form').requestSubmit();window.dispatchEvent(new Event('resize'))`)
    const errorDetail='Suggestions unavailable: private proposal state could not be saved. No proposal action will run.'
    publishStatus({state:'idle',proposalError:errorDetail})
    await evaluate('new Promise(r=>setTimeout(r,40))')
    const statusLayout=await evaluate(`(()=>{const summary=document.querySelector('.agent-identity summary');return {height:summary.getBoundingClientRect().height,label:summary.getAttribute('aria-label'),name:document.querySelector('.agent-name').textContent,status:document.querySelector('.agent-state').textContent,detail:document.querySelector('.agent-status-detail')?.textContent}})()`)
    assert.ok(statusLayout.height>=44&&statusLayout.height<=84,JSON.stringify(statusLayout))
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
  if (process.argv.includes('--optional-judgment-only')) {
    await assertOptionalJudgmentStatus();console.log('PASS optional Jev and actual ordinary judgment readiness');finish(0);return
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

  for (const theme of ['instrument', 'pixel', 'border-beam', 'liquid-glass']) {
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
      const readOverviewHeader = `(() => {
        const day = document.querySelector('.dash-wd').getBoundingClientRect()
        const date = document.querySelector('.dash-date').getBoundingClientRect()
        const baseline = selector => {
          const parent = document.querySelector(selector), marker = document.createElement('i')
          marker.style.cssText = 'display:inline-block;width:0;height:0'
          parent.append(marker)
          const y = marker.getBoundingClientRect().bottom
          marker.remove()
          return y
        }
        return { day: day.toJSON(), date: date.toJSON(), head: document.querySelector('.dash-head').getBoundingClientRect().toJSON(), grid: { cols: window.__odkGrid.cols, width: window.__odkGrid.gridW }, align: getComputedStyle(document.querySelector('.dash-head')).alignItems, sameRow: date.top < day.bottom,
          baseline: Math.abs(baseline('.dash-wd') - baseline('.dash-date')) }
      })()`
      const header = await evaluate(readOverviewHeader)
      assert.equal(header.align, 'baseline')
      assert.equal(header.sameRow, true, theme + ' ' + width + ' weekday and date share one row: ' + JSON.stringify(header))
      assert.ok(header.baseline < 1, theme + ' ' + width + ' weekday and date baselines align')
      if (width < 640) {
        const fullMonth = await evaluate(`(() => {
          const nodes=['.dash-wd','#dash-md','#dash-y'].map(selector=>document.querySelector(selector))
          const original=nodes.map(node=>node.textContent)
          try {
            ['Wed','September 30','2026'].forEach((text,index)=>{nodes[index].textContent=text})
            return ${readOverviewHeader}
          } finally { nodes.forEach((node,index)=>{node.textContent=original[index]}) }
        })()`)
        assert.equal(fullMonth.sameRow, true, theme + ' ' + width + ' full month shares the weekday row: ' + JSON.stringify(fullMonth))
        assert.ok(fullMonth.baseline < 1, theme + ' ' + width + ' full month retains the text baseline')
        assert.ok(fullMonth.day.left >= fullMonth.head.left && fullMonth.date.right <= fullMonth.head.right + 1, 'The complete full-month header fits its content row')
        const reachable = await evaluate(`(() => {
          const page=document.querySelector('[data-page-id="home"]'), original=page.scrollTop
          try {
            page.scrollTo({top:page.scrollHeight,behavior:'instant'})
            const last=[...page.querySelectorAll('.widget')].at(-1).getBoundingClientRect(), box=page.getBoundingClientRect()
            return page.scrollHeight<=page.clientHeight+1 || (page.scrollTop>0 && last.bottom<=box.bottom+1 && last.top>=box.top-1)
          } finally { page.scrollTo({top:original,behavior:'instant'}) }
        })()`)
        assert.equal(reachable,true,'The final compact Widget remains reachable through the page scroller')
      }
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
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-agent-home-' + theme + '.png'), (await capturePaintedPage(win)).toPNG())
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
  const widgetSurface = await evaluate(`(() => {
    const tile = document.querySelector('.widget[data-interaction="display-only"]')
    const probe = document.createElement('span')
    probe.style.color = 'var(--odk-surface)'
    tile.append(probe)
    const result = { actual: getComputedStyle(tile).backgroundColor, expected: getComputedStyle(probe).color }
    probe.remove()
    return result
  })()`)
  assert.equal(widgetSurface.actual, widgetSurface.expected, 'Home instruments use the theme surface')
  await evaluate(`document.querySelector('.agent-identity-form [name="name"]').value = 'Mori 中文'; document.querySelector('.agent-identity-form').requestSubmit()`)
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
  assert.equal(await evaluate(`document.querySelectorAll('.agent-avatar').length===1 && !!document.querySelector('.agent-avatar .bs-avatar svg') && !document.querySelector('.agent-input-avatar')`), true,'one live avatar stays in the header')
  assert.equal(await evaluate(`document.querySelector('#personal-bot-status').hidden && !document.querySelector('#home-desk').inert`), true)
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Typed question'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 30))`)
  assert.deepEqual(sentText, ['Typed question'])
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), '')
  completeBeforeReceipt = true
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Fast turn'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 80))`)
  assert.equal(await evaluate(`document.querySelector('.agent-state').textContent`), '', 'receipt cannot overwrite a completed status')
  completeBeforeReceipt = false
  textAccepted = false
  await evaluate(`document.querySelector('.agent-composer textarea').value = 'Keep draft'; document.querySelector('.agent-composer').requestSubmit(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').value`), 'Keep draft')
  assert.match(await evaluate(`document.querySelector('.agent-state').textContent`), /not confirmed/)
  publishStatus({ state: 'recording', message: '' })
  await evaluate(`new Promise(r => setTimeout(r, 30));`)
  await evaluate(`document.querySelector('.agent-mic').click(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(micToggles, 1, 'the voice field stops the active recording')
  publishStatus({ state: 'idle', transcript: 'Question 中文', message: 'Final response' })
  await evaluate(`new Promise(r => setTimeout(r, 30));`)
  assert.equal(await evaluate(`document.querySelector('.agent-composer').dataset.mode`), 'voice', 'the composer keeps the voice field')
  await evaluate(`document.querySelector('.agent-mic').click(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(micToggles, 1, 'a second tap on the idle voice field opens the keyboard instead of recording')
  assert.equal(await evaluate(`document.querySelector('.agent-composer').dataset.mode`), 'keyboard', 'the second tap switches the composer to the keyboard')
  assert.equal(await evaluate(`document.activeElement===document.querySelector('.agent-composer textarea')`), true, 'the keyboard takes focus')
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').hidden`), false, 'the text field becomes the visible field')
  assert.equal(await evaluate(`document.querySelector('.agent-composer .agent-keys').hidden`), true, 'the keyboard control leaves the voice field')
  await evaluate(`document.querySelector('.agent-mic').click(); new Promise(r => setTimeout(r, 30))`)
  assert.equal(micToggles, 2, 'the microphone of the keyboard starts the next voice turn')
  assert.equal(await evaluate(`document.querySelector('.agent-composer').dataset.mode`), 'voice', 'the microphone returns to the voice field')
  assert.equal(await evaluate(`document.querySelector('.agent-composer textarea').hidden`), true)
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
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-stress-' + theme + '.png'), (await capturePaintedPage(win)).toPNG())
  }
  await resize(1920, 1280)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    await evaluate(`window.odkTheme.set('${theme}'); window.dispatchEvent(new Event('resize')); void document.body.offsetHeight; document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))))`)
    await send(compact)
    fs.writeFileSync(path.join(os.tmpdir(), 'odk-home-failure-grid-' + theme + '.png'), (await capturePaintedPage(win)).toPNG())
  }
  await assertSessionReplies()
  await assertDuplicateRemoteIds()
  await assertThreadProjectionUpdate()
  await assertThreadCoverageRestore()
  console.log('PASS resident Agent identity, typed input, streaming, retained draft, first-page briefing and independent Agent')
  console.log('PASS keyboard and pointer paging remain usable; fixture capture saved')
  finish(0)
}).catch(error => { console.error(error); finish(1) })
