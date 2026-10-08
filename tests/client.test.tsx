import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createElement } from 'react';
import type { ComponentType } from 'react';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import { Context } from '@deepseek-ai/cordis';
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import type { RemoteStreamItem, RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import { EffortCache } from '../src/host/cache.ts';
import { DEFAULT_LIMITS } from '../src/contracts.ts';
import type { EffortItem } from '../src/contracts.ts';
import { EffortBadge } from '../src/client/EffortBadge.tsx';
import type { BadgeProps } from '../src/client/EffortBadge.tsx';
import { EffortHub } from '../src/client/session-store.ts';
import type { EffortSource, EffortTransport, RemoteReader } from '../src/client/session-store.ts';
import * as clientPlugin from '../src/client/index.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const item = (messageId: string, result: EffortItem['result']): EffortItem => ({ messageId, provider: 'p', model: 'm', observedAt: 1, result });
function transport(cache: EffortCache) {
  let opened = 0;
  const remote: EffortTransport = {
    async $mount() { return async () => {}; },
    responseEffort: { watch: (sessionId, signal) => cache.watch(sessionId, signal!) },
    $stream<Item>(options: RemoteStreamOptions<Item>): RemoteReader<Item> {
      opened++; const abort = new AbortController();
      async function* frames(): AsyncGenerator<RemoteStreamItem<Item>> {
        for await (const value of options.open(abort.signal)) yield { generation: 1, signal: abort.signal, value, accept() {} };
      }
      return { [Symbol.asyncIterator]: () => frames(), async dispose() { abort.abort(); } };
    },
  };
  return { remote, opened: () => opened };
}

test('badges use exact message identity, share a Session stream and refill after refresh', async t => {
  const cache = new EffortCache(DEFAULT_LIMITS); const fake = transport(cache); const hub = new EffortHub(fake.remote);
  t.after(() => hub.dispose());
  cache.put('s', item('one', { kind: 'observed', effort: 'max', terminal: 'completed' }));
  cache.put('s', item('two', { kind: 'absent', terminal: 'completed' }));
  cache.put('other', item('one', { kind: 'observed', effort: 'wrong-session', terminal: 'completed' }));
  let view: ReactTestRenderer;
  await act(async () => { view = create(<><EffortBadge messageId="one" effortSource={hub.source('s')} /><EffortBadge messageId="two" effortSource={hub.source('s')} /><EffortBadge messageId="missing" effortSource={hub.source('s')} /></>); await flush(); });
  assert.equal(fake.opened(), 1); assert.equal(hub.activeSessions, 1);
  assert.equal(view!.root.findAllByType('span').length, 2);
  assert.match(JSON.stringify(view!.toJSON()), /max/); assert.match(JSON.stringify(view!.toJSON()), /未返回/);
  assert.ok(!JSON.stringify(view!.toJSON()).includes('wrong-session'));
  await act(async () => { cache.put('s', item('one', { kind: 'unknown', reason: 'timeout' })); await flush(); });
  assert.equal(view!.root.findAllByType('span').length, 1);
  await act(async () => { view!.unmount(); await flush(); }); assert.equal(hub.activeSessions, 0);
  await act(async () => { view = create(<EffortBadge messageId="two" effortSource={hub.source('s')} />); await flush(); });
  assert.match(JSON.stringify(view!.toJSON()), /未返回/); assert.equal(fake.opened(), 2);
  await act(async () => { cache.reset(); await flush(); }); assert.equal(view!.toJSON(), null);
  await act(async () => { view!.unmount(); await hub.dispose(); });
});
test('untrusted effort is rendered as text, with no HTML injection', async () => {
  const value = '<img src=x onerror=alert(1)>';
  const source: EffortSource = { getSnapshot: () => values, subscribe: () => () => {} };
  const values = new Map([['m', item('m', { kind: 'observed', effort: value, terminal: 'completed' })]]);
  const view = create(<EffortBadge messageId="m" effortSource={source} />);
  assert.equal(view.root.findAllByType('img').length, 0);
  assert.ok(view.root.findByType('span').children.includes(value));
  assert.match(view.root.findByType('span').props.title, /不是测得的实际推理量/);
  view.unmount();
});
test('official SlotRegistry accepts the plugin and preserves existing contributions on unload', async t => {
  const require = createRequire(import.meta.url);
  let loaded: unknown;
  runInNewContext(readFileSync(require.resolve('@deepseek-ai/dsh-client-ui-renderer/client'), 'utf8'), {
    window: { __ModuleLoader__: { load(definition: { factory(require: NodeRequire): unknown }) { loaded = definition.factory(require); } } },
    console, setTimeout, clearTimeout, AbortController,
  });
  const native = loaded as typeof import('@deepseek-ai/dsh-client-ui-renderer/client');
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin({ name: 'native-slots', apply(context: Context) { new native.SlotRegistry(context); } });
  ctx.slots.register({ name: 'root', children: { 'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' } } }, (props: PropsRenderSlots<'conversation.chat.assistant-actions'>) => { void props.renderSlot; return null; });
  ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'feedback', order: 10 }, () => null);
  const cache = new EffortCache(DEFAULT_LIMITS); const fake = transport(cache);
  ctx.provide('locale', { register: () => () => {} });
  ctx.provide('remote', fake.remote);
  ctx.provide('remote.responseEffort', fake.remote.responseEffort);
  const owner = await ctx.plugin(clientPlugin); await flush();
  const entries = ctx.slots.entries('conversation.chat.assistant-actions');
  assert.equal(entries.length, 2);
  const entry = entries.find(entry => entry.options.id === 'response-effort'); assert.ok(entry);
  assert.equal(entry.component, EffortBadge);
  assert.ok(entry.inject);
  const inject = entry.inject as (sessionId: string) => { effortSource: EffortSource };
  const injected = inject('s');
  cache.put('s', item('m', { kind: 'observed', effort: 'max', terminal: 'completed' }));
  let view: ReactTestRenderer;
  await act(async () => { view = create(createElement(entry.component as ComponentType<BadgeProps>, { messageId: 'm', ...injected })); await flush(); });
  assert.match(JSON.stringify(view!.toJSON()), /max/);
  await act(async () => { await owner.dispose(); await flush(); });
  assert.deepEqual(ctx.slots.entries('conversation.chat.assistant-actions').map(entry => entry.options.id), ['feedback']);
  assert.equal(view!.toJSON(), null); view!.unmount();
});
