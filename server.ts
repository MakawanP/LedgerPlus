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
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function inferCategoryFromText(merchantAndBody: string): {
  category: string;
  uncertain: boolean;
} {
  const s = merchantAndBody.toLowerCase();
  if (/\b(uber\s*eats|doordash|grubhub|sweetgreen|chipotle|tartine|restaurant|diner|bistro|pizza|sushi|grill)\b/.test(s)) {
    return { category: 'Food & Restaurants', uncertain: false };
  }
  if (/\b(starbucks|blue bottle|philz|peet|coffee|cafe|espresso|bakery)\b/.test(s)) {
    return { category: 'Coffee & Drinks', uncertain: false };
  }
  if (/\b(whole foods|trader joe|safeway|kroger|costco|instacart|grocery|supermarket|market)\b/.test(s)) {
    return { category: 'Groceries', uncertain: false };
  }
  if (/\b(uber|lyft|waymo|taxi|cab|transit|bart|mta|caltrain)\b/.test(s)) {
    return { category: 'Transportation / Uber / Taxi', uncertain: false };
  }
  if (/\b(shell|chevron|texaco|arco|exxon|mobil|parking|parkmobile|fasTrak|toll)\b/.test(s)) {
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
  if (/\b(airbnb|marriott|hilton|hyatt|delta|united|american airlines|southwest|flight|hotel|expedia)\b/.test(s)) {
    return { category: 'Travel & Hotels', uncertain: false };
  }
  if (/\b(equinox|peloton|gym|fitness|cvs|walgreens|pharmacy|dental|medical|clinic)\b/.test(s)) {
    return { category: 'Health & Fitness', uncertain: false };
  }
  if (/\b(amc|regal|ticketmaster|stubhub|steam|playstation|nintendo|cinema|concert)\b/.test(s)) {
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

function normalizeIsoDate(rawDate: string): string {
  const trimmed = rawDate.trim();
  const isoMatch = trimmed.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) return isoMatch[1];
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '2026-11-17';
}

function cleanSenderMerchant(fromHeader: string, subjectHeader: string): string {
  const namePart = fromHeader.split('<')[0].replace(/["']/g, '').trim();
  const cleaned = namePart
    .replace(/\b(receipts?|orders?|billing|payments?|no-?reply|notifications?|auto-confirm|support|team)\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-·|]+|[\s\-·|]+$/g, '')
    .trim();
  if (cleaned.length >= 2) return cleaned.slice(0, 80);

  const domainMatch = fromHeader.match(/@([a-z0-9-]+)\./i);
  if (domainMatch && domainMatch[1]) {
    const dom = domainMatch[1];
    return dom.charAt(0).toUpperCase() + dom.slice(1);
  }
  return (subjectHeader || 'Receipt Merchant').slice(0, 60);
}

function extractDollarAmountFromBlock(text: string): number | null {
  const priorityPatterns = [
    /(?:total(?:\s+charged|\s+paid|\s+amount)?|amount(?:\s+paid|\s+charged)?|grand\s+total|charged|payment\s+of)\s*[:\-]?\s*\$\s*(\d{1,6}(?:,\d{3})*(?:\.\d{2}))/i,
    /\$\s*(\d{1,6}(?:,\d{3})*\.\d{2})\s*(?:usd|total|paid|charged)/i,
  ];
  for (const pat of priorityPatterns) {
    const m = text.match(pat);
    if (m && m[1]) {
      const val = parseFloat(m[1].replace(/,/g, ''));
      if (val > 0) return val;
    }
  }

  const allAmounts = Array.from(text.matchAll(/\$\s*(\d{1,6}(?:,\d{3})*\.\d{2})/g))
    .map((m) => parseFloat(m[1].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0 && n < 100000);

  if (allAmounts.length === 0) return null;
  return allAmounts[allAmounts.length - 1];
}

function extractTransactionsDeterministically(
  rawText: string,
  defaultSource: string,
  existingTransactions: any[]
): { extractedTransactions: any[]; summaryNote: string } {
  const extracted: any[] = [];
  const safeExisting = Array.isArray(existingTransactions) ? existingTransactions : [];

  const findDuplicateId = (dateStr: string, amount: number): string => {
    const targetTime = new Date(dateStr).getTime();
    const match = safeExisting.find((tx: any) => {
      const txAmt = Math.abs(Number(tx?.amount) || 0);
      if (Math.abs(txAmt - amount) >= 0.01) return false;
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
      const amount = extractDollarAmountFromBlock(block);
      if (amount === null) continue;

      const merchant = cleanSenderMerchant(fromLine, subjectLine);
      const date = normalizeIsoDate(dateLine);
      const isRefund = /\b(refund|refunded|credit issued|money back)\b/i.test(
        `${subjectLine} ${block}`
      );
      const { category, uncertain } = inferCategoryFromText(`${merchant} ${subjectLine} ${block}`);
      const matchedExistingId = findDuplicateId(date, amount);

      extracted.push({
        date,
        merchant,
        rawDescription: subjectLine || `Gmail Receipt · ${merchant}`,
        amount,
        paymentMethod: 'Gmail Digital Receipt',
        category,
        status: isRefund ? 'refunded' : 'posted',
        transactionType: isRefund ? 'refund' : 'purchase',
        source: 'Gmail',
        matchedExistingId,
        uncertainCategory: uncertain,
        uncertaintyPrompt: uncertain
          ? `Confirm spending category for "${merchant}" ($${amount.toFixed(2)})`
          : '',
        suggestedCategories: uncertain
          ? ['Shopping Online', 'Subscriptions', 'Food & Restaurants']
          : [],
      });
    }

    return {
      extractedTransactions: extracted,
      summaryNote:
        extracted.length > 0
          ? `Extracted ${extracted.length} receipt transaction(s) from Gmail using local Windows parser.`
          : 'Scanned Gmail messages, but none contained recognizable dollar receipt totals.',
    };
  }

  // Fallback line/alert parser for Apple Pay alerts, .eml files, and pasted statements
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    const amt = extractDollarAmountFromBlock(line);
    if (amt === null) continue;
    const date = normalizeIsoDate(line);
    const atMerchant =
      line.match(/\bat\s+([A-Za-z0-9 *&'.\-/]{2,45}?)(?:\s*\(|\s*—|\s*-|$)/i)?.[1]?.trim() ||
      line.slice(0, 40);
    const { category, uncertain } = inferCategoryFromText(line);
    const source = /apple pay/i.test(line) ? 'Apple Pay' : defaultSource || 'Uploaded Statement';
    extracted.push({
      date,
      merchant: atMerchant,
      rawDescription: line.slice(0, 180),
      amount: amt,
      paymentMethod: source === 'Apple Pay' ? 'Apple Pay' : 'Card / Statement',
      category,
      status: 'posted',
      transactionType: /\brefund\b/i.test(line) ? 'refund' : 'purchase',
      source,
      matchedExistingId: findDuplicateId(date, amt),
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
        : 'No dollar transactions detected in the provided text.',
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

      if (!hasConfiguredGeminiApiKey() && inlineMediaParts.length === 0) {
        const localParsed = extractTransactionsDeterministically(
          textBlocks.join('\n\n'),
          'Apple Pay',
          existingTransactions
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

      const prompt = `You are LedgerPulse's Automated Local Ingestion Engine on Windows.
Extract every actual transaction, refund, income, or transfer from the queued Apple Pay notifications and local inbox receipt files below.

STRICT RULES:
1. Never invent missing transactions. Extract exact dollar figures and dates (default year 2026; today is 2026-11-17).
2. Classify each item into one of these exact categories:
${ALLOWED_CATEGORIES.map((c) => `- ${c}`).join('\n')}
3. Set source to "Apple Pay" for Apple Pay notifications, "Gmail" for .eml email receipts, or "Uploaded Statement" for CSV/PDF files.
4. Deduplicate against existing ledger records so the same purchase is never double-counted:
Existing transactions JSON:
${JSON.stringify(existingCompact)}
If an extracted item matches an existing purchase (same/adjacent date and same amount), set matchedExistingId to that existing transaction's id.
5. If a merchant descriptor is ambiguous (e.g., cryptic POS code like "SQ *TERMINAL 42B VENTURES"), set uncertainCategory to true, write a short uncertaintyPrompt, and list 2-3 suggestedCategories so it is flagged for review instead of silently misclassified.

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

  // Endpoint 1: Parse raw financial records & OCR receipt images / PDFs
  app.post('/api/finance/parse-source', async (req, res) => {
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
          existingTransactions
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

      const prompt = `You are a Personal AI Financial Tracking Assistant with high-accuracy optical character recognition (OCR) for receipts, invoices, and PDF statements.
${
  validAttachments.length > 0
    ? `Perform full OCR on the ${validAttachments.length} attached receipt image(s)/PDF document(s) (${attachmentNames}) and extract every actual transaction, refund, income, or account transfer.`
    : `Extract every actual transaction, refund, income, or account transfer from the following ${sourceType || 'financial'} text.`
}

STRICT RULES:
1. Never invent missing transactions. Only extract transactions explicitly visible in the attached receipt image(s)/PDF(s) or input text.
2. Use actual exact total transaction amounts (including tax/tip when shown on a receipt total) rather than estimates. If a receipt date is missing the year, assume 2026 (current date is 2026-11-17).
3. Classify spending into one of these exact categories:
${ALLOWED_CATEGORIES.map((c) => `- ${c}`).join('\n')}
4. Separate transactionType into: "purchase", "refund", "income", or "transfer" (transfers between the user's own accounts must be marked as "transfer" so they are never counted as spending).
5. Set status to "posted", "pending", or "refunded".
6. Check against existing transactions to avoid counting the same purchase twice across Gmail, Apple Pay, Bank Statements, and Uploaded Receipts:
Existing transactions JSON:
${JSON.stringify(existingCompact)}
If an extracted item matches an existing transaction (same purchase on same/adjacent date and same amount), set matchedExistingId to that existing transaction's id.
7. If a merchant description is ambiguous and cannot be confidently categorized, set uncertainCategory to true and provide a short question in uncertaintyPrompt asking the user how to categorize it, along with 2-3 suggestedCategories.
8. If receipt images or PDFs were provided, populate ocrTranscribedText with a concise, accurate transcription of the key merchant header, line items, subtotal/tax/tip, total, date, and card/tender digits read via OCR.

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
                    date: { type: Type.STRING, description: 'YYYY-MM-DD format' },
                    merchant: { type: Type.STRING, description: 'Clean merchant or store name' },
                    rawDescription: {
                      type: Type.STRING,
                      description: 'Original raw receipt/statement descriptor or itemized OCR summary',
                    },
                    amount: { type: Type.NUMBER, description: 'Positive exact numeric dollar amount' },
                    paymentMethod: {
                      type: Type.STRING,
                      description:
                        'e.g., Apple Pay · Chase Sapphire ••4821, Amex Gold ••1094, Cash (Physical Currency)',
                    },
                    category: {
                      type: Type.STRING,
                      description: 'Must be one of the 16 allowed spending categories',
                    },
                    status: { type: Type.STRING, description: 'posted, pending, or refunded' },
                    transactionType: {
                      type: Type.STRING,
                      description: 'purchase, refund, income, or transfer',
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
                  'Concise 1-2 sentence summary of what was extracted via OCR/text and whether any cross-source duplicates or transfers were filtered.',
              },
            },
            required: ['extractedTransactions', 'summaryNote'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      return res.json(parsed);
    } catch (error: any) {
      console.error('Error in /api/finance/parse-source:', error);
      const { rawText = '', sourceType = 'Gmail', existingTransactions = [] } = req.body || {};
      if (typeof rawText === 'string' && rawText.trim().length > 0) {
        const fallbackParsed = extractTransactionsDeterministically(
          rawText,
          sourceType,
          existingTransactions
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
