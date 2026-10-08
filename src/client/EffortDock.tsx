import { useId, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import type { Observation } from '../contracts.ts';
import type { ResponseFeed, ResponseSource } from './session-store.ts';
import type { EffortTranslate } from './locale.ts';

export interface DockProps { readonly responseSource: ResponseSource; readonly t: EffortTranslate }
const buttonStyle: CSSProperties = {
  font: 'inherit', color: 'var(--dsw-alias-label-secondary)', background: 'transparent',
  border: 0, padding: '2px 4px', cursor: 'pointer', borderRadius: 4, flexShrink: 0,
};
const clipped: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 };
function resultText(result: Observation, t: EffortTranslate): string {
  return result.kind === 'observed' ? `effort: ${result.effort}` : result.kind === 'absent' ? `effort: ${t('absent')}` : t('unknown');
}
export function EffortDock({ responseSource, t }: DockProps) {
  const feed = useSyncExternalStore(responseSource.subscribe, responseSource.getSnapshot, responseSource.getSnapshot);
  if (feed.status !== 'ready' || feed.items.length === 0) return null;
  return <DockView key={feed.generation} feed={feed} t={t} />;
}
function DockView({ feed, t }: { readonly feed: ResponseFeed; readonly t: EffortTranslate }) {
  const [expanded, setExpanded] = useState(false);
  const [visible, setVisible] = useState(20);
  const historyId = useId();
  const latest = feed.items[0];
  if (!latest) return null;
  const summary = `${t('recent')}：${resultText(latest.result, t)} · ${t('response', { sequence: latest.sequence })}`;
  return <section data-response-effort-dock="" aria-label={t('recent')} style={{
    boxSizing: 'border-box', minWidth: 0, margin: '0 auto',
    width: 'calc(100% - 2 * var(--dsh-composer-side-clearance, 16px) - 4 * var(--dsh-composer-dock-inset, 4px))',
    maxWidth: 'calc(var(--dsh-composer-card-max-width, 800px) - 4 * var(--dsh-composer-dock-inset, 4px))',
    borderRadius: 12, fontSize: 13, lineHeight: '20px',
    color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-1)',
    boxShadow: '0 0 0 1px var(--dsw-alias-border-l1), 0 2px 8px var(--dsw-alias-border-l1)',
  }}>
    <button type="button" aria-expanded={expanded} aria-controls={historyId}
      aria-label={t(expanded ? 'hide' : 'view')} title={`${summary}\n${t('explanation')}`}
      style={{ ...buttonStyle, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 10,
        width: '100%', height: 36, padding: '4px 8px 4px 12px', borderRadius: 12, textAlign: 'left' }}
      onClick={() => setExpanded(value => !value)}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <path d="M3 12h4l3-8 4 16 3-8h4" />
      </svg>
      <span role="status" aria-live="polite" aria-atomic="true" style={{ ...clipped, flex: 1, color: 'var(--dsw-alias-label-primary)' }}>{summary}</span>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, transform: expanded ? 'rotate(180deg)' : undefined }}>
        <path d="m8 10 4 4 4-4" />
      </svg>
    </button>
    {expanded && <div id={historyId} style={{ padding: '0 12px 8px' }}>
      <ol aria-label={t('view')} style={{ listStyle: 'none', margin: '6px 0', padding: 0, maxHeight: 224, overflowY: 'auto' }}>
        {feed.items.slice(0, visible).map(item => {
          const value = resultText(item.result, t);
          const status = item.result.kind === 'unknown' ? t('unknownHint', { reason: item.result.reason }) : t(item.result.terminal);
          return <li key={item.captureId} data-response-capture={item.captureId} style={{ padding: '5px 0', borderTop: '1px solid var(--dsw-alias-border-l1)' }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <span>{t('response', { sequence: item.sequence })}</span>
              <time dateTime={new Date(item.observedAt).toISOString()} title={new Date(item.observedAt).toLocaleString()}>{new Date(item.observedAt).toLocaleTimeString()}</time>
              <span title={`${value}\n${status}\n${t('explanation')}`} style={{ ...clipped, flex: '1 1 80px', color: 'var(--dsw-alias-label-primary)' }}>{value}</span>
              <span title={status}>{item.result.kind === 'unknown' ? t('unknown') : t(item.result.terminal)}</span>
            </div>
            <div title={`${item.provider} / ${item.model}`} style={clipped}>{item.provider} / {item.model}</div>
          </li>;
        })}
      </ol>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>{t('count', { shown: Math.min(visible, feed.items.length), total: feed.items.length })}</span>
        {visible < feed.items.length && <button type="button" style={buttonStyle} onClick={() => setVisible(value => value + 20)}>{t('more')}</button>}
      </div>
      <p style={{ margin: '4px 0 0', fontSize: 11 }}>{t('retention')}</p>
    </div>}
  </section>;
}
