import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { settings } from '../src/config.ts';
import type { InputSettings } from '../src/config.ts';
import type { Observation } from '../src/contracts.ts';
import { FetchTap } from '../src/host/fetch-tap.ts';
import { calls } from '../src/host/call-context.ts';
import { URL, wire } from './fixtures.ts';

const scope = { provider: 'p', model: 'm', sessionId: 's', token: undefined };
function install(t: TestContext, transport: typeof fetch, options: InputSettings = {}) {
  const original = globalThis.fetch; globalThis.fetch = transport;
  const results: Observation[] = [];
  const tap = new FetchTap(settings({ enabled: true, targets: [{ provider: 'p', url: URL }], ...options }), { begin: () => 'id', complete: (_scope, _id, result) => results.push(result) });
  tap.install(); t.after(async () => { try { await tap.dispose(); } finally { globalThis.fetch = original; } });
  const invoke = (url = URL, init: RequestInit = { method: 'POST' }) => calls.run(scope, () => fetch(url, init));
  return { tap, results, invoke };
}

test('preserves original Response identity, request body, main bytes and reported value', async t => {
  const body = '{"reasoning":{"effort":"high"}}'; const originalResponse = new Response(wire(), { headers: { 'content-type': 'text/event-stream; charset=utf-8' } });
  let received: RequestInit | undefined;
  const { tap, results, invoke } = install(t, async (_url, init) => { received = init; return originalResponse; });
  const init = { method: 'POST', body }; const response = await invoke(URL, init);
  assert.equal(response, originalResponse); assert.equal(received, init); assert.equal(received.body, body);
  assert.equal(await response.text(), wire()); await tap.drained();
  assert.deepEqual(results, [{ kind: 'observed', effort: 'max', terminal: 'completed', responseId: 'resp-fixture' }]);
});
test('all filter axes bypass body cloning', async t => {
  let clones = 0;
  const { invoke, tap } = install(t, async url => {
    const response = new Response('{}', { headers: { 'content-type': String(url).includes('json') ? 'application/json' : 'text/event-stream' } });
    response.clone = () => { clones++; throw new Error('must not clone'); };
    return response;
  });
  await invoke('https://other.test/v1/responses'); await invoke(URL, { method: 'GET' });
  await calls.run({ ...scope, provider: 'other' }, () => fetch(URL, { method: 'POST' }));
  await fetch(URL, { method: 'POST' });
  assert.equal(clones, 0); assert.equal(tap.stats.matched, 0);
});
test('JSON response on a matching endpoint is unsupported, not absent', async t => {
  const { invoke, results, tap } = install(t, async () => new Response('{}', { headers: { 'content-type': 'application/json' } }));
  await invoke(); await tap.drained(); assert.deepEqual(results, []);
});
test('transport rejection retains exact error object', async t => {
  const error = new Error('upstream failure'); const { invoke } = install(t, async () => { throw error; });
  await assert.rejects(invoke(), value => value === error);
});
test('byte limit only cancels observer, not main stream', async t => {
  const raw = wire(); const { invoke, tap, results } = install(t, async () => new Response(raw, { headers: { 'content-type': 'text/event-stream' } }), { limits: { maxResponseBytes: 16 } });
  const response = await invoke(); await tap.drained();
  assert.equal(await response.text(), raw); assert.deepEqual(results, [{ kind: 'unknown', reason: 'byte-limit' }]);
});
test('concurrency cap skips observation, and unload never waits for main tee branch', async t => {
  const controls: ReadableStreamDefaultController<Uint8Array>[] = [];
  const { invoke, tap, results } = install(t, async () => new Response(new ReadableStream<Uint8Array>({ start(controller) { controls.push(controller); } }), { headers: { 'content-type': 'text/event-stream' } }), { limits: { maxConcurrent: 1 } });
  const a = await invoke(); const b = await invoke();
  assert.equal(tap.pending, 1); assert.equal(tap.stats.skipped, 1);
  await tap.dispose(); assert.equal(tap.pending, 0); assert.deepEqual(results, []);
  for (const controller of controls) { controller.enqueue(new TextEncoder().encode('unchanged')); controller.close(); }
  assert.equal(await a.text(), 'unchanged'); assert.equal(await b.text(), 'unchanged');
});
test('timeout records unknown while the original stream remains consumable', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  const { invoke, tap, results } = install(t, async () => new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; } }), { headers: { 'content-type': 'text/event-stream' } }), { limits: { maxObserveMs: 10 } });
  const response = await invoke(); t.mock.timers.tick(11); await tap.drained();
  assert.deepEqual(results, [{ kind: 'unknown', reason: 'timeout' }]);
  controller!.enqueue(new TextEncoder().encode('still live')); controller!.close();
  assert.equal(await response.text(), 'still live');
});
test('later fetch wrappers are not overwritten, and duplicate observer is rejected', async t => {
  let count = 0; const { tap, invoke } = install(t, async () => { count++; return new Response(wire(), { headers: { 'content-type': 'text/event-stream' } }); });
  const captured = globalThis.fetch;
  const later: typeof fetch = (input, init) => captured(input, init);
  globalThis.fetch = later;
  const duplicate = new FetchTap(settings({}), { begin: () => '', complete() {} });
  assert.throws(() => duplicate.install(), /already owns/);
  await tap.dispose(); assert.equal(globalThis.fetch, later);
  const response = await invoke(); await response.text(); assert.equal(count, 1); assert.equal(tap.stats.matched, 0);
});
