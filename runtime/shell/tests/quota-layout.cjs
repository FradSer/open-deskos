'use strict'
// Isolated renderer fixture: no application main, preload, credentials or service access.
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'odk-quota-layout-'))
app.setPath('userData', path.join(temp, 'profile'))
const renderer = path.resolve(__dirname, '../src/renderer')
const url = (file) => pathToFileURL(path.join(renderer, file)).href
const fixture = path.join(temp, 'fixture.html')
fs.writeFileSync(fixture, `<!doctype html><html><head>
<meta charset="utf-8">
${['uno.css', 'shell.css', 'plugins/quota-page.css', 'themes/pixel.css', 'themes/border-beam.css'].map(file => `<link rel="stylesheet" href="${url(file)}">`).join('')}
<style>body { display: block; padding: 16px; } #fixture { width: 100%; height: calc(100vh - 32px); --grid-w: 100%; --grid-h: 100%; --odk-app-inset: 24px; } </style>
</head><body><main id="fixture" class="page-app"></main><script>
window.odkPlugins = { register(plugin) { window.quotaPlugin = plugin } };
</script><script src="${url('plugins/quota-page.js')}"></script></body></html>`)

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, frame: false, useContentSize: true, width: 1920, height: 1280, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } })
  await win.loadFile(fixture)
  await win.webContents.executeJavaScript(`
    window.state = { state: 'available', snapshot: { accounts: ['codex', 'antigravity', 'xai'].map((provider, index) => ({
      provider, fileName: 'account-工作项目-' + 'long-name-'.repeat(8) + '.json', plan: 'Pro',
      resetCredits: { available: 2, expiresAt: ['2027-01-01T00:00:00Z'] },
      groups: Array.from({ length: index === 1 ? 4 : 1 }, (_, group) => ({ title: 'Model allowance ' + group, description: 'Shared across models', quotas: [0, 58].map((remainingPct, i) => ({ label: i ? 'Weekly limit 工作配额' : '5 hour limit', remainingPct, resetAt: '2027-01-01T00:00:00Z' })) }))
    })) } };
    window.quotaPlugin.mount(document.querySelector('#fixture'), { trackCleanup() {}, subscription: {
      status: () => window.state, lastCheck: () => 'Last checked 12:00',
      subscribe(fn) { window.renderQuota = fn; fn(window.state); return () => {} }, refresh: async () => window.state
    } });
    document.fonts.ready;
  `)
  for (const theme of ['instrument', 'pixel', 'border-beam']) {
    for (const [width, height] of [[1920, 1280], [960, 640], [480, 854], [320, 480]]) {
      win.setContentSize(width, height)
      await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = '${theme}'; document.fonts.ready`)
      const result = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const bad = [...document.querySelectorAll('.quota-card *')].filter(el => !el.closest('details:not([open])') || el.tagName === 'SUMMARY' || el.tagName === 'DETAILS').filter(el => {
          const r = el.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 1 || el.scrollWidth > el.clientWidth + 2);
        }).map(el => el.className);
        const button = document.querySelector('#quota-refresh'); button.focus();
        const surface = document.querySelector('.quota-card');
        surface.scrollTop = surface.scrollHeight;
        const last = document.querySelector('.provider-quota-card:last-child');
        const reachable = last.getBoundingClientRect().bottom <= surface.getBoundingClientRect().bottom + 1;
        surface.scrollTop = 0;
        resolve({ bad, meters: document.querySelectorAll('[role="meter"]').length,
          target: button.getBoundingClientRect().height >= 44,
          focus: document.activeElement === button,
          heights: [...document.querySelectorAll('.provider-quota-card')].map(el => el.getBoundingClientRect().height),
          contained: [...document.querySelectorAll('.provider-quota-card')].every(card => [...card.querySelectorAll('*')].filter(el => !el.closest('details:not([open])') || el.tagName === 'SUMMARY' || el.tagName === 'DETAILS').every(el => el.getBoundingClientRect().bottom <= card.getBoundingClientRect().bottom + 1)),
          bounded: surface.getBoundingClientRect().bottom <= innerHeight,
          reachable,
          boundaries: [...document.querySelectorAll('.provider-quota-card')].every(card => parseFloat(getComputedStyle(card).borderTopWidth) >= 1),
          count: document.querySelector('#quota-count')?.textContent });
      })))`)
      assert.deepEqual(result.bad, [], `${theme} ${width}: overflowing content`)
      assert.equal(result.meters, 12)
      assert.equal(result.count, '3 subscriptions')
      assert.equal(result.contained, true, 'every model group stays inside its subscription boundary')
      assert.equal(result.bounded, true)
      assert.equal(result.reachable, true, 'last subscription is reachable by scrolling')
      assert.equal(result.boundaries, true, 'each subscription has a visible boundary')
      assert.ok(result.heights[1] > result.heights[0], 'Antigravity has its natural taller height')
      assert.equal(result.target, true)
      assert.equal(result.focus, true)
      console.log(`PASS quota ${theme} ${width}x${height}: boundaries, variable heights, containment, scroll reachability and focus`)
    }
  }
  const disclosure = await win.webContents.executeJavaScript(`(() => {
    const details = document.querySelector('.provider-details'); details.open = true;
    details.querySelector('summary').focus();
    window.state.snapshot.accounts[0].groups[0].quotas[0].remainingPct = 40;
    window.renderQuota(window.state);
    return document.querySelector('.provider-details').open && document.activeElement.tagName === 'SUMMARY';
  })()`)
  assert.equal(disclosure, true, 'changed snapshots preserve disclosure and keyboard focus')
  if (process.env.ODK_QUOTA_CAPTURE) {
    win.setContentSize(1920, 1280)
    await win.webContents.executeJavaScript(`document.documentElement.dataset.theme = 'pixel'; document.querySelector('.quota-card').scrollTop = 0; document.fonts.ready`)
    fs.writeFileSync(process.env.ODK_QUOTA_CAPTURE, (await win.webContents.capturePage()).toPNG())
  }
  await win.webContents.executeJavaScript(`window.state = { state: 'unauthorized' }; window.renderQuota(window.state)`)
  assert.match(await win.webContents.executeJavaScript(`document.querySelector('#quota-feedback').textContent`), /credential/)
  win.destroy()
}).then(() => { fs.rmSync(temp, { recursive: true, force: true }); app.exit(0) }, error => {
  console.error(error); fs.rmSync(temp, { recursive: true, force: true }); app.exit(1)
})
