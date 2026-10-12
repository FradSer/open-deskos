'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const { createPluginHost } = require('../src/plugin-host')
const specs = require('./helpers/calendar-surfaces')
const dates = [[2026, 0, 1, 0, 0], [2026, 0, 1, 12, 34], [2026, 0, 9, 9, 5], [2026, 0, 10, 23, 59],
  [2026, 0, 31, 23, 59], [2026, 1, 1, 0, 0], [2024, 1, 28, 23, 59],
  [2024, 1, 29, 12, 0], [2024, 2, 1, 0, 0], [2024, 6, 2, 0, 0],
  [2026, 11, 31, 23, 59], [2027, 0, 1, 0, 0], [2026, 0, 1, 0, 0]]

async function fixture(t, spec, independent, failRelease = false) {
  const root = { odkPluginHost: { createPluginHost } }
  const context = vm.createContext({ window: root, structuredClone, console: { error() {} } })
  for (const file of ['core/registry.js', `plugins/${spec.file}.js`]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', file), 'utf8'), context)
  }
  let peers = 0
  root.odkPlugins.register({ id: 'odk.tile.time-peer', kind: 'tile', manifest: { schemaVersion: 1 },
    create() { peers++; return {} }, mount() {} })
  root.odkPlugins.captureDefaults()
  let selected
  if (independent) {
    root.odkRendererDevelopment = { define(definition) { selected = definition } }
    vm.runInContext(fs.readFileSync(path.join(__dirname, `fixtures/${spec.file}-surface-replacement/entry.js`), 'utf8'), context)
    root.odkPlugins.get(spec.id).lifecycle.mount = () => { throw Error('Default time surface delegation refused') }
  }
  const registry = root.odkPlugins
  await registry.start({ replacements: selected ? [selected] : [] })
  let writes = 0
  const nodes = new Map()
  function node() {
    let text = ''
    const classes = new Set()
    const style = new Proxy({}, { set(target, key, value) { writes++; target[key] = value; return true } })
    return { style, get textContent() { return text }, set textContent(value) { writes++; text = String(value) },
      classes, classList: { toggle(value, on) { if (on) classes.add(value); else classes.delete(value) } } }
  }
  const element = { isConnected: true, innerHTML: '', querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, node())
    return nodes.get(selector)
  }, replaceChildren() { nodes.clear() } }
  const ticks = new Set()
  let releases = 0
  let current = new Date(...dates[0])
  const ui = { onTick(callback) {
    ticks.add(callback); callback(current)
    return () => {
      if (failRelease && ++releases === 1) throw Error('Controlled Tick release failure')
      ticks.delete(callback)
    }
  } }
  assert.equal(registry.activate(registry.get(spec.id), element, ui), true)
  t.after(() => registry.stop())
  return { registry, element, ui, ticks, peers: () => peers, writes: () => writes,
    tick(parts) { current = new Date(...parts); for (const callback of ticks) callback(current) },
    snapshot: () => spec.readings.map(selector => {
      const n = element.querySelector(selector)
      return { text: n.textContent, classes: [...n.classes].sort(), style: { ...n.style } }
    }) }
}

