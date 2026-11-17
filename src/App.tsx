import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  Layers,
  Mail,
  Moon,
  Plus,
  ShieldCheck,
  Smartphone,
  Sun,
  Wallet,
} from 'lucide-react';
import {
  CONNECTED_SOURCES,
  INITIAL_CATEGORY_BUDGETS,
  INITIAL_INSIGHTS,
  INITIAL_SAVINGS_GOALS,
  INITIAL_SUBSCRIPTIONS,
  INITIAL_TRANSACTIONS,
} from './data/sampleFinanceData';
import {
  DataSource,
  SavingsGoal,
  SpendingCategory,
  SubscriptionItem,
  Transaction,
  TransactionStatus,
} from './types/finance';
import { computeDashboardMetrics, formatCurrency } from './utils/financeMetrics';
import { RunningSummaryGrid } from './components/RunningSummaryGrid';
import { UncertainQueuePanel } from './components/UncertainQueuePanel';
import { TransactionLedgerTable } from './components/TransactionLedgerTable';
import { FinancialReportsSection } from './components/FinancialReportsSection';
import { SubscriptionsTracker } from './components/SubscriptionsTracker';
import { SpendingInsightsView } from './components/SpendingInsightsView';
import { IngestSourceModal } from './components/IngestSourceModal';
import { CategoryBudgetDistribution } from './components/CategoryBudgetDistribution';
import { SubscriptionAlertsPanel } from './components/SubscriptionAlertsPanel';
import { SavingsGoalsSection } from './components/SavingsGoalsSection';
import { QuickAddFloatingMenu } from './components/QuickAddFloatingMenu';

