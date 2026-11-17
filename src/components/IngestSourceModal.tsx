import React, { useState } from 'react';
import { Check, FileText, Layers, Loader2, Plus, X } from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  DataSource,
  SpendingCategory,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/finance';
import { SAMPLE_INGEST_PRESETS } from '../data/sampleFinanceData';
import { formatCurrency } from '../utils/financeMetrics';

interface IngestSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingTransactions: Transaction[];
  onCommitTransactions: (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>
  ) => void;
}

export const IngestSourceModal: React.FC<IngestSourceModalProps> = ({
  isOpen,
  onClose,
  existingTransactions,
  onCommitTransactions,
}) => {
  const [mode, setMode] = useState<'ai_parse' | 'manual'>('ai_parse');
  const [sourceType, setSourceType] = useState<DataSource>('Gmail');
  const [rawText, setRawText] = useState(SAMPLE_INGEST_PRESETS[0].rawText);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<{
    extractedTransactions: any[];
    summaryNote: string;
  } | null>(null);

  // Manual Entry State
  const [manualDate, setManualDate] = useState('2026-11-17');
  const [manualMerchant, setManualMerchant] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualPayment, setManualPayment] = useState('Apple Pay · Chase Sapphire ••4821');
  const [manualCategory, setManualCategory] = useState<SpendingCategory>('Food & Restaurants');
  const [manualStatus, setManualStatus] = useState<TransactionStatus>('posted');
  const [manualType, setManualType] = useState<TransactionType>('purchase');
  const [manualSource, setManualSource] = useState<DataSource>('Apple Pay');

  if (!isOpen) return null;

  const handleRunParse = async () => {
    if (!rawText.trim()) return;
    setIsParsing(true);
    setParseError(null);
    setParsedPreview(null);

    try {
      const response = await fetch('/api/finance/parse-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          sourceType,
          existingTransactions: existingTransactions.filter((t) => t.monthKey === '2026-11'),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to parse source.');
      }
      setParsedPreview(data);
    } catch (err: any) {
      setParseError(err.message || 'Error parsing financial record.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirmAiImport = () => {
    if (!parsedPreview) return;
    const newItems: Transaction[] = [];
    const mergedUpdates: Array<{
      existingId: string;
      newSource: DataSource;
      rawDescriptor: string;
    }> = [];

    parsedPreview.extractedTransactions.forEach((item, idx) => {
      if (item.matchedExistingId && item.matchedExistingId.trim() !== '') {
        mergedUpdates.push({
          existingId: item.matchedExistingId,
          newSource: (item.source as DataSource) || sourceType,
          rawDescriptor: item.rawDescription || `${item.merchant} (${formatCurrency(item.amount)})`,
        });
      } else {
        const cleanCategory = ALL_SPENDING_CATEGORIES.includes(item.category)
          ? (item.category as SpendingCategory)
          : 'Other / Uncategorized';

        newItems.push({
          id: `tx-ingested-${Date.now()}-${idx}`,
          date: item.date || '2026-11-17',
          time: '10:02',
          merchant: item.merchant,
          rawDescription: item.rawDescription || item.merchant,
          amount: Math.abs(Number(item.amount) || 0),
          paymentMethod: item.paymentMethod || 'Chase Sapphire ••4821',
          category: cleanCategory,
          status: (item.status as TransactionStatus) || 'posted',
          transactionType: (item.transactionType as TransactionType) || 'purchase',
          source: (item.source as DataSource) || sourceType,
          isDeduplicated: false,
          mergedSources: [
            {
              source: (item.source as DataSource) || sourceType,
              referenceId: `ING-${Date.now().toString().slice(-5)}`,
              capturedAt: '2026-11-17 10:02',
              rawDescriptor: item.rawDescription || item.merchant,
              statusAtCapture: (item.status as TransactionStatus) || 'posted',
            },
          ],
          uncertainCategory: Boolean(item.uncertainCategory),
          uncertaintyReason: item.uncertaintyPrompt || undefined,
          suggestedCategories: item.suggestedCategories?.filter((c: any) =>
            ALL_SPENDING_CATEGORIES.includes(c)
          ) as SpendingCategory[],
          monthKey: '2026-11',
        });
      }
    });

    onCommitTransactions(newItems, mergedUpdates);
    setParsedPreview(null);
    onClose();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(manualAmount);
    if (!manualMerchant.trim() || isNaN(numericAmount) || numericAmount <= 0) return;

    // Check if an identical transaction already exists on the same date & amount to deduplicate
    const duplicateMatch = existingTransactions.find(
      (t) =>
        t.date === manualDate &&
        Math.abs(t.amount - numericAmount) < 0.01 &&
        t.merchant.toLowerCase() === manualMerchant.trim().toLowerCase()
    );

    if (duplicateMatch) {
      onCommitTransactions(
        [],
        [
          {
            existingId: duplicateMatch.id,
            newSource: manualSource,
            rawDescriptor: `${manualMerchant.trim()} · ${formatCurrency(numericAmount)}`,
          },
        ]
      );
    } else {
      const newTx: Transaction = {
        id: `tx-manual-${Date.now()}`,
        date: manualDate,
        time: '10:02',
        merchant: manualMerchant.trim(),
        rawDescription: `MANUAL ENTRY · ${manualMerchant.trim().toUpperCase()}`,
        amount: numericAmount,
        paymentMethod: manualPayment,
        category: manualCategory,
        status: manualStatus,
        transactionType: manualType,
        source: manualSource,
        isDeduplicated: false,
        mergedSources: [
          {
            source: manualSource,
            referenceId: `MAN-${Date.now().toString().slice(-5)}`,
            capturedAt: '2026-11-17 10:02',
            rawDescriptor: manualMerchant.trim(),
            statusAtCapture: manualStatus,
          },
        ],
        uncertainCategory: manualCategory === 'Other / Uncategorized',
        uncertaintyReason:
          manualCategory === 'Other / Uncategorized'
            ? 'Manually logged as Other / Uncategorized — please confirm specific category.'
            : undefined,
        monthKey: '2026-11',
      };
      onCommitTransactions([newTx], []);
    }

    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      <div className="bg-white border border-slate-200 rounded-xl max-w-3xl w-full overflow-hidden shadow-xl my-8">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Collect & Reconcile Transactions (Gmail · Apple Pay · Bank CSV)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatically deduplicates matching purchases across sources and separates transfers & refunds
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('ai_parse')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'ai_parse'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              AI Receipt / Statement Parser (Gemini)
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'manual'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Manual Transaction Entry
            </button>
          </div>

          {mode === 'ai_parse' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Load sample feed:</span>
              {SAMPLE_INGEST_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setSourceType(preset.sourceType);
                    setRawText(preset.rawText);
                    setParsedPreview(null);
                  }}
                  className="text-slate-700 hover:text-slate-900 underline underline-offset-4"
                >
                  Sample {idx + 1} ({preset.sourceType})
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'ai_parse' ? (
          <div className="p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-xs font-medium text-slate-700">Source Channel:</label>
              {(
                ['Gmail', 'Apple Pay', 'Bank Statement', 'Uploaded Statement'] as DataSource[]
              ).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceType(src)}
                  className={`px-3 py-1 text-xs rounded-md border transition-colors ${
                    sourceType === src
                      ? 'bg-slate-900 text-white border-slate-900'
                      : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>

            <div>
              <label
                htmlFor="raw-financial-text"
                className="block text-xs font-medium text-slate-700 mb-1.5"
              >
                Paste Gmail receipt, Apple Pay notification, or Bank CSV export lines:
              </label>
              <textarea
                id="raw-financial-text"
                rows={5}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full p-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:bg-white focus:border-slate-900"
                placeholder="Paste email receipt text, Apple Pay alert, or CSV statement rows..."
              />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Matches against existing ledger to prevent counting the same purchase twice.
              </span>
              <button
                type="button"
                onClick={handleRunParse}
                disabled={isParsing || !rawText.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Extracting & Checking Duplicates...</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-3.5 h-3.5" />
                    <span>Analyze & Extract Transactions</span>
                  </>
                )}
              </button>
            </div>

            {parseError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
                {parseError}
              </div>
            )}

            {parsedPreview && (
              <div className="border border-slate-200 rounded-xl overflow-hidden space-y-3 bg-slate-50/50 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-slate-900">
                    Extraction & Deduplication Preview
                  </div>
                  <span className="text-xs text-slate-600">{parsedPreview.summaryNote}</span>
                </div>

                <div className="divide-y divide-slate-200 bg-white border border-slate-200 rounded-lg text-xs">
                  {parsedPreview.extractedTransactions.map((item, i) => {
                    const isDuplicate = Boolean(item.matchedExistingId);
                    return (
                      <div
                        key={i}
                        className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5">
                          <div className="font-semibold text-slate-900 flex items-center gap-2">
                            <span>{item.merchant}</span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="font-mono">{formatCurrency(item.amount)}</span>
                            <span aria-hidden="true" className="text-slate-300">·</span>
                            <span className="font-mono text-slate-500">{item.date}</span>
                          </div>
                          <div className="text-slate-500">
                            Category: <strong className="text-slate-800">{item.category}</strong> ·
                            Type: <strong className="text-slate-800">{item.transactionType}</strong> ·
                            Status: <span className="capitalize">{item.status}</span>
                          </div>
                          {item.uncertainCategory && (
                            <div className="text-amber-700 font-medium">
                              Flagged as uncertain: {item.uncertaintyPrompt}
                            </div>
                          )}
                        </div>

                        <div className="shrink-0">
                          {isDuplicate ? (
                            <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                              <Layers className="w-3.5 h-3.5" />
                              Matched existing #{item.matchedExistingId} (Will merge source, $0 added)
                            </span>
                          ) : item.transactionType === 'transfer' ? (
                            <span className="text-slate-500">
                              Internal Transfer (Excluded from spend)
                            </span>
                          ) : (
                            <span className="text-slate-900 font-medium">
                              New Ledger Record
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setParsedPreview(null)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmAiImport}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Commit Reconciled Records to Ledger</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleManualSubmit} className="p-6 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Merchant / Store</label>
                <input
                  type="text"
                  value={manualMerchant}
                  onChange={(e) => setManualMerchant(e.target.value)}
                  placeholder="e.g., Philz Coffee"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Exact Amount ($)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  placeholder="14.50"
                  className="w-full px-3 py-2 font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  required
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Spending Category</label>
                <select
                  value={manualCategory}
                  onChange={(e) => setManualCategory(e.target.value as SpendingCategory)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  {ALL_SPENDING_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Payment Method</label>
                <input
                  type="text"
                  value={manualPayment}
                  onChange={(e) => setManualPayment(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Source of Information</label>
                <select
                  value={manualSource}
                  onChange={(e) => setManualSource(e.target.value as DataSource)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="Apple Pay">Apple Pay</option>
                  <option value="Gmail">Gmail</option>
                  <option value="Bank Statement">Bank Statement</option>
                  <option value="Uploaded Statement">Uploaded Statement</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-slate-700 mb-1">Transaction Status</label>
                <select
                  value={manualStatus}
                  onChange={(e) => setManualStatus(e.target.value as TransactionStatus)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="posted">Posted</option>
                  <option value="pending">Pending</option>
                  <option value="refunded">Refunded</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-slate-700 mb-1">Record Classification</label>
                <select
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value as TransactionType)}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg"
                >
                  <option value="purchase">Purchase (Counts as Spending)</option>
                  <option value="refund">Refund (Offsets Spending)</option>
                  <option value="income">Income / Deposit</option>
                  <option value="transfer">Account Transfer (Excluded from Spend)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Record Transaction</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
