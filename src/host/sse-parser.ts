import { record } from '../contracts.ts';
import type { Observation, Terminal } from '../contracts.ts';

const TERMINALS: Readonly<Record<string, Terminal>> = {
  'response.completed': 'completed', 'response.incomplete': 'incomplete', 'response.failed': 'failed',
};
/** Incremental SSE parser retaining only the current bounded event, never the transcript. */
export class EffortParser {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  private buffer = '';
  private data: string[] = [];
  private eventBytes = 0;
  private value: Observation | undefined;
  constructor(private readonly maxEventBytes: number, private readonly maxEffortChars: number) {}
  get result(): Observation | undefined { return this.value; }
  feed(bytes: Uint8Array): Observation | undefined {
    if (this.value) return this.value;
    try { this.buffer += this.decoder.decode(bytes, { stream: true }); }
    catch { return this.fail('invalid-event'); }
    while (!this.value) {
      const at = this.buffer.search(/[\r\n]/u);
      if (at < 0 || (this.buffer[at] === '\r' && at === this.buffer.length - 1)) break;
      const delimiter = this.buffer[at] === '\r' && this.buffer[at + 1] === '\n' ? 2 : 1;
      const line = this.buffer.slice(0, at);
      this.buffer = this.buffer.slice(at + delimiter);
      this.line(line, delimiter);
    }
    if (!this.value && this.eventBytes + new TextEncoder().encode(this.buffer).byteLength > this.maxEventBytes) this.fail('event-limit');
    return this.value;
  }
  end(): Observation {
    if (this.value) return this.value;
    try { this.decoder.decode(); } catch { return this.fail('invalid-event'); }
    // A CR at EOF is a complete line ending. A data line without the final
    // empty-line delimiter is not a dispatched SSE event.
    if (this.buffer.endsWith('\r')) {
      this.line(this.buffer.slice(0, -1), 1);
      this.buffer = '';
    }
    return this.value ?? this.fail('stream-ended');
  }
  private fail(reason: Extract<Observation, { kind: 'unknown' }>['reason']): Observation {
    this.value = { kind: 'unknown', reason };
    this.buffer = ''; this.data = []; this.eventBytes = 0;
    return this.value;
  }
  private line(line: string, delimiter: number): void {
    this.eventBytes += new TextEncoder().encode(line).byteLength + delimiter;
    if (this.eventBytes > this.maxEventBytes) { this.fail('event-limit'); return; }
    if (line === '') {
      const payload = this.data.join('\n');
      this.data = []; this.eventBytes = 0;
      if (payload && payload !== '[DONE]') this.event(payload);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
  }
  private event(payload: string): void {
    let parsed: unknown;
    try { parsed = JSON.parse(payload); } catch { this.fail('invalid-event'); return; }
    const event = record(parsed);
    if (!event || typeof event.type !== 'string') { this.fail('invalid-event'); return; }
    const terminal = TERMINALS[event.type];
    if (!terminal) return;
    const response = record(event.response);
    if (!response || (response.status !== undefined && response.status !== terminal)) { this.fail('invalid-event'); return; }
    const responseId = typeof response.id === 'string' && response.id.length > 0 && response.id.length <= 512 ? response.id : undefined;
    const extra = responseId === undefined ? {} : { responseId };
    if (response.reasoning !== undefined && response.reasoning !== null && !record(response.reasoning)) { this.fail('invalid-effort'); return; }
    const effort = record(response.reasoning)?.effort;
    if (effort === undefined || effort === null) this.value = { kind: 'absent', terminal, ...extra };
    else if (typeof effort === 'string' && effort.trim().length > 0 && [...effort].length <= this.maxEffortChars) this.value = { kind: 'observed', effort, terminal, ...extra };
    else { this.fail('invalid-effort'); return; }
    this.buffer = ''; this.data = [];
  }
}
