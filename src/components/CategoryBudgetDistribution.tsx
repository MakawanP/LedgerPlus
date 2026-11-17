import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
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

export function getBudgetHealthStatus(spent: number, limit: number): {
  status: BudgetHealthStatus;
  utilizationPercent: number;
  remainingOrOver: number;
} {
  if (limit <= 0) {
    return {
      status: 'unbudgeted',
      utilizationPercent: 0,
      remainingOrOver: 0,
    };
  }
  const utilizationPercent = (spent / limit) * 100;
  const remainingOrOver = limit - spent;

  if (spent > limit) {
    return {
      status: 'exceeded',
      utilizationPercent,
      remainingOrOver,
    };
  }
  if (utilizationPercent >= 80) {
    return {
      status: 'approaching',
      utilizationPercent,
      remainingOrOver,
    };
  }
  return {
    status: 'on_track',
    utilizationPercent,
    remainingOrOver,
  };
}

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
    const exceededCount = enrichedCategories.filter((c) => c.status === 'exceeded').length;
    const approachingCount = enrichedCategories.filter((c) => c.status === 'approaching').length;
    const onTrackCount = enrichedCategories.filter((c) => c.status === 'on_track').length;

    return {
      totalBudgeted,
      totalSpent,
      overallPercent: totalBudgeted > 0 ? (totalSpent / totalBudgeted) * 100 : 0,
      exceededCount,
      approachingCount,
      onTrackCount,
    };
  }, [categoryBudgets, categoryBreakdown, enrichedCategories]);

  const displayedCategories = useMemo(() => {
    if (isEditingBudgets || viewFilter === 'all') {
      return enrichedCategories;
    }
    if (viewFilter === 'alerts') {
      return enrichedCategories.filter(
        (c) => c.status === 'exceeded' || c.status === 'approaching'
      );
    }
    return enrichedCategories.filter((c) => c.amount > 0);
  }, [enrichedCategories, isEditingBudgets, viewFilter]);

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-col justify-between">
      <div>
        {/* Header & Budget Controls */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Category Spending Distribution & Monthly Budget Limits
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Highlights categories approaching (≥80%) or exceeding (&gt;100%) monthly limits · Click any limit to edit
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => (isEditingBudgets ? setIsEditingBudgets(false) : handleOpenBatchEdit())}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                isEditingBudgets
                  ? 'bg-slate-100 text-slate-900 border-slate-300'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>{isEditingBudgets ? 'Cancel Budget Edit' : 'Set Monthly Budgets'}</span>
            </button>

            {onNavigateReports && (
              <button
                type="button"
                onClick={onNavigateReports}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 whitespace-nowrap shrink-0 ml-1"
              >
                <span>Full Reports</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Overall Monthly Budget Utilization Strip */}
        <div className="mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="text-slate-600">
              <span>Monthly Budget Utilization: </span>
              <strong className="font-mono text-slate-900">
                {formatCurrency(budgetSummary.totalSpent)}
              </strong>
              <span> of </span>
              <strong className="font-mono text-slate-900">
                {formatCurrency(budgetSummary.totalBudgeted)}
              </strong>
              <span className="font-mono text-slate-500">
                {' '}({budgetSummary.overallPercent.toFixed(1)}%)
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-rose-700 font-medium font-mono">
                {budgetSummary.exceededCount} exceeded
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-amber-700 font-medium font-mono">
                {budgetSummary.approachingCount} approaching (≥80%)
              </span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="text-emerald-700 font-medium font-mono">
                {budgetSummary.onTrackCount} on track
              </span>
            </div>
          </div>

          <div className="w-full h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                budgetSummary.overallPercent > 100
                  ? 'bg-rose-600'
                  : budgetSummary.overallPercent >= 85
                  ? 'bg-amber-500'
                  : 'bg-slate-900'
              }`}
              style={{ width: `${Math.min(100, Math.max(2, budgetSummary.overallPercent))}%` }}
            />
          </div>
        </div>

        {/* Filter Segmented Bar (when not in batch edit mode) */}
        {!isEditingBudgets && (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
              {(
                [
                  { id: 'active', label: 'Active Spend Categories' },
                  {
                    id: 'alerts',
                    label: `Approaching / Exceeded (${
                      budgetSummary.exceededCount + budgetSummary.approachingCount
                    })`,
                  },
                  { id: 'all', label: 'All 16 Categories' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setViewFilter(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    viewFilter === tab.id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <span className="text-[11px] text-slate-400">
              80% threshold marker shown on each progress bar
            </span>
          </div>
        )}

        {/* Batch Budget Configuration Form */}
        {isEditingBudgets ? (
          <form onSubmit={handleSaveBatchEdit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-1">
              {enrichedCategories.map((cat) => (
                <div
                  key={cat.category}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-slate-900 truncate">
                      {cat.category}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500">
                      Nov spent: {formatCurrency(cat.amount)}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-xs font-mono text-slate-400">$</span>
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
                      className="w-24 px-2.5 py-1 text-xs font-mono text-right bg-white border border-slate-300 rounded-md text-slate-900 focus:outline-none focus:border-slate-900"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200">
              <span className="text-xs text-slate-500">
                Set $0 to mark a category as unbudgeted.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsEditingBudgets(false)}
                  className="px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Budget Limits</span>
                </button>
              </div>
            </div>
          </form>
        ) : (
          /* Category Distribution & Budget Progress Bars List */
          <div className="space-y-3.5">
            {displayedCategories.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500">
                No categories match the selected filter.
              </div>
            ) : (
              displayedCategories.map((cat) => {
                const isExceeded = cat.status === 'exceeded';
                const isApproaching = cat.status === 'approaching';
                const barWidth =
                  cat.limit > 0
                    ? Math.min(100, Math.max(cat.amount > 0 ? 3 : 0, cat.utilizationPercent))
                    : Math.min(100, Math.max(cat.amount > 0 ? 3 : 0, cat.percentageOfTotal));

                const barColorClass = isExceeded
                  ? 'bg-rose-600'
                  : isApproaching
                  ? 'bg-amber-500'
                  : 'bg-slate-900';

                const isInlineEditing = inlineEditCategory === cat.category;

                return (
                  <div
                    key={cat.category}
                    className={`p-3 rounded-lg border transition-colors ${
                      isExceeded
                        ? 'bg-rose-50/30 border-rose-200/80'
                        : isApproaching
                        ? 'bg-amber-50/30 border-amber-200/80'
                        : 'bg-white border-slate-200/80 hover:border-slate-300'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      {/* Left: Category Name + Count + Status Label */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-slate-900">
                          {cat.category}
                        </span>
                        <span className="text-slate-400 font-mono">
                          ({cat.transactionCount})
                        </span>

                        {isExceeded && (
                          <span className="inline-flex items-center gap-1 text-rose-700 font-medium">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Exceeded by {formatCurrency(Math.abs(cat.remainingOrOver))}
                            </span>
                          </span>
                        )}

                        {isApproaching && (
                          <span className="inline-flex items-center gap-1 text-amber-700 font-medium">
                            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                            <span>
                              Approaching limit · {formatCurrency(cat.remainingOrOver)} left
                            </span>
                          </span>
                        )}

                        {cat.status === 'on_track' && cat.limit > 0 && (
                          <span className="inline-flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="w-3 h-3 shrink-0" />
                            <span>{formatCurrency(cat.remainingOrOver)} left</span>
                          </span>
                        )}
                      </div>

                      {/* Right: Spent / Budget Limit (Click to Inline Edit) */}
                      <div className="flex items-center gap-1.5 font-mono tabular-nums">
                        <span
                          className={`font-semibold ${
                            isExceeded
                              ? 'text-rose-700'
                              : isApproaching
                              ? 'text-amber-800'
                              : 'text-slate-900'
                          }`}
                        >
                          {formatCurrency(cat.amount)}
                        </span>
                        <span className="text-slate-400">/</span>

                        {isInlineEditing ? (
                          <div className="inline-flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              step="5"
                              autoFocus
                              value={inlineEditValue}
                              onChange={(e) => setInlineEditValue(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleCommitInlineEdit(cat.category);
                                if (e.key === 'Escape') setInlineEditCategory(null);
                              }}
                              className="w-20 px-1.5 py-0.5 text-xs font-mono bg-white border border-slate-900 rounded text-slate-900 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => handleCommitInlineEdit(cat.category)}
                              className="px-1.5 py-0.5 text-[11px] bg-slate-900 text-white rounded"
                            >
                              Save
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
                            className="text-slate-600 hover:text-slate-900 underline decoration-dotted underline-offset-4"
                          >
                            {cat.limit > 0 ? `${formatCurrency(cat.limit)} limit` : 'Set limit'}
                          </button>
                        )}

                        {cat.limit > 0 && (
                          <span
                            className={`ml-1 text-[11px] ${
                              isExceeded
                                ? 'text-rose-700 font-semibold'
                                : isApproaching
                                ? 'text-amber-700 font-semibold'
                                : 'text-slate-500'
                            }`}
                          >
                            ({cat.utilizationPercent.toFixed(0)}%)
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Progress Bar against Budget Limit with 80% Warning Tick */}
                    <div className="relative w-full h-2 bg-slate-100 rounded-full overflow-hidden mt-2">
                      {/* 80% Approaching Threshold Marker */}
                      {cat.limit > 0 && (
                        <div
                          aria-hidden="true"
                          title="80% Approaching Limit Threshold"
                          className="absolute top-0 bottom-0 left-[80%] w-px bg-slate-300 z-10"
                        />
                      )}
                      <div
                        className={`h-full rounded-full transition-all duration-200 ${barColorClass}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Zero-Dollar Categories Footnote */}
      {!isEditingBudgets && (
        <div className="mt-5 pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <div>
            <span className="font-medium text-slate-700">Zero spend this month: </span>
            {categoryBreakdown
              .filter((c) => c.amount === 0)
              .map((c) => c.category)
              .join(' · ') || 'None'}
          </div>
          {viewFilter !== 'all' && (
            <button
              type="button"
              onClick={() => setViewFilter('all')}
              className="text-slate-700 hover:text-slate-900 underline underline-offset-4"
            >
              Show all 16 categories
            </button>
          )}
        </div>
      )}
    </div>
  );
};
