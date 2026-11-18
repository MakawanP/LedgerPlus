export type SupportedCurrencyCode =
  | 'USD'
  | 'THB'
  | 'EUR'
  | 'GBP'
  | 'JPY'
  | 'SGD'
  | 'MYR'
  | 'VND'
  | 'IDR'
  | 'KRW'
  | 'PHP'
  | 'AUD'
  | 'CAD'
  | 'CHF'
  | 'HKD'
  | 'TWD'
  | 'CNY'
  | 'INR';

// Units of foreign currency per 1 USD (updated live from /api/fx-rates when online)
export const FALLBACK_USD_RATES: Record<SupportedCurrencyCode, number> = {
  USD: 1,
  THB: 34.5,
  EUR: 0.92,
  GBP: 0.79,
  JPY: 152.5,
  SGD: 1.34,
  MYR: 4.45,
  VND: 25300,
  IDR: 15800,
  KRW: 1390,
  PHP: 58.2,
  AUD: 1.53,
  CAD: 1.39,
  CHF: 0.88,
  HKD: 7.78,
  TWD: 32.4,
  CNY: 7.23,
  INR: 84.4,
};

export const CURRENCY_OPTIONS: ReadonlyArray<{
  code: SupportedCurrencyCode;
  symbol: string;
  label: string;
}> = [
  { code: 'USD', symbol: '$', label: 'USD ($) — US Dollar' },
  { code: 'THB', symbol: '฿', label: 'THB (฿) — Thai Baht → USD' },
  { code: 'EUR', symbol: '€', label: 'EUR (€) — Euro → USD' },
  { code: 'GBP', symbol: '£', label: 'GBP (£) — British Pound → USD' },
  { code: 'SGD', symbol: 'S$', label: 'SGD (S$) — Singapore Dollar → USD' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥) — Japanese Yen → USD' },
  { code: 'MYR', symbol: 'RM', label: 'MYR (RM) — Malaysian Ringgit → USD' },
  { code: 'VND', symbol: '₫', label: 'VND (₫) — Vietnamese Dong → USD' },
  { code: 'IDR', symbol: 'Rp', label: 'IDR (Rp) — Indonesian Rupiah → USD' },
  { code: 'AUD', symbol: 'A$', label: 'AUD (A$) — Australian Dollar → USD' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD (CA$) — Canadian Dollar → USD' },
  { code: 'KRW', symbol: '₩', label: 'KRW (₩) — South Korean Won → USD' },
  { code: 'PHP', symbol: '₱', label: 'PHP (₱) — Philippine Peso → USD' },
  { code: 'HKD', symbol: 'HK$', label: 'HKD (HK$) — Hong Kong Dollar → USD' },
];

let cachedRates: Record<string, number> = { ...FALLBACK_USD_RATES };
let lastFetchedMs = 0;

export function getCachedUsdRates(): Record<string, number> {
  return cachedRates;
}

export async function fetchLiveUsdRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now - lastFetchedMs < 10 * 60 * 1000) {
    return cachedRates;
  }
  try {
    const res = await fetch('/api/fx-rates');
    if (res.ok) {
      const data = await res.json();
      if (data?.rates && typeof data.rates === 'object') {
        cachedRates = { ...FALLBACK_USD_RATES, ...data.rates, USD: 1 };
        lastFetchedMs = now;
      }
    }
  } catch {
    // Offline fallback uses FALLBACK_USD_RATES
  }
  return cachedRates;
}

export function detectCurrencyCode(rawText: string | undefined): SupportedCurrencyCode {
  if (!rawText) return 'USD';
  const s = rawText.trim();
  if (!s) return 'USD';
  const upper = s.toUpperCase();

  if (upper === 'THB' || s.includes('฿') || /\b(THB|BAHT)\b/i.test(s) || s.includes('บาท')) {
    return 'THB';
  }
  if (upper === 'EUR' || s.includes('€') || /\bEUR\b/.test(upper)) return 'EUR';
  if (upper === 'GBP' || s.includes('£') || /\bGBP\b/.test(upper)) return 'GBP';
  if (upper === 'SGD' || /\bSGD\b/.test(upper)) return 'SGD';
  if (upper === 'JPY' || /\bJPY\b/.test(upper)) return 'JPY';
  if (upper === 'MYR' || /\bMYR\b/.test(upper)) return 'MYR';
  if (upper === 'VND' || s.includes('₫') || /\bVND\b/.test(upper)) return 'VND';
  if (upper === 'IDR' || /\bIDR\b/.test(upper)) return 'IDR';
  if (upper === 'AUD' || /\bAUD\b/.test(upper)) return 'AUD';
  if (upper === 'CAD' || /\bCAD\b/.test(upper)) return 'CAD';
  if (upper === 'CHF' || /\bCHF\b/.test(upper)) return 'CHF';
  if (upper === 'KRW' || s.includes('₩') || /\bKRW\b/.test(upper)) return 'KRW';
  if (upper === 'PHP' || s.includes('₱') || /\bPHP\b/.test(upper)) return 'PHP';
  if (upper === 'HKD' || /\bHKD\b/.test(upper)) return 'HKD';
  if (upper === 'TWD' || /\bTWD\b/.test(upper)) return 'TWD';
  if (upper === 'CNY' || /\b(CNY|RMB)\b/.test(upper)) return 'CNY';
  if (upper === 'INR' || s.includes('₹') || /\bINR\b/.test(upper)) return 'INR';

  return 'USD';
}

export function convertToUsd(
  foreignAmount: number,
  currencyCode: string,
  customRatePerUsd?: number,
  ratesMap: Record<string, number> = cachedRates
): { usdAmount: number; rateUsed: number } {
  const code = currencyCode.trim().toUpperCase();
  if (!code || code === 'USD') {
    return {
      usdAmount: Math.round(Math.abs(foreignAmount) * 100) / 100,
      rateUsed: 1,
    };
  }
  const rate =
    customRatePerUsd && customRatePerUsd > 0
      ? customRatePerUsd
      : ratesMap[code] || FALLBACK_USD_RATES[code as SupportedCurrencyCode] || 1;
  const usd = Math.abs(foreignAmount) / rate;
  return {
    usdAmount: Math.max(0.01, Math.round(usd * 100) / 100),
    rateUsed: Math.round(rate * 10000) / 10000,
  };
}
