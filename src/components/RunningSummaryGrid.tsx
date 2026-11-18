import React from 'react';
import { DashboardSummaryMetrics, formatCurrency } from '../utils/financeMetrics';
import { NavTabId } from './MobileBottomNav';

interface RunningSummaryGridProps {
  metrics: DashboardSummaryMetrics;
  onNavigateTab: (tab: NavTabId, subView?: 'ledger' | 'subscriptions') => void;
}

export const RunningSummaryGrid: React.FC<RunningSummaryGridProps> = ({
  metrics,
  onNavigateTab,
}) => {
  const isCashFlowPositive = metrics.netCashFlow >= 0;
  const isMomLower = metrics.momSpendingChangePercent <= 0;

  return (
    <section
      aria-label="Running Spending Summary"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 tracking-tight">
            Running Spending Summary — November 2026
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Consolidated across Gmail, Apple Pay, Chase Sapphire ••4821, Amex Gold ••1094, and Checking ••8830 ·{' '}
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {metrics.duplicatesEliminatedCount} duplicate records merged
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
          <button
            type="button"
            onClick={() => onNavigateTab('splits')}
            className="hover:text-slate-900 dark:hover:text-slate-100 underline decoration-slate-300 dark:decoration-slate-700 underline-offset-4 transition-colors"
          >
            Owed to you (splits):{' '}
            <strong
              className={`font-mono tabular-nums ${
                metrics.totalSplitOwedToYou > 0
                  ? 'text-amber-700 dark:text-amber-400'
                  : 'text-slate-900 dark:text-slate-100'
              }`}
            >
              {formatCurrency(metrics.totalSplitOwedToYou)}
            </strong>
          </button>
          <span aria-hidden="true">·</span>
          <span>
            Excluded internal transfers:{' '}
            <strong className="font-mono text-slate-900 dark:text-slate-100">
              {formatCurrency(metrics.excludedTransfersThisMonth)}
            </strong>
          </span>
          <span aria-hidden="true">·</span>
          <span>
            Tracked refunds:{' '}
            <strong className="font-mono text-emerald-700 dark:text-emerald-400">
              {formatCurrency(metrics.totalRefundsThisMonth)}
            </strong>
          </span>
        </div>
      </div>

      {/* Top Row: 4 Core Financial Ledger KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800">
        {/* 1. Total spending this month */}
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Total spending this month
            </div>
            <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 tracking-tight">
              {formatCurrency(metrics.totalSpendingThisMonth)}
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {formatCurrency(metrics.postedSpendingThisMonth)} posted
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono text-amber-700 dark:text-amber-400">
              {formatCurrency(metrics.pendingSpendingThisMonth)} pending
            </span>
            {metrics.totalSplitCoveredThisMonth > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono text-slate-600 dark:text-slate-400">
                  Excl. {formatCurrency(metrics.totalSplitCoveredThisMonth)} covered for friends
                </span>
              </>
            )}
          </div>
        </div>

        {/* 2. Total income */}
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Total income</div>
            <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400 tracking-tight">
              {formatCurrency(metrics.totalIncomeThisMonth)}
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            <span>2 payroll direct deposits</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono text-slate-700 dark:text-slate-300">ACH ••8830</span>
          </div>
        </div>

        {/* 3. Net cash flow */}
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Net cash flow</div>
            <div
              className={`mt-2 text-2xl font-semibold font-mono tabular-nums tracking-tight ${
                isCashFlowPositive
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              {formatCurrency(metrics.netCashFlow, true)}
            </div>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            <span>
              {isCashFlowPositive ? 'Surplus after all net spending' : 'Deficit vs monthly income'}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono text-slate-700 dark:text-slate-300">
              {metrics.totalIncomeThisMonth > 0
                ? `${((metrics.netCashFlow / metrics.totalIncomeThisMonth) * 100).toFixed(1)}% saved`
                : '0%'}
            </span>
          </div>
        </div>

        {/* 4. Total subscriptions */}
        <div className="p-5 flex flex-col justify-between">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Total subscriptions & bills
              </div>
              <div className="mt-2 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 tracking-tight">
                {formatCurrency(metrics.totalSubscriptionsMonthly)}
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/mo</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('transactions', 'subscriptions')}
              className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Audit
            </button>
          </div>
          <div className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            <span>Est. annual cost (excl. rent):</span>{' '}
            <strong className="font-mono text-slate-800 dark:text-slate-200">
              {formatCurrency(metrics.totalSubscriptionsAnnual)}/yr
            </strong>
          </div>
        </div>
      </div>

      {/* Bottom Row: 4 Analytical Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
        {/* 5. Largest spending category */}
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Largest spending category
            </div>
            <div className="mt-1.5 text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {metrics.largestSpendingCategory.category}
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            <strong className="font-mono text-slate-900 dark:text-slate-100">
              {formatCurrency(metrics.largestSpendingCategory.amount)}
            </strong>
            <span aria-hidden="true"> · </span>
            <span className="font-mono">
              {metrics.largestSpendingCategory.percentage.toFixed(1)}% of gross spend
            </span>
          </div>
        </div>

        {/* 6. Largest individual purchase */}
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Largest individual purchase
            </div>
            <div className="mt-1.5 text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              {metrics.largestIndividualPurchase?.merchant ?? 'None'}
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-600 dark:text-slate-400">
            {metrics.largestIndividualPurchase ? (
              <>
                <strong className="font-mono text-slate-900 dark:text-slate-100">
                  {formatCurrency(metrics.largestIndividualPurchase.amount)}
                </strong>
                <span aria-hidden="true"> · </span>
                <span className="font-mono">{metrics.largestIndividualPurchase.date}</span>
              </>
            ) : (
              <span>No purchases recorded</span>
            )}
          </div>
        </div>

        {/* 7. Average daily spending */}
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Average daily spending
            </div>
            <div className="mt-1.5 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCurrency(metrics.averageDailySpending)}
              <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/day</span>
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            <span>Across 17 elapsed days in Nov</span>
            <span aria-hidden="true"> · </span>
            <span className="font-mono">
              {formatCurrency((metrics.totalSpendingThisMonth - 2450) / 17)}/d excl. rent
            </span>
          </div>
        </div>

        {/* 8. Month-over-month spending change */}
        <div className="p-5 flex flex-col justify-between">
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
              Month-over-month change
            </div>
            <div
              className={`mt-1.5 text-xl font-semibold font-mono tabular-nums ${
                isMomLower
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {metrics.momSpendingChangePercent > 0 ? '+' : ''}
              {metrics.momSpendingChangePercent.toFixed(1)}%
            </div>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            <span>vs. Oct total</span>{' '}
            <span className="font-mono text-slate-700 dark:text-slate-300">
              ({formatCurrency(metrics.previousMonthTotalSpending)})
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};
