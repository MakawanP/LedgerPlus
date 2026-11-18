import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownWideNarrow,
  ArrowRight,
  Check,
  CheckCircle2,
  SlidersHorizontal,
} from 'lucide-react';
import { SpendingCategory } from '../types/finance';
import { CategorySummaryItem, formatCurrency } from '../utils/financeMetrics';

interface CategoryBudgetDistributionProps {
  categoryBreakdown: CategorySummaryItem[];
  categoryBudgets: Record<SpendingCategory, number>;
  onUpdateCategoryBudget: (category: SpendingCategory, newLimit: number) => void;
  onUpdateMultipleBudgets: (updated: Record<SpendingCategory, number>) => void;
  onNavigateReports?: () => void;
}

export type BudgetHealthStatus = 'exceeded' | 'approaching' | 'on_track' | 'unbudgeted';
type BudgetSortMode = 'over_budget_first' | 'highest_spend';

export interface BudgetHealthMetrics {
  status: BudgetHealthStatus;
  utilizationPercent: number;
  remainingOrOver: number;
  overageAmount: number;
  baseSegmentRatio: number;
  overageSegmentRatio: number;
}

export function getBudgetHealthStatus(spent: number, limit: number): BudgetHealthMetrics {
  if (limit <= 0) {
    return {
      status: 'unbudgeted',
      utilizationPercent: 0,
      remainingOrOver: 0,
      overageAmount: 0,
      baseSegmentRatio: 0,
      overageSegmentRatio: 0,
    };
  }

  const utilizationPercent = (spent / limit) * 100;
  const remainingOrOver = limit - spent;

  if (spent > limit) {
    const overageAmount = spent - limit;
    const baseSegmentRatio = spent > 0 ? limit / spent : 1;
    const overageSegmentRatio = spent > 0 ? overageAmount / spent : 0;
    return {
      status: 'exceeded',
      utilizationPercent,
      remainingOrOver,
      overageAmount,
      baseSegmentRatio,
      overageSegmentRatio,
    };
  }

  if (utilizationPercent >= 80) {
    return {
      status: 'approaching',
      utilizationPercent,
      remainingOrOver,
      overageAmount: 0,
      baseSegmentRatio: utilizationPercent / 100,
      overageSegmentRatio: 0,
    };
  }

  return {
    status: 'on_track',
    utilizationPercent,
    remainingOrOver,
    overageAmount: 0,
    baseSegmentRatio: utilizationPercent / 100,
    overageSegmentRatio: 0,
  };
}

interface BudgetProgressBarProps {
  spent: number;
  limit: number;
  fallbackSharePercent?: number;
  label: string;
  compact?: boolean;
}

/**
 * Dynamic responsive SVG progress bar (zero inline styles):
 * - Green (< 80%): Emerald fill with 80% warning tick
 * - Amber (80% - 100%): Amber fill with 80% warning tick
 * - Red (> 100%): Split bar showing budgeted 100% base allowance + vivid red overage segment
 */
