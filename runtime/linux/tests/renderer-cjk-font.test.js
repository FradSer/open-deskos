'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { createHash } = require('node:crypto')

const RENDERER = path.join(__dirname, '..', 'src', 'renderer')
const NOTO_FONT = path.join(RENDERER, 'fonts', 'NotoSansSC-Regular.ttf')
const NOTO_NOTICE = path.join(RENDERER, 'fonts', 'NOTO-SANS-SC-NOTICE.md')
const CJK_FAMILIES = ['"Noto Sans SC"', '"Zpix"']

/*
 * The desk must never depend on a system CJK font: the device ships none, so a
 * codepoint the bundled faces lack is drawn as a tofu box. Reading the cmap is
 * what proves the bundled face actually carries the glyphs.
 */
function readCmap(filePath) {
  const buffer = fs.readFileSync(filePath)
  const tableCount = buffer.readUInt16BE(4)
  let cmapOffset = null
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16
    if (buffer.toString('latin1', record, record + 4) === 'cmap') {
      cmapOffset = buffer.readUInt32BE(record + 8)
    }
  }
  assert.ok(cmapOffset !== null, `${path.basename(filePath)} has a cmap table`)

  const codepoints = new Set()
  const subtableCount = buffer.readUInt16BE(cmapOffset + 2)
  for (let index = 0; index < subtableCount; index += 1) {
    const record = cmapOffset + 4 + index * 8
    const offset = cmapOffset + buffer.readUInt32BE(record + 4)
    const format = buffer.readUInt16BE(offset)
    if (format === 4) {
      const segmentCount = buffer.readUInt16BE(offset + 6) / 2
      for (let segment = 0; segment < segmentCount; segment += 1) {
        const end = buffer.readUInt16BE(offset + 14 + segment * 2)
        const start = buffer.readUInt16BE(offset + 16 + segmentCount * 2 + segment * 2)
        if (start === 0xFFFF) continue
        for (let code = start; code <= end && code !== 0x10000; code += 1) codepoints.add(code)
      }
    } else if (format === 12) {
      const groupCount = buffer.readUInt32BE(offset + 12)
      for (let group = 0; group < groupCount; group += 1) {
        const base = offset + 16 + group * 12
        const start = buffer.readUInt32BE(base)
        const end = buffer.readUInt32BE(base + 4)
        for (let code = start; code <= end; code += 1) codepoints.add(code)
      }
    }
  }
  return codepoints
}

function rendererStyleSources() {
  return ['shell.css', 'uno.css', 'personal-bot-status.css', 'user-app-desktop.css']
    .map((name) => path.join(RENDERER, name))
    .concat(fs.readdirSync(path.join(RENDERER, 'plugins')).filter((name) => name.endsWith('.css')).map((name) => path.join(RENDERER, 'plugins', name)))
    .concat(fs.readdirSync(path.join(RENDERER, 'themes')).filter((name) => name.endsWith('.css')).map((name) => path.join(RENDERER, 'themes', name)))
    .filter((file) => fs.existsSync(file))
}

test('the bundled CJK face carries the punctuation and Han the Shell displays', () => {
  const codepoints = readCmap(NOTO_FONT)
  const required = [
    0x41, 0x7A, // Latin
    0x00B7, 0x2014, 0x2018, 0x201C, 0x2026, // general punctuation
    0x3001, 0x3002, 0x300C, 0x300D, 0x3010, 0x3011, // CJK symbols and punctuation
    0xFF01, 0xFF08, 0xFF09, 0xFF0C, 0xFF1A, 0xFF1B, 0xFF1F, // fullwidth forms
    0x4E2D, 0x6587, 0x72B6, 0x6001, 0x50CF, 0x7D20, 0x7E41, 0x539F, 0x5219, 0x8FBE, 0x5229, 0x6B27, // Han (GB2312; traditional and rarer Han are Zpix's job)
    0x3042, // kana
  ]
  const missing = required.filter((code) => !codepoints.has(code)).map((code) => `U+${code.toString(16).toUpperCase()}`)
  assert.deepEqual(missing, [], 'the bundled CJK face must carry these glyphs')
  assert.ok([...codepoints].filter((code) => code >= 0x4E00 && code <= 0x9FFF).length >= 6763, 'GB2312 Han coverage stays complete')
})

test('every Shell font stack ends in a CJK-capable family', () => {
  const stacks = []
  for (const file of rendererStyleSources()) {
    const css = fs.readFileSync(file, 'utf8').replace(/@font-face\s*\{[^}]*\}/g, '')
    for (const match of css.matchAll(/font-family:\s*([^;}]+)/g)) stacks.push({ file: path.basename(file), value: match[1].trim() })
  }
  assert.ok(stacks.length > 20, 'expected the Shell to declare font stacks')
  const unprotected = stacks
    .filter((stack) => stack.value !== 'inherit')
    .filter((stack) => !CJK_FAMILIES.some((family) => stack.value.includes(family)))
    .map((stack) => `${stack.file}: ${stack.value}`)
  assert.deepEqual(unprotected, [], 'a stack without a CJK family renders Chinese as tofu boxes')

  const { THEMES, contextTokens } = require('../src/user-app-context')
  for (const theme of THEMES) {
    const declared = contextTokens(theme)['--odk-font']
    assert.ok(CJK_FAMILIES.some((family) => declared.includes(family)), `${theme} package stacks need a CJK family: ${declared}`)
  }
})

test('the bundled CJK face carries upstream provenance and its own digest', () => {
  const font = fs.readFileSync(NOTO_FONT)
  assert.equal(font.readUInt32BE(0), 0x00010000, 'the shipped face is a TrueType font')
  const notice = fs.readFileSync(NOTO_NOTICE, 'utf8')
  assert.match(notice, /notofonts\/noto-cjk/)
  assert.match(notice, /SIL Open Font License 1\.1/)
  assert.match(notice, /hb-subset/)
  assert.match(notice, /CJK punctuation is part of the contract/)
  const digest = createHash('sha256').update(font).digest('hex')
  assert.match(notice, new RegExp(`Shipped file SHA-256: \`${digest}\``))
})