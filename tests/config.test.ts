import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/config.ts';
import { decodeSnapshot } from '../src/remote-contract.ts';

test('disabled defaults and exact safe target URLs', () => {
  assert.equal(settings({}).enabled, false); assert.deepEqual(settings({}).targets, []);
  assert.equal(settings({ targets: [{ provider: 'p', url: 'https://EXAMPLE.test:443/v1/responses' }] }).targets[0]?.url, 'https://example.test/v1/responses');
  for (const url of ['file:///v1/responses', 'https://user:pass@example.test/v1/responses', 'https://example.test/v1/responses?token=x', 'https://example.test/v1/responses#x', 'https://example.test/v1/chat/completions']) assert.throws(() => settings({ targets: [{ provider: 'p', url }] }));
  for (const limits of [{ maxConcurrent: 0 }, { ttlMs: 0.1 }, { maxObserveMs: 2 ** 31 }, { maxEffortChars: 4097 }, { maxSessionEntries: 10001 }]) assert.throws(() => settings({ limits }));
});
test('snapshot codec accepts Unicode counts and strips unrelated data', () => {
  const effort = '😀'.repeat(256);
  const value = decodeSnapshot({ generation: 'g', revision: 1, responses: [], rawSse: 'must not pass', items: [{ messageId: 'm', provider: 'p', model: 'x', observedAt: 1, secret: 'not in output', result: { kind: 'observed', effort, terminal: 'completed' } }] });
  assert.equal(value.items[0]?.result.kind === 'observed' && value.items[0].result.effort, effort);
  assert.ok(!JSON.stringify(value).includes('must not pass'));
  assert.ok(!JSON.stringify(value).includes('not in output'));
  assert.throws(() => decodeSnapshot({ generation: 'g', revision: 1, items: [{ messageId: 'm' }] }));
});
