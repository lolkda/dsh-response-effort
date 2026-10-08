import { AsyncLocalStorage } from 'node:async_hooks';
import type { CallScope } from './association.ts';

export const calls = new AsyncLocalStorage<CallScope>();
/** Delay scope binding until the consumer advances: native start precedes that point. */
export function scopedStream<T>(next: () => AsyncIterable<T>, scopeFor: () => CallScope): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<T> {
      let iterator: AsyncIterator<T> | undefined;
      let scope: CallScope | undefined;
      const initialize = (): AsyncIterator<T> => {
        scope ??= scopeFor();
        iterator ??= calls.run(scope, () => next()[Symbol.asyncIterator]());
        return iterator;
      };
      return {
        next: value => {
          const inner = initialize();
          return calls.run(scope!, () => inner.next(value));
        },
        return: value => iterator === undefined ? Promise.resolve({ done: true, value }) : calls.run(scope!, () => iterator!.return?.(value) ?? Promise.resolve({ done: true, value })),
        throw: error => iterator === undefined ? Promise.reject(error) : calls.run(scope!, () => iterator!.throw?.(error) ?? Promise.reject(error)),
      };
    },
  };
}
