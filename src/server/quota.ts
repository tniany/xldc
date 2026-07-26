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
