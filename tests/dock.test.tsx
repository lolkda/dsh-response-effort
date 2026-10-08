import test from 'node:test';
import assert from 'node:assert/strict';
import { act, create } from 'react-test-renderer';
import type { ReactTestRenderer } from 'react-test-renderer';
import type { RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client';
import { EffortDock } from '../src/client/EffortDock.tsx';
import { EffortHub } from '../src/client/session-store.ts';
import type { EffortTransport, ResponseFeed, ResponseSource } from '../src/client/session-store.ts';
import type { ResponseItem } from '../src/contracts.ts';
import { en, zh } from '../src/client/locale.ts';
import type { EffortTranslate } from '../src/client/locale.ts';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const translate = (dict: Record<keyof typeof en, string>): EffortTranslate => (key, params) => (dict[key as keyof typeof en] ?? key).replace(/\{(\w+)\}/g, (_match, name: string) => String(params?.[name] ?? name));
const t = translate(zh);
const item = (n: number, result: ResponseItem['result'] = { kind: 'observed', effort: 'high', terminal: 'completed' }): ResponseItem => ({ captureId: `capture-${n}`, sequence: n, provider: 'p', model: 'm', observedAt: 1000 + n, result });
function source(initial: ResponseFeed) {
  let value = initial;
  const listeners = new Set<() => void>();
  const source: ResponseSource = { getSnapshot: () => value, subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  return { source, update(next: ResponseFeed) { value = next; for (const listener of listeners) listener(); } };
}
function summary(view: ReactTestRenderer): string { return view.root.findByProps({ role: 'status' }).children.join(''); }

test('dock updates latest response before a final message, expands bounded history and distinguishes absent/unknown', async () => {
  const state = source({ status: 'ready', generation: 'g', items: [] });
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<EffortDock responseSource={state.source} t={t} />); });
  try {
    assert.equal(view.toJSON(), null, 'empty feed leaves no container or spacing');
    const rows = Array.from({ length: 25 }, (_, index) => item(25 - index));
    await act(async () => { state.update({ status: 'ready', generation: 'g', items: rows }); });
    assert.match(summary(view), /最近响应.*effort: high.*#25/);
    assert.equal(view.root.findAllByType('li').length, 0);
    const button = view.root.findByType('button');
    assert.equal(button.props['aria-expanded'], false);
    await act(async () => { button.props.onClick(); });
    assert.equal(view.root.findAllByType('li').length, 20);
    assert.equal(view.root.findByProps({ id: button.props['aria-controls'] }).type, 'div');
    const more = view.root.findAllByType('button').at(-1)!;
    await act(async () => { more.props.onClick(); });
    assert.equal(view.root.findAllByType('li').length, 25);
    const unknown = item(26, { kind: 'unknown', reason: 'timeout' });
    await act(async () => { state.update({ status: 'ready', generation: 'g', items: [unknown, ...rows] }); });
    assert.match(summary(view), /无法确认/); assert.doesNotMatch(summary(view), /high|未返回/);
    const absent = item(27, { kind: 'absent', terminal: 'completed' });
    await act(async () => { state.update({ status: 'ready', generation: 'g', items: [absent, unknown, ...rows] }); });
    assert.match(summary(view), /effort: 未返回/);
    assert.equal(view.root.findAllByType('li')[0]?.props['data-response-capture'], 'capture-27');
    await act(async () => { state.update({ status: 'ready', generation: 'new', items: [item(1)] }); });
    assert.equal(view.root.findAllByType('li').length, 0, 'new generation resets expansion');
  } finally { await act(async () => { view.unmount(); }); }
});

test('dock does not retain another source, renders untrusted values as text and supports English', async () => {
  const malicious = '<img src=x onerror=alert(1)>';
  const first = source({ status: 'ready', generation: 'one', items: [item(1, { kind: 'observed', effort: malicious, terminal: 'failed' })] });
  const second = source({ status: 'ready', generation: 'two', items: [] });
  let view!: ReactTestRenderer;
  await act(async () => { view = create(<EffortDock responseSource={first.source} t={t} />); });
  try {
    assert.ok(summary(view).includes(malicious));
    assert.equal(view.root.findAllByType('img').length, 0);
    await act(async () => { view.root.findByType('button').props.onClick(); });
    assert.ok(JSON.stringify(view.toJSON()).includes('失败'));
    await act(async () => { view.update(<EffortDock responseSource={second.source} t={translate(en)} />); });
    assert.equal(view.toJSON(), null);
    assert.ok(!JSON.stringify(view.toJSON()).includes(malicious));
    for (const status of ['connecting', 'unavailable'] as const) {
      await act(async () => { second.update({ status, items: [] }); });
      assert.equal(view.toJSON(), null, `${status} must not leave a placeholder`);
    }
    await act(async () => { second.update({ status: 'ready', generation: 'two', items: [item(2)] }); });
    assert.match(summary(view), /Latest response.*high/);
    assert.equal(view.root.findByType('button').props['aria-expanded'], false);
    await act(async () => { view.root.findByType('button').props.onClick(); });
    await act(async () => { second.update({ status: 'ready', generation: 'two', items: [] }); });
    assert.equal(view.toJSON(), null, 'clearing records removes the entire card');
    await act(async () => { second.update({ status: 'ready', generation: 'two', items: [item(3)] }); });
    assert.equal(view.root.findByType('button').props['aria-expanded'], false, 'records returning start collapsed');
    await act(async () => { second.update({ status: 'unavailable', items: [] }); });
    assert.equal(view.toJSON(), null, 'disconnect hides a previously visible card');
  } finally { await act(async () => { view.unmount(); }); }
});

test('terminal subscription failure clears latest response and disposes the logical stream', async () => {
  let disposed = 0;
  const transport: EffortTransport = {
    async $mount() { return async () => {}; },
    responseEffort: { async *watch() { yield { generation: 'g', revision: 1, items: [], responses: [item(1)] }; throw new Error('fixture failure'); } },
    $stream<Item>(options: RemoteStreamOptions<Item>) {
      const abort = new AbortController();
      return {
        async *[Symbol.asyncIterator]() {
          for await (const value of options.open(abort.signal)) yield { value, generation: 1, signal: abort.signal, accept() {} };
        },
        async dispose() { disposed++; abort.abort(); },
      };
    },
  };
  const hub = new EffortHub(transport);
  const state = hub.responseSource('s');
  const statuses: string[] = [];
  const off = state.subscribe(() => statuses.push(state.getSnapshot().status));
  await flush();
  assert.ok(statuses.includes('ready'));
  assert.equal(state.getSnapshot().status, 'unavailable');
  assert.equal(state.getSnapshot().items.length, 0);
  assert.ok(disposed > 0);
  off(); await hub.dispose();
});
