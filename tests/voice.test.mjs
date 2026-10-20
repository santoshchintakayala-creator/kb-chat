import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceSessionHandler, buildVoiceInstructions, speakable } from '../src/server/index.mjs';
import { formatDuration } from '../src/voice/kb-voice.js';
import kb from '../examples/kb.example.mjs';

function mockRes() {
  return {
    status: 0, headers: {}, chunks: [], headersSent: false,
    writeHead(s, h = {}) { this.status = s; this.headers = h; this.headersSent = true; },
    write(c) { this.chunks.push(String(c)); },
    end(c) { if (c) this.chunks.push(String(c)); },
    json() { return JSON.parse(this.chunks.join('')); },
  };
}
const quiet = { warn() {}, error() {} };
const post = (headers = {}) => ({ method: 'POST', headers: { host: 'site.test', ...headers }, body: {} });

function fakeSecrets(calls, reply = { value: 'ek_test_123', expires_at: 1790000000 }, status = 200) {
  return async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify(reply), { status, headers: { 'Content-Type': 'application/json' } });
  };
}

test('speakable strips markdown for speech', () => {
  assert.equal(speakable('Call [555-010-0199](tel:+15550100199) **now**.'), 'Call 555-010-0199 now.');
});

test('voice instructions hold the knowledge and the phone rules', () => {
  const text = buildVoiceInstructions(kb);
  assert.match(text, /live phone call/);
  assert.match(text, /Answer ONLY with the facts in KNOWLEDGE/);
  assert.match(text, /Do not answer the unrelated question at all/);
  assert.match(text, /leave the building now and call 911/);
  assert.match(text, /Q: How can I pay\?\nA: Cash, checks and major cards\./);
  assert.ok(!/\]\(/.test(text), 'no markdown links in spoken knowledge');
});

test('GET reports whether the line is enabled, without secrets', async () => {
  let res = mockRes();
  await createVoiceSessionHandler({ kb, env: {}, log: quiet })({ method: 'GET', headers: {} }, res);
  assert.equal(res.json().enabled, false);
  res = mockRes();
  await createVoiceSessionHandler({ kb, apiKey: 'sk-secret', log: quiet })({ method: 'GET', headers: {} }, res);
  const body = res.json();
  assert.equal(body.enabled, true);
  assert.equal(body.maxCallSeconds, 300);
  assert.ok(!res.chunks.join('').includes('sk-secret'));
});

test('POST mints a short-lived client secret with the right session', async () => {
  const calls = [];
  const res = mockRes();
  await createVoiceSessionHandler({ kb, apiKey: 'sk-secret', env: {}, fetchImpl: fakeSecrets(calls), log: quiet })(post({ 'x-forwarded-for': '9.9.9.9' }), res);
  assert.equal(res.status, 200);
  const out = res.json();
  assert.equal(out.value, 'ek_test_123');
  assert.equal(out.model, 'gpt-realtime-2.1');
  assert.ok(!res.chunks.join('').includes('sk-secret'), 'real key never returned');
  const { url, init, body } = calls[0];
  assert.equal(url, 'https://api.openai.com/v1/realtime/client_secrets');
  assert.equal(init.headers.Authorization, 'Bearer sk-secret');
  assert.match(init.headers['OpenAI-Safety-Identifier'], /^[0-9a-f]{32}$/);
  assert.deepEqual(body.expires_after, { anchor: 'created_at', seconds: 60 });
  assert.equal(body.session.type, 'realtime');
  assert.equal(body.session.model, 'gpt-realtime-2.1');
  assert.equal(body.session.audio.output.voice, 'marin');
  assert.equal(body.session.audio.input.turn_detection.type, 'semantic_vad');
  assert.match(body.session.instructions, /KNOWLEDGE/);
});

test('model and voice can be changed with environment variables', async () => {
  const calls = [];
  await createVoiceSessionHandler({ kb, apiKey: 'sk', env: { OPENAI_REALTIME_MODEL: 'gpt-realtime-2.1-mini', OPENAI_REALTIME_VOICE: 'cedar' }, fetchImpl: fakeSecrets(calls), log: quiet })(post(), mockRes());
  assert.equal(calls[0].body.session.model, 'gpt-realtime-2.1-mini');
  assert.equal(calls[0].body.session.audio.output.voice, 'cedar');
});

test('no key, upstream errors, foreign origins and floods are handled', async () => {
  let res = mockRes();
  await createVoiceSessionHandler({ kb, env: {}, log: quiet })(post(), res);
  assert.equal(res.status, 503);
  res = mockRes();
  await createVoiceSessionHandler({ kb, apiKey: 'sk', fetchImpl: fakeSecrets([], { error: 'nope' }, 401), log: quiet })(post(), res);
  assert.equal(res.status, 502);
  res = mockRes();
  await createVoiceSessionHandler({ kb, apiKey: 'sk', fetchImpl: fakeSecrets([]), log: quiet })(post({ origin: 'https://evil.example' }), res);
  assert.equal(res.status, 403);
  const handler = createVoiceSessionHandler({ kb, apiKey: 'sk', fetchImpl: fakeSecrets([]), rateLimit: { max: 2 }, log: quiet });
  const statuses = [];
  for (let i = 0; i < 3; i++) { const r = mockRes(); await handler(post({ 'x-forwarded-for': '1.1.1.1' }), r); statuses.push(r.status); }
  assert.deepEqual(statuses, [200, 200, 429]);
});

test('call timer formatting', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65.4), '1:05');
});
