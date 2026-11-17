import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '25mb' }));

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
      return res.status(500).json({
        error: error?.message || 'Failed to parse financial source or receipt OCR with Gemini API.',
      });
    }
  });

  // Endpoint 2: Deep AI Spending Insights & Audit on current ledger
  app.post('/api/finance/audit-insights', async (req, res) => {
    try {
      const { summaryMetrics, categoryBreakdown, subscriptions, recentTransactions, userQuestion } = req.body;
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

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
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