export const BudgetProgressBar: React.FC<BudgetProgressBarProps> = ({
  spent,
  limit,
  fallbackSharePercent = 0,
  label,
  compact = false,
}) => {
  const health = getBudgetHealthStatus(spent, limit);
  const trackHeightClass = compact ? 'h-1.5' : 'h-2.5';

  if (health.status === 'exceeded') {
    const baseUnits = Math.max(100, Math.min(910, Math.round(health.baseSegmentRatio * 1000)));
    const dividerGap = 8;
    const overageStart = baseUnits + dividerGap;
    const overageUnits = Math.max(0, 1000 - overageStart);

    return (
      <div
        role="progressbar"
        aria-label={`${label}: ${health.utilizationPercent.toFixed(0)}% of budget (Exceeded by ${formatCurrency(health.overageAmount)})`}
        aria-valuenow={Math.round(health.utilizationPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={`w-full ${trackHeightClass} rounded-full overflow-hidden bg-red-100 dark:bg-red-950/60`}
      >
        <svg
          viewBox="0 0 1000 10"
          preserveAspectRatio="none"
          className="w-full h-full block"
          aria-hidden="true"
        >
          {/* Base 100% Budget Allowance Segment */}
          <rect
            x={0}
            y={0}
            width={baseUnits}
            height={10}
            className="fill-red-400 dark:fill-red-500/60 transition-all duration-150"
          />
          {/* Crisp 100% Budget Limit Boundary Divider */}
          <rect
            x={baseUnits}
            y={0}
            width={dividerGap}
            height={10}
            className="fill-white dark:fill-slate-950"
          />
          {/* Vivid Red Unbudgeted Overage Segment */}
          <rect
            x={overageStart}
            y={0}
            width={overageUnits}
            height={10}
            className="fill-red-600 dark:fill-red-500 transition-all duration-150"
          />
        </svg>
      </div>
    );
  }

  if (limit <= 0) {
    const shareUnits =
      spent > 0 ? Math.min(1000, Math.max(28, Math.round((fallbackSharePercent / 100) * 1000))) : 0;

    return (
      <div
        role="progressbar"
        aria-label={`${label}: unbudgeted (${fallbackSharePercent.toFixed(1)}% of total spend)`}
        aria-valuenow={Math.round(fallbackSharePercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        className={`w-full ${trackHeightClass} rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800`}
      >
        <svg
          viewBox="0 0 1000 10"
          preserveAspectRatio="none"
          className="w-full h-full block"
          aria-hidden="true"
        >
          {shareUnits > 0 && (
            <rect
              x={0}
              y={0}
              width={shareUnits}
              height={10}
              className="fill-slate-400 dark:fill-slate-500 transition-all duration-150"
            />
          )}
        </svg>
      </div>
    );
  }

  const fillUnits =
    spent > 0
      ? Math.min(1000, Math.max(28, Math.round((health.utilizationPercent / 100) * 1000)))
      : 0;

  const fillColorClass =
    health.status === 'approaching'
      ? 'fill-amber-500 dark:fill-amber-400'
      : 'fill-emerald-600 dark:fill-emerald-500';

  return (
    <div
      role="progressbar"
      aria-label={`${label}: ${health.utilizationPercent.toFixed(0)}% of ${formatCurrency(limit)} budget`}
      aria-valuenow={Math.round(health.utilizationPercent)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`w-full ${trackHeightClass} rounded-full overflow-hidden bg-slate-100 dark:bg-slate-800`}
    >
      <svg
        viewBox="0 0 1000 10"
        preserveAspectRatio="none"
        className="w-full h-full block"
        aria-hidden="true"
      >
        {fillUnits > 0 && (
          <rect
            x={0}
            y={0}
            width={fillUnits}
            height={10}
            className={`${fillColorClass} transition-all duration-150`}
          />
        )}
        {/* 80% Approaching Threshold Marker */}
        <rect
          x={798}
          y={0}
          width={4}
          height={10}
          className="fill-slate-300 dark:fill-slate-600"
        />
      </svg>
    </div>
  );
};

export const CategoryBudgetDistribution: React.FC<CategoryBudgetDistributionProps> = ({
  categoryBreakdown,
  categoryBudgets,
  onUpdateCategoryBudget,
  onUpdateMultipleBudgets,
  onNavigateReports,
}) => {
  const [isEditingBudgets, setIsEditingBudgets] = useState(false);
  const [draftBudgets, setDraftBudgets] = useState<Record<SpendingCategory, string>>(() => {
    const initial: Record<string, string> = {};
    Object.entries(categoryBudgets).forEach(([k, v]) => {
      initial[k] = String(v);
    });
    return initial as Record<SpendingCategory, string>;
  });
  const [inlineEditCategory, setInlineEditCategory] = useState<SpendingCategory | null>(null);
  const [inlineEditValue, setInlineEditValue] = useState<string>('');
  const [viewFilter, setViewFilter] = useState<'active' | 'alerts' | 'all'>('active');
  const [sortMode, setSortMode] = useState<BudgetSortMode>('over_budget_first');

  const handleOpenBatchEdit = () => {
    const nextDraft: Record<string, string> = {};
    Object.entries(categoryBudgets).forEach(([k, v]) => {
      nextDraft[k] = String(v);
    });
    setDraftBudgets(nextDraft as Record<SpendingCategory, string>);
    setIsEditingBudgets(true);
  };

  const handleSaveBatchEdit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned: Record<string, number> = {};
    Object.entries(draftBudgets).forEach(([cat, val]) => {
      const parsed = parseFloat(val);
      cleaned[cat] = !isNaN(parsed) && parsed >= 0 ? parsed : 0;
    });
    onUpdateMultipleBudgets(cleaned as Record<SpendingCategory, number>);
    setIsEditingBudgets(false);
  };

  const handleCommitInlineEdit = (category: SpendingCategory) => {
    const parsed = parseFloat(inlineEditValue);
    if (!isNaN(parsed) && parsed >= 0) {
      onUpdateCategoryBudget(category, parsed);
    }
    setInlineEditCategory(null);
  };

  const enrichedCategories = useMemo(() => {
    return categoryBreakdown.map((item) => {
      const limit = categoryBudgets[item.category] ?? 0;
      const health = getBudgetHealthStatus(item.amount, limit);
      return {
        ...item,
        limit,
        ...health,
      };
    });
  }, [categoryBreakdown, categoryBudgets]);

  const budgetSummary = useMemo(() => {
    const totalBudgeted = Object.values(categoryBudgets).reduce((acc, v) => acc + v, 0);
    const totalSpent = categoryBreakdown.reduce((acc, c) => acc + c.amount, 0);
    const exceededItems = enrichedCategories.filter((c) => c.status === 'exceeded');
    const exceededCount = exceededItems.length;
    const totalOverageAmount = exceededItems.reduce((acc, c) => acc + c.overageAmount, 0);
    const approachingCount = enrichedCategories.filter((c) => c.status === 'approaching').length;
    const onTrackCount = enrichedCategories.filter((c) => c.status === 'on_track').length;
    const overallHealth = getBudgetHealthStatus(totalSpent, totalBudgeted);

    return {
      totalBudgeted,
      totalSpent,
      overallPercent: totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0,
      overallStatus: overallHealth.status,
      overallOverage: overallHealth.overageAmount,
      exceededCount,
      totalOverageAmount,
      approachingCount,
      onTrackCount,
    };
  }, [categoryBudgets, categoryBreakdown, enrichedCategories]);

  const displayedCategories = useMemo(() => {
    let filtered = enrichedCategories;
    if (!isEditingBudgets) {
      if (viewFilter === 'alerts') {
        filtered = enrichedCategories.filter(
          (c) => c.status === 'exceeded' || c.status === 'approaching'
        );
      } else if (viewFilter === 'active') {
        filtered = enrichedCategories.filter((c) => c.amount > 0 || c.status === 'exceeded');
      }
    }

    if (isEditingBudgets) {
      return filtered;
    }

    const sorted = [...filtered];
    if (sortMode === 'highest_spend') {
      sorted.sort((a, b) => b.amount - a.amount);
    } else {
      const statusWeight: Record<BudgetHealthStatus, number> = {
        exceeded: 0,
        approaching: 1,
        on_track: 2,
        unbudgeted: 3,
      };
      sorted.sort((a, b) => {
        const tierDiff = statusWeight[a.status] - statusWeight[b.status];
        if (tierDiff !== 0) return tierDiff;
        if (a.status === 'exceeded' && b.status === 'exceeded') {
          if (Math.abs(b.overageAmount - a.overageAmount) > 0.01) {
            return b.overageAmount - a.overageAmount;
          }
          return b.utilizationPercent - a.utilizationPercent;
        }
        if (a.limit > 0 && b.limit > 0) {
          if (Math.abs(b.utilizationPercent - a.utilizationPercent) > 0.1) {
            return b.utilizationPercent - a.utilizationPercent;
          }
        }
        return b.amount - a.amount;
      });
    }

    return sorted;
  }, [enrichedCategories, isEditingBudgets, viewFilter, sortMode]);

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between">
      <div>
        {/* Header & Budget Controls */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Category Spending Distribution & Monthly Budget Limits
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Green on track (&lt;80%) · Amber warning (≥80%) · Split red bar when spending exceeds limit · Click any limit to edit
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => (isEditingBudgets ? setIsEditingBudgets(false) : handleOpenBatchEdit())}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                isEditingBudgets
                  ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{isEditingBudgets ? 'Cancel Budget Edit' : 'Set Monthly Budgets'}</span>
            </button>

            {onNavigateReports && (
              <button
                type="button"
                onClick={onNavigateReports}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0 ml-1"
              >
                <span>Full Reports</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Overall Monthly Budget Utilization Strip */}
        <div
          className={`mb-4 p-3.5 border rounded-lg space-y-2 transition-colors ${
            budgetSummary.overallStatus === 'exceeded'
              ? 'bg-red-50/40 dark:bg-red-950/25 border-red-200 dark:border-red-900/70'
              : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700/80'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="text-slate-600 dark:text-slate-300">
              <span>Monthly Budget Utilization: </span>
              <strong
                className={`font-mono tabular-nums ${
                  budgetSummary.overallStatus === 'exceeded'
                    ? 'text-red-700 dark:text-red-400'
                    : 'text-slate-900 dark:text-slate-100'
                }`}
              >
                {formatCurrency(budgetSummary.totalSpent)}
              </strong>
              <span> of </span>
              <strong className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                {formatCurrency(budgetSummary.totalBudgeted)}
              </strong>
              <span
                className={`font-mono tabular-nums ${
                  budgetSummary.overallStatus === 'exceeded'
                    ? 'text-red-700 dark:text-red-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {' '}({budgetSummary.overallPercent.toFixed(1)}%)
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span
                className={`font-mono tabular-nums ${
                  budgetSummary.exceededCount > 0
                    ? 'text-red-700 dark:text-red-400 font-semibold'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              >
                {budgetSummary.exceededCount} over limit
                {budgetSummary.totalOverageAmount > 0
                  ? ` (+${formatCurrency(budgetSummary.totalOverageAmount)})`
                  : ''}
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-amber-700 dark:text-amber-400 font-medium font-mono tabular-nums">
                {budgetSummary.approachingCount} near limit (≥80%)
              </span>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-medium font-mono tabular-nums">
                {budgetSummary.onTrackCount} on track
              </span>
            </div>
          </div>

          <BudgetProgressBar
            spent={budgetSummary.totalSpent}
            limit={budgetSummary.totalBudgeted}
            label="Overall monthly budget utilization"
            compact
          />
        </div>

        {/* Filter & Sort Controls Toolbar (when not in batch edit mode) */}
        {!isEditingBudgets && (
          <div className="flex flex-wrap items-center justify-between gap-2.5 mb-4">
            {/* View Filter Segmented Control */}
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-lg overflow-x-auto max-w-full">
              {(
                [
                  { id: 'active', label: 'Active Spend' },
                  {
                    id: 'alerts',
                    label: `Over / Near Limit (${
                      budgetSummary.exceededCount + budgetSummary.approachingCount
                    })`,
                  },
                  { id: 'all', label: 'All 16' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    viewFilter === tab.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Sort Order Toggle: Over-Budget First vs Highest Spend */}
            <div
              role="group"
              aria-label="Sort budget categories"
              className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-lg shrink-0"
            >
              <span className="pl-1.5 pr-0.5 text-slate-400 dark:text-slate-500" aria-hidden="true">
                <ArrowDownWideNarrow className="w-3.5 h-3.5" />
              </span>
              <button
                type="button"
                onClick={() => setSortMode('over_budget_first')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sortMode === 'over_budget_first'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Over-Budget First
              </button>
              <button
                type="button"
                onClick={() => setSortMode('highest_spend')}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sortMode === 'highest_spend'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Highest Spend
              </button>
            </div>
          </div>
        )}

        {/* Batch Budget Configuration Form */}
        {isEditingBudgets ? (
          <form onSubmit={handleSaveBatchEdit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
              {enrichedCategories.map((cat) => {
                const draftNum = parseFloat(draftBudgets[cat.category] ?? '0');
                const previewHealth = getBudgetHealthStatus(
                  cat.amount,
                  !isNaN(draftNum) && draftNum >= 0 ? draftNum : 0
                );
                const draftExceeded = previewHealth.status === 'exceeded';

                return (
                  <div
                    key={cat.category}
                    className={`p-3 border rounded-lg flex items-center justify-between gap-3 transition-colors ${
                      draftExceeded
                        ? 'bg-red-50/40 dark:bg-red-950/25 border-red-200 dark:border-red-900/60'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                        {cat.category}
                      </div>
                      <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        Spent: {formatCurrency(cat.amount)}
                        {draftExceeded && (
                          <span className="text-red-700 dark:text-red-400 font-semibold">
                            {' '}· Over +{formatCurrency(previewHealth.overageAmount)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-xs font-mono text-slate-400 dark:text-slate-500">$</span>
                      <input
                        type="number"
                        min="0"
                        step="5"
                        aria-label={`Monthly budget limit for ${cat.category}`}
                        value={draftBudgets[cat.category] ?? '0'}
                        onChange={(e) =>
                          setDraftBudgets((prev) => ({
                            ...prev,
                            [cat.category]: e.target.value,
                          }))
                        }
                        className="w-24 px-2.5 py-1 text-xs font-mono tabular-nums text-right bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Set $0 to mark a category as unbudgeted.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingBudgets(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Budget Limits</span>
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* Category Distribution & Dynamic Budget Progress Bars List */
          <div className="space-y-3">
            {displayedCategories.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 dark:text-slate-400">
                No categories match the selected filter.{' '}
                {viewFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setViewFilter('all')}
                    className="text-slate-900 dark:text-slate-100 font-medium underline underline-offset-4 ml-1"
                  >
                    View all 16 categories
                  </button>
                )}
              </div>
            ) : (
              displayedCategories.map((cat) => {
                const isExceeded = cat.status === 'exceeded';
                const isApproaching = cat.status === 'approaching';
                const isOnTrack = cat.status === 'on_track';
                const isInlineEditing = inlineEditCategory === cat.category;

                return (
                  <div
                    key={cat.category}
                    className={`p-3.5 rounded-lg border transition-colors duration-150 ${
                      isExceeded
                        ? 'bg-red-50/45 dark:bg-red-950/25 border-red-300 dark:border-red-800/80'
                        : isApproaching
                        ? 'bg-amber-50/35 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-900/60'
                        : 'bg-white dark:bg-slate-900 border-slate-200/80 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      {/* Left: Category Name + Transaction Count + Accessible Status Signal */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`font-semibold ${
                            isExceeded
                              ? 'text-red-950 dark:text-red-100'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {cat.category}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 font-mono tabular-nums">
                          ({cat.transactionCount})
                        </span>

                        {isExceeded && (
                          <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 font-semibold">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Over budget by +{formatCurrency(cat.overageAmount)}
                            </span>
                          </span>
                        )}

                        {isApproaching && (
                          <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Approaching limit · {formatCurrency(cat.remainingOrOver)} left
                            </span>
                          </span>
                        )}

                        {isOnTrack && cat.limit > 0 && (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                            <span>{formatCurrency(cat.remainingOrOver)} remaining</span>
                          </span>
                        )}
                      </div>

                      {/* Right: Spent / Monthly Limit (Click to Inline Edit) + % */}
                      <div className="flex items-center gap-1.5 font-mono tabular-nums">
                        <span
                          className={`font-semibold ${
                            isExceeded
                              ? 'text-red-700 dark:text-red-400'
                              : isApproaching
                              ? 'text-amber-800 dark:text-amber-300'
                              : 'text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {formatCurrency(cat.amount)}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500">/</span>

                        {isInlineEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="5"
                              autoFocus
                              aria-label={`Edit monthly limit for ${cat.category}`}
                              value={inlineEditValue}
                              onChange={(e) => setInlineEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCommitInlineEdit(cat.category);
                                if (e.key === 'Escape') setInlineEditCategory(null);
                              }}
                              className="w-20 px-1.5 py-0.5 text-xs font-mono tabular-nums bg-white dark:bg-slate-800 border border-slate-900 dark:border-slate-400 rounded text-slate-900 dark:text-slate-100 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleCommitInlineEdit(cat.category)}
                              className="px-2 py-0.5 text-[11px] font-sans font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded whitespace-nowrap shrink-0"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => setInlineEditCategory(null)}
                              className="px-1.5 py-0.5 text-[11px] font-sans text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 whitespace-nowrap shrink-0"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            title="Click to edit monthly budget limit"
                            onClick={() => {
                              setInlineEditCategory(cat.category);
                              setInlineEditValue(String(cat.limit));
                            }}
                            className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline decoration-dotted underline-offset-4 whitespace-nowrap shrink-0"
                          >
                            {cat.limit > 0 ? `${formatCurrency(cat.limit)} limit` : 'Set limit'}
                          </button>
                        )}

                        {cat.limit > 0 && (
                          <span
                            className={`ml-1 text-[11px] ${
                              isExceeded
                                ? 'text-red-700 dark:text-red-400 font-bold'
                                : isApproaching
                                ? 'text-amber-700 dark:text-amber-400 font-semibold'
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}
                          >
                            ({cat.utilizationPercent.toFixed(0)}%)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Dynamic Three-Tier / Split-Red Progress Bar */}
                    <div className="mt-2">
                      <BudgetProgressBar
                        spent={cat.amount}
                        limit={cat.limit}
                        fallbackSharePercent={cat.percentageOfTotal}
                        label={cat.category}
                      />
                    </div>

                    {/* Split-Bar Breakdown Legend for Exceeded Categories */}
                    {isExceeded && (
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
                        <span className="text-red-800/80 dark:text-red-300/80">
                          Base budget limit: {formatCurrency(cat.limit)} ({(cat.baseSegmentRatio * 100).toFixed(0)}% of spend)
                        </span>
                        <span className="text-red-700 dark:text-red-400 font-semibold">
                          Red overage segment: +{formatCurrency(cat.overageAmount)} ({(cat.overageSegmentRatio * 100).toFixed(0)}% of spend)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Zero-Dollar Categories Footnote */}
      {!isEditingBudgets && (
        <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
          <div>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              Zero spend this month:{' '}
            </span>
            {categoryBreakdown
              .filter((c) => c.amount === 0)
              .map((c) => c.category)
              .join(' · ') || 'None'}
          </div>
          {viewFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setViewFilter('all')}
              className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 whitespace-nowrap shrink-0"
            >
              Show all 16 categories
            </button>
          )}
        </div>
      )}
    </div>
  );
};
