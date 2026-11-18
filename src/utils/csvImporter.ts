import {
  ALL_SPENDING_CATEGORIES,
  DataSource,
  SpendingCategory,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/finance';
import { convertToUsd, detectCurrencyCode } from './currencyConverter';

export type CsvSignConvention = 'auto' | 'negative_is_expense' | 'positive_is_expense';

export interface CsvColumnMapping {
  dateCol: number;
  merchantCol: number;
  rawDescCol: number; // -1 if none
  amountCol: number; // -1 if using separate debit/credit columns
  debitCol: number; // -1 if single amount column
  creditCol: number; // -1 if single amount column
  currencyCol?: number; // -1 if none (e.g. Wise / multi-currency CSVs)
  categoryCol: number; // -1 if none
  paymentMethodCol: number; // -1 if none
  typeCol: number; // -1 if none
  statusCol: number; // -1 if none
}

export interface ParsedCsvFileStructure {
  delimiter: ',' | ';' | '\t';
  hasHeaderRow: boolean;
  headers: string[];
  dataRows: string[][];
  suggestedMapping: CsvColumnMapping;
}

export interface PreviewCsvRow {
  rowIndex: number;
  included: boolean;
  date: string;
  merchant: string;
  rawDescription: string;
  amount: number;
  paymentMethod: string;
  category: SpendingCategory;
  status: TransactionStatus;
  transactionType: TransactionType;
  source: DataSource;
  matchedExistingId?: string;
  uncertainCategory: boolean;
}

function detectDelimiter(sampleText: string): ',' | ';' | '\t' {
  const firstLines = sampleText
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);

  if (firstLines.length === 0) return ',';

  const countOutsideQuotes = (line: string, char: string) => {
    let count = 0;
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (inQuotes && line[i + 1] === '"') {
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (c === char && !inQuotes) {
        count += 1;
      }
    }
    return count;
  };

  const candidates: Array<',' | ';' | '\t'> = [',', '\t', ';'];
  let best: ',' | ';' | '\t' = ',';
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = firstLines.map((l) => countOutsideQuotes(l, delim));
    const minCount = Math.min(...counts);
    const total = counts.reduce((a, b) => a + b, 0);
    const score = minCount > 0 ? total * 10 : total;
    if (score > bestScore) {
      bestScore = score;
      best = delim;
    }
  }

  return best;
}

export function parseRawCsvGrid(rawText: string, forcedDelimiter?: ',' | ';' | '\t'): {
  delimiter: ',' | ';' | '\t';
  rows: string[][];
} {
  const cleaned = rawText.replace(/^\uFEFF/, '');
  const delimiter = forcedDelimiter || detectDelimiter(cleaned);

  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];

    if (inQuotes) {
      if (ch === '"') {
        if (cleaned[i + 1] === '"') {
          currentField += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        currentField += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && cleaned[i + 1] === '\n') {
          i += 1;
        }
        currentRow.push(currentField.trim());
        currentField = '';
        if (currentRow.some((cell) => cell.length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
      } else {
        currentField += ch;
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell.length > 0)) {
      rows.push(currentRow);
    }
  }

  return { delimiter, rows };
}

function looksLikeDateValue(val: string): boolean {
  const s = val.trim();
  if (!s) return false;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(s)) return true;
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(s)) return true;
  if (/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4}$/.test(s)) return true;
  return false;
}

function looksLikeCurrencyValue(val: string): boolean {
  const s = val.trim();
  if (!s) return false;
  return /^[(+-]?\s*[$€£฿¥₩₱₫]?\s*\d{1,8}(?:,\d{3})*(?:\.\d{1,4})?\s*(?:THB|USD|EUR|GBP|SGD|JPY)?\)?$/i.test(s);
}

export function parseCurrencyCell(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const isAccountingNegative = /^\(.*\)$/.test(trimmed);
  const isTrailingMinus = trimmed.endsWith('-');
  const hasExplicitMinus = trimmed.startsWith('-') || isAccountingNegative || isTrailingMinus;

  const numericStr = trimmed.replace(/[^0-9.]/g, '');
  if (!numericStr) return null;
  const parsed = parseFloat(numericStr);
  if (!Number.isFinite(parsed)) return null;

  return hasExplicitMinus ? -Math.abs(parsed) : parsed;
}

