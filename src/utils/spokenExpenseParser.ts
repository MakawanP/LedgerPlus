import {
  SpendingCategory,
  TransactionType,
} from '../types/finance';
import {
  SupportedCurrencyCode,
  convertToUsd,
  getCachedUsdRates,
} from './currencyConverter';

export interface SpokenTransactionDraft {
  transcript: string;
  merchant: string;
  amountInOriginalCurrency: number | null;
  currencyCode: SupportedCurrencyCode;
  usdAmount: number | null;
  rateUsed: number;
  category: SpendingCategory;
  paymentMethod: string;
  transactionType: TransactionType;
  date: string;
  memo: string;
  splitFriendName?: string;
  splitFriendAmount?: number;
}

export async function transcribeAudioBlob(
  audioBlob: Blob,
  explicitMimeType?: string
): Promise<string> {
  const base64Audio = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      const commaIdx = result.indexOf(',');
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read recorded audio data.'));
    reader.readAsDataURL(audioBlob);
  });

  const mimeType = (explicitMimeType || audioBlob.type || 'audio/webm').split(';')[0].trim();

  const response = await fetch('/api/audio/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      base64Audio,
      mimeType,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Voice transcription failed.');
  }

  return String(data.transcript || '').trim();
}

function detectSpokenCurrency(text: string): SupportedCurrencyCode {
  const s = text.trim();
  if (!s) return 'USD';
  if (s.includes('฿') || s.includes('บาท') || /\b(thb|thai\s*baht|baht)\b/i.test(s)) {
    return 'THB';
  }
  if (s.includes('€') || /\b(eur|euros?)\b/i.test(s)) return 'EUR';
  if (s.includes('£') || /\b(gbp|british\s*pounds?|pounds?\s*sterling)\b/i.test(s)) return 'GBP';
  if (/\b(sgd|singapore\s*dollars?)\b/i.test(s)) return 'SGD';
  if (s.includes('¥') || /\b(jpy|japanese\s*yen|yen)\b/i.test(s)) return 'JPY';
  if (/\b(myr|ringgit)\b/i.test(s)) return 'MYR';
  if (s.includes('₫') || /\b(vnd|dong)\b/i.test(s)) return 'VND';
  if (/\b(idr|rupiah)\b/i.test(s)) return 'IDR';
  if (/\b(aud|australian\s*dollars?)\b/i.test(s)) return 'AUD';
  if (/\b(cad|canadian\s*dollars?)\b/i.test(s)) return 'CAD';
  if (s.includes('₩') || /\b(krw|korean\s*won)\b/i.test(s)) return 'KRW';
  if (s.includes('₱') || /\b(php|pesos?)\b/i.test(s)) return 'PHP';
  if (/\b(hkd|hong\s*kong\s*dollars?)\b/i.test(s)) return 'HKD';
  if (s.includes('₹') || /\b(inr|rupees?)\b/i.test(s)) return 'INR';
  return 'USD';
}

