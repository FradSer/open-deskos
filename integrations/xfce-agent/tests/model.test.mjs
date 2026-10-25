import assert from 'node:assert/strict';
import { test } from 'node:test';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVisualDecision } from '../src/model.mjs';

test('Given a text-only provider declaration When the isolated worker calls its existing route Then pixels and one bounded tool reach the provider without configuration changes', async t => {
  let observed; const records = [];
  const server = http.createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    observed = JSON.parse(body);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = delta => ({ id: 'synthetic', object: 'chat.completion.chunk', created: 0, model: 'gpt-6-luna', choices: [{ index: 0, delta, finish_reason: null }] });
    response.write('data: ' + JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_test', type: 'function', function: { name: 'computer_action', arguments: JSON.stringify({ frameId: 'frame', intent: 'Inspect cart', action: { type: 'done' } }) } }] })) + '\n\n');
    response.write('data: ' + JSON.stringify({ ...chunk({}), choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } }) + '\n\n');
    response.end('data: [DONE]\n\n');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'odk-vision-route-'));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const modelsFile = join(directory, 'models.json');
  const config = JSON.stringify({ providers: { bailian: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-test-key', models: [{ id: 'gpt-6-luna', api: 'openai-completions', input: ['text'], reasoning: true, contextWindow: 128000, maxTokens: 16384, compat: { supportsReasoningEffort: true } }] } } });
  await writeFile(modelsFile, config);
  const decide = await createVisualDecision({ modelsFile, onRequest: value => records.push(value) });
  const decision = await decide({ task: { taskId: 'task', goal: 'fixture cable' }, frame: { id: 'frame', epoch: 1, width: 1, height: 1, png: Buffer.from('synthetic-pixel-buffer') }, history: [], signal: new AbortController().signal });
  assert.equal(decision.action.type, 'done');
  assert.equal(observed.model, 'gpt-6-luna');
  assert.equal(observed.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url').length, 1);
  assert.equal(observed.tools.length, 1);
  assert.equal(observed.reasoning_effort, 'none');
  assert.equal(records.at(-1).payloadImages, 1);
  assert.equal(records.at(-1).costRatesConfigured, false);
  assert.equal(await readFile(modelsFile, 'utf8'), config);
  assert.ok(!JSON.stringify(records).includes('synthetic-test-key'));
});

test('Given an upstream cooldown When the visual provider refuses Then only fixed failure tags and retry metadata are recorded', async t => {
  const server = http.createServer((_request, response) => { response.writeHead(429); response.end(JSON.stringify({ code: 'model_cooldown', message: 'usage_limit_reached synthetic-secret-key', reset_seconds: 3888 })); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const directory = await mkdtemp(join(tmpdir(), 'odk-rate-limit-')); const records = [];
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const modelsFile = join(directory, 'models.json');
  await writeFile(modelsFile, JSON.stringify({ providers: { bailian: { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'synthetic-secret-key', models: [{ id: 'gpt-6-luna', api: 'openai-completions', input: ['text'], reasoning: true, contextWindow: 128000, maxTokens: 16384 }] } } }));
  const decide = await createVisualDecision({ modelsFile, onRequest: value => records.push(value) });
  await assert.rejects(decide({ task: { taskId: 'task', goal: 'fixture' }, frame: { id: 'frame', epoch: 1, width: 1, height: 1, png: Buffer.from('public') }, history: [], signal: new AbortController().signal }), error => error.code === 'visual_provider_rate_limited' && !error.message.includes('secret'));
  assert.ok(records.at(-1).failureTags.includes('model_cooldown'));
  assert.equal(records.at(-1).retryAfterSeconds, 3888);
  assert.ok(!JSON.stringify(records).includes('synthetic-secret-key'));
});
