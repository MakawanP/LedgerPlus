import React, { useMemo, useState } from 'react';
import {
  CategorySummaryItem,
  DashboardSummaryMetrics,
  MerchantRankItem,
  formatCurrency,
} from '../utils/financeMetrics';
import { SpendingCategory, SubscriptionItem, Transaction } from '../types/finance';
import { getBudgetHealthStatus } from './CategoryBudgetDistribution';
import { ProjectedCashFlowChart } from './ProjectedCashFlowChart';
import { MerchantLogo } from './MerchantLogo';

interface FinancialReportsSectionProps {
  transactions: Transaction[];
  subscriptions: SubscriptionItem[];
  summaryMetrics: DashboardSummaryMetrics;
  categoryBreakdown: CategorySummaryItem[];
  topMerchants: MerchantRankItem[];
  categoryBudgets: Record<SpendingCategory, number>;
  onUpdateCategoryBudget: (category: SpendingCategory, newLimit: number) => void;
}

export const FinancialReportsSection: React.FC<FinancialReportsSectionProps> = ({
  transactions,
  subscriptions,
  summaryMetrics,
  categoryBreakdown,
  topMerchants,
  categoryBudgets,
  onUpdateCategoryBudget,
}) => {
  const [reportCadence, setReportCadence] = useState<'daily' | 'weekly' | 'monthly'>('monthly');
  const [selectedDate, setSelectedDate] = useState<string>('2026-11-17');
  const [selectedWeekRange, setSelectedWeekRange] = useState<'nov11_17' | 'nov01_10'>('nov11_17');

  const novTransactions = useMemo(
    () => transactions.filter((t) => t.monthKey === '2026-11'),
    [transactions]
  );

  // Unique dates in November for the Daily Report selector
  const availableDates = useMemo(() => {
    const dates = Array.from(new Set(novTransactions.map((t) => t.date))).sort((a, b) =>
      b.localeCompare(a)
    );
    return dates.length > 0 ? dates : ['2026-11-17'];
  }, [novTransactions]);

  // Daily Report data
  const dailyData = useMemo(() => {
    const dayRows = novTransactions.filter((t) => t.date === selectedDate);
    const dayPurchases = dayRows.filter((t) => t.transactionType === 'purchase');
    const dayTotal = dayPurchases.reduce((acc, t) => acc + t.amount, 0);
    return {
      dayRows,
      dayTotal,
      purchaseCount: dayPurchases.length,
    };
  }, [novTransactions, selectedDate]);

  // Weekly Report data
  const weeklyData = useMemo(() => {
    const inRange = novTransactions.filter((t) => {
      if (selectedWeekRange === 'nov11_17') {
        return t.date >= '2026-11-11' && t.date <= '2026-11-17';
      }
      return t.date >= '2026-11-01' && t.date <= '2026-11-10';
    });

    const purchases = inRange.filter((t) => t.transactionType === 'purchase');
    const totalSpent = purchases.reduce((acc, t) => acc + t.amount, 0);

    const byCatMap = new Map<SpendingCategory, number>();
    purchases.forEach((t) => {
      byCatMap.set(t.category, (byCatMap.get(t.category) || 0) + t.amount);
    });
    const byCategory = Array.from(byCatMap.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        share: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const biggestPurchases = [...purchases].sort((a, b) => b.amount - a.amount).slice(0, 5);
    const unusualItems = purchases.filter(
      (t) => Boolean(t.anomalyNote) || Boolean(t.uncertainCategory) || t.amount >= 150
    );

    return {
      totalSpent,
      purchaseCount: purchases.length,
      byCategory,
      biggestPurchases,
      unusualItems,
    };
  }, [novTransactions, selectedWeekRange]);

  return (
    <section className="space-y-6">
      {/* Report Cadence Switcher Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Financial Reports — Daily, Weekly & Monthly Analysis
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Switch between itemized daily logs, 7-day category & spike analysis, and full monthly cash flow statements
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start sm:self-auto">
          {(
            [
              { id: 'daily', label: 'Daily Report' },
              { id: 'weekly', label: 'Weekly Report' },
              { id: 'monthly', label: 'Monthly Report' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setReportCadence(tab.id)}
              className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                reportCadence === tab.id
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 1. DAILY REPORT VIEW */}
      {reportCadence === 'daily' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <label
                htmlFor="daily-date-select"
                className="text-xs font-medium text-slate-600 dark:text-slate-400"
              >
                Select Date:
              </label>
              <select
                id="daily-date-select"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-1.5 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              >
                {availableDates.map((d) => (
                  <option key={d} value={d}>
                    {d} {d === '2026-11-17' ? '(Today)' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                Daily Total Spending:{' '}
                <strong className="font-mono text-sm text-slate-900 dark:text-slate-100">
                  {formatCurrency(dailyData.dayTotal)}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono text-slate-600 dark:text-slate-400">
                {dailyData.purchaseCount} {dailyData.purchaseCount === 1 ? 'purchase' : 'purchases'}
              </span>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-medium">
                  <th className="py-2.5 pl-6 pr-3">Time</th>
                  <th className="py-2.5 px-3">Merchant</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Payment Method</th>
                  <th className="py-2.5 px-3">Source</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 pl-3 pr-6 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {dailyData.dayRows.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 pl-6 pr-3 font-mono text-slate-500 dark:text-slate-400">
                      {tx.time || '—'}
                    </td>
                    <td className="py-3 px-3 font-medium text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2.5">
                        <MerchantLogo
                          merchant={tx.merchant}
                          rawDescription={tx.rawDescription}
                          transactionType={tx.transactionType}
                          paymentMethod={tx.paymentMethod}
                          size="sm"
                        />
                        <span>
                          {tx.merchant}
                          {tx.transactionType !== 'purchase' && (
                            <span className="text-slate-500 dark:text-slate-400 font-normal">
                              {' '}· ({tx.transactionType})
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300">{tx.category}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300">{tx.paymentMethod}</td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                      {tx.mergedSources && tx.mergedSources.length > 1
                        ? `${tx.mergedSources.map((m) => m.source).join(' + ')} (Deduplicated)`
                        : tx.source}
                    </td>
                    <td className="py-3 px-3 text-slate-600 dark:text-slate-300 capitalize">
                      {tx.status}
                    </td>
                    <td className="py-3 pl-3 pr-6 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100">
                      {tx.transactionType === 'refund'
                        ? `-${formatCurrency(tx.amount)}`
                        : formatCurrency(tx.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. WEEKLY REPORT VIEW */}
      {reportCadence === 'weekly' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                Select Week Window:
              </span>
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSelectedWeekRange('nov11_17')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    selectedWeekRange === 'nov11_17'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Nov 11 – Nov 17 (Current Week)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedWeekRange('nov01_10')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                    selectedWeekRange === 'nov01_10'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Nov 01 – Nov 10 (Prior Period)
                </button>
              </div>
            </div>

            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-600 dark:text-slate-300">
                Weekly Total Spending:{' '}
                <strong className="font-mono text-base text-slate-900 dark:text-slate-100">
                  {formatCurrency(weeklyData.totalSpent)}
                </strong>
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              <span className="font-mono text-slate-600 dark:text-slate-400">
                {weeklyData.purchaseCount} purchases
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
            {/* Weekly Spending by Category */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Weekly Spending by Category
              </h3>
              <div className="space-y-3">
                {weeklyData.byCategory.map((item) => (
                  <div key={item.category} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-800 dark:text-slate-200">
                        {item.category}
                      </span>
                      <span className="font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {formatCurrency(item.amount)} · {item.share.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-900 dark:bg-slate-200 rounded-full"
                        style={{ width: `${Math.min(100, Math.max(2, item.share))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Weekly Biggest Purchases & Unusual Spending */}
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  Biggest Purchases This Week
                </h3>
                <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {weeklyData.biggestPurchases.map((tx) => (
                    <div key={tx.id} className="py-2.5 flex items-center justify-between gap-2.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <MerchantLogo
                          merchant={tx.merchant}
                          rawDescription={tx.rawDescription}
                          transactionType={tx.transactionType}
                          paymentMethod={tx.paymentMethod}
                          size="sm"
                        />
                        <div className="min-w-0 truncate">
                          <span className="font-medium text-slate-900 dark:text-slate-100">
                            {tx.merchant}
                          </span>
                          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700"> · </span>
                          <span className="text-slate-500 dark:text-slate-400">{tx.category}</span>
                          <span aria-hidden="true" className="text-slate-300 dark:text-slate-700"> · </span>
                          <span className="font-mono text-slate-400 dark:text-slate-500">{tx.date}</span>
                        </div>
                      </div>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                        {formatCurrency(tx.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Unusual or High-Variance Spending Flagged
                </h4>
                <div className="mt-2 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                  {weeklyData.unusualItems.map((u) => (
                    <div key={`unusual-${u.id}`} className="flex items-start justify-between gap-3">
                      <span>
                        <strong className="text-slate-800 dark:text-slate-200">{u.merchant}</strong>:{' '}
                        {u.anomalyNote ||
                          u.uncertaintyReason ||
                          `High-value single charge in ${u.category}`}
                      </span>
                      <span className="font-mono text-slate-900 dark:text-slate-100 shrink-0">
                        {formatCurrency(u.amount)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 3. MONTHLY REPORT VIEW */}
      {reportCadence === 'monthly' && (
        <div className="space-y-6">
          {/* Monthly Executive Cash Flow Strip */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800">
            <div className="p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Total money spent (Nov)</div>
              <div className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency(summaryMetrics.totalSpendingThisMonth)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Gross: {formatCurrency(summaryMetrics.grossPurchasesThisMonth)} − Refunds:{' '}
                {formatCurrency(summaryMetrics.totalRefundsThisMonth)}
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Total income (Nov)</div>
              <div className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatCurrency(summaryMetrics.totalIncomeThisMonth)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Direct deposit verified
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Net cash flow</div>
              <div className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
                {formatCurrency(summaryMetrics.netCashFlow, true)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Transfers excluded ({formatCurrency(summaryMetrics.excludedTransfersThisMonth)})
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Recurring expenses (incl. rent)
              </div>
              <div className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency(summaryMetrics.totalSubscriptionsMonthly + 2450)}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                {formatCurrency(summaryMetrics.totalSubscriptionsMonthly)} non-rent recurring
              </div>
            </div>

            <div className="p-5">
              <div className="text-xs text-slate-500 dark:text-slate-400">Comparison vs. October</div>
              <div className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {summaryMetrics.momSpendingChangePercent > 0 ? '+' : ''}
                {summaryMetrics.momSpendingChangePercent.toFixed(1)}%
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                Oct Total: {formatCurrency(summaryMetrics.previousMonthTotalSpending)}
              </div>
            </div>
          </div>

          {/* Projected Monthly Cash Flow & End-of-Month Balance Forecast Chart */}
          <ProjectedCashFlowChart
            transactions={transactions}
            subscriptions={subscriptions}
            summaryMetrics={summaryMetrics}
          />

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Spending by Category + MoM Comparison Table (7 cols) */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Spending by Category (All 16 Categories · Nov vs. Oct)
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Includes exact category amounts, share of spend, and month-over-month delta
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-medium">
                      <th className="py-2.5 pl-6 pr-3">Category & Budget Progress</th>
                      <th className="py-2.5 px-3 text-right">Nov Spent</th>
                      <th className="py-2.5 px-3 text-right">Monthly Limit</th>
                      <th className="py-2.5 px-3 text-right">Share</th>
                      <th className="py-2.5 pl-3 pr-6 text-right">vs. Oct</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {categoryBreakdown.map((cat) => {
                      const limit = categoryBudgets[cat.category] ?? 0;
                      const health = getBudgetHealthStatus(cat.amount, limit);
                      const isExceeded = health.status === 'exceeded';
                      const isApproaching = health.status === 'approaching';
                      const barWidth =
                        limit > 0
                          ? Math.min(100, Math.max(cat.amount > 0 ? 3 : 0, health.utilizationPercent))
                          : Math.min(100, cat.percentageOfTotal);

                      return (
                        <tr
                          key={cat.category}
                          className={`hover:bg-slate-50/70 dark:hover:bg-slate-800/40 ${
                            isExceeded
                              ? 'bg-rose-50/20 dark:bg-rose-950/20'
                              : isApproaching
                              ? 'bg-amber-50/20 dark:bg-amber-950/20'
                              : ''
                          }`}
                        >
                          <td className="py-2.5 pl-6 pr-3 font-medium text-slate-900 dark:text-slate-100">
                            <div className="flex items-center justify-between gap-2">
                              <span>
                                {cat.category}{' '}
                                <span className="text-slate-400 dark:text-slate-500 font-mono font-normal">
                                  ({cat.transactionCount})
                                </span>
                              </span>
                              {limit > 0 && (
                                <span
                                  className={`text-[11px] font-mono ${
                                    isExceeded
                                      ? 'text-rose-700 dark:text-rose-400 font-semibold'
                                      : isApproaching
                                      ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                      : 'text-slate-500 dark:text-slate-400'
                                  }`}
                                >
                                  {health.utilizationPercent.toFixed(0)}% of budget
                                </span>
                              )}
                            </div>
                            <div className="relative w-full h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full mt-1 overflow-hidden">
                              {limit > 0 && (
                                <div
                                  aria-hidden="true"
                                  className="absolute top-0 bottom-0 left-[80%] w-px bg-slate-300 dark:bg-slate-600 z-10"
                                />
                              )}
                              <div
                                className={`h-full rounded-full ${
                                  isExceeded
                                    ? 'bg-rose-600 dark:bg-rose-500'
                                    : isApproaching
                                    ? 'bg-amber-500 dark:bg-amber-400'
                                    : 'bg-slate-800 dark:bg-slate-200'
                                }`}
                                style={{
                                  width: `${barWidth}%`,
                                }}
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                            {formatCurrency(cat.amount)}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            <input
                              type="number"
                              min="0"
                              step="5"
                              aria-label={`Monthly limit for ${cat.category}`}
                              value={limit}
                              onChange={(e) => {
                                const val = parseFloat(e.target.value);
                                if (!isNaN(val) && val >= 0) {
                                  onUpdateCategoryBudget(cat.category, val);
                                }
                              }}
                              className="w-20 px-1.5 py-0.5 text-right text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-900 dark:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {cat.percentageOfTotal.toFixed(1)}%
                          </td>
                          <td className="py-2.5 pl-3 pr-6 text-right font-mono tabular-nums whitespace-nowrap">
                            {cat.previousMonthAmount === 0 && cat.amount === 0 ? (
                              <span className="text-slate-400 dark:text-slate-600">—</span>
                            ) : (
                              <span
                                className={
                                  cat.momDeltaAmount > 0
                                    ? 'text-amber-700 dark:text-amber-400'
                                    : cat.momDeltaAmount < 0
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-slate-500 dark:text-slate-400'
                                }
                              >
                                {formatCurrency(cat.momDeltaAmount, true)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Top 10 Merchants + Potential Savings Opportunities (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Top 10 Merchants — November 2026
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Ranked by actual deduplicated purchase volume
                  </p>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {topMerchants.map((m, idx) => (
                    <div
                      key={m.merchant}
                      className="px-6 py-2.5 flex items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-slate-400 dark:text-slate-500 w-5 shrink-0">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <MerchantLogo merchant={m.merchant} size="sm" />
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {m.merchant}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {m.category} · {m.transactionCount}{' '}
                            {m.transactionCount === 1 ? 'tx' : 'txs'}
                          </div>
                        </div>
                      </div>
                      <div className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                        {formatCurrency(m.totalSpent)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Potential Savings Opportunities */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Potential Monthly Savings Opportunities
                  </h3>
                  <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    Save $148.44/mo ($1,781/yr)
                  </span>
                </div>
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs text-slate-600 dark:text-slate-400">
                  <div className="py-2.5 flex items-start justify-between gap-3">
                    <span>
                      <strong className="text-slate-900 dark:text-slate-100">
                        Cancel unused Adobe CC & completed Coursera
                      </strong>
                      <br />
                      Zero usage on Adobe CC in 65 days; Coursera specialization already finished.
                    </span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400 font-medium shrink-0">
                      +$108.99/mo
                    </span>
                  </div>
                  <div className="py-2.5 flex items-start justify-between gap-3">
                    <span>
                      <strong className="text-slate-900 dark:text-slate-100">
                        Remove duplicate Sweetgreen authorization
                      </strong>
                      <br />
                      Ensure pending $19.45 second charge from Nov 14 drops off Amex Gold.
                    </span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400 font-medium shrink-0">
                      +$19.45
                    </span>
                  </div>
                  <div className="py-2.5 flex items-start justify-between gap-3">
                    <span>
                      <strong className="text-slate-900 dark:text-slate-100">
                        Bundle Apple iCloud+ & streaming tier
                      </strong>
                      <br />
                      Downgrade Netflix 4K to Standard or bundle family cloud storage.
                    </span>
                    <span className="font-mono text-emerald-700 dark:text-emerald-400 font-medium shrink-0">
                      +$20.00/mo
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
