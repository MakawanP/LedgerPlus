import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Trash2 } from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  SpendingCategory,
  Transaction,
} from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';
import { MerchantLogo } from './MerchantLogo';

interface UncertainQueuePanelProps {
  transactions: Transaction[];
  onResolveCategory: (transactionId: string, category: SpendingCategory) => void;
  onDismissAnomaly: (transactionId: string, action: 'keep' | 'remove_duplicate') => void;
  onDeleteTransaction: (transactionId: string) => void;
}

export const UncertainQueuePanel: React.FC<UncertainQueuePanelProps> = ({
  transactions,
  onResolveCategory,
  onDismissAnomaly,
  onDeleteTransaction,
}) => {
  const uncertainItems = transactions.filter(
    (t) => t.monthKey === '2026-11' && t.uncertainCategory
  );
  const anomalyItems = transactions.filter(
    (t) => t.monthKey === '2026-11' && Boolean(t.anomalyNote)
  );

  if (uncertainItems.length === 0 && anomalyItems.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <p className="text-sm text-slate-700 dark:text-slate-300">
            All November transactions are confidently categorized and reconciled across Gmail, Apple Pay, and Bank feeds.
          </p>
        </div>
        <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
          0 uncertain items
        </span>
      </div>
    );
  }

  return (
    <section
      aria-label="Action Required: Uncertain Categorizations & Charge Alerts"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-amber-50/40 dark:bg-amber-950/20">
        <div className="flex items-center gap-2.5">
          <HelpCircle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0" />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Assistant Clarification Queue — Confirm Ambiguous Categories & Duplicate Alerts
          </h2>
        </div>
        <div className="text-xs text-slate-600 dark:text-slate-400 font-mono">
          {uncertainItems.length} uncertain {uncertainItems.length === 1 ? 'category' : 'categories'} ·{' '}
          {anomalyItems.length} flagged {anomalyItems.length === 1 ? 'charge' : 'charges'}
        </div>
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-800">
        {uncertainItems.map((tx) => (
          <div
            key={tx.id}
            className="px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
          >
            <div className="flex items-start gap-3 max-w-2xl">
              <MerchantLogo
                merchant={tx.merchant}
                rawDescription={tx.rawDescription}
                transactionType={tx.transactionType}
                paymentMethod={tx.paymentMethod}
                size="sm"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 flex-wrap">
                  <span>{tx.merchant}</span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="font-mono text-slate-900 dark:text-slate-100">
                    {formatCurrency(tx.amount)}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-xs font-normal font-mono text-slate-500 dark:text-slate-400">
                    {tx.date}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
                    {tx.paymentMethod}
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">{tx.uncertaintyReason}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {(tx.suggestedCategories || ['Shopping & Retail', 'Food & Restaurants', 'Personal Care']).map(
                (suggestedCat) => (
                  <button
                    key={suggestedCat}
                    type="button"
                    onClick={() => onResolveCategory(tx.id, suggestedCat)}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
                  >
                    Assign: {suggestedCat}
                  </button>
                )
              )}
              <select
                aria-label={`Select category for ${tx.merchant}`}
                value={tx.category}
                onChange={(e) =>
                  onResolveCategory(tx.id, e.target.value as SpendingCategory)
                }
                className="px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-slate-900 dark:focus:ring-slate-400"
              >
                {ALL_SPENDING_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onDeleteTransaction(tx.id)}
                title={`Delete "${tx.merchant}"`}
                aria-label={`Delete transaction ${tx.merchant}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/70 transition-colors whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        ))}

        {anomalyItems.map((tx) => (
          <div
            key={`anomaly-${tx.id}`}
            className="px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-rose-50/20 dark:bg-rose-950/15"
          >
            <div className="flex items-start gap-3 max-w-2xl">
              <MerchantLogo
                merchant={tx.merchant}
                rawDescription={tx.rawDescription}
                transactionType={tx.transactionType}
                paymentMethod={tx.paymentMethod}
                size="sm"
              />
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 flex-wrap">
                  <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
                  <span>{tx.merchant}</span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="font-mono text-rose-700 dark:text-rose-400">
                    {formatCurrency(tx.amount)}
                  </span>
                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                  <span className="text-xs font-normal font-mono text-slate-500 dark:text-slate-400">
                    {tx.date} ({tx.status})
                  </span>
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-400">{tx.anomalyNote}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {tx.merchant.includes('Duplicate') && (
                <button
                  type="button"
                  onClick={() => onDismissAnomaly(tx.id, 'remove_duplicate')}
                  className="px-3 py-1.5 text-xs font-medium bg-rose-700 text-white rounded-lg hover:bg-rose-800 transition-colors whitespace-nowrap shrink-0"
                >
                  Exclude Duplicate Hold ({formatCurrency(tx.amount)})
                </button>
              )}
              <button
                type="button"
                onClick={() => onDismissAnomaly(tx.id, 'keep')}
                className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                Acknowledge & Keep
              </button>
              <button
                type="button"
                onClick={() => onDeleteTransaction(tx.id)}
                title={`Delete "${tx.merchant}"`}
                aria-label={`Delete transaction ${tx.merchant}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/70 transition-colors whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
