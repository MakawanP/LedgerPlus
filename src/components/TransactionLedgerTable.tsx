import React, { useMemo, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  CreditCard,
  Layers,
  RotateCcw,
  Search,
  Tag,
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
import { formatCurrency } from '../utils/financeMetrics';

type DateRangePreset =
  | 'nov_all'
  | 'today'
  | 'last_3_days'
  | 'last_7_days'
  | 'early_nov'
  | 'oct_all'
  | 'all_time'
  | 'custom';

interface TransactionLedgerTableProps {
  transactions: Transaction[];
  onUpdateCategory: (id: string, category: SpendingCategory) => void;
  onUpdateStatus: (id: string, status: TransactionStatus) => void;
  compactLimit?: number;
}

export const TransactionLedgerTable: React.FC<TransactionLedgerTableProps> = ({
  transactions,
  onUpdateCategory,
  onUpdateStatus,
  compactLimit,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDateRange, setSelectedDateRange] = useState<DateRangePreset>('nov_all');
  const [customStartDate, setCustomStartDate] = useState('2026-11-01');
  const [customEndDate, setCustomEndDate] = useState('2026-11-17');
  const [selectedCategory, setSelectedCategory] = useState<'All' | SpendingCategory>('All');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>('All');
  const [selectedSource, setSelectedSource] = useState<'All' | DataSource>('All');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<
    'all' | TransactionType | 'deduplicated' | 'uncertain'
  >('all');
  const [expandedTxId, setExpandedTxId] = useState<string | null>(null);

  // Extract distinct payment methods dynamically from transactions
  const availablePaymentMethods = useMemo(() => {
    const methods = Array.from(new Set(transactions.map((t) => t.paymentMethod))).sort();
    return methods;
  }, [transactions]);

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedDateRange !== 'nov_all' ||
    selectedCategory !== 'All' ||
    selectedPaymentMethod !== 'All' ||
    selectedSource !== 'All' ||
    selectedTypeFilter !== 'all';

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedDateRange('nov_all');
    setCustomStartDate('2026-11-01');
    setCustomEndDate('2026-11-17');
    setSelectedCategory('All');
    setSelectedPaymentMethod('All');
    setSelectedSource('All');
    setSelectedTypeFilter('all');
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter((tx) => {
      // 1. Date Range Filter
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

      // 2. Category Filter
      if (selectedCategory !== 'All' && tx.category !== selectedCategory) {
        return false;
      }

      // 3. Payment Method Filter
      if (selectedPaymentMethod !== 'All') {
        if (selectedPaymentMethod === 'GROUP_APPLE_PAY') {
          if (!tx.paymentMethod.toLowerCase().includes('apple pay')) return false;
        } else if (selectedPaymentMethod === 'GROUP_CHASE') {
          if (!tx.paymentMethod.toLowerCase().includes('chase')) return false;
        } else if (selectedPaymentMethod === 'GROUP_AMEX') {
          if (!tx.paymentMethod.toLowerCase().includes('amex')) return false;
        } else if (tx.paymentMethod !== selectedPaymentMethod) {
          return false;
        }
      }

      // 4. Source Filter
      if (selectedSource !== 'All') {
        const matchesPrimary = tx.source === selectedSource;
        const matchesMerged = tx.mergedSources?.some((m) => m.source === selectedSource);
        if (!matchesPrimary && !matchesMerged) return false;
      }

      // 5. Record Type / Status Segment Filter
      if (selectedTypeFilter === 'deduplicated' && (!tx.mergedSources || tx.mergedSources.length < 2)) {
        return false;
      } else if (selectedTypeFilter === 'uncertain' && !tx.uncertainCategory) {
        return false;
      } else if (
        selectedTypeFilter !== 'all' &&
        selectedTypeFilter !== 'deduplicated' &&
        selectedTypeFilter !== 'uncertain' &&
        tx.transactionType !== selectedTypeFilter
      ) {
        return false;
      }

      // 6. Search Query (Merchant, Raw Descriptor, Category, Payment Method, Date, Amount)
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const inMerchant = tx.merchant.toLowerCase().includes(q);
        const inRaw = tx.rawDescription.toLowerCase().includes(q);
        const inCat = tx.category.toLowerCase().includes(q);
        const inPayment = tx.paymentMethod.toLowerCase().includes(q);
        const inDate = tx.date.includes(q);
        const inAmount = tx.amount.toFixed(2).includes(q);
        if (!inMerchant && !inRaw && !inCat && !inPayment && !inDate && !inAmount) {
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
      .reduce((acc, t) => acc + t.amount, 0);
  }, [filteredTransactions]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Filter & Search Toolbar */}
      <div className="p-4 sm:px-6 border-b border-slate-200 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Unified Multi-Source Transaction Ledger
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Each purchase is counted once across Gmail, Apple Pay, and Bank Statements · Transfers & refunds separated
            </p>
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleResetFilters}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors self-start lg:self-auto whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset All Filters</span>
            </button>
          )}
        </div>

        {/* Search Input + Dropdown Filters Row (Date Range, Category, Payment Method, Source) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center">
          {/* Search Input (4 cols) */}
          <div className="relative lg:col-span-4">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              aria-label="Search transactions"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search merchant, descriptor, amount ($), or card..."
              className="w-full pl-8 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search query"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Date Range Dropdown Filter (3 cols) */}
          <div className="relative lg:col-span-3">
            <Calendar className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="Filter by date range"
              value={selectedDateRange}
              onChange={(e) => setSelectedDateRange(e.target.value as DateRangePreset)}
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors"
            >
              <option value="nov_all">Date: This Month (Nov 1 – Nov 17)</option>
              <option value="today">Date: Today (Nov 17, 2026)</option>
              <option value="last_3_days">Date: Last 3 Days (Nov 15 – Nov 17)</option>
              <option value="last_7_days">Date: Last 7 Days (Nov 11 – Nov 17)</option>
              <option value="early_nov">Date: Early Nov (Nov 1 – Nov 10)</option>
              <option value="oct_all">Date: Last Month (October 2026)</option>
              <option value="all_time">Date: All Recorded (Oct – Nov 2026)</option>
              <option value="custom">Date: Custom Range...</option>
            </select>
          </div>

          {/* Category Dropdown Filter (2 cols) */}
          <div className="relative lg:col-span-2">
            <Tag className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="Filter by spending category"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value as 'All' | SpendingCategory)}
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors"
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
            <CreditCard className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <select
              aria-label="Filter by payment method"
              value={selectedPaymentMethod}
              onChange={(e) => setSelectedPaymentMethod(e.target.value)}
              className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors"
            >
              <option value="All">Payment: All Methods</option>
              <optgroup label="By Payment Network / Card">
                <option value="GROUP_APPLE_PAY">Apple Pay (All Cards)</option>
                <option value="GROUP_CHASE">Chase Sapphire ••4821 (All)</option>
                <option value="GROUP_AMEX">Amex Gold ••1094 (All)</option>
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
              className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:bg-white focus:border-slate-900 transition-colors"
            >
              <option value="All">Source: All</option>
              <option value="Gmail">Gmail</option>
              <option value="Apple Pay">Apple Pay</option>
              <option value="Bank Statement">Bank Feed</option>
              <option value="Uploaded Statement">CSV Export</option>
            </select>
          </div>
        </div>

        {/* Custom Date Range Picker Row (shown when Date: Custom Range is active) */}
        {selectedDateRange === 'custom' && (
          <div className="flex flex-wrap items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
            <span className="font-medium text-slate-700">Custom Date Window:</span>
            <div className="flex items-center gap-2">
              <label htmlFor="tx-start-date" className="text-slate-500">
                From
              </label>
              <input
                id="tx-start-date"
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="px-2.5 py-1 font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
              />
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="tx-end-date" className="text-slate-500">
                To
              </label>
              <input
                id="tx-end-date"
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="px-2.5 py-1 font-mono bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
              />
            </div>
          </div>
        )}

        {/* Interactive Type Filter Bar (Functional Segmented Buttons) */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'all', label: 'All Records' },
                { id: 'purchase', label: 'Purchases Only' },
                { id: 'deduplicated', label: 'Cross-Source Merged' },
                { id: 'uncertain', label: 'Needs Review' },
                { id: 'refund', label: 'Refunds' },
                { id: 'income', label: 'Income' },
                { id: 'transfer', label: 'Excluded Transfers' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedTypeFilter(tab.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  selectedTypeFilter === tab.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="text-xs text-slate-500 font-mono">
            Showing {displayedRows.length} of {filteredTransactions.length} matching · Purchases sum:{' '}
            <strong className="text-slate-900">{formatCurrency(filteredPurchaseTotal)}</strong>
          </div>
        </div>
      </div>

      {/* High-Density Financial Data Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
              <th className="py-2.5 pl-6 pr-3 whitespace-nowrap">Date</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Merchant / Store</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Spending Category</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Payment Method</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Source & Deduplication</th>
              <th className="py-2.5 px-3 whitespace-nowrap">Status</th>
              <th className="py-2.5 pl-3 pr-6 text-right whitespace-nowrap">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 text-xs">
            {displayedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-10 text-center text-slate-500">
                  No transactions match the current filter criteria.{' '}
                  <button
                    type="button"
                    onClick={handleResetFilters}
                    className="text-slate-900 font-medium underline underline-offset-4 ml-1"
                  >
                    Reset filters
                  </button>
                </td>
              </tr>
            ) : (
              displayedRows.map((tx) => {
                const isExpanded = expandedTxId === tx.id;
                const sourceCount = tx.mergedSources?.length || 1;
                const sourceNames =
                  tx.mergedSources && tx.mergedSources.length > 0
                    ? Array.from(new Set(tx.mergedSources.map((s) => s.source))).join(' · ')
                    : tx.source;

                return (
                  <React.Fragment key={tx.id}>
                    <tr
                      className={`hover:bg-slate-50/80 transition-colors ${
                        tx.uncertainCategory ? 'bg-amber-50/30' : ''
                      } ${tx.transactionType === 'transfer' ? 'opacity-75' : ''}`}
                    >
                      {/* Date */}
                      <td className="py-3 pl-6 pr-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                        <div>{tx.date}</div>
                        {tx.time && (
                          <div className="text-[11px] text-slate-400">{tx.time}</div>
                        )}
                      </td>

                      {/* Merchant */}
                      <td className="py-3 px-3">
                        <div className="font-medium text-slate-900 flex items-center gap-1.5">
                          <span>{tx.merchant}</span>
                          {tx.uncertainCategory && (
                            <span className="text-[11px] font-medium text-amber-700">
                              · Needs category confirmation
                            </span>
                          )}
                          {tx.transactionType === 'transfer' && (
                            <span className="text-[11px] font-normal text-slate-500">
                              · Internal transfer (excluded from spend)
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 truncate max-w-xs">
                          {tx.rawDescription}
                        </div>
                      </td>

                      {/* Category */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        {tx.transactionType === 'income' ? (
                          <span className="text-emerald-700 font-medium">Income / Payroll</span>
                        ) : tx.transactionType === 'transfer' ? (
                          <span className="text-slate-500">Account Transfer (Not Spend)</span>
                        ) : (
                          <select
                            aria-label={`Category for ${tx.merchant}`}
                            value={tx.category}
                            onChange={(e) =>
                              onUpdateCategory(tx.id, e.target.value as SpendingCategory)
                            }
                            className={`text-xs bg-transparent border-b border-transparent hover:border-slate-300 focus:border-slate-900 focus:outline-none py-0.5 pr-1 ${
                              tx.uncertainCategory
                                ? 'text-amber-800 font-semibold border-amber-400'
                                : 'text-slate-700'
                            }`}
                          >
                            {ALL_SPENDING_CATEGORIES.map((cat) => (
                              <option key={cat} value={cat}>
                                {cat}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>

                      {/* Payment Method */}
                      <td className="py-3 px-3 text-slate-600 whitespace-nowrap">
                        {tx.paymentMethod}
                      </td>

                      {/* Source & Deduplication */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedTxId(isExpanded ? null : tx.id)
                          }
                          className="text-left group inline-flex items-center gap-1.5 text-slate-700 hover:text-slate-900"
                        >
                          <Layers className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-700 shrink-0" />
                          <span>{sourceNames}</span>
                          {sourceCount > 1 && (
                            <span className="font-mono text-[11px] text-emerald-700">
                              ({sourceCount}x merged → 1)
                            </span>
                          )}
                          {isExpanded ? (
                            <ChevronUp className="w-3 h-3 text-slate-400" />
                          ) : (
                            <ChevronDown className="w-3 h-3 text-slate-400" />
                          )}
                        </button>
                      </td>

                      {/* Status */}
                      <td className="py-3 px-3 whitespace-nowrap">
                        <select
                          aria-label={`Status for ${tx.merchant}`}
                          value={tx.status}
                          onChange={(e) =>
                            onUpdateStatus(tx.id, e.target.value as TransactionStatus)
                          }
                          className={`text-xs bg-transparent focus:outline-none font-medium ${
                            tx.status === 'posted'
                              ? 'text-slate-700'
                              : tx.status === 'pending'
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          <option value="posted">Posted</option>
                          <option value="pending">Pending</option>
                          <option value="refunded">Refunded</option>
                        </select>
                      </td>

                      {/* Amount */}
                      <td className="py-3 pl-3 pr-6 text-right font-mono tabular-nums font-medium whitespace-nowrap">
                        {tx.transactionType === 'refund' ? (
                          <span className="text-emerald-700">
                            -{formatCurrency(tx.amount)} (Refund)
                          </span>
                        ) : tx.transactionType === 'income' ? (
                          <span className="text-emerald-700">
                            +{formatCurrency(tx.amount)}
                          </span>
                        ) : tx.transactionType === 'transfer' ? (
                          <span className="text-slate-400 line-through">
                            {formatCurrency(tx.amount)}
                          </span>
                        ) : (
                          <span className="text-slate-900">
                            {formatCurrency(tx.amount)}
                          </span>
                        )}
                      </td>
                    </tr>

                    {/* Expanded Deduplication Provenance Drawer */}
                    {isExpanded && (
                      <tr className="bg-slate-50/90">
                        <td colSpan={7} className="px-6 py-3.5 border-l-0">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-slate-800">
                                Cross-Source Reconciliation Trail — Counted Once ({formatCurrency(tx.amount)})
                              </span>
                              <span className="text-slate-500 font-mono">
                                Canonical ID: {tx.id}
                              </span>
                            </div>
                            {tx.mergedSources && tx.mergedSources.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                                {tx.mergedSources.map((src, idx) => (
                                  <div
                                    key={`${tx.id}-src-${idx}`}
                                    className="p-2.5 bg-white border border-slate-200 rounded-lg text-xs space-y-1"
                                  >
                                    <div className="flex items-center justify-between font-medium text-slate-900">
                                      <span>{src.source}</span>
                                      <span className="font-mono text-[11px] text-slate-500">
                                        {src.referenceId}
                                      </span>
                                    </div>
                                    <div className="font-mono text-[11px] text-slate-600 truncate">
                                      {src.rawDescriptor}
                                    </div>
                                    <div className="text-[11px] text-slate-400 font-mono">
                                      Captured: {src.capturedAt} · Status: {src.statusAtCapture}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-600">
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
