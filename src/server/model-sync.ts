export function parseUpstreamModelIds(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((item) =>
      item && typeof item === "object" ? (item as { id?: unknown }).id : null,
    )
    .filter(
      (id): id is string =>
        typeof id === "string" &&
        id.trim().length > 0 &&
        id.trim().length <= 100,
    )
    .map((id) => id.trim());
  return [...new Set(ids)];
}
