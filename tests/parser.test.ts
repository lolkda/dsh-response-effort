import test from 'node:test';
import assert from 'node:assert/strict';
import { EffortParser } from '../src/host/sse-parser.ts';

const encode = new TextEncoder();
function event(effort: unknown = 'max', type = 'response.completed'): string {
  return `data: ${JSON.stringify({ type, response: { id: 'resp-1', reasoning: { effort } } })}\n\n`;
}
function parse(wire: string, size = 1, maxBytes = 1024 * 1024, chars = 256) {
  const parser = new EffortParser(maxBytes, chars);
  const bytes = encode.encode(wire);
  for (let i = 0; i < bytes.length; i += size) parser.feed(bytes.subarray(i, i + size));
  return parser.end();
}
test('preserves upstream value through every UTF-8 split', () => {
  const wire = `\ufeff: heartbeat\n\nevent: response.completed\n${event('未定义档位-max')}`;
  for (let size = 1; size <= encode.encode(wire).length; size++) assert.deepEqual(parse(wire, size), { kind: 'observed', effort: '未定义档位-max', terminal: 'completed', responseId: 'resp-1' });
});
test('SSE newline variants and multiline data', () => {
  for (const newline of ['\n', '\r\n', '\r']) {
    const wire = 'id: 1\ndata: {"type":"response.incomplete",\ndata: "response":{"reasoning":{"effort":"low"}}}\n\n'.replaceAll('\n', newline);
    assert.deepEqual(parse(wire), { kind: 'observed', effort: 'low', terminal: 'incomplete' });
  }
});
test('all terminal states and no enum assumptions', () => {
  for (const terminal of ['completed', 'incomplete', 'failed']) assert.deepEqual(parse(event('future-level', `response.${terminal}`)), { kind: 'observed', effort: 'future-level', terminal, responseId: 'resp-1' });
});
test('missing and null require a complete valid terminal', () => {
  for (const reasoning of [undefined, null, {}, { effort: null }]) assert.deepEqual(parse(`data: ${JSON.stringify({ type: 'response.completed', response: { reasoning } })}\n\n`), { kind: 'absent', terminal: 'completed' });
  for (const wire of ['', 'data: [DONE]\n\n', 'data: {"type":"response.created","response":{}}\n\n', event().trimEnd()]) assert.equal(parse(wire).kind, 'unknown');
});
test('invalid effort, malformed events, event and string limits', () => {
  for (const effort of ['', '  ', 1, true, {}, [], 'x'.repeat(257)]) assert.deepEqual(parse(event(effort)), { kind: 'unknown', reason: 'invalid-effort' });
  assert.equal(parse('data: {\n\n').kind, 'unknown');
  assert.deepEqual(parse(event(), 1, 10), { kind: 'unknown', reason: 'event-limit' });
  assert.deepEqual(parse('data: ' + 'x'.repeat(200), 1, 100), { kind: 'unknown', reason: 'event-limit' });
  assert.equal(parse('data: {"type":"response.completed","response":null}\n\n').kind, 'unknown');
});
test('unknown events and duplicate terminal do not change first settlement', () => {
  assert.deepEqual(parse('data: {"type":"response.output_text.delta","delta":"not stored"}\n\n' + event() + event('low')), { kind: 'observed', effort: 'max', terminal: 'completed', responseId: 'resp-1' });
});
test('broken UTF-8 is unknown', () => {
  const parser = new EffortParser(1024, 256);
  parser.feed(new Uint8Array([0xff]));
  assert.deepEqual(parser.end(), { kind: 'unknown', reason: 'invalid-event' });
});
