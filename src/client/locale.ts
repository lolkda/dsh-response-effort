import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';

export const NAMESPACE = 'response-effort';
export const en = {
  recent: 'Latest response', response: 'Response #{sequence}', view: 'View records', hide: 'Hide records',
  empty: 'No SSE observations available', connecting: 'Connecting to SSE observations…', unavailable: 'SSE observations unavailable',
  absent: 'Not returned', unknown: 'Unconfirmed', more: 'Show more', count: '{shown} / {total} retained records',
  explanation: 'Server-reported reasoning.effort, not measured reasoning. Updated when each matching SSE observation finishes; not the current request setting.',
  retention: 'Memory only; old records expire or are evicted. Numbers restart when this session has no retained records. Not a whole-turn request count.',
  unknownHint: 'No confirmed effort: {reason}', completed: 'Completed', incomplete: 'Incomplete', failed: 'Failed',
};
export const zh: Record<keyof typeof en, string> = {
  recent: '最近响应', response: '响应 #{sequence}', view: '查看记录', hide: '收起记录',
  empty: '暂无可用的 SSE 观测', connecting: '正在连接 SSE 观测…', unavailable: 'SSE 观测暂不可用',
  absent: '未返回', unknown: '无法确认', more: '查看更多', count: '已显示 {shown} / {total} 条保留记录',
  explanation: '服务端返回的 reasoning.effort，不是测得的实际推理量。每次匹配的 SSE 观测结束后更新，不代表当前请求设置。',
  retention: '仅保存在内存；旧记录会过期或淘汰。会话记录全部清空后重新编号，不是整轮请求总数。',
  unknownHint: '无法确认 effort：{reason}', completed: '已完成', incomplete: '未完成', failed: '失败',
};
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'response-effort': keyof typeof en }
}
export type EffortTranslate = TranslateNS<typeof NAMESPACE>;
/** The public dictionary-registration face; no Client implementation is bundled. */
export interface LocaleRegistry { register(namespace: string, locale: string, dictionary: Record<string, string>): () => void }
