import type { TokenUsage } from './billing.js';

function usageFrom(value: unknown): TokenUsage {
  if (!value || typeof value !== 'object') return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const usage = value as Record<string, unknown>;
  const inputTokens = Math.max(0, Math.ceil(Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0));
  const outputTokens = Math.max(0, Math.ceil(Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0));
  const reportedTotal = Math.max(0, Math.ceil(Number(usage.total_tokens ?? usage.total_tokens_used ?? 0) || 0));
  return { inputTokens, outputTokens, totalTokens: Math.max(reportedTotal, inputTokens + outputTokens) };
}

export function payloadTokenUsage(payload: unknown): TokenUsage {
  if (!payload || typeof payload !== 'object') return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  const record = payload as Record<string, unknown>;
  const candidates = [
    usageFrom(record.usage),
    record.response && typeof record.response === 'object'
      ? usageFrom((record.response as Record<string, unknown>).usage)
      : { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  ];
  return candidates.reduce((largest, usage) => usage.totalTokens > largest.totalTokens ? usage : largest);
}

export function payloadUsageTokens(payload: unknown) {
  return payloadTokenUsage(payload).totalTokens;
}

export function estimatedTokenUsage(requestBody: unknown, reported: TokenUsage, outputChars = 0): TokenUsage {
  const inputEstimate = Math.max(1, Math.ceil(JSON.stringify(requestBody).length / 4));
  if (reported.inputTokens + reported.outputTokens > 0) return reported;
  if (reported.totalTokens > 0) {
    const inputTokens = Math.min(reported.totalTokens, inputEstimate);
    return { inputTokens, outputTokens: reported.totalTokens - inputTokens, totalTokens: reported.totalTokens };
  }
  const outputTokens = Math.max(0, Math.ceil(outputChars / 4));
  return { inputTokens: inputEstimate, outputTokens, totalTokens: Math.max(1, inputEstimate + outputTokens) };
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
  private reportedUsage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
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
    return this.usage(requestBody).totalTokens;
  }

  usage(requestBody: unknown) {
    return estimatedTokenUsage(requestBody, this.reportedUsage, this.outputChars);
  }

  private inspectLine(line: string) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const payload = JSON.parse(data) as unknown;
      const usage = payloadTokenUsage(payload);
      if (usage.totalTokens > this.reportedUsage.totalTokens) this.reportedUsage = usage;
      this.outputChars += payloadTextLength(payload);
    } catch {
      // Compatible upstreams may emit non-JSON keepalive data.
    }
  }
}
