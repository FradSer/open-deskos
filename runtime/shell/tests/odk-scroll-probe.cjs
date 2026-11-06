const path=require('node:path');const {app,BrowserWindow}=require('electron')
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:320,height:480});
 await win.loadFile(path.join('/Users/FradSer/Developer/FradSer/open-deskos/runtime/shell/src/renderer/index.html'));
 await new Promise(r=>setTimeout(r,2200));
 const o=await win.webContents.executeJavaScript(`(()=>{
  const page=document.querySelector('[data-page-id="home"]');
  const tiles=[...page.querySelectorAll('.widget')].map(e=>e.getBoundingClientRect());
  page.scrollTo({top:page.scrollHeight,behavior:'instant'});
  const last=[...page.querySelectorAll('.widget')].at(-1).getBoundingClientRect(),box=page.getBoundingClientRect();
  return {scrollH:page.scrollHeight,clientH:page.clientHeight,scrollTop:page.scrollTop,lastB:+last.bottom.toFixed(1),lastT:+last.top.toFixed(1),boxB:+box.bottom.toFixed(1),boxT:+box.top.toFixed(1),overflowY:getComputedStyle(page).overflowY,tiles:tiles.length};
 })()`);
 console.log('SCROLL '+JSON.stringify(o));app.exit(0)
})
