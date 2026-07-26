export function detectCodingTool(
  headers: Record<string, string | string[] | undefined>,
  configuredPatterns: string,
) {
  const patterns = configuredPatterns
    .split(/[\s,]+/)
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean);
  const fingerprint = [
    headers['user-agent'],
    headers['x-client-name'],
    headers['x-app-name'],
    headers['x-openai-client-user-agent'],
  ]
    .flatMap((value) => Array.isArray(value) ? value : [value || ''])
    .join(' ')
    .toLowerCase();
  return patterns.find((pattern) => fingerprint.includes(pattern)) || '';
}

export function consumeRateLimit(timestamps: number[], limit: number, now = Date.now()) {
  const normalizedLimit = Math.max(0, Math.floor(limit));
  while (timestamps.length && timestamps[0] <= now - 60_000) timestamps.shift();
  if (!normalizedLimit) return { allowed: true, retryAfter: 0 };
  if (timestamps.length >= normalizedLimit) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((timestamps[0] + 60_000 - now) / 1000)),
    };
  }
  timestamps.push(now);
  return { allowed: true, retryAfter: 0 };
}
