import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/config.ts';
import { Associations } from '../src/host/association.ts';
import { EffortCache } from '../src/host/cache.ts';
import { FetchTap } from '../src/host/fetch-tap.ts';
import { calls } from '../src/host/call-context.ts';
import { URL, wire } from './fixtures.ts';

test('an uncaptured matching HTTP response cannot borrow an earlier effort in the same attempt', async () => {
  const original = globalThis.fetch;
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  globalThis.fetch = async (_url, init) => new Response(init?.body === 'blocker' ? new ReadableStream<Uint8Array>({ start(value) { controller = value; } }) : wire(init?.body === 'first' ? 'wrong' : 'correct', ''), { headers: { 'content-type': 'text/event-stream' } });
  const config = settings({ enabled: true, targets: [{ provider: 'p', url: URL }], limits: { maxConcurrent: 1 } });
  const cache = new EffortCache(config.limits); const links = new Associations(cache, config.limits); const tap = new FetchTap(config, links);
  try {
    tap.install(); const agent = {}; links.start(agent, 's', '1'); const scope = links.bind('s', 'p', 'm', true);
    const first = await calls.run(scope, () => fetch(URL, { method: 'POST', body: 'first' })); await first.text(); await tap.drained();
    const blocker = await calls.run({ ...scope, token: undefined }, () => fetch(URL, { method: 'POST', body: 'blocker' }));
    const last = await calls.run(scope, () => fetch(URL, { method: 'POST', body: 'last' })); await last.text();
    links.end(agent, '1', 'message'); assert.equal(cache.snapshot('s').items.length, 0); assert.equal(tap.stats.skipped, 1);
    await tap.dispose(); controller!.close(); await blocker.text();
  } finally { await tap.dispose(); globalThis.fetch = original; }
});
