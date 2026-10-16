import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeCapabilityDeclarations, childCapabilityDeclarations, capabilityIntentDefinitions, capabilityIntentAllows, isReviewedCapabilityTool, createReviewedCapabilities } from '../src/reviewed-capabilities.mjs';

const didi = { environment: 'sandbox', keyFile: '/private/didi.key' };
const browser = { executablePath: '/opt/agent-browser/bin/agent-browser' };
const personal = { profile: 'personal', memoryFile: '/private/notes.json', skillPaths: [] };

test('Given old or canonical declarations When normalized Then only fixed validated capabilities result', () => {
  assert.deepEqual(normalizeCapabilityDeclarations({ ...personal, didi, browser }), { didi, browser });
  assert.deepEqual(normalizeCapabilityDeclarations({ ...personal, capabilities: { browser, didi } }), { browser, didi });
  assert.deepEqual(normalizeCapabilityDeclarations(personal), {});
  for (const value of [
    { ...personal, capabilities: { arbitrary: {} } },
    { ...personal, capabilities: { browser: { ...browser, module: '/evil.mjs' } } },
    { ...personal, capabilities: { browser: { ...browser, timeoutMs: 0 } } },
    { ...personal, capabilities: { didi: { ...didi, environment: 'other' } } },
    { ...personal, capabilities: { didi }, didi },
    { ...personal, capabilities: [] },
    { ...personal, capabilities: { browser: null } },
    { ...personal, capabilities: { didi: null } },
    { profile: 'coding', capabilities: { browser } },
    { profile: 'coding', capabilities: {} },
    { ...personal, capabilities: { didi: { ...didi, keyFile: personal.memoryFile } } },
    { ...personal, capabilities: { didi: { ...didi, keyFile: '/private/config.json' } } },
  ]) assert.throws(() => normalizeCapabilityDeclarations(value, { configPath: '/private/config.json' }), /Invalid reviewed capability/);
});

test('Given declarations When a child starts Then only isolated browser is inherited without shared mutable config', () => {
  const declarations = normalizeCapabilityDeclarations({ ...personal, capabilities: { didi, browser } });
  const child = childCapabilityDeclarations(declarations);
  assert.deepEqual(child, { browser });
  child.browser.executablePath = '/changed';
  assert.equal(declarations.browser.executablePath, browser.executablePath);
});

test('Given reviewed tools When intent gates run Then known prefixes never enter unrelated workflows', () => {
  assert.deepEqual(capabilityIntentDefinitions().map(value => value.intent), ['ride', 'browse']);
  assert.equal(capabilityIntentAllows('didi_status', 'ride'), true);
  assert.equal(capabilityIntentAllows('didi_status', 'agent_execute'), false);
  assert.equal(capabilityIntentAllows('browser_read', 'agent_execute'), true);
  assert.equal(capabilityIntentAllows('browser_read', 'browse'), true);
  for (const intent of ['extension', 'conversation', 'clarify', 'agent_work']) assert.equal(capabilityIntentAllows('browser_read', intent), false);
  assert.equal(isReviewedCapabilityTool('browser_read'), true);
  assert.equal(isReviewedCapabilityTool('didi_submit'), true);
  assert.equal(isReviewedCapabilityTool('calendar_events'), false);
});

test('Given no declaration When composed Then no capability or bundled Skill is registered', async () => {
  const capabilities = await createReviewedCapabilities({ declarations: {}, stateDir: '/private/state' });
  assert.deepEqual(capabilities.tools, []);
  assert.deepEqual(capabilities.skillPaths, []);
  capabilities.beginTurn('request');
  await capabilities.close();
});

test('Given declared browser When composed Then its codemode tools and bundled Skill are registered together', async () => {
  // This deliberately absent executable verifies composition without starting a browser.
  const capabilities = await createReviewedCapabilities({
    declarations: { browser: { executablePath: '/nonexistent/odk-test-agent-browser' } }, stateDir: '/private/browser-test',
  });
  assert.deepEqual(capabilities.tools.map(tool => tool.name), [
    'browser_open', 'browser_read', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_press', 'browser_close',
  ]);
  assert.ok(capabilities.tools.every(tool => tool.exposure === 'codemode'));
  assert.equal(capabilities.skillPaths.length, 1);
  assert.match(capabilities.skillPaths[0], /\/src\/skills\/browser\/SKILL\.md$/);
  assert.equal(capabilities.rideStatus(), undefined);
  await capabilities.close();
  await capabilities.close();
});
