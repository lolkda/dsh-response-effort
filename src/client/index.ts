import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import type {} from '@deepseek-ai/dsh-api-gateway/client';
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client';
import { REMOTE } from '../remote-contract.ts';
import { EffortDock } from './EffortDock.tsx';
import { NAMESPACE, en, zh } from './locale.ts';
import type { LocaleRegistry } from './locale.ts';
import { EffortBadge } from './EffortBadge.tsx';
import { EffortHub } from './session-store.ts';
import type { EffortTransport } from './session-store.ts';

export const name = 'response-effort-ui';
export const inject = ['slots', 'remote', 'locale'];
export function apply(ctx: Context): void {
  ctx.effect(async function* () {
    const locale = ctx.get('locale') as LocaleRegistry;
    yield locale.register(NAMESPACE, 'en', en);
    yield locale.register(NAMESPACE, 'zh', zh);
    yield await ctx.remote.$mount(REMOTE);
    const consumer = ctx.inject(['remote.responseEffort'], scoped => {
      scoped.effect(async function* () {
        const hub = new EffortHub(scoped.remote as unknown as EffortTransport);
        yield () => hub.dispose();
        yield scoped.slots.inject('conversation.chat.assistant-actions', () => scoped.slots.register({
          name: 'conversation.chat.assistant-actions', id: 'response-effort', order: 20,
          inject: sessionId => ({ effortSource: hub.source(String(sessionId)) }),
        }, EffortBadge));
        yield scoped.slots.inject('conversation.input.dock', () => scoped.slots.register({
          name: 'conversation.input.dock', id: 'response-effort', order: 30, locale: NAMESPACE,
          inject: sessionId => ({ responseSource: hub.responseSource(String(sessionId)) }),
        }, EffortDock));
      }, 'response-effort: subscribed namespace');
    });
    yield () => consumer.dispose();
  }, 'response-effort: native action badge');
}
