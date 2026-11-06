const path = require('node:path')
const { app, BrowserWindow } = require('electron')
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 320, height: 480 })
  await win.loadFile(path.join(process.cwd(), 'src/renderer/index.html'))
  await new Promise(r => setTimeout(r, 2500))
  const out = await win.webContents.executeJavaScript(`(() => {
    const tile = document.querySelector('[data-widget="odk.tile.weread"]');
    const text = tile?.querySelector('.weread-text');
    const r = text?.getBoundingClientRect();
    const sum = document.getElementById('home-summary')?.getBoundingClientRect();
    const dc = document.getElementById('desk-content')?.getBoundingClientRect();
    return { vp: innerWidth+'x'+innerHeight, textTop: r?.top, summaryH: sum?.height, summaryTop: sum?.top, deskTop: dc?.top, deskH: dc?.height, homeDeskScroll: document.getElementById('home-desk')?.scrollHeight };
  })()`)
  console.log('PROBE ' + JSON.stringify(out))
  app.exit(0)
})
