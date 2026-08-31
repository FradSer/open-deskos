'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PROTOCOL_VERSION,
  createLinkState,
  parseJsonLine,
  validateNavigate,
  validateShellState,
} = require('../lib/protocol')

test('accepts the Shell client’s versioned authoritative state schema', () => {
  const record = {
    v: PROTOCOL_VERSION,
    type: 'state',
    page: 1,
    pages: 3,
    name: '概览',
    canPrev: false,
    canNext: true,
    link: 'usb',
  }
  assert.deepEqual(parseJsonLine(JSON.stringify(record)), { ok: true, record })
  assert.deepEqual(validateShellState(record), { ok: true })
})

test('rejects unversioned, invalid, and contradictory state records', () => {
  assert.deepEqual(parseJsonLine('{'), { ok: false, error: 'invalid-json' })
  assert.deepEqual(parseJsonLine(JSON.stringify({ type: 'state' })), {
    ok: false,
    error: 'unsupported-version',
  })
  assert.deepEqual(validateShellState({
    v: PROTOCOL_VERSION,
    type: 'state',
    page: 2,
    pages: 3,
    name: '应用',
    canPrev: false,
    canNext: true,
  }), { ok: false, error: 'inconsistent-boundaries' })
})

test('defines Shell client link states and requires versioned navigation', () => {
  assert.deepEqual(createLinkState('syncing'), {
    v: PROTOCOL_VERSION,
    type: 'link',
    state: 'syncing',
  })
  assert.deepEqual(createLinkState('wireless'), {
    v: PROTOCOL_VERSION,
    type: 'link',
    state: 'wireless',
  })
  assert.deepEqual(validateNavigate({
    v: PROTOCOL_VERSION,
    type: 'navigate',
    direction: 'next',
  }), { ok: true })
  assert.deepEqual(validateNavigate({ type: 'navigate', direction: 'next' }), {
    ok: false,
    error: 'unsupported-version',
  })
  assert.deepEqual(validateNavigate({
    v: PROTOCOL_VERSION + 1,
    type: 'navigate',
    direction: 'next',
  }), { ok: false, error: 'unsupported-version' })
})
