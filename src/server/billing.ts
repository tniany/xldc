export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ModelPricing = {
  inputPricePerMillion: number | null;
  outputPricePerMillion: number | null;
  requestPrice: number | null;
};

export type BillingResult = {
  quotaCharge: number;
  fishCharged: number;
  costUsd: number | null;
  priced: boolean;
};

const BASE_TOKEN_PRICE_PER_MILLION = 2;

function nonNegative(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function calculateBilling(
  usage: TokenUsage,
  pricing: ModelPricing | null,
  quotaPerFish: number,
  fishPerUsd: number,
): BillingResult {
  const perFish = Math.max(1, Math.floor(nonNegative(quotaPerFish)) || 1);
  const exchangeRate = Math.max(0.000001, nonNegative(fishPerUsd) || 10);
  const totalTokens = Math.ceil(nonNegative(usage.totalTokens));

  let costUsd: number | null = null;
  if (pricing?.requestPrice != null) {
    costUsd = nonNegative(pricing.requestPrice);
  } else if (pricing && (pricing.inputPricePerMillion != null || pricing.outputPricePerMillion != null)) {
    const inputPrice = pricing.inputPricePerMillion == null
      ? BASE_TOKEN_PRICE_PER_MILLION
      : nonNegative(pricing.inputPricePerMillion);
    const outputPrice = pricing.outputPricePerMillion == null
      ? BASE_TOKEN_PRICE_PER_MILLION
      : nonNegative(pricing.outputPricePerMillion);
    const inputTokens = Math.ceil(nonNegative(usage.inputTokens));
    const outputTokens = Math.ceil(nonNegative(usage.outputTokens));
    costUsd = (inputTokens * inputPrice + outputTokens * outputPrice) / 1_000_000;
  }

  if (costUsd == null) {
    return {
      quotaCharge: totalTokens,
      fishCharged: totalTokens / perFish,
      costUsd: null,
      priced: false,
    };
  }

  const quotaCharge = Math.max(0, Math.ceil(costUsd * exchangeRate * perFish - 1e-9));
  return {
    quotaCharge,
    fishCharged: quotaCharge / perFish,
    costUsd,
    priced: true,
  };
}
