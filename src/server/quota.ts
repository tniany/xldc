export function hongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function splitDailyQuotaCharge(tokens: number, dailyRemaining: number) {
  const daily = Math.min(Math.max(0, tokens), Math.max(0, dailyRemaining));
  return { daily, permanent: Math.max(0, tokens - daily) };
}

export function checkinFishRange(minValue: unknown, maxValue: unknown) {
  const min = Math.max(0, Math.floor(Number(minValue) || 0));
  const max = Math.max(min, Math.floor(Number(maxValue) || 0));
  return { min, max };
}

export function publicQuotaTotalForRemainingFish(usedQuota: unknown, remainingFish: unknown, quotaPerFish: unknown) {
  const used = Math.max(0, Math.floor(Number(usedQuota) || 0));
  const fish = Math.max(0, Math.floor(Number(remainingFish) || 0));
  const perFish = Math.max(1, Math.floor(Number(quotaPerFish) || 1));
  return used + fish * perFish;
}
