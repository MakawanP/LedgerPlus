import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Calendar,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CreditCard,
  Layers,
  RotateCcw,
  Search,
  Split,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  DataSource,
  SpendingCategory,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/finance';
import {
  formatCurrency,
  getEffectivePersonalSpend,
  getTransactionSplitSummary,
} from '../utils/financeMetrics';
import {
  CURRENCY_OPTIONS,
  SupportedCurrencyCode,
  detectCurrencyCode,
  fetchLiveUsdRates,
  getCachedUsdRates,
} from '../utils/currencyConverter';
import { MerchantLogo } from './MerchantLogo';

type DateRangePreset =
  | 'nov_all'
  | 'today'
  | 'last_3_days'
  | 'last_7_days'
  | 'early_nov'
  | 'oct_all'
  | 'all_time'
  | 'custom';

export type TransactionFieldPatch = Partial<
  Pick<
    Transaction,
    | 'transactionType'
    | 'amount'
    | 'category'
    | 'rawDescription'
    | 'uncertainCategory'
    | 'uncertaintyReason'
  >
>;

interface TransactionLedgerTableProps {
  transactions: Transaction[];
  onUpdateCategory: (id: string, category: SpendingCategory) => void;
  onUpdateStatus: (id: string, status: TransactionStatus) => void;
  onUpdateTransactionFields?: (
    id: string,
    patch: TransactionFieldPatch,
    toastMessage?: string
  ) => void;
  onDeleteTransactions: (ids: string[], reasonLabel?: string) => void;
  onOpenSplitModal?: (tx: Transaction) => void;
  onToggleSplitParticipantSettled?: (txId: string, participantId: string) => void;
  onOpenCsvImport?: () => void;
  onOpenIngestModal?: () => void;
  compactLimit?: number;
}