function inferSpokenCategory(text: string): SpendingCategory {
  const s = text.toLowerCase();
  if (
    /\b(starbucks|blue\s*bottle|philz|peet'?s|dunkin|costa|coffee|latte|espresso|cappuccino|matcha|boba|bubble\s*tea|cafe|tea)\b/.test(
      s
    )
  ) {
    return 'Coffee & Drinks';
  }
  if (
    /\b(mcdonald'?s|mcdonalds|wonder|chipotle|sweetgreen|shake\s*shack|burger\s*king|wendy'?s|taco\s*bell|kfc|chick-fil-a|subway|domino'?s|pizza|sushi|ramen|thai\s*food|dinner|lunch|breakfast|brunch|meal|food|restaurant|uber\s*eats|doordash|grubhub|grabfood|foodpanda)\b/.test(
      s
    )
  ) {
    return 'Food & Restaurants';
  }
  if (
    /\b(whole\s*foods|trader\s*joe'?s|costco|safeway|kroger|target\s*grocery|aldi|walmart\s*grocery|groceries|grocery|supermarket|produce|7-eleven|seven\s*eleven)\b/.test(
      s
    )
  ) {
    return 'Groceries';
  }
  if (
    /\b(uber|lyft|waymo|grab\s*car|bolt|taxi|cab|subway\s*fare|mta|bart|train|bus|flight\s*taxi|ride|commute)\b/.test(
      s
    )
  ) {
    return 'Transportation / Uber / Taxi';
  }
  if (/\b(shell|chevron|exxon|mobil|bp|arco|gas\s*station|fuel|gasoline|parking|toll)\b/.test(s)) {
    return 'Gas & Parking';
  }
  if (
    /\b(rent|apartment|landlord|lease|mortgage|hoa|condo)\b/.test(s)
  ) {
    return 'Rent & Housing';
  }
  if (
    /\b(electric|electricity|water\s*bill|internet|wifi|comcast|xfinity|verizon|at&t|t-mobile|phone\s*bill|utility|utilities)\b/.test(
      s
    )
  ) {
    return 'Bills & Utilities';
  }
  if (
    /\b(netflix|spotify|icloud|apple\s*music|youtube\s*premium|chatgpt|claude|openai|adobe|disney|hulu|prime\s*membership|subscription)\b/.test(
      s
    )
  ) {
    return 'Subscriptions';
  }
  if (/\b(hotel|airbnb|marriott|hilton|hyatt|delta|united|airlines|flight|airfare|travel)\b/.test(s)) {
    return 'Travel & Hotels';
  }
  if (/\b(gym|equinox|planet\s*fitness|pharmacy|cvs|walgreens|doctor|dentist|hospital|medicine|workout|fitness|health)\b/.test(s)) {
    return 'Health & Fitness';
  }
  if (/\b(movie|cinema|amc|concert|tickets|spotify\s*live|steam|playstation|nintendo|game|entertainment)\b/.test(s)) {
    return 'Entertainment';
  }
  if (/\b(tuition|textbook|course|udemy|coursera|university|college|school|education)\b/.test(s)) {
    return 'Education';
  }
  if (/\b(haircut|barber|salon|spa|skincare|sephora|ulta|personal\s*care)\b/.test(s)) {
    return 'Personal Care';
  }
  if (/\b(amazon|ebay|shopee|lazada|etsy|online\s*order)\b/.test(s)) {
    return 'Shopping Online';
  }
  if (/\b(target|walmart|uniqlo|nike|apple\s*store|ikea|mall|clothes|shoes|shopping)\b/.test(s)) {
    return 'Shopping & Retail';
  }
  return 'Other / Uncategorized';
}

function inferSpokenDate(text: string): string {
  const s = text.toLowerCase();
  if (/\byesterday\b/.test(s)) {
    return '2026-11-16';
  }
  const isoMatch = text.match(/\b(202\d-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];

  const slashMatch = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(202\d|\d{2}))?\b/);
  if (slashMatch) {
    const m = String(Number(slashMatch[1])).padStart(2, '0');
    const d = String(Number(slashMatch[2])).padStart(2, '0');
    const rawY = slashMatch[3];
    const y = rawY ? (rawY.length === 2 ? `20${rawY}` : rawY) : '2026';
    return `${y}-${m}-${d}`;
  }

  const monthNames: Record<string, string> = {
    jan: '01',
    january: '01',
    feb: '02',
    february: '02',
    mar: '03',
    march: '03',
    apr: '04',
    april: '04',
    may: '05',
    jun: '06',
    june: '06',
    jul: '07',
    july: '07',
    aug: '08',
    august: '08',
    sep: '09',
    sept: '09',
    september: '09',
    oct: '10',
    october: '10',
    nov: '11',
    november: '11',
    dec: '12',
    december: '12',
  };

  const namedMatch = s.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(202\d))?\b/
  );
  if (namedMatch) {
    const mm = monthNames[namedMatch[1]] || '11';
    const dd = String(Number(namedMatch[2])).padStart(2, '0');
    const yy = namedMatch[3] || '2026';
    return `${yy}-${mm}-${dd}`;
  }

  return '2026-11-17';
}

