'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  PROTOCOL_VERSION,
  createLinkState,
  parseJsonLine,
  validateNavigate,
  validateRemoteInput,
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

test('accepts versioned Remote Touchpad direction, primary, secondary, mic, and action records', () => {
  for (const input of ['left', 'right', 'up', 'down', 'primary', 'secondary', 'back', 'mic']) {
    assert.deepEqual(validateRemoteInput({
      v: PROTOCOL_VERSION,
      type: 'input',
      input,
    }), { ok: true })
  }
  assert.deepEqual(validateRemoteInput({
    v: PROTOCOL_VERSION,
    type: 'input',
    input: 'action',
    action: 'refresh',
  }), { ok: true })
  assert.deepEqual(validateRemoteInput({
    v: PROTOCOL_VERSION,
    type: 'action',
    action: 'play',
  }), { ok: true })
  assert.deepEqual(validateRemoteInput({
    v: PROTOCOL_VERSION,
    type: 'input',
    input: 'action',
  }), { ok: false, error: 'invalid-action' })
  assert.deepEqual(validateRemoteInput({
    v: PROTOCOL_VERSION,
    type: 'input',
    input: 'diagonal',
  }), { ok: false, error: 'invalid-input' })
})

test('validates dynamic contextual Touch Bar actions in shell state', () => {
  const validState = {
    v: PROTOCOL_VERSION,
    type: 'state',
    page: 1,
    pages: 3,
    name: 'Home',
    canPrev: false,
    canNext: true,
    actions: [
      { id: 'refresh', label: 'SYNC' },
      { id: 'mode', label: 'MODE' },
    ],
  }
  assert.deepEqual(validateShellState(validState), { ok: true })

  assert.deepEqual(validateShellState({
    ...validState,
    actions: 'not-an-array',
  }), { ok: false, error: 'invalid-actions' })

  assert.deepEqual(validateShellState({
    ...validState,
    actions: [{ id: '' }],
  }), { ok: false, error: 'invalid-actions' })
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
