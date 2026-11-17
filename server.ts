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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '5mb' }));

  // Endpoint 1: Parse raw financial records (Gmail receipt, Apple Pay alert, Bank CSV, or statement text)
  app.post('/api/finance/parse-source', async (req, res) => {
    try {
      const { rawText, sourceType, existingTransactions = [] } = req.body;
      if (!rawText || typeof rawText !== 'string') {
        return res.status(400).json({ error: 'Please provide rawText to parse.' });
      }

      const ai = getGeminiClient();

      const existingCompact = existingTransactions.slice(0, 40).map((t: any) => ({
        id: t.id,
        date: t.date,
        merchant: t.merchant,
        amount: t.amount,
        source: t.source,
        status: t.status,
      }));

      const prompt = `You are a Personal AI Financial Tracking Assistant.
Extract every actual transaction, refund, income, or account transfer from the following ${sourceType || 'financial'} text.

STRICT RULES:
1. Never invent missing transactions. Only extract transactions explicitly stated in the input text.
2. Use actual exact transaction amounts rather than estimates.
3. Classify spending into one of these exact categories:
${ALLOWED_CATEGORIES.map((c) => `- ${c}`).join('\n')}
4. Separate transactionType into: "purchase", "refund", "income", or "transfer" (transfers between the user's own accounts must be marked as "transfer" so they are never counted as spending).
5. Set status to "posted", "pending", or "refunded".
6. Check against existing transactions to avoid counting the same purchase twice across Gmail, Apple Pay, and Bank Statements:
Existing transactions JSON:
${JSON.stringify(existingCompact)}
If an extracted item matches an existing transaction (same purchase on same/adjacent date and same amount), set matchedExistingId to that existing transaction's id.
7. If a merchant description is ambiguous and cannot be confidently categorized (e.g., generic payment processor code, Venmo peer transfer, or multi-purpose store without item details), set uncertainCategory to true and provide a short question in uncertaintyPrompt asking the user how to categorize it, along with 2-3 suggestedCategories.

Input source text to parse:
"""
${rawText}
"""`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
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
                    date: { type: Type.STRING, description: 'YYYY-MM-DD format' },
                    merchant: { type: Type.STRING, description: 'Clean merchant or store name' },
                    rawDescription: { type: Type.STRING, description: 'Original raw descriptor if available' },
                    amount: { type: Type.NUMBER, description: 'Positive exact numeric dollar amount' },
                    paymentMethod: { type: Type.STRING, description: 'e.g., Apple Pay · Chase Sapphire ••4821, Amex Gold ••1094' },
                    category: { type: Type.STRING, description: 'Must be one of the 16 allowed spending categories' },
                    status: { type: Type.STRING, description: 'posted, pending, or refunded' },
                    transactionType: { type: Type.STRING, description: 'purchase, refund, income, or transfer' },
                    source: { type: Type.STRING, description: 'Gmail, Apple Pay, Bank Statement, or Uploaded Statement' },
                    matchedExistingId: { type: Type.STRING, description: 'ID of matching existing transaction if duplicate across sources, else empty string' },
                    uncertainCategory: { type: Type.BOOLEAN, description: 'True if category is ambiguous and needs user confirmation' },
                    uncertaintyPrompt: { type: Type.STRING, description: 'Question asking user to confirm category if uncertain' },
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
                description: 'Concise 1-2 sentence summary of what was extracted and whether any cross-source duplicates or transfers were filtered.',
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
        error: error?.message || 'Failed to parse financial source with Gemini API.',
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
