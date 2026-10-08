import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS } from '../src/contracts.ts';
import type { ResponseItem } from '../src/contracts.ts';
import { EffortCache } from '../src/host/cache.ts';
import { Associations } from '../src/host/association.ts';
import { FetchTap } from '../src/host/fetch-tap.ts';
import { calls } from '../src/host/call-context.ts';
import { settings } from '../src/config.ts';
import { decodeSnapshot } from '../src/remote-contract.ts';
import { URL, wire } from './fixtures.ts';
const item = (id: string): Omit<ResponseItem, 'sequence'> => ({ captureId: id, provider: 'p', model: 'm', observedAt: 1, result: { kind: 'observed', effort: 'high', terminal: 'completed' } });

test('SSE publishes before native message settlement or turn end without consuming the main response', { timeout: 3000 }, async t => {
  const original = globalThis.fetch;
  let control!: ReadableStreamDefaultController<Uint8Array>;
  const response = new Response(new ReadableStream<Uint8Array>({ start(c) { control = c; } }), { headers: { 'content-type': 'text/event-stream' } });
  globalThis.fetch = async () => response;
  const cache = new EffortCache(DEFAULT_LIMITS);
  const links = new Associations(cache, DEFAULT_LIMITS);
  const tap = new FetchTap(settings({ enabled: true, targets: [{ provider: 'p', url: URL }] }), links);
  const abort = new AbortController();
  t.after(async () => { abort.abort(); control.close(); await tap.dispose(); cache.dispose(); globalThis.fetch = original; });
  tap.install();
  const agent = {};
  links.start(agent, 's', 'attempt');
  const scope = links.bind('s', 'p', 'm', true);
  const watcher = cache.watch('s', abort.signal);
  assert.equal((await watcher.next()).value?.responses.length, 0);
  const next = watcher.next();
  const returned = await calls.run(scope, () => fetch(URL, { method: 'POST' }));
  assert.equal(returned, response);
  control.enqueue(new TextEncoder().encode(wire()));
  const captured = (await next).value;
  assert.equal(captured?.responses.length, 1);
  assert.equal(captured?.responses[0]?.result.kind, 'observed');
  assert.equal(captured?.items.length, 0);
  assert.equal(links.size, 1, 'native attempt is still running');
  assert.equal(response.bodyUsed, false, 'observation does not read the SDK branch');
  await tap.drained();
  links.end(agent, 'attempt', 'message');
  assert.equal(cache.snapshot('s').items.length, 1);
  assert.equal(cache.snapshot('s').responses.length, 1);
  abort.abort(); await watcher.return(undefined);
});

test('retries, repeated upstream IDs, absent and unknown remain separate without borrowing message identity', () => {
  const cache = new EffortCache(DEFAULT_LIMITS);
  const links = new Associations(cache, DEFAULT_LIMITS);
  const agent = {};
  links.start(agent, 's', '1');
  const scope = links.bind('s', 'p', 'm', true);
  const failed = links.begin(scope);
  links.end(agent, '1');
  links.complete(scope, failed, { kind: 'observed', effort: 'max', terminal: 'failed', responseId: 'same' });
  const next = links.bind('s', 'p', 'm', false);
  for (const result of [{ kind: 'absent', terminal: 'completed', responseId: 'same' }, { kind: 'unknown', reason: 'timeout' }] as const) links.complete(next, links.begin(next), result);
  links.complete(scope, failed, { kind: 'observed', effort: 'wrong duplicate', terminal: 'completed' });
  const snapshot = cache.snapshot('s');
  assert.deepEqual(snapshot.responses.map(i => i.sequence), [1, 2, 3]);
  assert.deepEqual(snapshot.responses.map(i => i.result.kind), ['observed', 'absent', 'unknown']);
  assert.equal(new Set(snapshot.responses.map(i => i.captureId)).size, 3);
  assert.equal(snapshot.items.length, 0);
  assert.equal(cache.snapshot('other').responses.length, 0);
  const anonymous = links.bind(undefined, 'p', 'm', false);
  links.complete(anonymous, links.begin(anonymous), { kind: 'absent', terminal: 'completed' });
  assert.equal(cache.responseSize, 3);
});

test('response pool has independent bounds, absolute TTL, LRU and bounded sequence lifetime', () => {
  let now = 0;
  const cache = new EffortCache({ ...DEFAULT_LIMITS, maxEntries: 3, maxSessionEntries: 2, ttlMs: 100 }, () => now);
  cache.put('a', { messageId: 'message', provider: 'p', model: 'm', observedAt: now, result: { kind: 'absent', terminal: 'completed' } });
  for (const id of ['1', '2', '3']) cache.putResponse('a', item(id));
  assert.deepEqual(cache.snapshot('a').responses.map(i => i.sequence), [2, 3]);
  assert.equal(cache.snapshot('a').items.length, 1);
  cache.putResponse('b', item('4')); cache.snapshot('a'); cache.putResponse('c', item('5'));
  assert.equal(cache.snapshot('b').responses.length, 0);
  assert.equal(cache.responseSize, 3);
  now = 99; cache.snapshot('a'); now = 101; cache.sweep();
  assert.equal(cache.responseSize, 0);
  cache.putResponse('a', item('6')); assert.equal(cache.snapshot('a').responses[0]?.sequence, 1);
  const generation = cache.snapshot('a').generation;
  cache.reset(); assert.notEqual(cache.snapshot('a').generation, generation);
  assert.equal(cache.responseSize, 0);
  cache.dispose(); cache.putResponse('a', item('7')); assert.equal(cache.responseSize, 0);
});

test('snapshot codec validates response identity and drops unrelated sensitive fields', () => {
  const response = { ...item('1'), sequence: 1, rawSse: 'never expose' };
  const snapshot = { generation: 'g', revision: 1, items: [], responses: [response] };
  assert.ok(!JSON.stringify(decodeSnapshot(snapshot)).includes('never expose'));
  assert.throws(() => decodeSnapshot({ ...snapshot, responses: undefined }));
  assert.throws(() => decodeSnapshot({ ...snapshot, responses: [response, response] }));
  for (const invalid of [{ sequence: 0 }, { sequence: 0.5 }, { captureId: '' }, { observedAt: Infinity }, { observedAt: 9e15 }]) {
    assert.throws(() => decodeSnapshot({ ...snapshot, responses: [{ ...response, ...invalid }] }));
  }
});

test('slow subscribers coalesce response updates and refresh sees the same retained IDs', async () => {
  const cache = new EffortCache({ ...DEFAULT_LIMITS, maxSessionEntries: 2 });
  const abort = new AbortController();
  const watcher = cache.watch('s', abort.signal);
  await watcher.next();
  for (let i = 0; i < 100; i++) cache.putResponse('s', item(String(i)));
  const update = await watcher.next();
  assert.ok(!update.done);
  const snapshot = update.value;
  assert.deepEqual(snapshot.responses.map(i => i.sequence), [99, 100]);
  const second = cache.watch('s', abort.signal);
  assert.deepEqual((await second.next()).value?.responses, snapshot.responses);
  cache.reset(); assert.equal((await watcher.next()).value?.responses.length, 0);
  abort.abort(); await watcher.return(undefined); await second.return(undefined); cache.dispose();
});
