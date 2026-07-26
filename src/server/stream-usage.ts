function usageFrom(value: unknown) {
  if (!value || typeof value !== 'object') return 0;
  const usage = value as Record<string, unknown>;
  const total = Number(usage.total_tokens ?? usage.total_tokens_used ?? 0);
  if (total > 0) return Math.ceil(total);
  const input = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
  const output = Number(usage.output_tokens ?? usage.completion_tokens ?? 0);
  return input + output > 0 ? Math.ceil(input + output) : 0;
}

export function payloadUsageTokens(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 0;
  const record = payload as Record<string, unknown>;
  return Math.max(
    usageFrom(record.usage),
    record.response && typeof record.response === 'object'
      ? usageFrom((record.response as Record<string, unknown>).usage)
      : 0,
  );
}

function payloadTextLength(payload: unknown) {
  if (!payload || typeof payload !== 'object') return 0;
  const record = payload as Record<string, unknown>;
  let length = 0;
  if (typeof record.delta === 'string' && String(record.type || '').includes('delta')) {
    length += record.delta.length;
  }
  if (Array.isArray(record.choices)) {
    for (const choice of record.choices) {
      if (!choice || typeof choice !== 'object') continue;
      const delta = (choice as Record<string, unknown>).delta;
      if (!delta || typeof delta !== 'object') continue;
      const content = (delta as Record<string, unknown>).content;
      const reasoning = (delta as Record<string, unknown>).reasoning_content;
      if (typeof content === 'string') length += content.length;
      if (typeof reasoning === 'string') length += reasoning.length;
    }
  }
  return length;
}

export class SseUsageTracker {
  private lineBuffer = '';
  private usageTokens = 0;
  private outputChars = 0;

  push(text: string) {
    const lines = `${this.lineBuffer}${text}`.split(/\r?\n/);
    this.lineBuffer = lines.pop() || '';
    for (const line of lines) this.inspectLine(line);
  }

  finish() {
    if (this.lineBuffer) this.inspectLine(this.lineBuffer);
    this.lineBuffer = '';
  }

  totalTokens(requestBody: unknown) {
    if (this.usageTokens > 0) return this.usageTokens;
    return Math.max(1, Math.ceil((JSON.stringify(requestBody).length + this.outputChars) / 4));
  }

  private inspectLine(line: string) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const payload = JSON.parse(data) as unknown;
      this.usageTokens = Math.max(this.usageTokens, payloadUsageTokens(payload));
      this.outputChars += payloadTextLength(payload);
    } catch {
      // Compatible upstreams may emit non-JSON keepalive data.
    }
  }
}
