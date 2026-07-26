const sensitiveHeaders = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "proxy-authorization",
]);

export function sanitizeRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
) {
  const safe: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (sensitiveHeaders.has(name)) {
      safe[name] = "[REDACTED]";
      continue;
    }
    if (rawValue == null) continue;
    safe[name] = (
      Array.isArray(rawValue) ? rawValue.join(", ") : rawValue
    ).slice(0, 500);
  }
  return JSON.stringify(safe).slice(0, 8000);
}

export function clientIp(
  forwarded: string | string[] | undefined,
  fallback = "",
) {
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return (value?.split(",")[0].trim() || fallback || "").slice(0, 100);
}