export const TransactionLedgerTable: React.FC<TransactionLedgerTableProps> = ({
  transactions,
  onUpdateCategory,
  onUpdateStatus,
  onUpdateTransactionFields,
  onDeleteTransactions,
  onOpenSplitModal,
  onToggleSplitParticipantSettled,
  onOpenCsvImport,
  onOpenIngestModal,
  compactLimit,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDateRange, setSelectedDateRange] = useState<DateRangePreset>('all_time');
  const [customStartDate, setCustomStartDate] = useState('2026-11-01');
  const [customEndDate, setCustomEndDate] = useState('2026-11-17');
  const [selectedCategory, setSelectedCategory] = useState<'All' | SpendingCategory>('All');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('All');
  const [selectedSource, setSelectedSource] = useState<'All' | DataSource>('All');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<
    'all' | TransactionType | 'split' | 'deduplicated' | 'uncertain'
  >('all');
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmClearAll, setConfirmClearAll] = useState(false);

  // Live FX rates & per-row THB/Foreign -> USD converter inputs
  const [fxRates, setFxRates] = useState<Record<string, number>>(() => getCachedUsdRates());
  const [fxCurrencyByTx, setFxCurrencyByTx] = useState<Record<string, SupportedCurrencyCode>>({});
  const [fxAmountByTx, setFxAmountByTx] = useState<Record<string, string>>({});
  const [fxRateByTx, setFxRateByTx] = useState<Record<string, string>>({});

  useEffect(() => {
    void fetchLiveUsdRates().then((rates) => setFxRates({ ...rates }));
  }, []);

  const openRowFxConverter = (tx: Transaction, preferredCurrency?: SupportedCurrencyCode) => {
    const inferred =
      preferredCurrency ||
      detectCurrencyCode(`${tx.merchant} ${tx.rawDescription}`) ||
      'THB';
    const currentCurrency = inferred === 'USD' ? 'THB' : inferred;
    const rate = fxRates[currentCurrency] || 34.5;

    // Extract original THB/foreign amount from rawDescription if already noted, else prefill tx.amount
    const notedMatch = tx.rawDescription.match(
      /([\d,]+(?:\.\d{1,2})?)\s*(THB|EUR|GBP|SGD|JPY|MYR|VND|IDR|PHP|KRW|HKD|TWD|AUD|CAD|CHF|INR|CNY|MXN)/i
    );
    const initialForeignAmount = notedMatch
      ? notedMatch[1].replace(/,/g, '')
      : String(tx.amount);

    setFxCurrencyByTx((prev) => ({ ...prev, [tx.id]: currentCurrency }));
    setFxAmountByTx((prev) => ({ ...prev, [tx.id]: initialForeignAmount }));
    setFxRateByTx((prev) => ({ ...prev, [tx.id]: rate.toFixed(2) }));
    setExpandedTxId(tx.id);
  };

  const handleApplyRowFxConversion = (tx: Transaction, markAsExternalSpend: boolean) => {
    if (!onUpdateTransactionFields) return;
    const currency = fxCurrencyByTx[tx.id] || 'THB';
    const foreignVal = Math.abs(
      Number(String(fxAmountByTx[tx.id] ?? tx.amount).replace(/,/g, ''))
    );
    const defaultRate = fxRates[currency] || (currency === 'THB' ? 34.5 : 1);
    const rateVal =
      currency === 'USD'
        ? 1
        : Math.abs(Number(fxRateByTx[tx.id]) || defaultRate) || defaultRate;

    if (!Number.isFinite(foreignVal) || foreignVal <= 0) return;

    const convertedUsd =
      currency === 'USD'
        ? Math.round(foreignVal * 100) / 100
        : Math.round((foreignVal / rateVal) * 100) / 100;

    const cleanBaseDesc = tx.rawDescription
      .replace(/\s*·?\s*\(?Converted from [^)]+\)?/gi, '')
      .trim();
    const nextRawDesc =
      currency === 'USD'
        ? cleanBaseDesc
        : `${cleanBaseDesc} · Converted from ${foreignVal.toLocaleString('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })} ${currency} @ ${rateVal.toFixed(2)} ${currency}/USD`;

    const patch: TransactionFieldPatch = {
      amount: Math.max(0.01, convertedUsd),
      rawDescription: nextRawDesc,
    };
    if (markAsExternalSpend) {
      patch.transactionType = 'purchase';
    }

    onUpdateTransactionFields(
      tx.id,
      patch,
      currency === 'USD'
        ? `Updated "${tx.merchant}" amount to ${formatCurrency(convertedUsd)}${
            markAsExternalSpend ? ' (External Spend)' : ''
          }.`
        : `Converted ${foreignVal.toLocaleString('en-US', {
            maximumFractionDigits: 2,
          })} ${currency} → ${formatCurrency(convertedUsd)} USD on "${tx.merchant}"${
            markAsExternalSpend ? ' & counted as External Spend' : ''
          }.`
    );
  };

  const renderInlineTypeAndFxPanel = (tx: Transaction) => {
    if (!onUpdateTransactionFields) return null;
    const activeCurrency = fxCurrencyByTx[tx.id] || 'THB';
    const rawInputStr = fxAmountByTx[tx.id] ?? String(tx.amount);
    const activeRateStr =
      fxRateByTx[tx.id] ??
      (activeCurrency === 'USD'
        ? '1.00'
        : (fxRates[activeCurrency] || 34.5).toFixed(2));
    const parsedForeign = Math.abs(Number(String(rawInputStr).replace(/,/g, '')) || 0);
    const parsedRate =
      activeCurrency === 'USD'
        ? 1
        : Math.abs(Number(activeRateStr) || fxRates[activeCurrency] || 34.5);
    const previewUsd =
      parsedForeign > 0 && parsedRate > 0
        ? activeCurrency === 'USD'
          ? parsedForeign
          : Math.round((parsedForeign / parsedRate) * 100) / 100
        : 0;

    return (
      <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg space-y-3 text-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="font-semibold text-slate-900 dark:text-slate-100">
              Transfer Classification &amp; Currency Converter (THB → USD)
            </span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              Switch Wise or bank transfers between external spending and internal self-transfers, or convert THB / foreign amounts into USD.
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              Record Type:
            </label>
            <select
              aria-label={`Transaction type for ${tx.merchant}`}
              value={tx.transactionType}
              onChange={(e) => {
                const nextType = e.target.value as TransactionType;
                onUpdateTransactionFields(
                  tx.id,
                  { transactionType: nextType },
                  nextType === 'purchase'
                    ? `Marked "${tx.merchant}" as External Spend (included in spending totals).`
                    : nextType === 'transfer'
                    ? `Marked "${tx.merchant}" as Internal Self-Transfer (excluded from spend).`
                    : `Updated "${tx.merchant}" record type to ${nextType}.`
                );
              }}
              className="h-8 px-2.5 text-xs font-medium bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
            >
              <option value="purchase">External Spend / Purchase (Counts in Spend)</option>
              <option value="transfer">Internal Self-Transfer (Excluded from Spend)</option>
              <option value="income">Income / Deposit (+)</option>
              <option value="refund">Refund / Credit (-)</option>
            </select>
          </div>
        </div>

        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-end gap-2.5">
          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              Original Amount
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0.01"
              value={rawInputStr}
              onChange={(e) =>
                setFxAmountByTx((prev) => ({ ...prev, [tx.id]: e.target.value }))
              }
              className="w-32 h-8 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
              From Currency
            </label>
            <select
              aria-label={`Source currency for ${tx.merchant}`}
              value={activeCurrency}
              onChange={(e) => {
                const nextCurr = e.target.value as SupportedCurrencyCode;
                setFxCurrencyByTx((prev) => ({ ...prev, [tx.id]: nextCurr }));
                setFxRateByTx((prev) => ({
                  ...prev,
                  [tx.id]:
                    nextCurr === 'USD'
                      ? '1.00'
                      : (fxRates[nextCurr] || 34.5).toFixed(2),
                }));
              }}
              className="h-8 px-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
            >
              {CURRENCY_OPTIONS.filter((c) => c.code !== 'USD').map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol}) → USD
                </option>
              ))}
              <option value="USD">USD ($) Direct Edit</option>
            </select>
          </div>

          {activeCurrency !== 'USD' && (
            <div>
              <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                FX Rate ({activeCurrency} per $1 USD)
              </label>
              <input
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0.0001"
                value={activeRateStr}
                onChange={(e) =>
                  setFxRateByTx((prev) => ({ ...prev, [tx.id]: e.target.value }))
                }
                className="w-28 h-8 px-2.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100"
              />
            </div>
          )}

          <div className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-md font-mono tabular-nums text-slate-800 dark:text-slate-200 h-8 inline-flex items-center">
            = <strong>{formatCurrency(previewUsd)}</strong>&nbsp;USD
          </div>

          <button
            type="button"
            onClick={() => handleApplyRowFxConversion(tx, true)}
            className="h-8 inline-flex items-center gap-1.5 px-3 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
          >
            <Check className="w-3.5 h-3.5" />
            <span>
              {tx.transactionType === 'transfer'
                ? 'Convert to USD & Count as External Spend'
                : 'Apply USD Amount'}
            </span>
          </button>
        </div>
      </div>
    );
  };

  const availablePaymentMethods = useMemo(() => {
    const methods = Array.from(new Set(transactions.map((t) => t.paymentMethod))).sort();
    return methods;
  }, [transactions]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedDateRange !== 'all_time' ||
    selectedCategory !== 'All' ||
    selectedPaymentMethod !== 'All' ||
    selectedSource !== 'All' ||
    selectedTypeFilter !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDateRange('all_time');
    setCustomStartDate('2026-11-01');
    setCustomEndDate('2026-11-17');
    setSelectedCategory('All');
    setSelectedPaymentMethod('All');
    setSelectedSource('All');
    setSelectedTypeFilter('all');
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      if (selectedDateRange === 'nov_all') {
        if (tx.monthKey !== '2026-11') return false;
      } else if (selectedDateRange === 'today') {
        if (tx.date !== '2026-11-17') return false;
      } else if (selectedDateRange === 'last_3_days') {
        if (tx.date < '2026-11-15' || tx.date > '2026-11-17') return false;
      } else if (selectedDateRange === 'last_7_days') {
        if (tx.date < '2026-11-11' || tx.date > '2026-11-17') return false;
      } else if (selectedDateRange === 'early_nov') {
        if (tx.date < '2026-11-01' || tx.date > '2026-11-10') return false;
      } else if (selectedDateRange === 'oct_all') {
        if (tx.monthKey !== '2026-10') return false;
      } else if (selectedDateRange === 'custom') {
        if (customStartDate && tx.date < customStartDate) return false;
        if (customEndDate && tx.date > customEndDate) return false;
      }

      if (selectedCategory !== 'All' && tx.category !== selectedCategory) {
        return false;
      }

      if (selectedPaymentMethod !== 'All') {
        if (selectedPaymentMethod === 'GROUP_APPLE_PAY') {
          if (!tx.paymentMethod.toLowerCase().includes('apple pay')) return false;
        } else if (selectedPaymentMethod === 'GROUP_WISE') {
          if (
            !tx.paymentMethod.toLowerCase().includes('wise') &&
            !tx.merchant.toLowerCase().includes('wise')
          ) {
            return false;
          }
        } else if (selectedPaymentMethod === 'GROUP_CARD') {
          if (!/card|visa|mastercard|amex|chase/i.test(tx.paymentMethod)) return false;
        } else if (selectedPaymentMethod === 'GROUP_CASH') {
          if (!tx.paymentMethod.toLowerCase().includes('cash')) return false;
        } else if (tx.paymentMethod !== selectedPaymentMethod) {
          return false;
        }
      }

      if (selectedSource !== 'All') {
        const matchesPrimary = tx.source === selectedSource;
        const matchesMerged = tx.mergedSources?.some((m) => m.source === selectedSource);
        if (!matchesPrimary && !matchesMerged) return false;
      }

      if (selectedTypeFilter === 'split' && !getTransactionSplitSummary(tx).isSplit) {
        return false;
      } else if (
        selectedTypeFilter === 'deduplicated' &&
        (!tx.mergedSources || tx.mergedSources.length < 2)
      ) {
        return false;
      } else if (selectedTypeFilter === 'uncertain' && !tx.uncertainCategory) {
        return false;
      } else if (
        selectedTypeFilter !== 'all' &&
        selectedTypeFilter !== 'split' &&
        selectedTypeFilter !== 'deduplicated' &&
        selectedTypeFilter !== 'uncertain' &&
        tx.transactionType !== selectedTypeFilter
      ) {
        return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const inMerchant = tx.merchant.toLowerCase().includes(q);
        const inRaw = tx.rawDescription.toLowerCase().includes(q);
        const inCat = tx.category.toLowerCase().includes(q);
        const inPayment = tx.paymentMethod.toLowerCase().includes(q);
        const inDate = tx.date.includes(q);
        const inAmount = tx.amount.toFixed(2).includes(q);
        const inSplitNote = Boolean(tx.splitBill?.note?.toLowerCase().includes(q));
        const inSplitFriends = Boolean(
          tx.splitBill?.participants?.some(
            (p) =>
              p.friendName.toLowerCase().includes(q) ||
              Boolean(p.itemNote?.toLowerCase().includes(q))
          )
        );
        if (
          !inMerchant &&
          !inRaw &&
          !inCat &&
          !inPayment &&
          !inDate &&
          !inAmount &&
          !inSplitNote &&
          !inSplitFriends
        ) {
          return false;
        }
      }

      return true;
    });
  }, [
    transactions,
    selectedDateRange,
    customStartDate,
    customEndDate,
    selectedCategory,
    selectedPaymentMethod,
    selectedSource,
    selectedTypeFilter,
    searchQuery,
  ]);

  const displayedRows = compactLimit
    ? filteredTransactions.slice(0, compactLimit)
    : filteredTransactions;

  const filteredPurchaseTotal = useMemo(() => {
    return filteredTransactions
      .filter((t) => t.transactionType === 'purchase')
      .reduce((acc, t) => acc + getEffectivePersonalSpend(t), 0);
  }, [filteredTransactions]);

  const activeSelectedIds = useMemo(() => {
    const existingSet = new Set(transactions.map((t) => t.id));
    return selectedIds.filter((id) => existingSet.has(id));
  }, [selectedIds, transactions]);

  const allDisplayedSelected =
    displayedRows.length > 0 && displayedRows.every((row) => activeSelectedIds.includes(row.id));

  const handleToggleSelectRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleToggleSelectAllDisplayed = () => {
    const displayedIds = displayedRows.map((r) => r.id);
    if (allDisplayedSelected) {
      setSelectedIds((prev) => prev.filter((id) => !displayedIds.includes(id)));
    } else {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...displayedIds])));
    }
  };

  const handleBulkDeleteSelected = () => {
    if (activeSelectedIds.length === 0) return;
    onDeleteTransactions(activeSelectedIds);
    setSelectedIds([]);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl overflow-hidden">
      {/* Filter & Search Toolbar */}
      <div className="p-4 sm:px-6 border-b border-slate-200 dark:border-slate-800 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Unified Multi-Source Transaction Ledger
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Select checkboxes for bulk removal or click the trash icon on any row to delete test/unwanted records
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(onOpenCsvImport || onOpenIngestModal) && (
              <button
                type="button"
                onClick={onOpenCsvImport || onOpenIngestModal}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Import / Export / Scan</span>
              </button>
            )}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="min-h-[40px] md:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl md:rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset All Filters</span>
              </button>
            )}

            {transactions.length > 0 && (
              confirmClearAll ? (
                <div className="inline-flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/70 px-2.5 py-1 rounded-lg text-xs">
                  <span className="font-medium text-rose-800 dark:text-rose-200">
                    Delete all {transactions.length} records?
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteTransactions(
                        transactions.map((t) => t.id),
                        'Cleared all loaded transactions from local vault'
                      );
                      setSelectedIds([]);
                      setConfirmClearAll(false);
                    }}
                    className="px-2 py-0.5 font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-md transition-colors"
                  >
                    Yes, Clear All
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmClearAll(false)}
                    className="px-1.5 py-0.5 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmClearAll(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 hover:bg-rose-100 dark:hover:bg-rose-950/60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear All Loaded Transactions</span>
                </button>
              )
            )}
          </div>
        </div>

        {/* Multi-Select Bulk Delete Bar */}
        {activeSelectedIds.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 px-3.5 py-2.5 bg-rose-50/80 dark:bg-rose-950/35 border border-rose-200 dark:border-rose-800/70 rounded-lg text-xs">
            <span className="font-medium text-rose-900 dark:text-rose-200">
              <strong className="font-mono">{activeSelectedIds.length}</strong>{' '}
              {activeSelectedIds.length === 1 ? 'transaction' : 'transactions'} selected for removal
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelectedIds([])}
                className="px-2.5 py-1 text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium"
              >
                Clear Selection
              </button>
              <button
                type="button"
                onClick={handleBulkDeleteSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-md transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  Delete {activeSelectedIds.length}{' '}
                  {activeSelectedIds.length === 1 ? 'Transaction' : 'Transactions'}
                </span>
              </button>
            </div>
          </div>
        )}

        {/* Search Input + Dropdown Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center">
          {/* Search Input (4 cols) */}
          <div className="relative lg:col-span-4">
            <Search className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              aria-label="Search transactions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search merchant, descriptor, amount ($), or card..."
              className="w-full min-h-[44px] md:min-h-0 pl-9 md:pl-8 pr-9 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl md:rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-slate-900 dark:focus:border-slate-400 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search query"
                onClick={() => setSearchQuery('')}
                className="min-h-[40px] min-w-[40px] md:min-h-0 md:min-w-0 flex items-center justify-center absolute right-1.5 md:right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4 md:w-3.5 md:h-3.5" />
              </button>
            )}
          </div>

          {/* Date Range Dropdown Filter (3 cols) */}
          <div className="relative lg:col-span-3">
            <Calendar className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="Filter by date range"
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value as DateRangePreset)}
              className="w-full min-h-[44px] md:min-h-0 pl-9 md:pl-8 pr-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl md:rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-slate-900 dark:focus:border-slate-400 transition-colors"
            >
              <option value="all_time">Date: All Recorded Dates</option>
              <option value="nov_all">Date: November 2026</option>
              <option value="today">Date: Today (Nov 17, 2026)</option>
              <option value="last_3_days">Date: Last 3 Days</option>
              <option value="last_7_days">Date: Last 7 Days</option>
              <option value="early_nov">Date: Early Nov (Nov 1 – Nov 10)</option>
              <option value="oct_all">Date: October 2026</option>
              <option value="custom">Date: Custom Range...</option>
            </select>
          </div>

          {/* Category Dropdown Filter (2 cols) */}
          <div className="relative lg:col-span-2">
            <Tag className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="Filter by spending category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as 'All' | SpendingCategory)}
              className="w-full min-h-[44px] md:min-h-0 pl-9 md:pl-8 pr-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl md:rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-slate-900 dark:focus:border-slate-400 transition-colors"
            >
              <option value="All">Category: All (16)</option>
              {ALL_SPENDING_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          {/* Payment Method Dropdown Filter (2 cols) */}
          <div className="relative lg:col-span-2">
            <CreditCard className="w-4 h-4 md:w-3.5 md:h-3.5 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="Filter by payment method"
              value={selectedPaymentMethod}
              onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              className="w-full min-h-[44px] md:min-h-0 pl-9 md:pl-8 pr-3 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl md:rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-slate-900 dark:focus:border-slate-400 transition-colors"
            >
              <option value="All">Payment: All Methods</option>
              <optgroup label="By Payment Network">
                <option value="GROUP_APPLE_PAY">Apple Pay</option>
                <option value="GROUP_WISE">Wise Transfer / Card</option>
                <option value="GROUP_CARD">Credit / Debit Card</option>
                <option value="GROUP_CASH">Cash</option>
              </optgroup>
              <optgroup label="Exact Payment Method">
                {availablePaymentMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>

          {/* Source Dropdown Filter (1 col) */}
          <div className="lg:col-span-1">
            <select
              aria-label="Filter by data source"
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value as 'All' | DataSource)}
              className="w-full min-h-[44px] md:min-h-0 px-3 md:px-2.5 py-2 text-base md:text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl md:rounded-lg text-slate-700 dark:text-slate-200 focus:outline-none focus:bg-white dark:focus:bg-slate-800 focus:border-slate-900 dark:focus:border-slate-400 transition-colors"
            >
              <option value="All">Source: All</option>
              <option value="Gmail">Gmail</option>
              <option value="Apple Pay">Apple Pay</option>
              <option value="Bank Statement">Bank Feed</option>
              <option value="Uploaded Statement">CSV Export</option>
              <option value="Cash / Manual">Cash / Manual</option>
            </select>
          </div>
        </div>

        {/* Custom Date Range Picker Row */}
        {selectedDateRange === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs">
            <span className="font-medium text-slate-700 dark:text-slate-200">Custom Date Window:</span>
            <div className="flex items-center gap-2">
              <label htmlFor="tx-start-date" className="text-slate-500 dark:text-slate-400">
                From
              </label>
              <input
                id="tx-start-date"
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="min-h-[40px] md:min-h-0 px-2.5 py-1 text-base md:text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="tx-end-date" className="text-slate-500 dark:text-slate-400">
                To
              </label>
              <input
                id="tx-end-date"
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="min-h-[40px] md:min-h-0 px-2.5 py-1 text-base md:text-xs font-mono bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>
          </div>
        )}

        {/* Interactive Type Filter Bar (Horizontally scrollable on mobile, wraps cleanly on desktop) */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-xl md:rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { id: 'all', label: 'All Records' },
                { id: 'purchase', label: 'Purchases' },
                { id: 'split', label: 'Split / IOUs' },
                { id: 'deduplicated', label: 'Merged' },
                { id: 'uncertain', label: 'Needs Review' },
                { id: 'refund', label: 'Refunds' },
                { id: 'income', label: 'Income' },
                { id: 'transfer', label: 'Transfers' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedTypeFilter(tab.id)}
                className={`min-h-[36px] md:min-h-0 px-3 md:px-2.5 py-1.5 md:py-1 text-xs font-medium rounded-lg md:rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedTypeFilter === tab.id
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
            {displayedRows.length} of {filteredTransactions.length} records · Your Net Spend:{' '}
            <strong className="text-slate-900 dark:text-slate-100">
              {formatCurrency(filteredPurchaseTotal)}
            </strong>
          </div>
        </div>
      </div>

      {/* MOBILE iOS TOUCH LIST (< 768px) — Zero Horizontal Scroll */}
      <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
        {displayedRows.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
            {transactions.length === 0 ? (
              <>
                <p>
                  No transactions recorded yet. Import a CSV bank/card statement, scan receipts, or log an entry.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {(onOpenCsvImport || onOpenIngestModal) && (
                    <button
                      type="button"
                      onClick={onOpenCsvImport || onOpenIngestModal}
                      className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                    >
                      <Layers className="w-3.5 h-3.5" />
                      <span>Import / Export / Scan</span>
                    </button>
                  )}
                </div>
              </>
            ) : (
              <div>
                No transactions match the current filter criteria.{' '}
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="text-slate-900 dark:text-slate-100 font-medium underline underline-offset-4 ml-1"
                >
                  Reset filters
                </button>
              </div>
            )}
          </div>
        ) : (
          displayedRows.map((tx) => {
            const isExpanded = expandedTxId === tx.id;
            const sourceCount = tx.mergedSources?.length || 1;
            const splitSummary = getTransactionSplitSummary(tx);
            const categoryLabel =
              tx.transactionType === 'income'
                ? 'Income / Payroll'
                : tx.transactionType === 'transfer'
                ? 'Internal Transfer'
                : tx.category;

            return (
              <div
                key={`mobile-${tx.id}`}
                className={
                  tx.uncertainCategory ? 'bg-amber-50/40 dark:bg-amber-950/20' : ''
                }
              >
                <button
                  type="button"
                  onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
                  className="w-full min-h-[68px] px-4 py-3 flex items-center justify-between gap-3 text-left active:bg-slate-100/80 dark:active:bg-slate-800/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MerchantLogo
                      merchant={tx.merchant}
                      rawDescription={tx.rawDescription}
                      transactionType={tx.transactionType}
                      paymentMethod={tx.paymentMethod}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {tx.merchant}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        <span className="font-mono">{tx.date.slice(5)}</span>
                        <span aria-hidden="true"> · </span>
                        <span
                          className={
                            tx.uncertainCategory
                              ? 'text-amber-700 dark:text-amber-400 font-medium'
                              : ''
                          }
                        >
                          {categoryLabel}
                        </span>
                        {splitSummary.isSplit && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span
                              className={
                                splitSummary.owedUnpaid > 0
                                  ? 'text-amber-700 dark:text-amber-400 font-medium'
                                  : 'text-emerald-700 dark:text-emerald-400 font-medium'
                              }
                            >
                              {splitSummary.owedUnpaid > 0
                                ? `${formatCurrency(splitSummary.owedUnpaid)} owed`
                                : 'Split settled'}
                            </span>
                          </>
                        )}
                        {sourceCount > 1 && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-emerald-700 dark:text-emerald-400 font-mono">
                              {sourceCount}x merged
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="text-right">
                      <div className="text-sm font-mono tabular-nums font-semibold">
                        {tx.transactionType === 'refund' ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            -{formatCurrency(tx.amount)}
                          </span>
                        ) : tx.transactionType === 'income' ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            +{formatCurrency(tx.amount)}
                          </span>
                        ) : tx.transactionType === 'transfer' ? (
                          <span className="text-slate-400 dark:text-slate-500 line-through">
                            {formatCurrency(tx.amount)}
                          </span>
                        ) : splitSummary.isSplit ? (
                          <span className="text-slate-900 dark:text-slate-100">
                            {formatCurrency(splitSummary.personalShare)}
                          </span>
                        ) : (
                          <span className="text-slate-900 dark:text-slate-100">
                            {formatCurrency(tx.amount)}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                        {splitSummary.isSplit
                          ? `Paid ${formatCurrency(tx.amount)}`
                          : tx.status}
                      </div>
                    </div>
                    <ChevronRight
                      className={`w-4 h-4 text-slate-400 dark:text-slate-500 transition-transform ${
                        isExpanded ? 'rotate-90' : ''
                      }`}
                    />
                  </div>
                </button>

                {/* Mobile Inline Category, FX/Transfer Converter, Split Bill, Status & Provenance Drawer */}
                {isExpanded && (
                  <div className="px-4 pb-4 pt-1 bg-slate-50/90 dark:bg-slate-800/40 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs">
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 break-all">
                      {tx.rawDescription} · {tx.paymentMethod}
                    </div>

                    {renderInlineTypeAndFxPanel(tx)}

                    {splitSummary.isSplit && tx.splitBill && (
                      <div className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl space-y-2">
                        <div className="flex items-center justify-between text-[11px] font-medium text-slate-800 dark:text-slate-200">
                          <span>
                            Split Bill · Paid {formatCurrency(tx.amount)} · Your share{' '}
                            {formatCurrency(splitSummary.personalShare)}
                          </span>
                        </div>
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                          {tx.splitBill.participants.map((p) => (
                            <div
                              key={p.id}
                              className="py-1.5 flex items-center justify-between gap-2 text-[11px]"
                            >
                              <div className="min-w-0 truncate">
                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                  {p.friendName}
                                </span>
                                {p.itemNote && (
                                  <span className="text-slate-500 dark:text-slate-400">
                                    {' '}· {p.itemNote}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <span
                                  className={`font-mono tabular-nums font-semibold ${
                                    p.status === 'settled'
                                      ? 'text-emerald-700 dark:text-emerald-400 line-through'
                                      : 'text-amber-700 dark:text-amber-400'
                                  }`}
                                >
                                  {formatCurrency(p.amountOwed)}
                                </span>
                                {onToggleSplitParticipantSettled && (
                                  <button
                                    type="button"
                                    onClick={() => onToggleSplitParticipantSettled(tx.id, p.id)}
                                    className="px-2 py-1 font-semibold text-[10px] rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                                  >
                                    {p.status === 'settled' ? 'Mark Unpaid' : 'Mark Paid'}
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2.5">
                      {tx.transactionType !== 'income' && tx.transactionType !== 'transfer' && (
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                            Category
                          </label>
                          <select
                            aria-label={`Category for ${tx.merchant}`}
                            value={tx.category}
                            onChange={(e) =>
                              onUpdateCategory(tx.id, e.target.value as SpendingCategory)
                            }
                            className="w-full min-h-[42px] px-2.5 py-1.5 text-base bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                          >
                            {ALL_SPENDING_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <div
                        className={
                          tx.transactionType === 'income' || tx.transactionType === 'transfer'
                            ? 'col-span-2'
                            : ''
                        }
                      >
                        <label className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          Status
                        </label>
                        <select
                          aria-label={`Status for ${tx.merchant}`}
                          value={tx.status}
                          onChange={(e) =>
                            onUpdateStatus(tx.id, e.target.value as TransactionStatus)
                          }
                          className="w-full min-h-[42px] px-2.5 py-1.5 text-base bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100"
                        >
                          <option value="posted">Posted</option>
                          <option value="pending">Pending</option>
                          <option value="refunded">Refunded</option>
                        </select>
                      </div>
                    </div>

                    {tx.mergedSources && tx.mergedSources.length > 0 && (
                      <div className="space-y-1.5 pt-1">
                        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                          Cross-Source Provenance ({tx.mergedSources.length} feed
                          {tx.mergedSources.length === 1 ? '' : 's'} → counted once)
                        </div>
                        {tx.mergedSources.map((src, idx) => (
                          <div
                            key={`${tx.id}-mob-src-${idx}`}
                            className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-[11px]"
                          >
                            <div className="flex items-center justify-between font-medium text-slate-900 dark:text-slate-100">
                              <span>{src.source}</span>
                              <span className="font-mono text-slate-400">{src.referenceId}</span>
                            </div>
                            <div className="font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                              {src.rawDescriptor}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="pt-1 flex items-center justify-between gap-2">
                      {tx.transactionType === 'purchase' && onOpenSplitModal ? (
                        <button
                          type="button"
                          onClick={() => onOpenSplitModal(tx)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        >
                          <Split className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                          <span>{splitSummary.isSplit ? 'Edit Bill Split' : 'Split Bill'}</span>
                        </button>
                      ) : (
                        <span />
                      )}
                      <button
                        type="button"
                        onClick={() => onDeleteTransactions([tx.id])}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 rounded-lg hover:bg-rose-100 dark:hover:bg-rose-950/70 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete Transaction</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* DESKTOP HIGH-DENSITY FINANCIAL DATA GRID (>= 768px) */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-xs font-medium text-slate-500 dark:text-slate-400">
              <th className="py-2.5 pl-5 pr-2 w-9">
                <input
                  type="checkbox"
                  aria-label="Select all displayed transactions"
                  checked={allDisplayedSelected}
                  onChange={handleToggleSelectAllDisplayed}
                  disabled={displayedRows.length === 0}
                  className="rounded border-slate-300 dark:border-slate-600 text-slate-900 focus:ring-slate-500 cursor-pointer"
                />
              </th>
              <th className="py-2.5 px-3 whitespace-nowrap">Date</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Merchant / Store</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Spending Category</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Payment Method</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Source & Deduplication</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
              <th className="py-2.5 px-3 text-right whitespace-nowrap">Amount</th>
              <th className="py-2.5 pl-2 pr-5 text-right whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={9} className="py-10 text-center text-slate-500 dark:text-slate-400">
                  {transactions.length === 0 ? (
                    <div className="max-w-lg mx-auto space-y-3">
                      <p>
                        Your ledger is currently empty. Import a CSV statement, scan Gmail receipts with permission, or upload a receipt image/PDF.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        {(onOpenCsvImport || onOpenIngestModal) && (
                          <button
                            type="button"
                            onClick={onOpenCsvImport || onOpenIngestModal}
                            className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                          >
                            <Layers className="w-3.5 h-3.5" />
                            <span>Import / Export / Scan</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      No transactions match the current filter criteria.{' '}
                      <button
                        type="button"
                        onClick={handleResetFilters}
                        className="text-slate-900 dark:text-slate-100 font-medium underline underline-offset-4 ml-1"
                      >
                        Reset filters
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ) : (
              displayedRows.map((tx) => {
                const isExpanded = expandedTxId === tx.id;
                const isRowSelected = activeSelectedIds.includes(tx.id);
                const sourceCount = tx.mergedSources?.length || 1;
                const splitSummary = getTransactionSplitSummary(tx);
                const sourceNames =
                  tx.mergedSources && tx.mergedSources.length > 0
                    ? Array.from(new Set(tx.mergedSources.map((s) => s.source))).join(' · ')
                    : tx.source;

                return (
                  <React.Fragment key={tx.id}>
                    <tr
                      className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                        isRowSelected
                          ? 'bg-rose-50/40 dark:bg-rose-950/20'
                          : tx.uncertainCategory
                          ? 'bg-amber-50/30 dark:bg-amber-950/20'
                          : ''
                      } ${tx.transactionType === 'transfer' ? 'opacity-75' : ''}`}
                    >
                      <td className="py-3 pl-5 pr-2 whitespace-nowrap">
                        <input
                          type="checkbox"
                          aria-label={`Select ${tx.merchant} (${formatCurrency(tx.amount)})`}
                          checked={isRowSelected}
                          onChange={() => handleToggleSelectRow(tx.id)}
                          className="rounded border-slate-300 dark:border-slate-600 text-slate-900 focus:ring-slate-500 cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-3 font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        <div>{tx.date}</div>
                        {tx.time && (
                          <div className="text-[11px] text-slate-400 dark:text-slate-500">
                            {tx.time}
                          </div>
                        )}
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex items-center gap-2.5">
                          <MerchantLogo
                            merchant={tx.merchant}
                            rawDescription={tx.rawDescription}
                            transactionType={tx.transactionType}
                            paymentMethod={tx.paymentMethod}
                            size="sm"
                          />
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 dark:text-slate-100 flex items-center gap-1.5 flex-wrap">
                              <span>{tx.merchant}</span>
                              {splitSummary.isSplit && tx.splitBill && (
                                <span
                                  className={`text-[11px] font-medium ${
                                    splitSummary.owedUnpaid > 0
                                      ? 'text-amber-700 dark:text-amber-400'
                                      : 'text-emerald-700 dark:text-emerald-400'
                                  }`}
                                >
                                  ·{' '}
                                  {splitSummary.owedUnpaid > 0
                                    ? tx.splitBill.participants.length === 1
                                      ? `${tx.splitBill.participants[0].friendName} owes ${formatCurrency(
                                          splitSummary.owedUnpaid
                                        )}`
                                      : `${formatCurrency(splitSummary.owedUnpaid)} owed to you`
                                    : `${formatCurrency(splitSummary.settledReimbursed)} split paid back`}
                                </span>
                              )}
                              {tx.uncertainCategory && (
                                <span className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
                                  · Needs category confirmation
                                </span>
                              )}
                              {tx.transactionType === 'transfer' && (
                                <span className="inline-flex items-center gap-1.5 flex-wrap text-[11px] font-normal text-slate-500 dark:text-slate-400">
                                  <span>· Internal transfer (excluded from spend)</span>
                                  {onUpdateTransactionFields && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onUpdateTransactionFields(
                                            tx.id,
                                            { transactionType: 'purchase' },
                                            `Changed "${tx.merchant}" to External Spend (now included in spending totals).`
                                          )
                                        }
                                        className="font-semibold text-emerald-700 dark:text-emerald-400 hover:underline underline-offset-2"
                                      >
                                        Count as External Spend
                                      </button>
                                      <span aria-hidden="true">·</span>
                                      <button
                                        type="button"
                                        onClick={() => openRowFxConverter(tx, 'THB')}
                                        className="font-semibold text-slate-700 dark:text-slate-200 hover:underline underline-offset-2"
                                      >
                                        Convert THB → USD
                                      </button>
                                    </>
                                  )}
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 truncate max-w-xs">
                              {tx.rawDescription}
                            </div>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        {tx.transactionType === 'income' ? (
                          <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                            Income / Payroll
                          </span>
                        ) : tx.transactionType === 'transfer' ? (
                          <span className="text-slate-500 dark:text-slate-400">
                            Account Transfer (Not Spend)
                          </span>
                        ) : (
                          <select
                            aria-label={`Category for ${tx.merchant}`}
                            value={tx.category}
                            onChange={(e) =>
                              onUpdateCategory(tx.id, e.target.value as SpendingCategory)
                            }
                            className={`text-xs bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-600 focus:border-slate-900 dark:focus:border-slate-300 focus:outline-none py-0.5 pr-1 ${
                              tx.uncertainCategory
                                ? 'text-amber-800 dark:text-amber-300 font-semibold border-amber-400 dark:border-amber-500/70'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {ALL_SPENDING_CATEGORIES.map((cat) => (
                              <option
                                key={cat}
                                value={cat}
                                className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                              >
                                {cat}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      <td className="py-3 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {tx.paymentMethod}
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => setExpandedTxId(isExpanded ? null : tx.id)}
                          className="text-left group inline-flex items-center gap-1.5 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100"
                        >
                          <Layers className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-slate-700 dark:group-hover:text-slate-300 shrink-0" />
                          <span>{sourceNames}</span>
                          {sourceCount > 1 && (
                            <span className="font-mono text-[11px] text-emerald-700 dark:text-emerald-400">
                              ({sourceCount}x merged → 1)
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-slate-400 dark:text-slate-500" />
                          )}
                        </button>
                      </td>

                      <td className="py-3 px-3 whitespace-nowrap">
                        <select
                          aria-label={`Status for ${tx.merchant}`}
                          value={tx.status}
                          onChange={(e) =>
                            onUpdateStatus(tx.id, e.target.value as TransactionStatus)
                          }
                          className={`text-xs bg-transparent focus:outline-none font-medium ${
                            tx.status === 'posted'
                              ? 'text-slate-700 dark:text-slate-300'
                              : tx.status === 'pending'
                              ? 'text-amber-700 dark:text-amber-400'
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}
                        >
                          <option
                            value="posted"
                            className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          >
                            Posted
                          </option>
                          <option
                            value="pending"
                            className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          >
                            Pending
                          </option>
                          <option
                            value="refunded"
                            className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                          >
                            Refunded
                          </option>
                        </select>
                      </td>

                      <td className="py-3 px-3 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                        {tx.transactionType === 'refund' ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            -{formatCurrency(tx.amount)} (Refund)
                          </span>
                        ) : tx.transactionType === 'income' ? (
                          <span className="text-emerald-700 dark:text-emerald-400">
                            +{formatCurrency(tx.amount)}
                          </span>
                        ) : tx.transactionType === 'transfer' ? (
                          <span className="text-slate-400 dark:text-slate-500 line-through">
                            {formatCurrency(tx.amount)}
                          </span>
                        ) : splitSummary.isSplit ? (
                          <div>
                            <div className="text-slate-900 dark:text-slate-100 font-semibold">
                              {formatCurrency(splitSummary.personalShare)}
                            </div>
                            <div className="text-[10px] font-normal text-slate-500 dark:text-slate-400">
                              Paid {formatCurrency(tx.amount)} total
                            </div>
                          </div>
                        ) : (
                          <span className="text-slate-900 dark:text-slate-100">
                            {formatCurrency(tx.amount)}
                          </span>
                        )}
                      </td>

                      <td className="py-3 pl-2 pr-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center justify-end gap-1">
                          {onUpdateTransactionFields && (
                            <button
                              type="button"
                              onClick={() =>
                                isExpanded
                                  ? setExpandedTxId(null)
                                  : openRowFxConverter(tx)
                              }
                              title={`Convert THB / Foreign Currency to USD or change transfer type on "${tx.merchant}"`}
                              className="px-2 py-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                            >
                              <ArrowRightLeft className="w-3 h-3" />
                              <span>FX / Type</span>
                            </button>
                          )}

                          {tx.transactionType === 'purchase' && onOpenSplitModal && (
                            <button
                              type="button"
                              onClick={() => onOpenSplitModal(tx)}
                              title={
                                splitSummary.isSplit
                                  ? `Edit bill split on "${tx.merchant}"`
                                  : `Split "${tx.merchant}" (${formatCurrency(tx.amount)}) with friends`
                              }
                              className={`px-2 py-1 inline-flex items-center gap-1 text-[11px] font-medium rounded-lg transition-colors whitespace-nowrap ${
                                splitSummary.isSplit
                                  ? 'text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-950/70'
                                  : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                              }`}
                            >
                              <Split className="w-3 h-3" />
                              <span>{splitSummary.isSplit ? 'Edit Split' : 'Split'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => onDeleteTransactions([tx.id])}
                            title={`Delete "${tx.merchant}" (${formatCurrency(tx.amount)})`}
                            aria-label={`Delete transaction ${tx.merchant} for ${formatCurrency(tx.amount)}`}
                            className="p-1.5 inline-flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr className="bg-slate-50/90 dark:bg-slate-800/50">
                        <td colSpan={9} className="px-6 py-3.5 border-l-0">
                          <div className="space-y-3">
                            {renderInlineTypeAndFxPanel(tx)}
                            {splitSummary.isSplit && tx.splitBill && (
                              <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                                    Split Bill Breakdown · Paid {formatCurrency(tx.amount)} · Your share{' '}
                                    {formatCurrency(splitSummary.personalShare)}
                                    {tx.splitBill.note ? ` · "${tx.splitBill.note}"` : ''}
                                  </span>
                                  {onOpenSplitModal && (
                                    <button
                                      type="button"
                                      onClick={() => onOpenSplitModal(tx)}
                                      className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium underline underline-offset-4"
                                    >
                                      <Split className="w-3 h-3" />
                                      <span>Edit Split</span>
                                    </button>
                                  )}
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                  {tx.splitBill.participants.map((p) => (
                                    <div
                                      key={p.id}
                                      className="p-2.5 bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-between gap-2 text-xs"
                                    >
                                      <div className="min-w-0">
                                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                                          {p.friendName}
                                        </div>
                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                                          {p.itemNote || 'Covered share'} ·{' '}
                                          {p.status === 'settled' ? 'Paid back' : 'Owes you'}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <span
                                          className={`font-mono tabular-nums font-semibold ${
                                            p.status === 'settled'
                                              ? 'text-emerald-700 dark:text-emerald-400 line-through'
                                              : 'text-amber-700 dark:text-amber-400'
                                          }`}
                                        >
                                          {formatCurrency(p.amountOwed)}
                                        </span>
                                        {onToggleSplitParticipantSettled && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              onToggleSplitParticipantSettled(tx.id, p.id)
                                            }
                                            className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                                              p.status === 'settled'
                                                ? 'bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200'
                                                : 'bg-emerald-700 hover:bg-emerald-800 text-white'
                                            }`}
                                          >
                                            <Check className="w-3 h-3" />
                                            <span>
                                              {p.status === 'settled' ? 'Undo' : 'Paid'}
                                            </span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            <div className="flex items-center justify-between text-xs gap-4">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                Cross-Source Reconciliation Trail — Counted Once ({formatCurrency(tx.amount)})
                              </span>
                              <div className="flex items-center gap-3">
                                <span className="text-slate-500 dark:text-slate-400 font-mono">
                                  Canonical ID: {tx.id}
                                </span>
                                {tx.transactionType === 'purchase' && onOpenSplitModal && (
                                  <button
                                    type="button"
                                    onClick={() => onOpenSplitModal(tx)}
                                    className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white font-medium"
                                  >
                                    <Split className="w-3.5 h-3.5" />
                                    <span>{splitSummary.isSplit ? 'Edit Split' : 'Split Bill'}</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => onDeleteTransactions([tx.id])}
                                  className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 font-medium"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                  <span>Delete Record</span>
                                </button>
                              </div>
                            </div>
                            {tx.mergedSources && tx.mergedSources.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                                {tx.mergedSources.map((src, idx) => (
                                  <div
                                    key={`${tx.id}-src-${idx}`}
                                    className="p-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-xs space-y-1"
                                  >
                                    <div className="flex items-center justify-between font-medium text-slate-900 dark:text-slate-100">
                                      <span>{src.source}</span>
                                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                                        {src.referenceId}
                                      </span>
                                    </div>
                                    <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">
                                      {src.rawDescriptor}
                                    </div>
                                    <div className="text-[11px] text-slate-400 dark:text-slate-500 font-mono">
                                      Captured: {src.capturedAt} · Status: {src.statusAtCapture}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-600 dark:text-slate-400">
                                Single-source record from {tx.source} ({tx.rawDescription}).
                              </p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