export function normalizeCsvDate(raw: string | undefined): string {
  const s = (raw || '').trim();
  if (!s) return '2026-11-17';

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // MM/DD/YYYY or MM-DD-YY
  const usMatch = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (usMatch) {
    let [, p1, p2, yRaw] = usMatch;
    const year = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    let monthNum = parseInt(p1, 10);
    let dayNum = parseInt(p2, 10);
    // Handle DD/MM/YYYY if first token > 12 and second <= 12
    if (monthNum > 12 && dayNum <= 12) {
      const tmp = monthNum;
      monthNum = dayNum;
      dayNum = tmp;
    }
    if (monthNum >= 1 && monthNum <= 12 && dayNum >= 1 && dayNum <= 31) {
      return `${year}-${String(monthNum).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    }
  }

  const nativeParsed = new Date(s);
  if (!Number.isNaN(nativeParsed.getTime())) {
    return nativeParsed.toISOString().slice(0, 10);
  }

  return '2026-11-17';
}

export function inferSpendingCategory(
  rawCategory: string,
  merchantAndDesc: string
): { category: SpendingCategory; uncertain: boolean } {
  const cleanRawCat = rawCategory.trim();
  if (cleanRawCat) {
    const exactMatch = ALL_SPENDING_CATEGORIES.find(
      (c) => c.toLowerCase() === cleanRawCat.toLowerCase()
    );
    if (exactMatch) {
      return { category: exactMatch, uncertain: false };
    }
  }

  const combined = `${cleanRawCat} ${merchantAndDesc}`.toLowerCase();

  if (/\b(coffee|starbucks|blue bottle|philz|peet|cafe|espresso|tea|boba)\b/.test(combined)) {
    return { category: 'Coffee & Drinks', uncertain: false };
  }
  if (
    /\b(mcdonald'?s|mcdonalds|mcdelivery|mcflurry|burger\s*king|wendy'?s|taco\s*bell|kfc|chick-fil-a|popeyes|domino'?s|pizza\s*hut|five\s*guys|shake\s*shack|dunkin|tim\s*hortons|grabfood|foodpanda|line\s*man|deliveroo|just\s*eat|restaurant|dining|food\s*&\s*drink|doordash|uber\s*eats|grubhub|sweetgreen|chipotle|tartine|pizza|sushi|burger|bistro|bar|grill|bakery)\b/.test(
      combined
    )
  ) {
    return { category: 'Food & Restaurants', uncertain: false };
  }
  if (
    /\b(grocer|supermarket|whole foods|trader joe|safeway|kroger|costco|aldi|heb|publix|instacart|market)\b/.test(
      combined
    )
  ) {
    return { category: 'Groceries', uncertain: false };
  }
  if (/\b(uber|lyft|waymo|taxi|cab|transit|subway|bart|mta|caltrain|rideshare)\b/.test(combined)) {
    return { category: 'Transportation / Uber / Taxi', uncertain: false };
  }
  if (
    /\b(gas|fuel|shell|chevron|texaco|exxon|mobil|arco|parking|parkmobile|toll|fastrak|automotive)\b/.test(
      combined
    )
  ) {
    return { category: 'Gas & Parking', uncertain: false };
  }
  if (
    /\b(netflix|spotify|hulu|disney|icloud|apple\.com\/bill|youtube|openai|chatgpt|claude|adobe|github|patreon|substack|nytimes|subscription|software)\b/.test(
      combined
    )
  ) {
    return { category: 'Subscriptions', uncertain: false };
  }
  if (
    /\b(bill|utilit|pg&e|electric|water|comcast|xfinity|verizon|at&t|t-mobile|internet|phone|insurance)\b/.test(
      combined
    )
  ) {
    return { category: 'Bills & Utilities', uncertain: false };
  }
  if (/\b(rent|mortgage|housing|hoa|apartment|leasing)\b/.test(combined)) {
    return { category: 'Rent & Housing', uncertain: false };
  }
  if (
    /\b(travel|airline|flight|hotel|airbnb|marriott|hilton|hyatt|delta|united|southwest|expedia|booking)\b/.test(
      combined
    )
  ) {
    return { category: 'Travel & Hotels', uncertain: false };
  }
  if (
    /\b(health|fitness|gym|equinox|peloton|medical|dental|doctor|pharmacy|cvs|walgreens|wellness)\b/.test(
      combined
    )
  ) {
    return { category: 'Health & Fitness', uncertain: false };
  }
  if (
    /\b(entertainment|movie|cinema|amc|regal|concert|ticketmaster|stubhub|steam|playstation|nintendo|xbox)\b/.test(
      combined
    )
  ) {
    return { category: 'Entertainment', uncertain: false };
  }
  if (/\b(education|tuition|school|university|college|udemy|coursera|book)\b/.test(combined)) {
    return { category: 'Education', uncertain: false };
  }
  if (/\b(personal care|salon|barber|spa|sephora|ulta|cosmetic)\b/.test(combined)) {
    return { category: 'Personal Care', uncertain: false };
  }
  if (/\b(amazon|amzn|ebay|etsy|shopify|online|apple store|newegg)\b/.test(combined)) {
    return { category: 'Shopping Online', uncertain: false };
  }
  if (
    /\b(shopping|retail|merchandise|target|walmart|nordstrom|uniqlo|nike|ikea|home depot|lowes|best buy|department)\b/.test(
      combined
    )
  ) {
    return { category: 'Shopping & Retail', uncertain: false };
  }

  return { category: 'Other / Uncategorized', uncertain: true };
}

function cleanMerchantName(raw: string): string {
  const trimmed = raw
    .replace(/\s+/g, ' ')
    .replace(/^(POS DEBIT|ACH DEBIT|CARD PURCHASE|PURCHASE AUTHORIZED ON \d{2}\/\d{2}|SQ \*|TST\* ?|DD \*)/i, '')
    .trim();
  return (trimmed || 'CSV Merchant').slice(0, 120);
}

export function analyzeCsvStructure(rawText: string): ParsedCsvFileStructure {
  const { delimiter, rows } = parseRawCsvGrid(rawText);
  if (rows.length === 0) {
    return {
      delimiter,
      hasHeaderRow: true,
      headers: [],
      dataRows: [],
      suggestedMapping: {
        dateCol: 0,
        merchantCol: 1,
        rawDescCol: -1,
        amountCol: 2,
        debitCol: -1,
        creditCol: -1,
        categoryCol: -1,
        paymentMethodCol: -1,
        typeCol: -1,
        statusCol: -1,
      },
    };
  }

  const firstRow = rows[0];
  const firstRowHasDateOrCurrency =
    firstRow.some((cell) => looksLikeDateValue(cell)) &&
    firstRow.some((cell) => looksLikeCurrencyValue(cell));
  const hasHeaderRow = !firstRowHasDateOrCurrency && rows.length > 1;

  const maxCols = Math.max(...rows.map((r) => r.length));
  const headers = hasHeaderRow
    ? Array.from({ length: maxCols }, (_, idx) => firstRow[idx] || `Column ${idx + 1}`)
    : Array.from({ length: maxCols }, (_, idx) => `Column ${idx + 1}`);
  const dataRows = hasHeaderRow ? rows.slice(1) : rows;

  const findHeaderIdx = (patterns: RegExp[], exclude: number[] = []): number => {
    for (const pat of patterns) {
      const idx = headers.findIndex((h, i) => !exclude.includes(i) && pat.test(h.trim()));
      if (idx !== -1) return idx;
    }
    return -1;
  };

  let dateCol = findHeaderIdx([
    /^transaction\s*date$/i,
    /^date$/i,
    /^posted\s*date$/i,
    /^post\s*date$/i,
    /date/i,
  ]);

  let merchantCol = findHeaderIdx(
    [
      /^merchant$/i,
      /^merchant\s*name$/i,
      /^payee$/i,
      /^description$/i,
      /^name$/i,
      /merchant|payee|description|vendor/i,
    ],
    dateCol >= 0 ? [dateCol] : []
  );

  const rawDescCol = findHeaderIdx(
    [/^raw\s*descriptor$/i, /^original\s*description$/i, /^memo$/i, /^notes?$/i],
    [dateCol, merchantCol].filter((i) => i >= 0)
  );

  let amountCol = findHeaderIdx([
    /^total\s*bill\s*paid/i,
    /^amount$/i,
    /^amount\s*\(\$\)$/i,
    /^transaction\s*amount$/i,
    /^total$/i,
    /^value$/i,
  ]);

  const debitCol = findHeaderIdx([/^debit$/i, /^withdrawal/i, /^charge$/i, /^outflow$/i]);
  const creditCol = findHeaderIdx([/^credit$/i, /^deposit/i, /^inflow$/i, /^payment$/i]);

  if (amountCol === -1 && debitCol === -1 && creditCol === -1) {
    amountCol = findHeaderIdx([/amount|total|price|usd/i]);
  }

  // Fallback heuristics from sample data rows when no header names matched
  if (dataRows.length > 0) {
    const sampleRow = dataRows[0];
    if (dateCol === -1) {
      const guessedDate = sampleRow.findIndex((c) => looksLikeDateValue(c));
      dateCol = guessedDate >= 0 ? guessedDate : 0;
    }
    if (amountCol === -1 && debitCol === -1) {
      const guessedAmt = sampleRow.findIndex(
        (c, idx) => idx !== dateCol && looksLikeCurrencyValue(c)
      );
      amountCol = guessedAmt >= 0 ? guessedAmt : Math.min(2, maxCols - 1);
    }
    if (merchantCol === -1) {
      const guessedMerchant = sampleRow.findIndex(
        (c, idx) => idx !== dateCol && idx !== amountCol && c.trim().length > 1
      );
      merchantCol = guessedMerchant >= 0 ? guessedMerchant : Math.min(1, maxCols - 1);
    }
  }

  const currencyCol = findHeaderIdx(
    [/^currency$/i, /^target\s*currency$/i, /^source\s*currency$/i, /currency/i],
    [dateCol, merchantCol, amountCol]
  );
  const categoryCol = findHeaderIdx([/^category$/i, /^spending\s*category$/i, /category/i], [
    dateCol,
    merchantCol,
    amountCol,
  ]);
  const paymentMethodCol = findHeaderIdx(
    [/^payment\s*method$/i, /^card$/i, /^account$/i, /^account\s*name$/i],
    [dateCol, merchantCol, amountCol]
  );
  const typeCol = findHeaderIdx([/^type$/i, /^direction$/i, /^transaction\s*type$/i], [
    dateCol,
    merchantCol,
    amountCol,
  ]);
  const statusCol = findHeaderIdx([/^status$/i], [dateCol, merchantCol, amountCol]);

  return {
    delimiter,
    hasHeaderRow,
    headers,
    dataRows,
    suggestedMapping: {
      dateCol: Math.max(0, dateCol),
      merchantCol: Math.max(0, merchantCol),
      rawDescCol,
      amountCol: debitCol >= 0 && creditCol >= 0 && amountCol === -1 ? -1 : amountCol,
      debitCol: amountCol === -1 ? debitCol : -1,
      creditCol: amountCol === -1 ? creditCol : -1,
      currencyCol,
      categoryCol,
      paymentMethodCol,
      typeCol,
      statusCol,
    },
  };
}

export function buildCsvTransactionPreview(params: {
  structure: ParsedCsvFileStructure;
  mapping: CsvColumnMapping;
  signConvention: CsvSignConvention;
  defaultPaymentMethod: string;
  defaultSource: DataSource;
  existingTransactions: Transaction[];
  forcedCurrencyCode?: string;
  fxRates?: Record<string, number>;
}): PreviewCsvRow[] {
  const {
    structure,
    mapping,
    signConvention,
    defaultPaymentMethod,
    defaultSource,
    existingTransactions,
    forcedCurrencyCode = 'AUTO',
    fxRates,
  } = params;

  const { dataRows } = structure;
  if (dataRows.length === 0) return [];

  // Auto-detect sign convention if 'auto' and single amount column
  let resolvedConvention: 'negative_is_expense' | 'positive_is_expense' = 'positive_is_expense';
  if (signConvention === 'negative_is_expense' || signConvention === 'positive_is_expense') {
    resolvedConvention = signConvention;
  } else if (mapping.amountCol >= 0) {
    let negCount = 0;
    let posCount = 0;
    for (const row of dataRows) {
      const val = parseCurrencyCell(row[mapping.amountCol]);
      if (val === null || val === 0) continue;
      if (val < 0) negCount += 1;
      else posCount += 1;
    }
    resolvedConvention = negCount > posCount ? 'negative_is_expense' : 'positive_is_expense';
  }

  const previewRows: PreviewCsvRow[] = [];

  dataRows.forEach((row, idx) => {
    const rawDate = row[mapping.dateCol] || '';
    const rawMerchantCell = row[mapping.merchantCol] || '';
    const rawDescExtra = mapping.rawDescCol >= 0 ? row[mapping.rawDescCol] || '' : '';
    const rawCatCell = mapping.categoryCol >= 0 ? row[mapping.categoryCol] || '' : '';
    const rawPaymentCell =
      mapping.paymentMethodCol >= 0 ? row[mapping.paymentMethodCol] || '' : '';
    const rawTypeCell = (mapping.typeCol >= 0 ? row[mapping.typeCol] || '' : '').toLowerCase();
    const rawStatusCell = (
      mapping.statusCol >= 0 ? row[mapping.statusCol] || '' : ''
    ).toLowerCase();

    let signedVal: number | null = null;
    let fromDebitCredit = false;
    let isCreditEntry = false;

    if (mapping.amountCol >= 0) {
      signedVal = parseCurrencyCell(row[mapping.amountCol]);
    } else if (mapping.debitCol >= 0 || mapping.creditCol >= 0) {
      fromDebitCredit = true;
      const debitVal = mapping.debitCol >= 0 ? parseCurrencyCell(row[mapping.debitCol]) : null;
      const creditVal = mapping.creditCol >= 0 ? parseCurrencyCell(row[mapping.creditCol]) : null;
      if (debitVal !== null && Math.abs(debitVal) > 0) {
        signedVal = Math.abs(debitVal);
        isCreditEntry = false;
      } else if (creditVal !== null && Math.abs(creditVal) > 0) {
        signedVal = Math.abs(creditVal);
        isCreditEntry = true;
      }
    }

    if (signedVal === null || Math.abs(signedVal) < 0.005) {
      return;
    }

    const rawAmountText =
      mapping.amountCol >= 0
        ? row[mapping.amountCol] || ''
        : `${mapping.debitCol >= 0 ? row[mapping.debitCol] || '' : ''} ${
            mapping.creditCol >= 0 ? row[mapping.creditCol] || '' : ''
          }`;
    const rawCurrencyCell =
      typeof mapping.currencyCol === 'number' && mapping.currencyCol >= 0
        ? row[mapping.currencyCol] || ''
        : '';

    const detectedCurrency =
      forcedCurrencyCode && forcedCurrencyCode !== 'AUTO'
        ? forcedCurrencyCode
        : detectCurrencyCode(`${rawCurrencyCell} ${rawAmountText}`);

    const rawAbsAmount = Math.round(Math.abs(signedVal) * 100) / 100;
    const { usdAmount: absAmount, rateUsed } = convertToUsd(
      rawAbsAmount,
      detectedCurrency,
      undefined,
      fxRates
    );

    const merchant = cleanMerchantName(rawMerchantCell || rawDescExtra || 'CSV Entry');
    const baseDescription = (rawDescExtra || rawMerchantCell || merchant).slice(0, 170);
    const rawDescription =
      detectedCurrency !== 'USD'
        ? `${baseDescription} · ${rawAbsAmount.toLocaleString('en-US', {
            maximumFractionDigits: 2,
          })} ${detectedCurrency} (@ ${rateUsed})`
        : baseDescription;
    const combinedLower = `${merchant} ${rawDescription} ${rawCatCell} ${rawTypeCell}`.toLowerCase();

    // Determine transactionType: purchase | refund | income | transfer
    // Only mark as 'transfer' when moving money between the user's OWN accounts (never external Wise transfers!)
    let transactionType: TransactionType = 'purchase';

    const isExternalWiseSend =
      /\bwise\b/i.test(`${merchant} ${defaultPaymentMethod} ${rawPaymentCell}`) &&
      !/\b(added\s+money\s+to\s+your|topped\s+up\s+your|between\s+your\s+balances)\b/i.test(
        combinedLower
      );

    if (
      !isExternalWiseSend &&
      (rawTypeCell === 'internal_transfer' ||
        /\b(autopay|payment\s*-?\s*thank\s*you|credit\s*card\s*payment|zelle\s*to\s*self|internal\s*transfer|epayment|transfer\s+to\s+savings|added\s+money\s+to\s+your)\b/i.test(
          combinedLower
        ))
    ) {
      transactionType = 'transfer';
    } else if (
      rawTypeCell === 'income' ||
      rawTypeCell === 'in' ||
      /\b(payroll|direct\s*dep|salary|dividend|interest\s*payment|tax\s*refund)\b/i.test(
        combinedLower
      )
    ) {
      transactionType = 'income';
    } else if (
      rawTypeCell === 'refund' ||
      rawTypeCell === 'return' ||
      rawStatusCell === 'refunded' ||
      /\b(refund|rebate|chargeback|merchandise\s*return)\b/i.test(combinedLower)
    ) {
      transactionType = 'refund';
    } else if (fromDebitCredit) {
      if (isCreditEntry) {
        transactionType = /\b(deposit|payroll|salary|income)\b/i.test(combinedLower)
          ? 'income'
          : 'refund';
      } else {
        transactionType = 'purchase';
      }
    } else {
      const isOppositeOfExpense =
        (resolvedConvention === 'negative_is_expense' && signedVal > 0) ||
        (resolvedConvention === 'positive_is_expense' && signedVal < 0);

      if (isOppositeOfExpense) {
        transactionType = /\b(deposit|payroll|salary|income|ach\s*credit)\b/i.test(combinedLower)
          ? 'income'
          : 'refund';
      } else {
        transactionType = 'purchase';
      }
    }

    const status: TransactionStatus =
      transactionType === 'refund'
        ? 'refunded'
        : rawStatusCell === 'pending'
        ? 'pending'
        : 'posted';

    const { category, uncertain } =
      transactionType === 'income' || transactionType === 'transfer'
        ? { category: 'Other / Uncategorized' as SpendingCategory, uncertain: false }
        : inferSpendingCategory(rawCatCell, `${merchant} ${rawDescription}`);

    const normalizedDate = normalizeCsvDate(rawDate);
    const targetTimeMs = new Date(normalizedDate).getTime();

    const duplicate = existingTransactions.find((tx) => {
      if (Math.abs(tx.amount - absAmount) >= 0.01) return false;
      const txTimeMs = new Date(tx.date).getTime();
      if (Number.isNaN(targetTimeMs) || Number.isNaN(txTimeMs)) {
        return tx.date === normalizedDate;
      }
      return Math.abs(targetTimeMs - txTimeMs) <= 2 * 86400 * 1000;
    });

    previewRows.push({
      rowIndex: idx + 1,
      included: true,
      date: normalizedDate,
      merchant,
      rawDescription,
      amount: absAmount,
      paymentMethod: (rawPaymentCell || defaultPaymentMethod || 'Bank CSV Statement').slice(0, 90),
      category,
      status,
      transactionType,
      source: defaultSource,
      matchedExistingId: duplicate?.id,
      uncertainCategory: uncertain,
    });
  });

  return previewRows;
}
