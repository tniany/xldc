export type UpstreamModel = {
  id: string;
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  requestPrice: number | null;
};

export type ModelStatus = 'normal' | 'abnormal' | 'offline';

export function parseModelStatus(value: unknown, legacyEnabled: unknown = true): ModelStatus {
  if (value === 'normal' || value === 'abnormal' || value === 'offline') return value;
  return legacyEnabled === false || legacyEnabled === 0 || legacyEnabled === '0' ? 'offline' : 'normal';
}

export function shouldMarkModelAbnormal(httpStatus: number, recentFailures: number, threshold: number) {
  return httpStatus >= 500 && httpStatus < 600 && recentFailures >= Math.max(1, Math.floor(threshold));
}

function nonNegativeNumber(value: unknown) {
  if (value === '' || value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function firstPrice(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = nonNegativeNumber(record[key]);
    if (value != null) return value;
  }
  return null;
}

export function parseUpstreamModels(payload: unknown): UpstreamModel[] {
  if (!payload || typeof payload !== "object") return [];
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const models = new Map<string, UpstreamModel>();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    if (!id || id.length > 100 || models.has(id)) continue;
    const pricing = record.pricing && typeof record.pricing === 'object'
      ? record.pricing as Record<string, unknown>
      : {};
    const inputPerMillion = firstPrice(record, ['input_price_per_million', 'prompt_price_per_million', 'input_price'])
      ?? firstPrice(pricing, ['input_per_million', 'prompt_per_million']);
    const outputPerMillion = firstPrice(record, ['output_price_per_million', 'completion_price_per_million', 'output_price'])
      ?? firstPrice(pricing, ['output_per_million', 'completion_per_million']);
    const inputPerToken = firstPrice(record, ['input_cost_per_token', 'prompt_cost_per_token'])
      ?? firstPrice(pricing, ['prompt', 'input']);
    const outputPerToken = firstPrice(record, ['output_cost_per_token', 'completion_cost_per_token'])
      ?? firstPrice(pricing, ['completion', 'output']);
    models.set(id, {
      id,
      inputPricePerMillion: inputPerMillion ?? (inputPerToken == null ? null : inputPerToken * 1_000_000),
      outputPricePerMillion: outputPerMillion ?? (outputPerToken == null ? null : outputPerToken * 1_000_000),
      requestPrice: firstPrice(record, ['request_price', 'price_per_request'])
        ?? firstPrice(pricing, ['request']),
    });
  }
  return [...models.values()];
}

export function mergeNewApiPricing(models: UpstreamModel[], payload: unknown) {
  if (!payload || typeof payload !== 'object') return models;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return models;
  const prices = new Map<string, Pick<UpstreamModel, 'inputPricePerMillion' | 'outputPricePerMillion' | 'requestPrice'>>();
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const id = typeof record.model_name === 'string' ? record.model_name.trim() : '';
    if (!id) continue;
    const quotaType = Number(record.quota_type);
    if (quotaType === 1) {
      const requestPrice = nonNegativeNumber(record.model_price);
      if (requestPrice != null) prices.set(id, { inputPricePerMillion: null, outputPricePerMillion: null, requestPrice });
      continue;
    }
    const ratio = nonNegativeNumber(record.model_ratio);
    if (ratio == null) continue;
    const completionRatio = nonNegativeNumber(record.completion_ratio) ?? 1;
    const inputPricePerMillion = ratio * 2;
    prices.set(id, {
      inputPricePerMillion,
      outputPricePerMillion: inputPricePerMillion * completionRatio,
      requestPrice: null,
    });
  }
  return models.map((model) => ({ ...model, ...(prices.get(model.id) || {}) }));
}

export function upstreamBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export function parseUpstreamModelIds(payload: unknown) {
  return parseUpstreamModels(payload).map((model) => model.id);
}

export function upstreamV1Url(baseUrl: string, endpoint: string) {
  const normalizedBase = upstreamBaseUrl(baseUrl);
  const normalizedEndpoint = endpoint.replace(/^\/+/, '');
  return `${normalizedBase}/v1/${normalizedEndpoint}`;
}

export function upstreamError(payload: unknown) {
  if (!payload || typeof payload !== 'object') return '';
  const error = (payload as { error?: unknown }).error;
  if (typeof error === 'string') return error.slice(0, 300);
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string') return message.slice(0, 300);
  }
  return '';
}
