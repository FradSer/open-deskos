import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveHomeTemplate, homeTemplateVariables } from '../src/home-template.mjs'
import { HomeBriefing } from '../src/home-briefing.mjs'

const source = (id, icon, value) => ({ id, label: id, state: 'live', value, home: { mode: 'required', priority: 100, icon, fields: Object.keys(value) } })
const template = (id, icon, text) => ({ items: [{ text, readingIds: [id], segments: [{ text, icon }] }] })

test('plugin field references resolve numbers and text without model-supplied values', () => {
  const reading = source('weather', 'weather', { temperatureC: 25, place: '<b>Taipei</b>', condition: 'overcast' })
  const raw = template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|celsius}} {{weather|condition|text}} in {{weather|place|text}}.')
  const output = resolveHomeTemplate(raw, [reading])
  assert.equal(output.items[0].text, 'weather 25°C overcast in <b>Taipei</b>.')
  assert.equal(output.items[0].segments[0].text, output.items[0].text)
})

test('invented numbers, unknown fields, prototype paths and unavailable values fail closed', () => {
  const reading = source('weather', 'weather', { temperatureC: 25 })
  for (const text of ['weather 99°C {{weather|@state|text}}.', 'weather {{weather|invented|number}}.', 'weather {{weather|constructor.name|text}}.', 'weather {{other|temperatureC|celsius}}.']) {
    assert.throws(() => resolveHomeTemplate(template('weather', 'weather', text), [reading]))
  }
  assert.throws(() => resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|celsius}}.'), [{ ...reading, state: 'unavailable' }]))
  assert.equal(resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} is {{weather|@state|text}}.'), [{ ...reading, state: 'unavailable' }]).items[0].text, 'weather is unavailable.')
})

test('count and percent changes update the template without another generation', async () => {
  let count = 4, percent = -0.82, calls = 0
  const readings = () => [source('pi', 'sessions', { count }), source('futu', 'portfolio', { todayChangePercent: percent })]
  const segments = [{ text: '{{pi|@label|text}} {{pi|count|integer}} sessions', icon: 'sessions' }, { text: ', ' }, { text: '{{futu|@label|text}} {{futu|todayChangePercent|signedPercent}} today.', icon: 'portfolio' }]
  const home = new HomeBriefing({ requireBindings: true, list: async () => readings(), read: async id => readings().find(r => r.id === id), generate: async () => { calls++; return { items: [{ text: segments.map(s => s.text).join(''), segments, readingIds: ['pi', 'futu'] }] } }, publish: () => {} })
  await home.refresh()
  assert.equal(home.frame.items[0].text, 'pi 4 sessions, futu -0.82% today.')
  count = 9; percent = 1.25
  home.invalidate()
  await home.refresh()
  assert.equal(home.frame.items[0].text, 'pi 9 sessions, futu +1.25% today.')
  assert.equal(home.frame.state, 'live')
  assert.equal(calls, 1)
  home.close()
})

test('a value changed during model generation binds the newer reading', async () => {
  let temperatureC = 25
  const reading = () => source('weather', 'weather', { temperatureC })
  const home = new HomeBriefing({ requireBindings: true, list: async () => [reading()], read: async () => reading(), generate: async () => { temperatureC = 27; home.invalidate(); return template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|celsius}}.') }, publish: () => {} })
  await home.refresh()
  assert.equal(home.frame.state, 'live')
  assert.equal(home.frame.items[0].text, 'weather 27°C.')
  home.close()
})

test('availability changes cannot reuse a live-value template', async () => {
  let state = 'live', calls = 0
  const reading = () => ({ ...source('weather', 'weather', { temperatureC: 25 }), state, value: state === 'live' ? { temperatureC: 25 } : null })
  const home = new HomeBriefing({ requireBindings: true, list: async () => [reading()], read: async () => reading(), generate: async () => { calls++; return template('weather', 'weather', state === 'live' ? '{{weather|@label|text}} {{weather|temperatureC|celsius}}.' : '{{weather|@label|text}} is {{weather|@state|text}}.') }, publish: () => {} })
  await home.refresh()
  state = 'unavailable'; home.invalidate(); await home.refresh()
  assert.equal(home.frame.items[0].text, 'weather is unavailable.')
  assert.equal(calls, 2)
  home.close()
})

test('literal string facts and claims hidden in context cannot bypass plugin binding', () => {
  const reading = source('weather', 'weather', { temperatureC: 25, condition: 'overcast' })
  assert.throws(() => resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|celsius}}, sunny in Tokyo.'), [reading]))
  const segments = [{ text: '{{weather|@label|text}} {{weather|temperatureC|celsius}}', icon: 'weather' }, { text: ' and sunny in Tokyo.' }]
  assert.throws(() => resolveHomeTemplate({ items: [{ text: segments.map(s => s.text).join(''), segments, readingIds: ['weather'] }] }, [reading]))
})

