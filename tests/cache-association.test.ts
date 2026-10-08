import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS } from '../src/contracts.ts';
import type { EffortItem } from '../src/contracts.ts';
import { EffortCache } from '../src/host/cache.ts';
import { Associations } from '../src/host/association.ts';
const limits = { ...DEFAULT_LIMITS, maxEntries: 3, maxSessionEntries: 2, ttlMs: 100, pendingMs: 20 };
const item = (id: string, effort = 'max'): EffortItem => ({ messageId: id, provider: 'p', model: 'm', observedAt: 0, result: { kind: 'observed', effort, terminal: 'completed' } });

test('global/per-session capacity, LRU reads, TTL and reset generation', () => {
  let now = 0; const cache = new EffortCache(limits, () => now);
  cache.put('a', item('1')); cache.put('a', item('2')); cache.put('a', item('3'));
  assert.deepEqual(cache.snapshot('a').items.map(i => i.messageId), ['2', '3']);
  cache.put('b', item('4')); cache.snapshot('a'); cache.put('c', item('5'));
  assert.equal(cache.snapshot('b').items.length, 0);
  const before = cache.snapshot('a').generation;
  now = 101; cache.sweep(); assert.equal(cache.size, 0);
  cache.reset(); assert.notEqual(cache.snapshot('a').generation, before);
});
test('watch coalesces changes and yields reset even to a slow subscriber', async () => {
  const cache = new EffortCache(limits); const abort = new AbortController();
  const iterator = cache.watch('a', abort.signal);
  assert.equal((await iterator.next()).value?.items.length, 0);
  for (let i = 0; i < 100; i++) cache.put('a', item(String(i)));
  const update = await iterator.next();
  assert.ok(!update.done);
  assert.deepEqual(update.value.items.map(i => i.messageId), ['98', '99']);
  cache.dispose();
  assert.equal((await iterator.next()).value?.items.length, 0);
  assert.equal((await iterator.next()).done, true);
});
test('watch cancellation wakes an idle consumer', async () => {
  const cache = new EffortCache(limits); const abort = new AbortController();
  const iterator = cache.watch('a', abort.signal); await iterator.next();
  const waiting = iterator.next(); abort.abort(); assert.equal((await waiting).done, true);
});
test('native identity joins either completion order, across sessions and Agent lifetimes', () => {
  const cache = new EffortCache({ ...limits, maxEntries: 100 });
  const links = new Associations(cache, { ...limits, maxEntries: 100 });
  for (const order of ['capture-first', 'message-first']) {
    const agent = {}; const session = order;
    links.start(agent, session, `${session}:1`);
    const scope = links.bind(session, 'p', 'm', true); const request = links.begin(scope);
    if (order === 'message-first') links.end(agent, `${session}:1`, 'msg');
    links.complete(scope, request, { kind: 'observed', effort: order, terminal: 'completed' });
    if (order === 'capture-first') links.end(agent, `${session}:1`, 'msg');
    assert.equal(cache.snapshot(session).items[0]?.result.kind, 'observed');
  }
  const old = {}, replacement = {};
  links.start(old, 's', 's:1'); const scope = links.bind('s', 'p', 'm', true); const id = links.begin(scope);
  links.end(old, 's:1');
  links.start(replacement, 's', 's:1');
  links.complete(scope, id, { kind: 'observed', effort: 'wrong', terminal: 'completed' });
  const next = links.bind('s', 'p', 'm', true); const second = links.begin(next);
  links.complete(next, second, { kind: 'observed', effort: 'correct', terminal: 'completed' });
  links.end(replacement, 's:1', 'replacement');
  const result = cache.snapshot('s').items[0]?.result;
  assert.ok(result?.kind === 'observed');
  assert.equal(result.effort, 'correct');
});
test('failed retry, missing capture, ambiguous calls and conflicting response ids never borrow values', () => {
  const cache = new EffortCache(limits); const links = new Associations(cache, limits); const agent = {};
  links.start(agent, 's', '1'); let scope = links.bind('s', 'p', 'm', true); let id = links.begin(scope);
  links.complete(scope, id, { kind: 'observed', effort: 'failed-attempt', terminal: 'failed' }); links.end(agent, '1');
  links.start(agent, 's', '2'); scope = links.bind('s', 'p', 'm', true); id = links.begin(scope);
  links.complete(scope, id, { kind: 'absent', terminal: 'completed' }); links.end(agent, '2', 'success');
  assert.equal(cache.snapshot('s').items[0]?.result.kind, 'absent');
  links.start(agent, 's', '3'); scope = links.bind('s', 'p', 'm', true);
  for (const effort of ['high', 'low']) { id = links.begin(scope); links.complete(scope, id, { kind: 'observed', effort, terminal: 'completed' }); }
  links.end(agent, '3', 'ambiguous'); assert.equal(cache.snapshot('s').items.length, 1);
  links.start(agent, 's', '4'); scope = links.bind('s', 'p', 'm', true); id = links.begin(scope);
  links.complete(scope, id, { kind: 'observed', effort: 'max', terminal: 'completed', responseId: 'a' }); links.end(agent, '4', 'conflict', 'b');
  assert.equal(cache.snapshot('s').items.length, 1);
});
test('pending joins expire and auxiliary calls are not attached to a live attempt', () => {
  let now = 0; const cache = new EffortCache(limits, () => now); const links = new Associations(cache, limits, () => now); const agent = {};
  links.start(agent, 's', '1'); assert.equal(links.bind('s', 'p', 'm', false).token, undefined);
  const scope = links.bind('s', 'p', 'm', true); const id = links.begin(scope); links.end(agent, '1', 'm');
  now = 21; links.sweep(); links.complete(scope, id, { kind: 'absent', terminal: 'completed' });
  assert.equal(cache.size, 0); assert.equal(links.size, 0);
});
