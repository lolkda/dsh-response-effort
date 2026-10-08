import type { TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import { record } from './contracts.ts';
import type { EffortItem, Observation, ResponseItem, Snapshot } from './contracts.ts';

function boundedText(value: unknown, max = 1024): value is string { return typeof value === 'string' && value.length > 0 && value.length <= max; }
const reasons = new Set(['invalid-event', 'invalid-effort', 'event-limit', 'byte-limit', 'timeout', 'interrupted', 'stream-ended', 'read-error', 'ambiguous', 'unavailable']);
function observation(value: unknown): Observation {
  const data = record(value);
  if (!data) throw new TypeError('Invalid effort observation');
  if (data.kind === 'unknown' && typeof data.reason === 'string' && reasons.has(data.reason)) return { kind: 'unknown', reason: data.reason as Extract<Observation, { kind: 'unknown' }>['reason'] };
  if (data.terminal !== 'completed' && data.terminal !== 'incomplete' && data.terminal !== 'failed') throw new TypeError('Invalid effort terminal');
  const extra = boundedText(data.responseId, 512) ? { responseId: data.responseId } : {};
  if (data.kind === 'absent') return { kind: 'absent', terminal: data.terminal, ...extra };
  if (data.kind === 'observed' && typeof data.effort === 'string' && [...data.effort].length <= 4096 && data.effort.trim()) return { kind: 'observed', terminal: data.terminal, effort: data.effort, ...extra };
  throw new TypeError('Invalid effort observation');
}
export function decodeSnapshot(value: unknown): Snapshot {
  const data = record(value);
  if (!data || !boundedText(data.generation) || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0 || !Array.isArray(data.items) || data.items.length > 10000) throw new TypeError('Invalid effort snapshot');
  const seen = new Set<string>();
  const items: EffortItem[] = data.items.map((value: unknown) => {
    const item = record(value);
    if (!item || !boundedText(item.messageId) || !boundedText(item.provider) || !boundedText(item.model) || !Number.isFinite(item.observedAt) || seen.has(item.messageId)) throw new TypeError('Invalid effort item');
    seen.add(item.messageId);
    return { messageId: item.messageId, provider: item.provider, model: item.model, observedAt: item.observedAt as number, result: observation(item.result) };
  });
  if (!Array.isArray(data.responses) || data.responses.length > 10000) throw new TypeError('Invalid effort responses');
  const captures = new Set<string>();
  const sequences = new Set<number>();
  const responses: ResponseItem[] = data.responses.map((value: unknown) => {
    const item = record(value);
    if (!item || !boundedText(item.captureId) || !boundedText(item.provider) || !boundedText(item.model)
      || !Number.isFinite(item.observedAt) || Math.abs(item.observedAt as number) > 8.64e15
      || !Number.isSafeInteger(item.sequence) || (item.sequence as number) < 1
      || captures.has(item.captureId) || sequences.has(item.sequence as number)) throw new TypeError('Invalid effort response');
    captures.add(item.captureId); sequences.add(item.sequence as number);
    return { captureId: item.captureId, sequence: item.sequence as number, provider: item.provider, model: item.model,
      observedAt: item.observedAt as number, result: observation(item.result) };
  });
  return { generation: data.generation, revision: data.revision as number, items, responses };
}
const sessionId: TypertCodec = {
  mode: 'strict', typeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
  create: () => ({ parse(value: unknown) { if (!boundedText(value)) throw new TypeError('Expected Session ID'); return value; } }),
};
export const REMOTE: TypertRemoteContribution = {
  package: 'dsh-response-effort',
  descriptors: [{
    id: 'dsh-response-effort#responseEffort/watch', service: 'responseEffort', namespace: 'responseEffort', method: 'watch', mode: 'stream',
    invocation: { kind: 'direct' }, parameters: [{ name: 'session', wire: 'sessionId', source: 'lookup', lookup: 'session', codec: sessionId }],
    cancellation: { parameter: 'signal' },
    result: { mode: 'strict', typeSymbol: 'dsh-response-effort#Snapshot', create: () => ({ parse: decodeSnapshot }) },
  }],
};