test('a push during cached binding cannot publish the captured older value', async () => {
  let count = 1, block = false, entered, release
  const ready = new Promise(resolve => { entered = resolve })
  const pause = new Promise(resolve => { release = resolve })
  const reading = () => source('pi', 'sessions', { count })
  const frames = []
  const home = new HomeBriefing({ requireBindings: true, list: async () => [reading()], read: async () => {
    const captured = reading()
    if (block) { block = false; entered(); await pause }
    return captured
  }, generate: async () => template('pi', 'sessions', '{{pi|@label|text}} {{pi|count|integer}} sessions.'), publish: frame => frames.push(frame) })
  await home.refresh()
  count = 2; block = true
  const next = home.refresh()
  await ready
  count = 3; home.invalidate(); release()
  await next
  assert.equal(frames.some(frame => frame.state === 'live' && frame.items[0].text.includes('2 sessions')), false)
  assert.equal(home.frame.items[0].text, 'pi 3 sessions.')
  home.close()
})

test('model cannot change the declared reference format or measurement unit', () => {
  const reading = source('weather', 'weather', { temperatureC: 25 })
  assert.throws(() => resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|signedPercent}}.'), [reading]))
  assert.throws(() => resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|number}}.'), [reading]))
})

test('a missing selected percentage binds unavailable rather than a fabricated value', () => {
  const reading = source('futu', 'portfolio', { todayChangePercent: null })
  const raw = template('futu', 'portfolio', '{{futu|@label|text}} is {{futu|@availability|text}}.')
  assert.equal(resolveHomeTemplate(raw, [reading]).items[0].text, 'futu is unavailable.')
})

test('ordinary numbers retain their format across fraction and integer changes', async () => {
  let usage = 1.5, calls = 0
  const reading = () => source('quota', 'quota', { usage })
  const home = new HomeBriefing({ requireBindings: true, list: async () => [reading()], read: async () => reading(), generate: async () => {
    calls++; return template('quota', 'quota', '{{quota|@label|text}} usage {{quota|usage|number}}.')
  }, publish: () => {} })
  for (usage of [1.5, 2, 2.75]) {
    await home.refresh()
    assert.equal(home.frame.items[0].text, `quota usage ${usage}.`)
  }
  assert.equal(calls, 1)
  home.close()
})

test('literal unit suffixes cannot alter a bound measurement', () => {
  const reading = source('weather', 'weather', { temperatureC: 25 })
  assert.throws(() => resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|celsius}}%.'), [reading]))
  assert.throws(() => resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} {{weather|temperatureC|celsius}}°C.'), [reading]))
})

test('provided display examples resolve all current plugin fields as one fact each', () => {
  const readings = [source('weather', 'weather', { temperatureC: 25, condition: 'overcast', place: 'Taipei' }), source('pi', 'sessions', { total: 8, counts: { running: 4, settled: 3, exited: 1 } }), source('futu', 'portfolio', { todayChangePercent: -0.82 })]
  for (const variable of homeTemplateVariables(readings)) {
    const resolved = resolveHomeTemplate(template(variable.id, variable.icon, variable.example), readings)
    assert.doesNotMatch(resolved.items[0].text, /\{\{/)
    assert.match(resolved.items[0].text, new RegExp(variable.id))
  }
})


test('literal signs cannot change a bound measurement within or across segments', () => {
  const reading = source('weather', 'weather', { temperatureC: 25 })
  assert.throws(() => resolveHomeTemplate(template('weather', 'weather', '{{weather|@label|text}} -{{weather|temperatureC|celsius}}.'), [reading]))
  const segments = [{ text: '-', }, { text: '{{weather|@label|text}} {{weather|temperatureC|celsius}}.', icon: 'weather' }]
  assert.throws(() => resolveHomeTemplate({ items: [{ text: segments.map(s => s.text).join(''), segments, readingIds: ['weather'] }] }, [reading]))
})
