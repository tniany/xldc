export const API_BRAND = '小老鼠的奶酪工坊-dc分站';

export function brandedError(message: string, type: string, details: Record<string, unknown> = {}) {
  return {
    error: {
      ...details,
      message: `【${API_BRAND}】${message}`,
      type,
      brand: API_BRAND,
    },
  };
}

export function brandUpstreamError(payload: unknown, status: number) {
  if (payload && typeof payload === 'object') {
    const error = (payload as { error?: unknown }).error;
    if (error && typeof error === 'object') {
      const details = error as Record<string, unknown>;
      const message = typeof details.message === 'string' ? details.message : `上游请求失败（${status}）`;
      const type = typeof details.type === 'string' ? details.type : 'upstream_error';
      return brandedError(message, type, details);
    }
    if (typeof error === 'string') return brandedError(error, 'upstream_error');
  }
  return brandedError(`上游请求失败（${status}）`, 'upstream_error');
}
