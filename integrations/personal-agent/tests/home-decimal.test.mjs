import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveHomeTemplate } from '../src/home-template.mjs'

const source = (id, icon, value) => ({ id, label: id, state: 'live', value, home: { mode: 'required', priority: 100, icon, fields: Object.keys(value) } })
const template = (id, icon, text) => ({ items: [{ text, readingIds: [id], segments: [{ text, icon }] }] })

test('Overview numbers keep up to two decimal places', () => {
  const readings = [source('weather', 'weather', { temperatureC: 18.467, humidityPercent: 61.2 })]
  const text = '{{weather|@label|text}} {{weather|temperatureC|celsius}} {{weather|humidityPercent|percent}}.'
  const result = resolveHomeTemplate(template('weather', 'weather', text), readings)
  assert.match(result.items[0].text, /18\.47°C/, 'two decimals are kept')
  assert.match(result.items[0].text, /61\.2%/, 'a single decimal is not padded')
})

test('an integer Overview value stays a clean whole number', () => {
  const readings = [source('weather', 'weather', { temperatureC: 18 })]
  const text = '{{weather|@label|text}} {{weather|temperatureC|celsius}}.'
  const result = resolveHomeTemplate(template('weather', 'weather', text), readings)
  assert.match(result.items[0].text, /18°C/)
  assert.doesNotMatch(result.items[0].text, /18\.00°C/)
})