function extractSpokenAmount(text: string): number | null {
  // Check explicit $0 / free reward mention if no non-zero currency amount is primary
  const currencyPrefixed = text.match(
    /(?:\$|฿|€|£|¥|₱|₩|₹)\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/
  );
  if (currencyPrefixed) {
    return parseFloat(currencyPrefixed[1].replace(/,/g, ''));
  }

  const currencySuffixed = text.match(
    /\b(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s*(?:dollars?|usd|bucks|cents|baht|thai\s*baht|thb|บาท|euros?|eur|pounds?|gbp|sgd|yen|jpy|ringgit|myr|pesos?|php)\b/i
  );
  if (currencySuffixed) {
    const val = parseFloat(currencySuffixed[1].replace(/,/g, ''));
    if (/\bcents\b/i.test(currencySuffixed[0]) && !/\bdollars?\b/i.test(currencySuffixed[0])) {
      return Math.round(val) / 100;
    }
    return val;
  }

  // Spoken "14 dollars and 50 cents"
  const dollarsAndCents = text.match(/\b(\d+)\s*dollars?\s*(?:and\s*)?(\d{1,2})\s*cents?\b/i);
  if (dollarsAndCents) {
    return Number(dollarsAndCents[1]) + Number(dollarsAndCents[2]) / 100;
  }

  // Action verb followed by number: "spent 14.50", "paid 25", "sent 3500", "for 12.99"
  const verbNumber = text.match(
    /\b(?:spent|paid|bought|cost|for|sent|received|earned|deposited|total(?:ed|ing)?|amount)\s+(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\b/i
  );
  if (verbNumber) {
    return parseFloat(verbNumber[1].replace(/,/g, ''));
  }

  // Any decimal number like 14.50
  const decimalMatch = text.match(/\b(\d+\.\d{1,2})\b/);
  if (decimalMatch) {
    return parseFloat(decimalMatch[1]);
  }

  if (/\b(free\s+order|zero\s+dollars|\$0(?:\.00)?)\b/i.test(text)) {
    return 0;
  }

  // Standalone number not part of a date
  const fallbackNum = text.match(/\b(\d{1,3}(?:,\d{3})+|\d{1,5})\b/);
  if (fallbackNum) {
    return parseFloat(fallbackNum[1].replace(/,/g, ''));
  }

  return null;
}

function toTitleCaseMerchant(raw: string): string {
  const cleaned = raw
    .replace(/^[.,;:\-\s]+|[.,;:\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((w) => {
      if (w.toUpperCase() === 'CVS' || w.toUpperCase() === 'AMC' || w.toUpperCase() === 'KFC') {
        return w.toUpperCase();
      }
      if (/^mcdonald'?s$/i.test(w)) return "McDonald's";
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function extractSpokenMerchant(text: string, transactionType: TransactionType): string {
  // Common patterns: "at Starbucks", "from McDonald's", "to Alex"
  const stopTail =
    '(?:\\s+(?:for|with|using|via|on|today|yesterday|this\\s+morning|last\\s+night|and\\s+split|split\\s+with|in\\s+cash)|[.,;]|$)';

  const atFromMatch = text.match(
    new RegExp(`\\b(?:at|from)\\s+([A-Za-z0-9'&.\\- ]{2,40}?)${stopTail}`, 'i')
  );
  if (atFromMatch?.[1]) {
    const candidate = atFromMatch[1]
      .replace(/\s+\$?\d+(?:[.,]\d+)?.*$/i, '')
      .trim();
    if (candidate && !/^(my|the|a|an)\b/i.test(candidate)) {
      return toTitleCaseMerchant(candidate);
    }
  }

  if (/\bwise\b/i.test(text)) {
    const sentTo = text.match(
      new RegExp(`\\bto\\s+([A-Za-z0-9'&.\\- ]{2,36}?)${stopTail}`, 'i')
    );
    if (sentTo?.[1]) {
      return `Wise · ${toTitleCaseMerchant(sentTo[1])}`;
    }
    return 'Wise Transfer';
  }

  if (transactionType === 'income') {
    const incomeFrom = text.match(
      new RegExp(`\\b(?:from|by)\\s+([A-Za-z0-9'&.\\- ]{2,40}?)${stopTail}`, 'i')
    );
    if (incomeFrom?.[1]) {
      return toTitleCaseMerchant(incomeFrom[1]);
    }
    if (/\b(salary|paycheck|payroll)\b/i.test(text)) return 'Payroll / Salary';
    if (/\b(freelance|consulting)\b/i.test(text)) return 'Consulting / Freelance';
  }

  // Fallback: leading noun phrase before amount, e.g. "Blue Bottle coffee 6.75" or "Chipotle $13.25"
  const leadingPhrase = text
    .replace(/^(?:i\s+)?(?:just\s+)?(?:spent|paid|bought|got|ordered|logged|record|add)\s+/i, '')
    .split(/\s+(?:\$?\d|for\s+\$?\d|with\s+|via\s+|on\s+)/i)[0]
    ?.trim();

  if (leadingPhrase && leadingPhrase.length >= 2 && leadingPhrase.length <= 40 && !/^\d/.test(leadingPhrase)) {
    return toTitleCaseMerchant(leadingPhrase);
  }

  return '';
}

export function parseSpokenTransactionDraft(
  transcript: string,
  ratesMap: Record<string, number> = getCachedUsdRates()
): SpokenTransactionDraft {
  const cleanTranscript = transcript.trim();
  const lower = cleanTranscript.toLowerCase();

  let transactionType: TransactionType = 'purchase';
  if (/\b(got\s+paid|received|earned|paycheck|salary|income|deposit(?:ed)?|bonus)\b/.test(lower)) {
    transactionType = 'income';
  } else if (/\b(refund(?:ed)?|money\s+back|reimburs(?:ed|ement))\b/.test(lower)) {
    transactionType = 'refund';
  } else if (
    /\b(transfer(?:red)?\s+(?:between|to\s+my\s+own|to\s+my\s+savings)|credit\s+card\s+autopay)\b/.test(
      lower
    )
  ) {
    transactionType = 'transfer';
  }

  const currencyCode = detectSpokenCurrency(cleanTranscript);
  const amountInOriginalCurrency = extractSpokenAmount(cleanTranscript);

  let usdAmount: number | null = null;
  let rateUsed = 1;
  if (amountInOriginalCurrency !== null) {
    if (amountInOriginalCurrency === 0) {
      usdAmount = 0;
      rateUsed = 1;
    } else {
      const converted = convertToUsd(
        amountInOriginalCurrency,
        currencyCode,
        undefined,
        ratesMap
      );
      usdAmount = converted.usdAmount;
      rateUsed = converted.rateUsed;
    }
  }

  let paymentMethod = 'Cash (Physical Currency)';
  if (/\bapple\s*pay\b/i.test(cleanTranscript)) {
    paymentMethod = 'Apple Pay';
  } else if (/\bwise\b/i.test(cleanTranscript)) {
    paymentMethod = 'Wise';
  } else if (/\b(credit\s*card|visa|mastercard|amex|chase|sapphire|capital\s*one)\b/i.test(cleanTranscript)) {
    paymentMethod = 'Credit Card';
  } else if (/\b(debit|checking|bank\s*account)\b/i.test(cleanTranscript)) {
    paymentMethod = transactionType === 'income' ? 'Direct Deposit / Checking' : 'Debit / Checking';
  } else if (amountInOriginalCurrency === 0) {
    paymentMethod = 'Rewards / Promo ($0.00)';
  } else if (transactionType === 'income') {
    paymentMethod = 'Direct Deposit / Checking';
  }

  const category =
    transactionType === 'income'
      ? 'Other / Uncategorized'
      : inferSpokenCategory(cleanTranscript);
  const date = inferSpokenDate(cleanTranscript);
  const merchant = extractSpokenMerchant(cleanTranscript, transactionType);

  // Check optional split bill mention: e.g. "split with Alex" or "Alex owes me 15"
  let splitFriendName: string | undefined;
  let splitFriendAmount: number | undefined;

  const splitWithMatch = cleanTranscript.match(
    /\bsplit(?:\s+50\/50|\s+evenly|\s+half)?\s+with\s+([A-Z][a-zA-Z]+|[a-zA-Z]{2,20})\b/i
  );
  const owesMeMatch = cleanTranscript.match(
    /\b([A-Z][a-zA-Z]+)\s+owes\s+me\s+\$?(\d+(?:\.\d{1,2})?)\b/i
  );

  if (owesMeMatch) {
    splitFriendName = toTitleCaseMerchant(owesMeMatch[1]);
    splitFriendAmount = parseFloat(owesMeMatch[2]);
  } else if (splitWithMatch) {
    splitFriendName = toTitleCaseMerchant(splitWithMatch[1]);
    if (usdAmount && usdAmount > 0) {
      splitFriendAmount = Math.round((usdAmount / 2) * 100) / 100;
    }
  }

  const fxPrefix =
    currencyCode !== 'USD' && amountInOriginalCurrency !== null
      ? `${amountInOriginalCurrency.toLocaleString('en-US', {
          maximumFractionDigits: 2,
        })} ${currencyCode} → $${(usdAmount ?? 0).toFixed(2)} USD · `
      : '';

  return {
    transcript: cleanTranscript,
    merchant,
    amountInOriginalCurrency,
    currencyCode,
    usdAmount,
    rateUsed,
    category,
    paymentMethod,
    transactionType,
    date,
    memo: `${fxPrefix}Voice: "${cleanTranscript}"`.slice(0, 180),
    splitFriendName,
    splitFriendAmount,
  };
}