type ActiveTab = 'overview' | 'transactions' | 'reports' | 'subscriptions' | 'insights';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ledgerpulse_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  const [transactions, setTransactions] = useState<Transaction[]>(INITIAL_TRANSACTIONS);
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>(INITIAL_SUBSCRIPTIONS);
  const [categoryBudgets, setCategoryBudgets] =
    useState<Record<SpendingCategory, number>>(INITIAL_CATEGORY_BUDGETS);
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>(INITIAL_SAVINGS_GOALS);
  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);
  const [toastBanner, setToastBanner] = useState<string | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    try {
      localStorage.setItem('ledgerpulse_theme', isDarkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }, [isDarkMode]);

  const handleToggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
  };

  const showToast = (msg: string) => {
    setToastBanner(msg);
    setTimeout(() => {
      setToastBanner((prev) => (prev === msg ? null : prev));
    }, 4500);
  };

  const { summary, categoryBreakdown, topMerchants } = useMemo(
    () => computeDashboardMetrics(transactions, subscriptions, 17),
    [transactions, subscriptions]
  );

  // Handlers for updating category, status, resolving uncertain items, and deduplicating
  const handleUpdateCategory = (id: string, category: SpendingCategory) => {
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === id
          ? {
              ...tx,
              category,
              uncertainCategory: false,
              uncertaintyReason: undefined,
            }
          : tx
      )
    );
    showToast(`Updated category to "${category}" and recalculated monthly summary.`);
  };

  const handleUpdateStatus = (id: string, status: TransactionStatus) => {
    setTransactions((prev) =>
      prev.map((tx) =>
        tx.id === id
          ? {
              ...tx,
              status,
              transactionType: status === 'refunded' ? 'refund' : tx.transactionType,
            }
          : tx
      )
    );
    showToast(`Updated transaction status to ${status}.`);
  };

  const handleDismissAnomaly = (id: string, action: 'keep' | 'remove_duplicate') => {
    if (action === 'remove_duplicate') {
      setTransactions((prev) => prev.filter((tx) => tx.id !== id));
      showToast('Excluded duplicate pending hold from active spending totals.');
    } else {
      setTransactions((prev) =>
        prev.map((tx) => (tx.id === id ? { ...tx, anomalyNote: undefined } : tx))
      );
      showToast('Acknowledged charge alert.');
    }
  };

  const handleToggleCancelSubscription = (id: string) => {
    setSubscriptions((prev) =>
      prev.map((sub) =>
        sub.id === id
          ? {
              ...sub,
              status:
                sub.status === 'Unused / Review'
                  ? 'Active'
                  : sub.status === 'Canceled'
                  ? 'Active'
                  : 'Unused / Review',
            }
          : sub
      )
    );
  };

  const handleDismissSubscriptionAlert = (id: string) => {
    setSubscriptions((prev) =>
      prev.map((sub) => (sub.id === id ? { ...sub, alertDismissed: true } : sub))
    );
    showToast('Acknowledged and dismissed subscription alert.');
  };

  const handleCancelAndRedirectToGoal = (subId: string, goalId: string) => {
    const targetSub = subscriptions.find((s) => s.id === subId);
    if (!targetSub) return;

    setSubscriptions((prev) =>
      prev.map((sub) =>
        sub.id === subId ? { ...sub, status: 'Canceled', alertDismissed: true } : sub
      )
    );

    setSavingsGoals((prev) =>
      prev.map((g) =>
        g.id === goalId
          ? {
              ...g,
              monthlyContribution: g.monthlyContribution + targetSub.amount,
            }
          : g
      )
    );

    const targetGoal = savingsGoals.find((g) => g.id === goalId);
    showToast(
      `Canceled "${targetSub.merchant}" and redirected +${formatCurrency(targetSub.amount)}/mo into "${targetGoal?.name || 'Savings Goal'}".`
    );
  };

  const handleSimulateNewPriceHike = () => {
    setSubscriptions((prev) =>
      prev.map((sub) => {
        if (sub.id === 'sub-07') {
          return {
            ...sub,
            previousAmount: 22.99,
            amount: 25.99,
            estimatedAnnualCost: 311.88,
            status: 'Price Increased',
            alertDismissed: false,
            usageNote:
              'Automated Alert: Netflix 4K plan increased +$3.00/mo (+13.0%) from $22.99 to $25.99',
          };
        }
        return { ...sub, alertDismissed: false };
      })
    );
    showToast(
      'Automated Watchdog Alert: Detected price increase on Netflix 4K (+$3.00/mo) and refreshed >3-month inactivity alerts.'
    );
  };

  const handleContributeToGoal = (goalId: string, amount: number) => {
    setSavingsGoals((prev) =>
      prev.map((g) =>
        g.id === goalId ? { ...g, currentSaved: g.currentSaved + amount } : g
      )
    );
    const goal = savingsGoals.find((g) => g.id === goalId);
    showToast(`Logged +${formatCurrency(amount)} deposit toward "${goal?.name || 'Goal'}".`);
  };

  const handleUpdateGoal = (
    goalId: string,
    updates: Partial<Pick<SavingsGoal, 'targetAmount' | 'monthlyContribution' | 'targetDate'>>
  ) => {
    setSavingsGoals((prev) =>
      prev.map((g) => (g.id === goalId ? { ...g, ...updates } : g))
    );
    showToast('Updated savings goal parameters.');
  };

  const handleCreateGoal = (newGoal: Omit<SavingsGoal, 'id'>) => {
    const created: SavingsGoal = {
      ...newGoal,
      id: `goal-${Date.now()}`,
    };
    setSavingsGoals((prev) => [created, ...prev]);
    showToast(`Created new savings goal "${newGoal.name}" (${formatCurrency(newGoal.targetAmount)} target).`);
  };

  const handleUpdateCategoryBudget = (category: SpendingCategory, newLimit: number) => {
    setCategoryBudgets((prev) => ({
      ...prev,
      [category]: newLimit,
    }));
    showToast(`Updated monthly budget for "${category}" to ${formatCurrency(newLimit)}.`);
  };

  const handleUpdateMultipleBudgets = (updated: Record<SpendingCategory, number>) => {
    setCategoryBudgets(updated);
    showToast('Saved monthly category budget limits.');
  };

  const handleCommitTransactions = (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>
  ) => {
    setTransactions((prev) => {
      let updated = [...prev];

      mergedUpdates.forEach((m) => {
        updated = updated.map((tx) => {
          if (tx.id !== m.existingId) return tx;
          const nextSources = [
            ...(tx.mergedSources || []),
            {
              source: m.newSource,
              referenceId: `SYNC-${Date.now().toString().slice(-4)}`,
              capturedAt: '2026-11-17 10:03',
              rawDescriptor: m.rawDescriptor,
              statusAtCapture: tx.status,
            },
          ];
          return {
            ...tx,
            isDeduplicated: true,
            mergedSources: nextSources,
          };
        });
      });

      return [...newItems, ...updated];
    });

    const msgParts: string[] = [];
    if (newItems.length === 1 && mergedUpdates.length === 0) {
      const item = newItems[0];
      const kind = item.transactionType === 'income' ? 'one-off income' : 'transaction';
      msgParts.push(
        `Routed ${kind} "${item.merchant}" (${formatCurrency(item.amount)}) to Unified Ledger & updated monthly totals`
      );
    } else if (newItems.length > 0) {
      msgParts.push(`${newItems.length} new record(s) added`);
    }
    if (mergedUpdates.length > 0) {
      msgParts.push(`${mergedUpdates.length} cross-source duplicate(s) merged without double-counting`);
    }
    showToast(msgParts.join(' · ') || 'Ledger updated.');
  };

  const handleExportCsv = () => {
    const headers = [
      'ID',
      'Date',
      'Merchant',
      'Amount',
      'Type',
      'Status',
      'Category',
      'PaymentMethod',
      'PrimarySource',
      'MergedSourcesCount',
    ];
    const rows = transactions
      .filter((t) => t.monthKey === '2026-11')
      .map((t) => [
        t.id,
        t.date,
        `"${t.merchant.replace(/"/g, '""')}"`,
        t.amount.toFixed(2),
        t.transactionType,
        t.status,
        `"${t.category}"`,
        `"${t.paymentMethod}"`,
        t.source,
        t.mergedSources?.length || 1,
      ]);

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'ledgerpulse_reconciled_nov_2026.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Exported deduplicated November 2026 ledger to CSV.');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-150">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 px-6 py-3.5 flex items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          LedgerPulse
        </a>

        {/* Zone 2: 5 single-line text navigation links */}
        <nav
          aria-label="Primary Navigation"
          className="flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400 overflow-x-auto"
        >
          {(
            [
              { id: 'overview', label: 'Overview' },
              { id: 'transactions', label: 'Transactions' },
              { id: 'reports', label: 'Reports' },
              { id: 'subscriptions', label: 'Subscriptions' },
              { id: 'insights', label: 'Insights' },
            ] as const
          ).map((nav) => (
            <button
              key={nav.id}
              type="button"
              onClick={() => setActiveTab(nav.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === nav.id
                  ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setIsIngestModalOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Collect Transactions</span>
          </button>
        </div>
      </header>

      {/* Main Content Container (1440px desktop baseline) */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Feedback Toast */}
        {toastBanner && (
          <div
            role="status"
            className="bg-slate-900 dark:bg-slate-800 text-white dark:text-slate-100 border border-transparent dark:border-slate-700 px-4 py-2.5 rounded-lg text-xs flex items-center justify-between shadow-sm"
          >
            <span>{toastBanner}</span>
            <button
              type="button"
              onClick={() => setToastBanner(null)}
              className="text-slate-300 dark:text-slate-400 hover:text-white dark:hover:text-slate-100 ml-4 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Workspace Context, Dark Mode Switch & Connected Sources Bar */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                Personal AI Finance & Spending Tracker
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                Monitoring Gmail receipts, Bank & Credit Card statements, Apple Pay notifications, and uploaded CSVs ·{' '}
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  Nov 1 – Nov 17, 2026
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={handleToggleDarkMode}
                aria-pressed={isDarkMode}
                aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                {isDarkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-600" />
                    <span>Dark Mode</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export Reconciled CSV</span>
              </button>

              <button
                type="button"
                onClick={() => setIsIngestModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800/80 border border-transparent dark:border-slate-700/80 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Test Cross-Source Deduplication</span>
              </button>
            </div>
          </div>

          {/* 4 Connected Sources Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
            {CONNECTED_SOURCES.map((src) => {
              const Icon =
                src.sourceType === 'Gmail'
                  ? Mail
                  : src.sourceType === 'Apple Pay'
                  ? Smartphone
                  : src.sourceType === 'Bank Statement'
                  ? Wallet
                  : FileSpreadsheet;

              return (
                <div
                  key={src.id}
                  className="p-3 bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 rounded-lg flex items-start gap-3"
                >
                  <Icon className="w-4 h-4 text-slate-600 dark:text-slate-300 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 text-xs">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {src.name}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                      {src.accountDetail}
                    </div>
                    <div className="text-[11px] font-mono text-slate-600 dark:text-slate-300 mt-1.5">
                      {src.recordsScanned} scanned ·{' '}
                      <span className="text-emerald-700 dark:text-emerald-400">
                        {src.duplicatesMerged} merged
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Always-Visible 8-KPI Running Spending Summary on Overview */}
        {activeTab === 'overview' && (
          <>
            <RunningSummaryGrid
              metrics={summary}
              onNavigateTab={(tab) => setActiveTab(tab)}
            />

            {/* Uncertain Categorization & Anomaly Clarification Queue */}
            <UncertainQueuePanel
              transactions={transactions}
              onResolveCategory={handleUpdateCategory}
              onDismissAnomaly={handleDismissAnomaly}
            />

            {/* Automated Subscription Price Increase & >3-Month Inactivity Watchdog */}
            <SubscriptionAlertsPanel
              subscriptions={subscriptions}
              savingsGoals={savingsGoals}
              onDismissAlert={handleDismissSubscriptionAlert}
              onCancelAndRedirectToGoal={handleCancelAndRedirectToGoal}
              onSimulateNewPriceHike={handleSimulateNewPriceHike}
            />

            {/* 2-Column Overview Split: Category Distribution & Budgets + Subscriptions & Insights Preview */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Left Column: Category Distribution & Monthly Budgets (7 cols) */}
              <div className="lg:col-span-7 flex flex-col">
                <CategoryBudgetDistribution
                  categoryBreakdown={categoryBreakdown}
                  categoryBudgets={categoryBudgets}
                  onUpdateCategoryBudget={handleUpdateCategoryBudget}
                  onUpdateMultipleBudgets={handleUpdateMultipleBudgets}
                  onNavigateReports={() => setActiveTab('reports')}
                />
              </div>

              {/* Right Column: Key Insights & Forgotten Subscriptions Watch (5 cols) */}
              <div className="lg:col-span-5 flex flex-col gap-6">
                {/* Key Insights Card */}
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Priority Spending Insights
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveTab('insights')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap shrink-0"
                      >
                        <span>AI Audit</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {INITIAL_INSIGHTS.slice(0, 4).map((ins) => (
                        <div key={ins.id} className="py-3 space-y-1">
                          <div className="flex items-center justify-between text-[11px]">
                            <span
                              className={`font-medium ${
                                ins.severity === 'high'
                                  ? 'text-rose-700 dark:text-rose-400'
                                  : ins.severity === 'medium'
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-500 dark:text-slate-400'
                              }`}
                            >
                              {ins.categoryType}
                            </span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                              {formatCurrency(ins.impactAmount)}
                              {ins.impactPeriod === 'month' ? '/mo' : ''}
                            </span>
                          </div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {ins.title}
                          </div>
                          <p className="text-slate-600 dark:text-slate-400 line-clamp-2">
                            {ins.description}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Strict Rules Compliance Footer */}
                  <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                    <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                    <span>
                      Read-only guardrails active: Never invents missing records, never double-counts across feeds, and never executes payments.
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Personal Savings Goals & Cash Allocation Section */}
            <SavingsGoalsSection
              savingsGoals={savingsGoals}
              netCashFlowThisMonth={summary.netCashFlow}
              onContributeToGoal={handleContributeToGoal}
              onUpdateGoal={handleUpdateGoal}
              onCreateGoal={handleCreateGoal}
            />

            {/* Full Unified Transaction Ledger Table on Overview */}
            <TransactionLedgerTable
              transactions={transactions}
              onUpdateCategory={handleUpdateCategory}
              onUpdateStatus={handleUpdateStatus}
            />
          </>
        )}

        {/* TRANSACTIONS TAB */}
        {activeTab === 'transactions' && (
          <div className="space-y-6">
            <UncertainQueuePanel
              transactions={transactions}
              onResolveCategory={handleUpdateCategory}
              onDismissAnomaly={handleDismissAnomaly}
            />
            <TransactionLedgerTable
              transactions={transactions}
              onUpdateCategory={handleUpdateCategory}
              onUpdateStatus={handleUpdateStatus}
            />
          </div>
        )}

        {/* REPORTS TAB (Daily, Weekly, Monthly) */}
        {activeTab === 'reports' && (
          <FinancialReportsSection
            transactions={transactions}
            subscriptions={subscriptions}
            summaryMetrics={summary}
            categoryBreakdown={categoryBreakdown}
            topMerchants={topMerchants}
            categoryBudgets={categoryBudgets}
            onUpdateCategoryBudget={handleUpdateCategoryBudget}
          />
        )}

        {/* SUBSCRIPTIONS TAB */}
        {activeTab === 'subscriptions' && (
          <SubscriptionsTracker
            subscriptions={subscriptions}
            savingsGoals={savingsGoals}
            onToggleCancelSubscription={handleToggleCancelSubscription}
            onDismissAlert={handleDismissSubscriptionAlert}
            onCancelAndRedirectToGoal={handleCancelAndRedirectToGoal}
            onSimulateNewPriceHike={handleSimulateNewPriceHike}
          />
        )}

        {/* INSIGHTS TAB */}
        {activeTab === 'insights' && (
          <SpendingInsightsView
            insights={INITIAL_INSIGHTS}
            summaryMetrics={summary}
            categoryBreakdown={categoryBreakdown}
            subscriptions={subscriptions}
            transactions={transactions}
          />
        )}
      </main>

      {/* Clean Quiet Footer */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4 mt-12">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div>
            LedgerPulse Personal Finance & Spending Tracker · Read-Only Multi-Source Reconciliation
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={handleToggleDarkMode}
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              {isDarkMode ? 'Switch to Light Theme' : 'Switch to Dark Theme'}
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={() => setIsIngestModalOpen(true)}
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              Ingest Receipt or Statement
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleExportCsv}
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              Download Reconciled CSV
            </button>
          </div>
        </div>
      </footer>

      {/* Multi-Source Ingestion & AI Deduplication Modal */}
      <IngestSourceModal
        isOpen={isIngestModalOpen}
        onClose={() => setIsIngestModalOpen(false)}
        existingTransactions={transactions}
        onCommitTransactions={handleCommitTransactions}
      />

      {/* Quick Add Floating Action Menu (Cash Transactions & One-Off Income) */}
      <QuickAddFloatingMenu
        existingTransactions={transactions}
        onQuickCommitTransaction={handleCommitTransactions}
        onOpenFullIngestModal={() => setIsIngestModalOpen(true)}
      />
    </div>
  );
}