for (const spec of specs) {
  test(`${spec.name} independent time behavior matches default including stable writes and date transitions`, async t => {
    const baseline = await fixture(t, spec, false)
    const independent = await fixture(t, spec, true)
    let previous = dates[0]
    for (const parts of dates) {
      const beforeTransition = [baseline.writes(), independent.writes()]
      for (const f of [baseline, independent]) f.tick(parts)
      const changes = [baseline.writes(), independent.writes()].map((value, index) => value - beforeTransition[index])
      assert.equal(changes[0], changes[1])
      if (spec.file === 'almanac' && parts.slice(0, 3).join() === previous.slice(0, 3).join()) assert.deepEqual(changes, [0, 0])
      previous = parts
      assert.deepEqual(independent.snapshot(), baseline.snapshot())
      const before = [baseline.writes(), independent.writes()]
      for (const f of [baseline, independent]) f.tick(parts)
      const expectedWrites = spec.kind === 'status' ? 1 : 0
      assert.deepEqual([baseline.writes(), independent.writes()], before.map(value => value + expectedWrites))
    }
    for (const f of [baseline, independent]) {
      f.tick([2026, 0, 1, 0, 0])
      const reading = f.snapshot()
      if (spec.file === 'almanac') assert.deepEqual(reading.map(item => item.text), ['Thu', '1', 'Jan'])
      if (spec.file === 'year') {
        assert.equal(reading[0].text, '0%')
        assert.equal(reading[2].style.width, '0.00%')
        f.tick([2026, 11, 31, 23, 59])
        assert.equal(f.snapshot()[0].text, '100%')
        assert.deepEqual(f.snapshot()[0].classes, ['year-pct-wide'])
      }
      if (spec.kind === 'status') assert.equal(reading[0].text, '00:00')
    }
  })

  for (const independent of [false, true]) test(`${independent ? 'independent' : 'default'} ${spec.name} owns cleanup retry and recovery`, async t => {
    const f = await fixture(t, spec, independent, true)
    await f.registry.setEnabled(spec.id, false)
    assert.equal(f.registry.catalog().find(record => record.manifest.id === spec.id).state, 'cleanup-failed')
    assert.equal(f.ticks.size, 1)
    assert.equal(f.registry.activate(f.registry.get(spec.id), {}, f.ui), false)
    await f.registry.setEnabled(spec.id, false)
    assert.equal(f.ticks.size, 0)
    await f.registry.setEnabled(spec.id, true)
    assert.equal(f.ticks.size, 1)
    f.tick([2024, 1, 29, 12, 0])
    const reading = f.snapshot()
    await f.registry.restoreDefault(spec.id)
    assert.equal(f.ticks.size, 1)
    assert.equal(f.registry.isActive(f.registry.get(spec.id), f.element), true)
    assert.deepEqual(f.snapshot(), reading)
    assert.equal(f.peers(), 1)
    await f.registry.stop()
    assert.equal(f.ticks.size, 0)
  })
}

for (const [timezone, expectedGaps] of [['America/New_York', [3600000, 10800000]], ['Asia/Shanghai', [7200000, 7200000]]]) {
  test(`Year replacement retains elapsed local-year time in ${timezone}`, () => {
    const script = `
      const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
      const files = process.argv.slice(1);
      const dates = [new Date(2024,2,10,1,30), new Date(2024,2,10,3,30), new Date(2024,10,3,0,30), new Date(2024,10,3,2,30)];
      const views = files.map(file => {
        let definition;
        const root = { odkPlugins:{register(value){definition=value}}, odkRendererDevelopment:{define(value){definition=value}} };
        vm.runInNewContext(fs.readFileSync(file,'utf8'),{window:root,Date});
        const nodes = new Map();
        const element = {innerHTML:'',querySelector(selector){
          if (!nodes.has(selector)) nodes.set(selector,{textContent:'',style:{},classList:{toggle(){}}});
          return nodes.get(selector);
        }};
        let tick; definition.mount(element,{onTick(callback){tick=callback}});
        return dates.map(date=>{
          tick(date);
          const percentage = 100 * ((date-new Date(2024,0,1))/(new Date(2025,0,1)-new Date(2024,0,1)));
          const view = {text:nodes.get('.year-pct').textContent,width:nodes.get('.meter-fill').style.width};
          assert.deepEqual(view,{text:Math.round(percentage)+'%',width:percentage.toFixed(2)+'%'});
          return view;
        });
      });
      assert.deepEqual(views[0],views[1]);
      process.stdout.write(JSON.stringify([dates[1]-dates[0],dates[3]-dates[2]]));
    `
    const output = execFileSync(process.execPath, ['-e', script,
      path.join(__dirname, '../src/renderer/plugins/year.js'),
      path.join(__dirname, 'fixtures/year-surface-replacement/entry.js')],
    { env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 5000 })
    assert.deepEqual(JSON.parse(output), expectedGaps)
  })
}
