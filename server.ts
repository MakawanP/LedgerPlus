import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const INBOX_DIR = path.join(DATA_DIR, 'inbox');
const PROCESSED_INBOX_DIR = path.join(INBOX_DIR, 'processed');
const VAULT_FILE_PATH = path.join(DATA_DIR, 'local-ledger-vault.json');
const APPLE_PAY_QUEUE_PATH = path.join(DATA_DIR, 'apple-pay-queue.json');
const PREBUILT_WINDOWS_ZIP_PATH = path.join(
  __dirname,
  'release',
  'LedgerPulse-Windows-v1.0.2.zip'
);

const ZIP_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = ZIP_CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBuffer(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const crc = computeCrc32(entry.data);
    const deflated = zlib.deflateRawSync(entry.data, { level: 6 });
    const useDeflate = deflated.length < entry.data.length;
    const payload = useDeflate ? deflated : entry.data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    localParts.push(local, payload);
    centralParts.push(central);
    offset += local.length + payload.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function ensureLocalDataDirs() {
  fs.mkdirSync(PROCESSED_INBOX_DIR, { recursive: true });
}

interface QueuedApplePayAlert {
  id: string;
  receivedAt: string;
  rawNotification: string;
}

function readApplePayQueue(): QueuedApplePayAlert[] {
  try {
    ensureLocalDataDirs();
    if (!fs.existsSync(APPLE_PAY_QUEUE_PATH)) return [];
    const raw = fs.readFileSync(APPLE_PAY_QUEUE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeApplePayQueue(queue: QueuedApplePayAlert[]) {
  ensureLocalDataDirs();
  fs.writeFileSync(APPLE_PAY_QUEUE_PATH, JSON.stringify(queue, null, 2), 'utf-8');
}

const ALLOWED_CATEGORIES = [
  'Food & Restaurants',
  'Coffee & Drinks',
  'Groceries',
  'Shopping & Retail',
  'Transportation / Uber / Taxi',
  'Gas & Parking',
  'Bills & Utilities',
  'Rent & Housing',
  'Travel & Hotels',
  'Entertainment',
  'Health & Fitness',
  'Subscriptions',
  'Personal Care',
  'Shopping Online',
  'Education',
  'Other / Uncategorized',
];

function hasConfiguredGeminiApiKey(): boolean {
  const key = (process.env.GEMINI_API_KEY || '').trim();
  return (
    key.length > 10 &&
    key !== 'your_api_key_here' &&
    key !== 'MY_GEMINI_API_KEY' &&
    !key.startsWith('YOUR_')
  );
}

function getGeminiClient() {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    apiVersion: 'v1beta',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const FALLBACK_USD_RATES: Record<string, number> = {
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

let cachedFxRates: Record<string, number> = { ...FALLBACK_USD_RATES };
let cachedFxExpiresAt = 0;

async function getLiveUsdRates(): Promise<Record<string, number>> {
  const now = Date.now();
  if (now < cachedFxExpiresAt) {
    return cachedFxRates;
  }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data: any = await res.json();
      if (data?.rates && typeof data.rates === 'object') {
        cachedFxRates = { ...FALLBACK_USD_RATES, ...data.rates, USD: 1 };
        cachedFxExpiresAt = now + 1000 * 60 * 60 * 6;
      }
    }
  } catch {
    cachedFxExpiresAt = now + 1000 * 60 * 10;
  }
  return cachedFxRates;
}

function inferCategoryFromText(merchantAndBody: string): {
  category: string;
  uncertain: boolean;
} {
  const s = merchantAndBody.toLowerCase();
  if (
    /\b(wonder|mcdonald'?s|mcdonalds|mcdelivery|mcflurry|filet-o-fish|mcchicken|big\s*mac|burger\s*king|wendy'?s|taco\s*bell|kfc|chick-fil-a|popeyes|subway|domino'?s|pizza\s*hut|papa\s*john|five\s*guys|shake\s*shack|in-n-out|panda\s*express|wingstop|nando'?s|greggs|tim\s*hortons|dunkin|uber\s*eats|doordash|grubhub|deliveroo|just\s*eat|grabfood|foodpanda|line\s*man|sweetgreen|chipotle|panera|tartine|restaurant|diner|bistro|pizza|sushi|burger|grill|takeaway|drive-thru)\b/.test(
      s
    )
  ) {
    return { category: 'Food & Restaurants', uncertain: false };
  }
  if (/\b(starbucks|blue bottle|philz|peet|costa\s*coffee|pret|coffee|cafe|espresso|bakery|boba)\b/.test(s)) {
    return { category: 'Coffee & Drinks', uncertain: false };
  }
  if (/\b(whole foods|trader joe|safeway|kroger|costco|aldi|lidl|tesco|sainsbury|asda|waitrose|instacart|grocery|supermarket|market)\b/.test(s)) {
    return { category: 'Groceries', uncertain: false };
  }
  if (/\b(uber|lyft|waymo|bolt|taxi|cab|transit|bart|mta|caltrain|tfl)\b/.test(s)) {
    return { category: 'Transportation / Uber / Taxi', uncertain: false };
  }
  if (/\b(shell|chevron|texaco|arco|exxon|mobil|bp|esso|parking|parkmobile|fastrak|toll)\b/.test(s)) {
    return { category: 'Gas & Parking', uncertain: false };
  }
  if (/\b(netflix|spotify|hulu|disney|apple\.com\/bill|icloud|youtube|openai|chatgpt|claude|adobe|github|patreon|substack|nytimes|membership|subscription)\b/.test(s)) {
    return { category: 'Subscriptions', uncertain: false };
  }
  if (/\b(pg&e|comcast|xfinity|verizon|at&t|t-mobile|water|electric|utility|internet)\b/.test(s)) {
    return { category: 'Bills & Utilities', uncertain: false };
  }
  if (/\b(rent|apartment|hoa|mortgage|leasing)\b/.test(s)) {
    return { category: 'Rent & Housing', uncertain: false };
  }
  if (/\b(airbnb|marriott|hilton|hyatt|delta|united|american airlines|southwest|flight|hotel|expedia|booking\.com)\b/.test(s)) {
    return { category: 'Travel & Hotels', uncertain: false };
  }
  if (/\b(equinox|peloton|gym|fitness|cvs|walgreens|boots|pharmacy|dental|medical|clinic)\b/.test(s)) {
    return { category: 'Health & Fitness', uncertain: false };
  }
  if (/\b(amc|regal|ticketmaster|stubhub|steam|playstation|nintendo|xbox|cinema|concert)\b/.test(s)) {
    return { category: 'Entertainment', uncertain: false };
  }
  if (/\b(udemy|coursera|tuition|university|textbook|book)\b/.test(s)) {
    return { category: 'Education', uncertain: false };
  }
  if (/\b(sephora|ulta|barber|salon|spa)\b/.test(s)) {
    return { category: 'Personal Care', uncertain: false };
  }
  if (/\b(amazon|amzn|shopify|ebay|etsy|apple store|best buy)\b/.test(s)) {
    return { category: 'Shopping Online', uncertain: false };
  }
  if (/\b(target|walmart|nordstrom|uniqlo|nike|ikea)\b/.test(s)) {
    return { category: 'Shopping & Retail', uncertain: false };
  }
  return { category: 'Other / Uncategorized', uncertain: true };
}

const MONTH_NAME_TO_NUM: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function normalizeIsoDate(rawDate: string): string {
  const trimmed = rawDate.trim();
  const isoMatch = trimmed.match(/\b(20\d{2})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  // Match US MM/DD/YYYY dates inside multi-line receipts (e.g. "10/30/2026 03:08:29 PM" on McDonald's Mobile Order Receipts)
  const usSlashMatch = trimmed.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/);
  if (usSlashMatch) {
    const mm = usSlashMatch[1].padStart(2, '0');
    const dd = usSlashMatch[2].padStart(2, '0');
    return `${usSlashMatch[3]}-${mm}-${dd}`;
  }

  // Match RFC 2822 email Date headers in sender/local date ("Fri, 30 Oct 2026 ...") without UTC rollover
  const rfcDayFirst = trimmed.match(
    /\b(0?[1-9]|[12]\d|3[01])\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(20\d{2})\b/i
  );
  if (rfcDayFirst) {
    const dd = rfcDayFirst[1].padStart(2, '0');
    const mm = MONTH_NAME_TO_NUM[rfcDayFirst[2].slice(0, 3).toLowerCase()] || '11';
    return `${rfcDayFirst[3]}-${mm}-${dd}`;
  }

  // Match "Oct 30, 2026" / "October 30, 2026"
  const monthFirst = trimmed.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(0?[1-9]|[12]\d|3[01]),?\s+(20\d{2})\b/i
  );
  if (monthFirst) {
    const mm = MONTH_NAME_TO_NUM[monthFirst[1].slice(0, 3).toLowerCase()] || '11';
    const dd = monthFirst[2].padStart(2, '0');
    return `${monthFirst[3]}-${mm}-${dd}`;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '2026-11-17';
}

function cleanSenderMerchant(fromHeader: string, subjectHeader: string, bodyText = ''): string {
  const cleanSubj = subjectHeader.replace(/^(?:\s*(?:fwd?|re)\s*:\s*)+/i, '').trim();
  const isForwarded = /^(?:\s*(?:fwd?|re)\s*:)/i.test(subjectHeader) || /Forwarded message/i.test(bodyText);
  const innerFrom = isForwarded
    ? bodyText.match(/Forwarded message[\s\S]{0,260}?From:\s*([^\n]+)/i)?.[1]?.trim() || ''
    : '';
  const effectiveFrom = innerFrom || fromHeader;
  const combined = `${effectiveFrom} ${cleanSubj}`;
  const combinedWithBody = `${combined} ${bodyText.slice(0, 1200)}`;

  if (/mcdonald'?s|mcdelivery/i.test(combinedWithBody)) return "McDonald's";
  if (/\bpopeyes\b/i.test(combined)) return 'Popeyes';
  if (/\bsteam\b|steampowered/i.test(combined)) return 'Steam';
  if (/\bwonder\b/i.test(effectiveFrom) || /\byour wonder order\b/i.test(cleanSubj)) return 'Wonder';
  if (/\b(wise|transferwise)\b/i.test(effectiveFrom) || /\byou sent\b.*\bwise\b/i.test(combined)) return 'Wise';
  if (/\bgrab\s*food\b/i.test(combined)) return 'GrabFood';
  if (/\bfoodpanda\b/i.test(combined)) return 'Foodpanda';
  if (/\bline\s*man\b/i.test(combined)) return 'LINE MAN';
  if (/uber\s*eats/i.test(combined)) return 'Uber Eats';
  if (/doordash/i.test(combined)) return 'DoorDash';
  if (/grubhub/i.test(combined)) return 'Grubhub';
  if (/deliveroo/i.test(combined)) return 'Deliveroo';
  if (/just\s*eat/i.test(combined)) return 'Just Eat';

  if (!isForwarded || innerFrom) {
    const namePart = effectiveFrom.split('<')[0].replace(/["']/g, '').trim();
    const cleaned = namePart
      .replace(/\b(receipts?|orders?|billing|payments?|no-?reply|notifications?|auto-confirm|support|team)\b/gi, '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-·|]+|[\s\-·|]+$/g, '')
      .trim();
    if (cleaned.length >= 2) return cleaned.slice(0, 80);
  }

  const domainMatch = effectiveFrom.match(/@(?:[a-z0-9-]+\.)?([a-z0-9-]+)\.[a-z]{2,}/i);
  if (domainMatch && domainMatch[1] && !/^(gmail|yahoo|outlook|hotmail|icloud|rutgers|edu)$/i.test(domainMatch[1])) {
    const dom = domainMatch[1];
    if (/mcdonalds/i.test(dom)) return "McDonald's";
    if (/wise|transferwise/i.test(dom)) return 'Wise';
    return dom.charAt(0).toUpperCase() + dom.slice(1);
  }
  return (cleanSubj || 'Receipt Merchant').slice(0, 60);
}

function isNonTransactionEmail(fromLine: string, subjectLine: string, bodyText = ''): boolean {
  const sender = fromLine.toLowerCase();
  const subj = subjectLine.replace(/^(?:\s*(?:fwd?|re)\s*:\s*)+/i, '').trim();

  // 1. Job boards, recruiting platforms, & career alerts (Handshake, LinkedIn, Indeed, Glassdoor, etc.)
  if (
    /\b(handshake|joinhandshake|linkedin|indeed|glassdoor|ziprecruiter|wellfound|greenhouse\.io|lever\.co|myworkdayjobs|ashbyhq|wayup|ripplematch)\b/i.test(
      sender
    )
  ) {
    return true;
  }
  if (
    /(\bsees you as a top applicant\b|\btop applicant\b|\bjob alert\b|\bnew jobs?\b|\bhiring now\b|\bget paid \$\d+|\bapply now\b|\bcareer opportunity\b|\binvited you to apply\b)/i.test(
      `${subj} ${bodyText.slice(0, 400)}`
    )
  ) {
    return true;
  }

  // 2. Promotional coupons, % / $ off cart offers, grocery flyers, sweepstakes, challenges, & free-trial upsells
  if (
    /(\bget \$\d+(?:\.\d{1,2})?\s*off\b|\$\d+(?:\.\d{1,2})?\s*off\b|\b\d+%\s*off\b|\boff your (?:order|cart|next|purchase)\b|\bon us\b|\byou['’]?re eligible for\b|\beligible for \d+\s*(?:months?|days?|weeks?)\b|\bclaim your (?:free|offer|reward|discount)\b|\bunlock (?:your )?\d+%|\bjoin our challenge\b|\bspooky season\b|\bstarting at \$\d+|\$\d+(?:\.\d{2})?\s*\/?\s*lb\b|\bwant free\b|\benter to win\b|\bgiveaway\b|\bpromo code\b|\bflash sale\b|\bdeal alert\b|\bdon['’]?t miss out\b|\bwe miss you\b|\bcome back and save\b)/i.test(
      subj
    )
  ) {
    return true;
  }

  // 3. Post-order surveys, review requests, & feedback emails ("How was your order from Wonder?")
  if (
    /(\bhow was your\b|\brate your\b|\btell us what you think\b|\bleave a review\b|\bshare your feedback\b|\bquick survey\b|\bhow did we do\b)/i.test(
      subj
    )
  ) {
    return true;
  }

  return false;
}

function parseNumericMoney(raw: string, allowZero = false): number | null {
  const normalized = raw.trim().replace(/\s/g, '');
  const cleaned =
    /^\d{1,6},\d{2}$/.test(normalized)
      ? normalized.replace(',', '.')
      : normalized.replace(/,/g, '');
  const val = parseFloat(cleaned);
  if (!Number.isFinite(val) || val >= 50000000) return null;
  if (allowZero ? val >= 0 : val > 0) return val;
  return null;
}

function normalizeDetectedCurrency(token: string | undefined, fullText: string): string {
  const t = (token || '').trim();
  if (!t) {
    if (/฿|\b(THB|baht)\b|บาท/i.test(fullText) && !/\$|\bUSD\b/i.test(fullText)) return 'THB';
    if (/€|\bEUR\b/i.test(fullText) && !/\$|\bUSD\b/i.test(fullText)) return 'EUR';
    if (/£|\bGBP\b/i.test(fullText) && !/\$|\bUSD\b/i.test(fullText)) return 'GBP';
    return 'USD';
  }
  const upper = t.toUpperCase();
  if (t === '฿' || upper === 'THB' || upper === 'BAHT' || t === 'บาท') return 'THB';
  if (t === '€' || upper === 'EUR') return 'EUR';
  if (t === '£' || upper === 'GBP') return 'GBP';
  if (t === 'CA$' || upper === 'CAD') return 'CAD';
  if (t === 'A$' || upper === 'AUD') return 'AUD';
  if (t === 'S$' || upper === 'SGD') return 'SGD';
  if (t === '¥' || upper === 'JPY') return 'JPY';
  if (upper === 'MYR' || upper === 'RM') return 'MYR';
  if (t === '₫' || upper === 'VND') return 'VND';
  if (upper === 'IDR' || upper === 'RP') return 'IDR';
  if (t === '₩' || upper === 'KRW') return 'KRW';
  if (t === '₱' || upper === 'PHP') return 'PHP';
  return 'USD';
}

function extractConvertedUsdFromBlock(
  text: string,
  rates: Record<string, number>,
  options?: { strictReceiptTotalOnly?: boolean }
): { usdAmount: number; fxSuffix: string } | null {
  const strictOnly = Boolean(options?.strictReceiptTotalOnly);

  const savingsMatch = text.match(
    /\b(?:total\s+savings|you\s+saved|promo\s+savings)[ \t:.\-]*(?:\r?\n[ \t]*)?([$£€฿]?\s*\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/i
  );
  const savingsNote = savingsMatch?.[1]
    ? `Reward / Promo · Saved ${savingsMatch[1].trim()}`
    : 'Free / $0.00 Order';

  const convert = (rawVal: number, currency: string): { usdAmount: number; fxSuffix: string } => {
    if (rawVal === 0) {
      return { usdAmount: 0, fxSuffix: savingsNote };
    }
    const code = currency.toUpperCase();
    if (code === 'USD' || !rates[code] || rates[code] <= 0) {
      return { usdAmount: Math.round(rawVal * 100) / 100, fxSuffix: '' };
    }
    const rate = rates[code];
    const usd = Math.max(0.01, Math.round((rawVal / rate) * 100) / 100);
    return {
      usdAmount: usd,
      fxSuffix: `${rawVal.toLocaleString('en-US', { maximumFractionDigits: 2 })} ${code} (~$${usd.toFixed(2)} USD @ ${rate.toFixed(2)})`,
    };
  };

  // Strip "Total Savings" / "Base for Tax" / "Tax Amount" / "Tax Rate" (even across a table cell newline)
  // before scanning for Order Total so $0.00 reward orders never confuse Total Savings ($5.79) with Total ($0.00)
  const sanitizedForTotals = text.replace(
    /\b(?:total\s+savings|you\s+saved|promo\s+savings|tax\s+amount|base\s+for\s+tax|tax\s+rate)\b[ \t:.\-]*(?:\r?\n[ \t]*)?(?:[$£€฿]?\s*\d{1,7}(?:[.,]\d{3})*(?:\.\d{1,4})?%?)?/gi,
    ' '
  );

  // If Wise or multi-currency receipt explicitly states USD amount paid/debited alongside THB, prefer exact USD paid
  const explicitUsdPaid = sanitizedForTotals.match(
    /\b(?:you\s+paid|amount\s+(?:paid|debited|charged)|total\s+(?:paid|charged)|source\s+amount)[ \t]*[:\-]?[ \t]*(?:\r?\n[ \t]*)?(?:\$|USD\s*)?(\d{1,6}(?:,\d{3})*(?:\.\d{2}))\s*USD\b/i
  );
  if (explicitUsdPaid?.[1]) {
    const usdVal = parseNumericMoney(explicitUsdPaid[1], true);
    if (usdVal !== null) {
      const thbMatch = text.match(/(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(?:THB|฿|บาท)/i);
      return {
        usdAmount: Math.round(usdVal * 100) / 100,
        fxSuffix: thbMatch ? `${thbMatch[1]} THB` : usdVal === 0 ? savingsNote : '',
      };
    }
  }

  const hasReceiptContext =
    /\b(receipt|mobile\s+order|order\s*#|order\s+number|check-in\s*#|order\s+is\s+confirmed|order\s+confirmation|subtotal|invoice|payment\s+received|payment\s+confirmation|billing\s+statement|subscription\s+renewal|you\s+sent)\b|ใบเสร็จ|คำสั่งซื้อ|ยอดรวม/i.test(
      text
    );

  // Priority 1: Explicit Order Total / Total / You Sent (supports single table-cell newline & $0.00 reward/promo orders!)
  const totalPrefixPat =
    /(\b(?:order\s+total|grand\s+total|total\s+(?:charged|paid|amount|due|billed|including\s+tax)|amount\s+(?:paid|charged|billed)|payment\s+(?:total|amount)|you\s+(?:paid|sent))|(?<!sub)\btotal(?!\s+(?:savings|saved|discount|items|qty|points|rewards|value))\b|ยอดรวม|รวมทั้งสิ้น)[ \t]*[:\-]?[ \t]*(?:\r?\n[ \t]*)?(CA\$|A\$|S\$|[$£€฿¥₩₱₫]|\b(?:USD|THB|GBP|EUR|CAD|AUD|SGD|JPY|MYR|VND|IDR|KRW|PHP)\b)?[ \t]*(\d{1,7}(?:[.,]\d{3})*(?:[.,]\d{1,2})?)[ \t]*(\b(?:USD|THB|GBP|EUR|CAD|AUD|SGD|JPY|MYR|VND|IDR|KRW|PHP|baht)\b|฿|บาท)?/gi;

  const totalMatches = Array.from(sanitizedForTotals.matchAll(totalPrefixPat)).filter((m) => {
    const label = (m[1] || '').toLowerCase();
    const currPrefix = (m[2] || '').trim();
    const numStr = (m[3] || '').trim();
    const currSuffix = (m[4] || '').trim();
    const hasExplicitCurrencyOrCents =
      Boolean(currPrefix || currSuffix) || /[.,]\d{2}$/.test(numStr);
    if (!hasExplicitCurrencyOrCents) return false;
    // Bare "Total" in an email requires receipt/order context so random prose "total" never misfires
    if (strictOnly && label === 'total' && !hasReceiptContext) return false;
    return true;
  });

  if (totalMatches.length > 0) {
    const last = totalMatches[totalMatches.length - 1];
    const num = parseNumericMoney(last[3], hasReceiptContext);
    if (num !== null) {
      const curr = normalizeDetectedCurrency(last[2] || last[4], text);
      return convert(num, curr);
    }
  }

  // Priority 1B: Explicit card/payment charge phrasing ("was charged $15.99", "Receipt for $24.50", "Payment of $40.11")
  const explicitChargePat =
    /\b(?:was\s+charged|has\s+been\s+charged|you\s+were\s+charged|payment\s+of|receipt\s+for|charged\s+your\s+\w+)\s+(CA\$|A\$|S\$|[$£€฿¥₩₱₫])\s*(\d{1,7}(?:,\d{3})*\.\d{2})\b/gi;
  const chargeMatches = Array.from(sanitizedForTotals.matchAll(explicitChargePat));
  if (chargeMatches.length > 0) {
    const last = chargeMatches[chargeMatches.length - 1];
    const num = parseNumericMoney(last[2], false);
    if (num !== null) {
      const curr = normalizeDetectedCurrency(last[1], text);
      return convert(num, curr);
    }
  }

  // For Gmail messages, NEVER guess from arbitrary $ numbers (salaries, "$10 off", "$11.99/mo trial")!
  if (strictOnly) {
    return null;
  }

  // Priority 2 (Non-Gmail single-line alerts like Apple Pay notifications): Currency symbol/code attached to positive numbers
  const anyCurrPat =
    /(?:(CA\$|A\$|S\$|[$£€฿¥₩₱₫])\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)|(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?)\s*(THB|USD|GBP|EUR|CAD|AUD|SGD|JPY|MYR|VND|IDR|KRW|PHP|baht|฿|บาท)\b|\b(THB|USD|GBP|EUR|CAD|AUD|SGD|JPY|MYR)\s*(\d{1,7}(?:,\d{3})*(?:\.\d{1,2})?))/gi;

  const currMatches = Array.from(sanitizedForTotals.matchAll(anyCurrPat));
  if (currMatches.length > 0) {
    const last = currMatches[currMatches.length - 1];
    const rawNum = last[2] || last[3] || last[6] || '';
    const rawTok = last[1] || last[4] || last[5] || '';
    const num = parseNumericMoney(rawNum, false);
    if (num !== null) {
      const curr = normalizeDetectedCurrency(rawTok, text);
      return convert(num, curr);
    }
  }

  return null;
}

function enrichReceiptDescription(
  merchant: string,
  subjectLine: string,
  bodyBlock: string,
  fxSuffix: string
): string {
  const parts: string[] = [];
  const cleanSubj = subjectLine.replace(/^(?:\s*(?:fwd?|re)\s*:\s*)+/i, '').trim();

  if (merchant === "McDonald's") {
    const orderNum = bodyBlock.match(/\bOrder#\s*([A-Z0-9-]{2,14})\b/i)?.[1];
    const itemMatch = bodyBlock.match(
      /\b(Filet-O-Fish|Big\s*Mac|Quarter\s*Pounder|McChicken|McCrispy|McNuggets|McDouble|Double\s*Cheeseburger|Cheeseburger|McFlurry|Egg\s*McMuffin|Sausage\s*McMuffin|Hash\s*Browns|French\s*Fries|Happy\s*Meal)[^\n$]{0,25}/i
    )?.[0];
    parts.push('Mobile Order Receipt');
    if (orderNum) {
      parts.push(`Order #${orderNum}`);
    }
    if (itemMatch) {
      parts.push(itemMatch.replace(/\s+\d+P\b/i, '').replace(/\s+/g, ' ').trim());
    }
  } else {
    parts.push(cleanSubj || `Gmail Receipt · ${merchant}`);
  }

  if (fxSuffix) {
    parts.push(fxSuffix);
  }
  return parts.join(' · ').slice(0, 260);
}

function merchantsLikelySame(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.includes(nb.slice(0, 5)) || nb.includes(na.slice(0, 5));
}

function extractTransactionsDeterministically(
  rawText: string,
  defaultSource: string,
  existingTransactions: any[],
  rates: Record<string, number> = FALLBACK_USD_RATES
): { extractedTransactions: any[]; summaryNote: string } {
  const extracted: any[] = [];
  const safeExisting = Array.isArray(existingTransactions) ? existingTransactions : [];

  const findDuplicateId = (dateStr: string, amount: number, merchant: string, source: string): string => {
    const targetTime = new Date(dateStr).getTime();
    const match = safeExisting.find((tx: any) => {
      const txAmt = Math.abs(Number(tx?.amount) || 0);
      if (Math.abs(txAmt - amount) >= 0.02) return false;
      if (tx?.source === source && tx?.date !== dateStr) return false;
      if (!merchantsLikelySame(String(tx?.merchant || ''), merchant)) return false;
      const txTime = new Date(String(tx?.date || '')).getTime();
      if (Number.isNaN(targetTime) || Number.isNaN(txTime)) return tx?.date === dateStr;
      return Math.abs(targetTime - txTime) <= 2 * 86400 * 1000;
    });
    return match?.id ? String(match.id) : '';
  };

  if (rawText.includes('=== GMAIL MESSAGE')) {
    const blocks = rawText.split(/=== GMAIL MESSAGE \d+[^=]*===/i).filter((b) => b.trim());
    for (const block of blocks) {
      const fromLine = (block.match(/^From:\s*(.+)$/im)?.[1] || '').trim();
      const subjectLine = (block.match(/^Subject:\s*(.+)$/im)?.[1] || '').trim();
      const dateLine = (block.match(/^Date:\s*(.+)$/im)?.[1] || '').trim();

      if (isNonTransactionEmail(fromLine, subjectLine, block)) {
        continue;
      }

      const money = extractConvertedUsdFromBlock(block, rates, {
        strictReceiptTotalOnly: true,
      });
      if (!money) continue;

      const merchant = cleanSenderMerchant(fromLine, subjectLine, block);
      // Prefer explicit receipt date inside mobile order body (e.g. "10/30/2026 03:08:29 PM") or inner forwarded Date header, else outer email Date header
      const bodyReceiptDate =
        block.match(/\b(0?[1-9]|1[0-2])\/(0?[1-9]|[12]\d|3[01])\/(20\d{2})\b/)?.[0] ||
        block.match(/Forwarded message[\s\S]{0,260}?Date:\s*([^\n]+)/i)?.[1]?.trim();
      const date = normalizeIsoDate(bodyReceiptDate || dateLine);
      // Avoid matching "Refund Policy" or "request a refund" footers on normal purchase receipts (e.g. Steam)
      const isRefund =
        /\b(refund|refunded|credit issued)\b/i.test(subjectLine) ||
        /\b(refund\s+(?:issued|processed|confirmation|receipt|total|amount)|has\s+been\s+refunded|your\s+refund\s+of)\b/i.test(
          block
        );
      const isSelfTopUp =
        /\b(added\s+money\s+to\s+your\s+.*account|topped\s+up\s+your\s+balance|credit\s+card\s+autopay)\b/i.test(
          `${subjectLine} ${block}`
        );
      const { category, uncertain } = inferCategoryFromText(`${merchant} ${subjectLine} ${block}`);
      const matchedExistingId = findDuplicateId(date, money.usdAmount, merchant, 'Gmail');
      const rawDescription = enrichReceiptDescription(merchant, subjectLine, block, money.fxSuffix);

      extracted.push({
        date,
        merchant,
        rawDescription,
        amount: money.usdAmount,
        paymentMethod:
          merchant === 'Wise'
            ? 'Wise'
            : money.usdAmount === 0
            ? 'Rewards / Promo ($0.00)'
            : 'Gmail Digital Receipt',
        category,
        status: isRefund ? 'refunded' : 'posted',
        transactionType: isRefund ? 'refund' : isSelfTopUp ? 'transfer' : 'purchase',
        source: 'Gmail',
        matchedExistingId,
        uncertainCategory: isSelfTopUp ? false : uncertain,
        uncertaintyPrompt: uncertain
          ? `Confirm spending category for "${merchant}" ($${money.usdAmount.toFixed(2)} USD${money.fxSuffix ? ` · ${money.fxSuffix}` : ''})`
          : '',
        suggestedCategories: uncertain
          ? merchant === 'Wise'
            ? ['Rent & Housing', 'Bills & Utilities', 'Food & Restaurants']
            : ['Food & Restaurants', 'Shopping Online', 'Subscriptions']
          : [],
      });
    }

    return {
      extractedTransactions: extracted,
      summaryNote:
        extracted.length > 0
          ? `Extracted ${extracted.length} verified receipt/order transaction(s) from Gmail.`
          : 'Scanned Gmail messages: no completed order receipts or payment charges found (filtered out promos, surveys, and non-receipt alerts).',
    };
  }

  // Multi-line pasted receipt check (e.g., pasted McDonald's mobile order, Wise receipt, or THB receipt)
  const hasExplicitReceiptTotal =
    /\b(order\s+total|grand\s+total|total\s+charged|amount\s+paid|subtotal|you\s+sent)\b|ยอดรวม|รวมทั้งสิ้น/i.test(
      rawText
    );
  if (hasExplicitReceiptTotal) {
    const money = extractConvertedUsdFromBlock(rawText, rates);
    if (money) {
      const date = normalizeIsoDate(rawText);
      const firstNonEmptyLine =
        rawText
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.length >= 2 && !/^\d/.test(l)) || 'Receipt Merchant';
      const merchant = cleanSenderMerchant('', `${firstNonEmptyLine} ${rawText.slice(0, 120)}`);
      const { category, uncertain } = inferCategoryFromText(rawText);
      const source = defaultSource || 'Uploaded Statement';
      return {
        extractedTransactions: [
          {
            date,
            merchant,
            rawDescription: money.fxSuffix
              ? `${firstNonEmptyLine.slice(0, 110)} · ${money.fxSuffix}`
              : firstNonEmptyLine.slice(0, 180),
            amount: money.usdAmount,
            paymentMethod: merchant === 'Wise' ? 'Wise' : 'Card / Receipt',
            category,
            status: 'posted',
            transactionType: /\brefund\b/i.test(rawText) ? 'refund' : 'purchase',
            source,
            matchedExistingId: findDuplicateId(date, money.usdAmount, merchant, source),
            uncertainCategory: uncertain,
            uncertaintyPrompt: uncertain ? `Confirm category for "${merchant}"` : '',
            suggestedCategories: uncertain ? ['Food & Restaurants', 'Bills & Utilities', 'Shopping & Retail'] : [],
          },
        ],
        summaryNote: `Extracted receipt total ($${money.usdAmount.toFixed(2)} USD) for ${merchant}.`,
      };
    }
  }

  // Fallback line/alert parser for Apple Pay alerts, .eml files, and pasted statements
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const money = extractConvertedUsdFromBlock(line, rates);
    if (!money) continue;
    const date = normalizeIsoDate(line);
    const atMerchant =
      line.match(/\bat\s+([A-Za-z0-9 *&'.\-/]{2,45}?)(?:\s*\(|\s*—|\s*-|$)/i)?.[1]?.trim() ||
      cleanSenderMerchant('', line.slice(0, 45));
    const { category, uncertain } = inferCategoryFromText(line);
    const source = /apple pay/i.test(line) ? 'Apple Pay' : defaultSource || 'Uploaded Statement';
    extracted.push({
      date,
      merchant: atMerchant,
      rawDescription: money.fxSuffix ? `${line.slice(0, 120)} · ${money.fxSuffix}` : line.slice(0, 180),
      amount: money.usdAmount,
      paymentMethod: source === 'Apple Pay' ? 'Apple Pay' : 'Card / Statement',
      category,
      status: 'posted',
      transactionType: /\brefund\b/i.test(line) ? 'refund' : 'purchase',
      source,
      matchedExistingId: findDuplicateId(date, money.usdAmount, atMerchant, source),
      uncertainCategory: uncertain,
      uncertaintyPrompt: uncertain ? `Confirm category for "${atMerchant}"` : '',
      suggestedCategories: uncertain ? ['Shopping & Retail', 'Food & Restaurants'] : [],
    });
  }

  return {
    extractedTransactions: extracted,
    summaryNote:
      extracted.length > 0
        ? `Extracted ${extracted.length} transaction(s) via built-in local parser.`
        : 'No completed transaction totals detected in the provided text.',
  };
}

interface CachedLogoEntry {
  status: 200 | 404;
  buffer?: Buffer;
  contentType?: string;
  expiresAt: number;
}

const merchantLogoCache = new Map<string, CachedLogoEntry>();
const LOGO_HIT_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours
const LOGO_MISS_TTL_MS = 1000 * 60 * 15; // 15 minutes

function sanitizeDomainInput(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z]{2,15})+$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

async function fetchBrandIconFromProviders(
  domain: string
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const candidateUrls = [
    `https://t2.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(
      `https://${domain}`
    )}&size=128`,
    `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`,
  ];

  for (const url of candidateUrls) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (compatible; LedgerPulseLogoFetcher/1.0)',
        },
        signal: AbortSignal.timeout(2800),
      });

      if (!response.ok) {
        continue;
      }

      const contentType = response.headers.get('content-type') || 'image/png';
      if (!contentType.startsWith('image/') && !contentType.includes('icon')) {
        continue;
      }

      const arrayBuf = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (buffer.byteLength < 64) {
        continue;
      }

      return { buffer, contentType };
    } catch {
      // Try next icon provider in cascade
    }
  }

  return null;
}

async function startServer() {
  ensureLocalDataDirs();
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '30mb' }));

  // Allow Google Sign-In / Gmail OAuth popups to communicate cleanly back to Edge/Chrome --app windows on Windows
  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });

  // Local Windows Disk Vault: Read saved vault from PC disk (data/local-ledger-vault.json)
  app.get('/api/local-vault', (_req, res) => {
    try {
      ensureLocalDataDirs();
      if (!fs.existsSync(VAULT_FILE_PATH)) {
        return res.json({
          exists: false,
          vaultFilePath: VAULT_FILE_PATH,
          inboxDirPath: INBOX_DIR,
        });
      }
      const stats = fs.statSync(VAULT_FILE_PATH);
      const raw = fs.readFileSync(VAULT_FILE_PATH, 'utf-8');
      const vault = JSON.parse(raw);
      return res.json({
        exists: true,
        vault,
        vaultFilePath: VAULT_FILE_PATH,
        inboxDirPath: INBOX_DIR,
        fileSizeBytes: stats.size,
        updatedAt: stats.mtime.toISOString(),
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || 'Failed to read local Windows vault file.',
      });
    }
  });

  // Local Windows Disk Vault: Persist full vault state directly to PC disk
  app.post('/api/local-vault', (req, res) => {
    try {
      ensureLocalDataDirs();
      const payload = {
        ...req.body,
        savedAt: new Date().toISOString(),
      };
      const serialized = JSON.stringify(payload, null, 2);
      fs.writeFileSync(VAULT_FILE_PATH, serialized, 'utf-8');
      const stats = fs.statSync(VAULT_FILE_PATH);
      return res.json({
        saved: true,
        vaultFilePath: VAULT_FILE_PATH,
        inboxDirPath: INBOX_DIR,
        fileSizeBytes: stats.size,
        updatedAt: stats.mtime.toISOString(),
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || 'Failed to save local Windows vault file.',
      });
    }
  });

  // Apple Pay & Card Notification Webhook Receiver
  app.post('/api/apple-pay/webhook', (req, res) => {
    try {
      const body = req.body || {};
      let rawNotification = '';
      if (typeof body.rawNotification === 'string' && body.rawNotification.trim()) {
        rawNotification = body.rawNotification.trim();
      } else if (body.merchant || body.amount) {
        const dateStr = body.date || '2026-11-17';
        const cardStr = body.card || 'Apple Pay';
        rawNotification = `Apple Pay Alert [${dateStr}]: $${Number(body.amount || 0).toFixed(2)} at ${
          body.merchant || 'Unknown Merchant'
        } via ${cardStr}${body.note ? ` — ${body.note}` : ''}`;
      } else {
        return res.status(400).json({
          error: 'Provide either rawNotification or { merchant, amount, card, date }.',
        });
      }

      const queue = readApplePayQueue();
      const entry: QueuedApplePayAlert = {
        id: `ap-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        receivedAt: new Date().toISOString(),
        rawNotification,
      };
      queue.push(entry);
      writeApplePayQueue(queue);

      return res.json({
        queued: true,
        entry,
        pendingQueueCount: queue.length,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || 'Failed to enqueue Apple Pay notification.',
      });
    }
  });

  // Status check for pending Apple Pay alerts & local watched inbox files
  app.get('/api/auto-pull/status', (_req, res) => {
    try {
      ensureLocalDataDirs();
      const queue = readApplePayQueue();
      const inboxFiles = fs
        .readdirSync(INBOX_DIR, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith('.'))
        .map((d) => d.name);

      return res.json({
        pendingApplePayAlerts: queue.length,
        pendingInboxFiles: inboxFiles.length,
        inboxFileNames: inboxFiles,
        vaultFilePath: VAULT_FILE_PATH,
        inboxDirPath: INBOX_DIR,
      });
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || 'Failed to read auto-pull queue status.',
      });
    }
  });

  // Unified Automated Pull: Drains Apple Pay webhook queue + local data/inbox/ files & parses via Gemini
  app.post('/api/auto-pull/sync', async (req, res) => {
    try {
      ensureLocalDataDirs();
      const { existingTransactions = [] } = req.body || {};
      const queue = readApplePayQueue();
      const inboxEntries = fs
        .readdirSync(INBOX_DIR, { withFileTypes: true })
        .filter((d) => d.isFile() && !d.name.startsWith('.'));

      if (queue.length === 0 && inboxEntries.length === 0) {
        return res.json({
          pulledCount: 0,
          extractedTransactions: [],
          summaryNote: 'No pending Apple Pay notifications or local inbox files waiting.',
          sourcesProcessed: 0,
        });
      }

      const textBlocks: string[] = [];
      const inlineMediaParts: Array<{ inlineData: { mimeType: string; data: string } }> = [];
      const processedFilesToMove: string[] = [];

      if (queue.length > 0) {
        textBlocks.push(
          `=== QUEUED APPLE PAY & CARD NOTIFICATIONS (${queue.length}) ===\n` +
            queue.map((q, idx) => `[Alert ${idx + 1}] ${q.rawNotification}`).join('\n')
        );
      }

      for (const fileEntry of inboxEntries) {
        const fullPath = path.join(INBOX_DIR, fileEntry.name);
        const ext = path.extname(fileEntry.name).toLowerCase();
        if (['.eml', '.txt', '.csv', '.json', '.md', '.html'].includes(ext)) {
          const text = fs.readFileSync(fullPath, 'utf-8').slice(0, 18000);
          textBlocks.push(`=== LOCAL INBOX FILE: ${fileEntry.name} ===\n${text}`);
          processedFilesToMove.push(fileEntry.name);
        } else if (['.pdf', '.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          const buf = fs.readFileSync(fullPath);
          const mimeType =
            ext === '.pdf'
              ? 'application/pdf'
              : ext === '.png'
              ? 'image/png'
              : ext === '.webp'
              ? 'image/webp'
              : 'image/jpeg';
          inlineMediaParts.push({
            inlineData: {
              mimeType,
              data: buf.toString('base64'),
            },
          });
          textBlocks.push(`=== ATTACHED LOCAL INBOX RECEIPT/DOCUMENT: ${fileEntry.name} ===`);
          processedFilesToMove.push(fileEntry.name);
        }
      }

      const fxRates = await getLiveUsdRates();

      if (!hasConfiguredGeminiApiKey() && inlineMediaParts.length === 0) {
        const localParsed = extractTransactionsDeterministically(
          textBlocks.join('\n\n'),
          'Apple Pay',
          existingTransactions,
          fxRates
        );
        if (queue.length > 0) writeApplePayQueue([]);
        for (const fileName of processedFilesToMove) {
          const src = path.join(INBOX_DIR, fileName);
          const dest = path.join(PROCESSED_INBOX_DIR, `${Date.now()}-${fileName}`);
          if (fs.existsSync(src)) fs.renameSync(src, dest);
        }
        return res.json({
          pulledCount: localParsed.extractedTransactions.length,
          extractedTransactions: localParsed.extractedTransactions,
          summaryNote: localParsed.summaryNote,
          sourcesProcessed: queue.length + processedFilesToMove.length,
        });
      }

      const ai = getGeminiClient();
      const existingCompact = (Array.isArray(existingTransactions) ? existingTransactions : [])
        .slice(0, 50)
        .map((t: any) => ({
          id: t.id,
          date: t.date,
          merchant: t.merchant,
          amount: t.amount,
          source: t.source,
          status: t.status,
        }));

      const prompt = `You are LedgerPulse's Automated Local Ingestion Engine.
Extract every actual transaction, refund, income, or transfer from the queued Apple Pay notifications and local inbox receipt files below.

STRICT RULES:
1. Never invent missing transactions. Include $0.00 free/reward/points-redeemed mobile order receipts (e.g. McDonald's Mobile Order Receipt with Total $0.00 and Total Savings $5.79 — record amount = 0, NEVER Total Savings, and note the item & savings in rawDescription). Convert ALL non-USD amounts (especially Thai Baht THB / ฿, EUR, GBP, SGD, JPY) into USD using either the exact USD amount shown on the receipt OR live FX rates (1 USD = ${fxRates.THB} THB, ${fxRates.EUR} EUR, ${fxRates.GBP} GBP, ${fxRates.SGD} SGD, ${fxRates.JPY} JPY), and note the original currency amount in rawDescription. Parse US MM/DD/YYYY dates (e.g. 10/30/2026 -> 2026-10-30) accurately; default year 2026 if missing (today is 2026-11-17).
2. Classify each item into one of these exact categories:
${ALLOWED_CATEGORIES.map((c) => `- ${c}`).join('\n')}
3. External Wise transfers/payments to another person, landlord, or merchant MUST be marked transactionType = "purchase" (counts as spending). Reserve "transfer" strictly for transfers between the user's OWN accounts (credit card autopay, own checking to own savings, topping up own Wise balance).
4. Set source to "Apple Pay" for Apple Pay notifications, "Gmail" for .eml email receipts, or "Uploaded Statement" for CSV/PDF files.
5. Deduplicate against existing ledger records ONLY when clearly the same merchant and amount across different sources:
Existing transactions JSON:
${JSON.stringify(existingCompact)}
6. If a merchant descriptor or external Wise recipient category is ambiguous, set uncertainCategory to true, write a short uncertaintyPrompt, and list 2-3 suggestedCategories.

Input Feeds:
${textBlocks.join('\n\n')}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: {
          parts: [...inlineMediaParts, { text: prompt }],
        },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              extractedTransactions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING },
                    merchant: { type: Type.STRING },
                    rawDescription: { type: Type.STRING },
                    amount: { type: Type.NUMBER },
                    paymentMethod: { type: Type.STRING },
                    category: { type: Type.STRING },
                    status: { type: Type.STRING },
                    transactionType: { type: Type.STRING },
                    source: { type: Type.STRING },
                    matchedExistingId: { type: Type.STRING },
                    uncertainCategory: { type: Type.BOOLEAN },
                    uncertaintyPrompt: { type: Type.STRING },
                    suggestedCategories: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: [
                    'date',
                    'merchant',
                    'amount',
                    'paymentMethod',
                    'category',
                    'status',
                    'transactionType',
                    'source',
                    'uncertainCategory',
                  ],
                },
              },
              summaryNote: { type: Type.STRING },
            },
            required: ['extractedTransactions', 'summaryNote'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());

      // Clear processed Apple Pay alerts & archive processed local inbox files
      if (queue.length > 0) {
        writeApplePayQueue([]);
      }
      for (const fileName of processedFilesToMove) {
        const src = path.join(INBOX_DIR, fileName);
        const dest = path.join(PROCESSED_INBOX_DIR, `${Date.now()}-${fileName}`);
        if (fs.existsSync(src)) {
          fs.renameSync(src, dest);
        }
      }

      return res.json({
        pulledCount: (parsed.extractedTransactions || []).length,
        extractedTransactions: parsed.extractedTransactions || [],
        summaryNote: parsed.summaryNote || 'Automated pull completed.',
        sourcesProcessed: queue.length + processedFilesToMove.length,
      });
    } catch (error: any) {
      console.error('Error in /api/auto-pull/sync:', error);
      return res.status(500).json({
        error: error?.message || 'Failed to process automated pull.',
      });
    }
  });

  // Endpoint 0: Automated Merchant Favicon / Company Logo Fetcher with In-Memory Cache
  app.get('/api/merchant-logo', async (req, res) => {
    const domain = sanitizeDomainInput(req.query.domain);
    if (!domain) {
      return res.status(404).end();
    }

    const now = Date.now();
    const cached = merchantLogoCache.get(domain);
    if (cached && cached.expiresAt > now) {
      if (cached.status === 200 && cached.buffer && cached.contentType) {
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(cached.buffer);
      }
      res.setHeader('Cache-Control', 'public, max-age=900');
      return res.status(404).end();
    }

    const fetched = await fetchBrandIconFromProviders(domain);
    if (merchantLogoCache.size > 400) {
      const oldestKey = merchantLogoCache.keys().next().value;
      if (oldestKey) merchantLogoCache.delete(oldestKey);
    }

    if (fetched) {
      merchantLogoCache.set(domain, {
        status: 200,
        buffer: fetched.buffer,
        contentType: fetched.contentType,
        expiresAt: now + LOGO_HIT_TTL_MS,
      });
      res.setHeader('Content-Type', fetched.contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(fetched.buffer);
    }

    merchantLogoCache.set(domain, {
      status: 404,
      expiresAt: now + LOGO_MISS_TTL_MS,
    });
    res.setHeader('Cache-Control', 'public, max-age=900');
    return res.status(404).end();
  });

  // Live USD FX Rates Endpoint (used for client-side THB->USD and multi-currency conversion)
  app.get('/api/fx-rates', async (_req, res) => {
    const rates = await getLiveUsdRates();
    return res.json({ base: 'USD', rates });
  });

  // Audio Transcription Endpoint using gemini-3.5-transcribe
  app.post('/api/audio/transcribe', async (req, res) => {
    try {
      const { base64Audio, mimeType } = req.body || {};

      if (typeof base64Audio !== 'string' || base64Audio.trim().length === 0) {
        return res.status(400).json({
          error: 'No audio data received. Please record or upload a non-empty audio clip.',
        });
      }

      if (!hasConfiguredGeminiApiKey()) {
        return res.status(400).json({
          error:
            'Gemini API key is not configured. Please check your API key in the Settings > Secrets panel.',
        });
      }

      // Strip data URL prefix if present and normalize MIME type for cross-browser MediaRecorder (Chrome webm, iOS Safari mp4)
      const cleanBase64 = base64Audio.includes(',')
        ? base64Audio.split(',')[1].trim()
        : base64Audio.trim();

      const rawMime = typeof mimeType === 'string' && mimeType.trim() ? mimeType : 'audio/webm';
      let baseMime = rawMime.split(';')[0].trim().toLowerCase();
      if (baseMime === 'audio/x-m4a' || baseMime === 'audio/m4a' || baseMime === 'audio/mp4a-latm') {
        baseMime = 'audio/mp4';
      } else if (baseMime === 'audio/x-wav') {
        baseMime = 'audio/wav';
      } else if (!baseMime.startsWith('audio/')) {
        baseMime = 'audio/webm';
      }

      const ai = getGeminiClient();
      const audioPart = {
        inlineData: {
          mimeType: baseMime,
          data: cleanBase64,
        },
      };

      const response = await ai.models.generateContent({
        model: 'gemini-3.5-transcribe',
        contents: {
          parts: [
            audioPart,
            {
              text: 'Transcribe this audio accurately into text. Preserve exact numbers, decimals, currency symbols or codes (such as $, THB, Baht, EUR, GBP, JPY), dates, and merchant or person names. Return only the spoken words without commentary.',
            },
          ],
        },
      });

      const transcript = (response.text ?? '').trim();
      return res.json({
        transcript,
        mimeType: baseMime,
      });
    } catch (error: any) {
      console.error('Error in /api/audio/transcribe:', error);
      const status = Number(error?.status || error?.code) || 500;
      const rawMessage = String(error?.message || 'Failed to transcribe audio recording.');

      if (
        status === 400 &&
        /API_KEY_INVALID|API key not valid/i.test(rawMessage)
      ) {
        return res.status(400).json({
          error:
            'Invalid Gemini API key. Please check or select a valid API key in the Settings > Secrets panel.',
        });
      }
      if (status === 403 || /PERMISSION_DENIED/i.test(rawMessage)) {
        return res.status(403).json({
          error:
            'Permission denied by Gemini API. Please verify your API key in the Settings > Secrets panel.',
        });
      }
      if (status === 429 || /RESOURCE_EXHAUSTED/i.test(rawMessage)) {
        return res.status(429).json({
          error:
            'Transcription rate limit reached. Upgrading to a billing-enabled API key in Settings > Secrets increases quota.',
        });
      }

      return res.status(status >= 400 && status < 600 ? status : 500).json({
        error: rawMessage,
      });
    }
  });

  // Endpoint 1: Parse raw financial records & OCR receipt images / PDFs
  app.post('/api/finance/parse-source', async (req, res) => {
    const fxRates = await getLiveUsdRates();
    try {
      const {
        rawText = '',
        attachments = [],
        sourceType,
        existingTransactions = [],
      } = req.body;

      const hasText = typeof rawText === 'string' && rawText.trim().length > 0;
      const validAttachments = Array.isArray(attachments)
        ? attachments.filter(
            (a: any) =>
              a &&
              typeof a.mimeType === 'string' &&
              typeof a.base64Data === 'string' &&
              a.base64Data.length > 0
          )
        : [];

      if (!hasText && validAttachments.length === 0) {
        return res.status(400).json({
          error: 'Please provide receipt images, PDF documents, or text to parse.',
        });
      }

      if (!hasConfiguredGeminiApiKey() && validAttachments.length === 0) {
        const localParsed = extractTransactionsDeterministically(
          rawText,
          sourceType || 'Gmail',
          existingTransactions,
          fxRates
        );
        return res.json({
          ocrTranscribedText: '',
          extractedTransactions: localParsed.extractedTransactions,
          summaryNote: localParsed.summaryNote,
        });
      }

      const ai = getGeminiClient();

      const existingCompact = existingTransactions.slice(0, 45).map((t: any) => ({
        id: t.id,
        date: t.date,
        merchant: t.merchant,
        amount: t.amount,
        source: t.source,
        status: t.status,
      }));

      const attachmentNames = validAttachments
        .map((a: any) => a.fileName || a.mimeType)
        .join(', ');

      const prompt = `You are a Personal AI Financial Tracking Assistant with high-accuracy optical character recognition (OCR) and multi-currency conversion for receipts, emails, Wise transfers, and PDF statements.
${
  validAttachments.length > 0
    ? `Perform full OCR on the ${validAttachments.length} attached receipt image(s)/PDF document(s) (${attachmentNames}) and extract every actual transaction, refund, income, or account transfer.`
    : `Extract every actual transaction, refund, income, or account transfer from the following ${sourceType || 'financial'} text.`
}

STRICT RULES:
1. Never invent missing transactions. Extract ONLY real completed purchases, mobile/fast-food orders (including McDonald's Mobile Order Receipts, Wonder orders, GrabFood, Foodpanda, Uber Eats, DoorDash, Thai/English receipts), external Wise money transfers, refunds, income, or self-transfers.
   - STRICTLY EXCLUDE job/recruiting alerts (e.g., Handshake, LinkedIn, Indeed, "sees you as a top applicant", "Get paid $100 a week"), promotional coupons/discounts ("Get $10 off your order", "15% off your cart"), post-order surveys ("How was your order"), challenges, and free-trial offers ("You're eligible for 4 months free"). NEVER extract salary rates, discount amounts, or future post-trial prices as transactions!
2. $0.00 REWARDS / PROMO / POINTS ORDERS (CRITICAL FOR MCDONALD'S):
   - DO NOT skip $0.00 mobile order receipts! When a receipt is a completed reward/points/promo redemption (for example, a McDonald's Mobile Order Receipt for "Filet-O-Fish 1P" where Subtotal = $0.00, Total = $0.00, and Total Savings = $5.79), you MUST extract it with "amount": 0, "transactionType": "purchase", "paymentMethod": "Rewards / Promo ($0.00)", and include the item, order number, and savings in "rawDescription" (e.g., "Mobile Order #LS27 · Filet-O-Fish (Rewards / Promo · Saved $5.79)").
   - NEVER use "Total Savings" or "You Saved" as the transaction "amount"—always use the actual "Total" paid out of pocket ($0.00 if free).
3. FOREIGN CURRENCY TO USD CONVERSION (CRITICAL): The ledger's base currency is USD ($). Whenever a transaction or receipt is in Thai Baht (THB / ฿ / บาท) or any other non-USD currency (EUR, GBP, SGD, JPY, MYR, VND, IDR, AUD, CAD, etc.):
   - If the receipt/Wise email explicitly states the exact USD amount debited/paid alongside THB, use that exact USD amount for "amount".
   - Otherwise, convert the foreign Order Total / Grand Total into USD using these live exchange rates: 1 USD = ${fxRates.THB} THB, ${fxRates.EUR} EUR, ${fxRates.GBP} GBP, ${fxRates.SGD} SGD, ${fxRates.JPY} JPY, ${fxRates.MYR} MYR, ${fxRates.VND} VND, ${fxRates.IDR} IDR, ${fxRates.AUD} AUD, ${fxRates.CAD} CAD.
   - Always include the original foreign amount and currency in "rawDescription" (for example: "McDonald's Order · 289.00 THB (~$8.38 USD)" or "Wise External Transfer · 5,000.00 THB").
   - Always use the final Order Total / Grand Total (not Subtotal or Total Savings). Convert US MM/DD/YYYY dates (such as "10/30/2026" -> "2026-10-30") into YYYY-MM-DD format; if a date is missing the year, assume 2026 (current date is 2026-11-17).
4. Classify spending into one of these exact categories (e.g., McDonald's, GrabFood, restaurants -> "Food & Restaurants"):
${ALLOWED_CATEGORIES.map((c) => `- ${c}`).join('\n')}
5. EXTERNAL TRANSFERS vs. INTERNAL SELF-TRANSFERS (CRITICAL FOR WISE):
   - Mark transactionType as "transfer" ONLY when moving money between the user's OWN accounts (such as paying off the user's own credit card bill, moving money from own checking to own savings, or topping up the user's own Wise balance).
   - External transfers via Wise (e.g., "You sent ... THB to ...", paying another person, landlord, utility, or business via Wise) are EXTERNAL SPENDING — you MUST set transactionType to "purchase" so they count in spending! If the category of an external Wise payment is unclear, set uncertainCategory to true and suggest 2-3 likely categories (e.g., ["Rent & Housing", "Bills & Utilities", "Food & Restaurants"]).
6. Set status to "posted", "pending", or "refunded".
7. Check against existing transactions to avoid counting the exact same purchase twice across DIFFERENT sources:
Existing transactions JSON:
${JSON.stringify(existingCompact)}
Only set matchedExistingId if it is clearly the SAME merchant AND same USD amount on the same/adjacent date from another source.
8. If a merchant description is ambiguous and cannot be confidently categorized, set uncertainCategory to true and provide a short question in uncertaintyPrompt asking the user how to categorize it, along with 2-3 suggestedCategories.
9. If receipt images or PDFs were provided, populate ocrTranscribedText with a concise, accurate transcription of the key merchant header, line items, total (with original currency and USD equivalent, or $0.00 + savings), date, and payment method read via OCR.

${
  hasText
    ? `Additional text / notes provided:
"""
${rawText}
"""`
    : ''
}`;

      const contentParts: any[] = [
        ...validAttachments.map((att: any) => ({
          inlineData: {
            mimeType: att.mimeType,
            data: att.base64Data,
          },
        })),
        { text: prompt },
      ];

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts: contentParts },
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ocrTranscribedText: {
                type: Type.STRING,
                description:
                  'Concise OCR transcription of merchant, date, line items, and total read from attached image/PDF receipts (empty string if text-only).',
              },
              extractedTransactions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING, description: 'YYYY-MM-DD format (e.g. 2026-10-30 for 10/30/2026)' },
                    merchant: { type: Type.STRING, description: 'Clean merchant or recipient name' },
                    rawDescription: {
                      type: Type.STRING,
                      description: 'Original raw descriptor including items, reward savings if $0.00, or original foreign currency (e.g. THB) when converted to USD',
                    },
                    amount: { type: Type.NUMBER, description: 'Non-negative exact numeric USD dollar amount paid (>= 0; use 0 for $0.00 free/reward/points-redeemed orders, never Total Savings)' },
                    paymentMethod: {
                      type: Type.STRING,
                      description: 'e.g., Wise, Apple Pay, Credit Card, Cash (Physical Currency)',
                    },
                    category: {
                      type: Type.STRING,
                      description: 'Must be one of the 16 allowed spending categories',
                    },
                    status: { type: Type.STRING, description: 'posted, pending, or refunded' },
                    transactionType: {
                      type: Type.STRING,
                      description: 'purchase (includes external Wise sends), refund, income, or transfer (strictly between own accounts)',
                    },
                    source: {
                      type: Type.STRING,
                      description:
                        'Gmail, Apple Pay, Bank Statement, Uploaded Statement, or Cash / Manual',
                    },
                    matchedExistingId: {
                      type: Type.STRING,
                      description:
                        'ID of matching existing transaction if duplicate across sources, else empty string',
                    },
                    uncertainCategory: {
                      type: Type.BOOLEAN,
                      description: 'True if category is ambiguous and needs user confirmation',
                    },
                    uncertaintyPrompt: {
                      type: Type.STRING,
                      description: 'Question asking user to confirm category if uncertain',
                    },
                    suggestedCategories: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: [
                    'date',
                    'merchant',
                    'amount',
                    'paymentMethod',
                    'category',
                    'status',
                    'transactionType',
                    'source',
                    'uncertainCategory',
                  ],
                },
              },
              summaryNote: {
                type: Type.STRING,
                description:
                  'Concise 1-2 sentence summary of what was extracted, noting any THB/foreign currency conversions to USD.',
              },
            },
            required: ['extractedTransactions', 'summaryNote'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      if (Array.isArray(parsed.extractedTransactions)) {
        parsed.extractedTransactions = parsed.extractedTransactions.filter(
          (item: any) =>
            !isNonTransactionEmail(
              String(item?.merchant || ''),
              String(item?.rawDescription || ''),
              ''
            )
        );
      }
      return res.json(parsed);
    } catch (error: any) {
      console.error('Error in /api/finance/parse-source:', error);
      const { rawText = '', sourceType = 'Gmail', existingTransactions = [] } = req.body || {};
      if (typeof rawText === 'string' && rawText.trim().length > 0) {
        const fallbackParsed = extractTransactionsDeterministically(
          rawText,
          sourceType,
          existingTransactions,
          fxRates
        );
        return res.json({
          ocrTranscribedText: '',
          extractedTransactions: fallbackParsed.extractedTransactions,
          summaryNote: fallbackParsed.summaryNote,
        });
      }
      return res.status(500).json({
        error: error?.message || 'Failed to parse financial source or receipt OCR.',
      });
    }
  });

  // Endpoint 2: Deep AI Spending Insights & Audit on current ledger
  app.post('/api/finance/audit-insights', async (req, res) => {
    try {
      const { summaryMetrics, categoryBreakdown, subscriptions, recentTransactions, userQuestion } = req.body;

      if (!hasConfiguredGeminiApiKey()) {
        const totalSpent = Number(summaryMetrics?.totalSpent || 0);
        const topCat = Array.isArray(categoryBreakdown) && categoryBreakdown[0]
          ? `${categoryBreakdown[0].category} ($${Number(categoryBreakdown[0].amount || 0).toFixed(2)})`
          : 'None yet';
        const activeSubTotal = Array.isArray(subscriptions)
          ? subscriptions
              .filter((s: any) => s?.active !== false)
              .reduce((acc: number, s: any) => acc + Number(s?.monthlyEquivalent || s?.amount || 0), 0)
          : 0;
        return res.json({
          executiveHeadline: `Verified monthly spend is $${totalSpent.toFixed(2)}, led by ${topCat}.`,
          directAnswer: userQuestion
            ? `Based on your local ledger for "${userQuestion}": total verified monthly spend is $${totalSpent.toFixed(2)}, top category is ${topCat}, and active recurring subscriptions total $${activeSubTotal.toFixed(2)}/mo.`
            : `Your verified ledger totals $${totalSpent.toFixed(2)} this month across ${(recentTransactions || []).length} recent records, with $${activeSubTotal.toFixed(2)}/mo in active subscriptions.`,
          findings: [
            {
              type: 'Top Category',
              title: `Primary Spend Driver: ${topCat}`,
              detail: 'Calculated directly from verified non-transfer purchase transactions in your ledger.',
              estimatedMonthlyImpact: Number(categoryBreakdown?.[0]?.amount || 0),
              severity: 'info',
            },
            {
              type: 'Savings Opportunity',
              title: `Active Subscriptions: $${activeSubTotal.toFixed(2)}/mo`,
              detail: 'Review recurring bills in Transactions & Subscriptions to redirect unused services into Savings Goals.',
              estimatedMonthlyImpact: activeSubTotal,
              severity: activeSubTotal > 100 ? 'medium' : 'info',
            },
          ],
        });
      }

      const ai = getGeminiClient();

      const prompt = `You are a Personal AI Financial Tracking Assistant analyzing the user's actual ledger data.
Never invent missing transactions. Use exact dollar figures from the provided dataset.

Current Monthly Summary:
${JSON.stringify(summaryMetrics, null, 2)}

Category Breakdown:
${JSON.stringify(categoryBreakdown, null, 2)}

Recurring Subscriptions:
${JSON.stringify(subscriptions, null, 2)}

Recent Transactions Sample:
${JSON.stringify((recentTransactions || []).slice(0, 35), null, 2)}

${userQuestion ? `User specific question: "${userQuestion}"` : 'Provide a comprehensive audit covering top spending categories, unusual or unnecessary purchases, increasing spending patterns, duplicate/suspicious charge alerts, forgotten subscriptions, and concrete monthly savings opportunities.'}`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveHeadline: {
                type: Type.STRING,
                description: 'Direct, data-backed 1-sentence headline with exact figures.',
              },
              directAnswer: {
                type: Type.STRING,
                description: 'Detailed, factual analysis answering the audit or user question with exact merchant names and dollar amounts.',
              },
              findings: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: {
                      type: Type.STRING,
                      description: 'Top Category | Unusual Purchase | Increasing Pattern | Duplicate Alert | Forgotten Subscription | Savings Opportunity',
                    },
                    title: { type: Type.STRING },
                    detail: { type: Type.STRING },
                    estimatedMonthlyImpact: { type: Type.NUMBER },
                    severity: { type: Type.STRING, description: 'high, medium, or info' },
                  },
                  required: ['type', 'title', 'detail', 'estimatedMonthlyImpact', 'severity'],
                },
              },
            },
            required: ['executiveHeadline', 'directAnswer', 'findings'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      return res.json(parsed);
    } catch (error: any) {
      console.error('Error in /api/finance/audit-insights:', error);
      return res.status(500).json({
        error: error?.message || 'Failed to generate AI financial insights.',
      });
    }
  });

  // Downloadable Windows 10/11 Desktop Release Package (.zip)
  app.get('/api/release/windows.zip', (_req, res) => {
    try {
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="LedgerPulse-Windows-v1.0.2.zip"'
      );

      if (fs.existsSync(PREBUILT_WINDOWS_ZIP_PATH)) {
        return res.sendFile(PREBUILT_WINDOWS_ZIP_PATH);
      }

      // Fallback on-demand Windows launcher bundle if prebuilt release/ zip is absent
      const filesToInclude: Array<{ src: string; zipName: string; crlf?: boolean }> = [
        { src: path.join(__dirname, 'windows', 'Install-Windows-App.bat'), zipName: 'LedgerPulse-Windows/Install-Windows-App.bat', crlf: true },
        { src: path.join(__dirname, 'windows', 'LedgerPulse.vbs'), zipName: 'LedgerPulse-Windows/LedgerPulse.vbs', crlf: true },
        { src: path.join(__dirname, 'windows', 'Stop-LedgerPulse-Server.bat'), zipName: 'LedgerPulse-Windows/Stop-LedgerPulse-Server.bat', crlf: true },
        { src: path.join(__dirname, 'start-windows-app.bat'), zipName: 'LedgerPulse-Windows/Start-LedgerPulse.bat', crlf: true },
        { src: path.join(__dirname, 'public', 'ledgerpulse.ico'), zipName: 'LedgerPulse-Windows/ledgerpulse.ico' },
        { src: path.join(__dirname, '.env.example'), zipName: 'LedgerPulse-Windows/.env.example', crlf: true },
      ];

      const zipEntries: Array<{ name: string; data: Buffer }> = [];
      for (const item of filesToInclude) {
        if (fs.existsSync(item.src)) {
          const raw = fs.readFileSync(item.src);
          const data = item.crlf
            ? Buffer.from(raw.toString('utf-8').replace(/\r?\n/g, '\r\n'), 'utf-8')
            : raw;
          zipEntries.push({ name: item.zipName, data });
        }
      }

      zipEntries.push({
        name: 'LedgerPulse-Windows/WINDOWS-QUICKSTART.txt',
        data: Buffer.from(
          [
            'LedgerPulse for Windows 10 / 11',
            'Repository: https://github.com/MakawanP/LedgerPulse',
            '',
            '1. Extract this ZIP folder anywhere on your Windows PC.',
            '2. For the full standalone build (with embedded node.exe), download from:',
            '   https://github.com/MakawanP/LedgerPulse/releases',
            '   or run "npm run release:windows" from the cloned repository.',
            '3. Double-click Install-Windows-App.bat to add Desktop & Start Menu shortcuts.',
          ].join('\r\n'),
          'utf-8'
        ),
      });

      return res.send(buildZipBuffer(zipEntries));
    } catch (error: any) {
      return res.status(500).json({
        error: error?.message || 'Failed to serve Windows release package.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(vitePkg);
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        hmr: false,
        ws: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LedgerPulse server running on http://localhost:${PORT}`);
  });
}

startServer();
