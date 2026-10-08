import { useSyncExternalStore } from 'react';
import type { EffortSource } from './session-store.ts';

export interface BadgeProps { readonly messageId: string; readonly effortSource: EffortSource }
/** Message-bound metadata only; never falls back to a request or another message. */
export function EffortBadge({ messageId, effortSource }: BadgeProps) {
  const items = useSyncExternalStore(effortSource.subscribe, effortSource.getSnapshot, effortSource.getSnapshot);
  const observation = items.get(messageId)?.result;
  if (!observation || observation.kind === 'unknown') return null;
  const value = observation.kind === 'observed' ? observation.effort : '未返回';
  const explanation = observation.kind === 'observed'
    ? `服务端响应返回的 reasoning.effort：${value}。不是测得的实际推理量。`
    : '已收到完整的 Responses 终态，但服务端未返回 reasoning.effort。';
  return <span data-response-effort={observation.kind} title={explanation} aria-label={`effort: ${value}；${explanation}`}
    style={{ display: 'inline-block', maxWidth: '14em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '12px', lineHeight: '20px', color: 'var(--dsw-alias-label-tertiary, currentColor)', padding: '0 4px', verticalAlign: 'middle' }}>
    effort: {value}
  </span>;
}
