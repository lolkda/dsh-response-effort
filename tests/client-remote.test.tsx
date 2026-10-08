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
import TypertRegistry from '@deepseek-ai/dsh-typert-registry';
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client';
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots';
import { EffortCache } from '../src/host/cache.ts';
import { DEFAULT_LIMITS } from '../src/contracts.ts';
import type { BadgeProps } from '../src/client/EffortBadge.tsx';
import type { EffortSource, ResponseSource } from '../src/client/session-store.ts';
import type { DockProps } from '../src/client/EffortDock.tsx';
import { zh } from '../src/client/locale.ts';
import type { EffortTranslate } from '../src/client/locale.ts';
const translate: EffortTranslate = (key, params) => (zh[key as keyof typeof zh] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? name));
import * as clientPlugin from '../src/client/index.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function loadClient<T>(name: string): T {
  const require = createRequire(import.meta.url);
  let loaded: unknown;
  runInNewContext(readFileSync(require.resolve(name), 'utf8'), {
    window: { __ModuleLoader__: { load(definition: { factory(require: NodeRequire): unknown }) { loaded = definition.factory(require); } } },
    console, setTimeout, clearTimeout, AbortController, AbortSignal, crypto: globalThis.crypto,
  });
  return loaded as T;
}

test('native Remote namespace dependency delivers metadata and cleans up on reload', { timeout: 5000 }, async t => {
  const gateway = loadClient<typeof import('@deepseek-ai/dsh-api-gateway/client')>('@deepseek-ai/dsh-api-gateway/client');
  const renderer = loadClient<typeof import('@deepseek-ai/dsh-client-ui-renderer/client')>('@deepseek-ai/dsh-client-ui-renderer/client');
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const cache = new EffortCache(DEFAULT_LIMITS);
  t.after(() => cache.dispose());
  let opened = 0;
  let active = 0;
  const requests: unknown[] = [];
  ctx.provide('connection', {
    registerGenerationSource: () => () => {},
    start: () => ({ stop() {} }),
    generation: { getSnapshot: () => ({}), subscribe: () => () => {} },
    rpc: {
      async *open(prefix: string, endpoint: string, payload: { args: { sessionId: string } }, signal: AbortSignal) {
        opened++; active++;
        requests.push({ prefix, endpoint, payload });
        try { yield* cache.watch(payload.args.sessionId, signal); }
        finally { active--; }
      },
    },
  } as unknown as ConnectionHandle);
  ctx.provide('locale', { register: () => () => {} });
  await ctx.plugin(TypertRegistry);
  await ctx.plugin(gateway);
  await ctx.plugin({ name: 'native-slots', apply(context: Context) { new renderer.SlotRegistry(context); } });
  ctx.slots.register({ name: 'root', children: { 'conversation.chat.assistant-actions': { kind: 'list', scope: 'session' }, 'conversation.input.dock': { kind: 'list', scope: 'session' } } }, (_props: PropsRenderSlots<'conversation.chat.assistant-actions'>) => null);
  ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'feedback', order: 10 }, () => null);
  cache.put('s', { messageId: 'm', provider: 'p', model: 'model', observedAt: 1, result: { kind: 'observed', effort: 'high', terminal: 'completed' } });

  // A reload must acquire its own namespace dependency and stream lifetime.
  for (let round = 0; round < 2; round++) {
    const owner = await ctx.plugin(clientPlugin);
    await flush();
    const entry = ctx.slots.entries('conversation.chat.assistant-actions').find(value => value.options.id === 'response-effort');
    assert.ok(entry, 'plugin must mount before it can consume its own namespace');
    const injected = (entry.inject as (sessionId: string) => { effortSource: EffortSource })('s');
    const dock = ctx.slots.entries('conversation.input.dock').find(value => value.options.id === 'response-effort');
    assert.ok(dock);
    const dockProps = (dock.inject as (sessionId: string) => { responseSource: ResponseSource })('s');
    let view: ReactTestRenderer | undefined;
    try {
      await act(async () => {
        view = create(<>{createElement(entry.component as ComponentType<BadgeProps>, { messageId: 'm', ...injected })}
          {createElement(dock.component as ComponentType<DockProps>, { ...dockProps, t: translate })}</>);
        await flush();
      });
      assert.equal(opened, round + 1, 'real Cordis Remote must reach the carrier');
      assert.equal(active, 1);
      assert.equal(JSON.stringify(requests.at(-1)), JSON.stringify({ prefix: '/api', endpoint: 'responseEffort/watch', payload: { args: { sessionId: 's' } } }));
      assert.match(JSON.stringify(view!.toJSON()), /effort: .*high/);
      await act(async () => { await owner.dispose(); await flush(); });
      assert.equal(active, 0);
      assert.doesNotMatch(JSON.stringify(view!.toJSON()), /effort: .*high/);
      assert.equal(ctx.slots.entries('conversation.input.dock').length, 0);
      assert.deepEqual(ctx.slots.entries('conversation.chat.assistant-actions').map(value => value.options.id), ['feedback']);
    } finally {
      await act(async () => { view?.unmount(); await owner.dispose(); });
    }
  }
});
