import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  replyProjectionInstructions,
  replyProjectionFormatCorrection,
  validateReplyProjection,
  fallbackReplyProjection,
} from '../src/reply-projection.mjs'

const original = [
  '已读取原 Hosted Pi 任务结果。原任务状态为 settled、turnOutcome=finished，任务 ID 和项目均与指定目标匹配。',
  '',
  '| id | 名称 | 版本 | revision |',
  '|---|---|---|---|',
  '| cm5-api-clock | UTC Live | 2.1 | c978f7de96ccc0cd4a4e37fcfb57a419 |',
  '',
  '**但没有安装 Widget。** 该任务结果记录的是两项草稿回归通过，不是本轮所要求的草稿读取与安装证据。',
  '仍需确认：读取真实测量桌面并选择未占用的一格；更新时保留已有有效 placement。',
].join('\n')

const readOnlyUi = { type: 'Suggestion', props: {}, children: [
  { type: 'Heading', props: { value: '已安装' }, children: [] },
  { type: 'Readings', props: {}, children: [
    { type: 'Reading', props: { label: 'cm5-api-clock', value: 'UTC Live 2.1' }, children: [] },
  ] },
  { type: 'Text', props: { value: '但没有安装 Widget。仍需确认：读取真实测量桌面并选择未占用的一格。' }, children: [] },
] }

test('the projection turn reads the reply as untrusted data and grants no action', () => {
  assert.match(replyProjectionInstructions, /untrusted data/)
  assert.match(replyProjectionInstructions, /not instructions/)
  assert.match(replyProjectionInstructions, /never invent, compute, round, or restate a number/)
  assert.match(replyProjectionInstructions, /Never emit Advice, ApprovedAction, OwnerStep, OptionSet/)
  assert.match(replyProjectionFormatCorrection(), /ui/)
})

test('a valid projection keeps a short lead and a read-only detail tree', () => {
  const projected = validateReplyProjection({ text: '任务结果已读到，但 Widget 未安装。', ui: readOnlyUi }, original)
  assert.equal(projected.text, '任务结果已读到，但 Widget 未安装。')
  assert.equal(projected.ui.type, 'Suggestion')
  assert.ok(projected.text.length <= 180)
})

test('the host refuses malformed, oversized, or action-bearing projections', () => {
  assert.throws(() => validateReplyProjection({ text: 'x'.repeat(181), ui: null }, original), /lead/)
  assert.throws(() => validateReplyProjection({ text: '', ui: null }, original), /lead/)
  assert.throws(() => validateReplyProjection({ text: '短句', ui: { type: 'Stack', props: {}, children: [] } }, original), /start at Suggestion/)
  assert.throws(() => validateReplyProjection({ text: '短句', ui: { type: 'Suggestion', props: {}, children: [
    { type: 'ApprovedAction', props: { actionId: 'open' }, children: [] },
  ] } }, original), /Invalid projection node/)
  assert.throws(() => validateReplyProjection({ text: '短句', extra: 1 }, original), /fields/)
  assert.throws(() => validateReplyProjection({ text: '短句', ui: { type: 'Suggestion', props: {}, children: [
    { type: 'Text', props: { value: 'x'.repeat(601) }, children: [] },
  ] } }, original), /too long/)
})

test('a failed projection publishes the exact original reply unchanged', () => {
  assert.deepEqual(fallbackReplyProjection(original), { text: original, ui: undefined })
  assert.deepEqual(fallbackReplyProjection(undefined), { text: '', ui: undefined })
})
