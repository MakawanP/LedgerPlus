import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {
  SpendingInsight,
  SubscriptionItem,
  Transaction,
} from '../types/finance';
import {
  CategorySummaryItem,
  DashboardSummaryMetrics,
  formatCurrency,
} from '../utils/financeMetrics';
import { NavTabId } from './MobileBottomNav';

interface SpendingInsightsViewProps {
  insights: SpendingInsight[];
  summaryMetrics: DashboardSummaryMetrics;
  categoryBreakdown: CategorySummaryItem[];
  subscriptions: SubscriptionItem[];
  transactions: Transaction[];
  onNavigateTab?: (tab: NavTabId, subView?: 'ledger' | 'subscriptions') => void;
}

interface AuditResult {
  executiveHeadline: string;
  directAnswer: string;
  findings: Array<{
    type: string;
    title: string;
    detail: string;
    estimatedMonthlyImpact: number;
    severity: string;
  }>;
}

export const SpendingInsightsView: React.FC<SpendingInsightsViewProps> = ({
  insights,
  summaryMetrics,
  categoryBreakdown,
  subscriptions,
  transactions,
  onNavigateTab,
}) => {
  const [userQuestion, setUserQuestion] = useState('');
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditResult, setAuditResult] = useState<AuditResult | null>(null);

  const handleRunAudit = async (customPrompt?: string) => {
    setIsLoadingAudit(true);
    setAuditError(null);
    try {
      const response = await fetch('/api/finance/audit-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summaryMetrics,
          categoryBreakdown: categoryBreakdown.filter(
            (c) => c.amount > 0 || c.previousMonthAmount > 0
          ),
          subscriptions,
          recentTransactions: transactions.filter((t) => t.monthKey === '2026-11'),
          userQuestion: customPrompt ?? userQuestion,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to run financial ledger audit.');
      }
      setAuditResult(data);
    } catch (err: any) {
      setAuditError(err.message || 'Unable to reach financial audit service.');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  return (
    <section
      aria-label="Spending Insights & Live Ledger Audit"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl p-5 sm:p-6 flex-1 flex flex-col justify-between gap-5"
    >
      <div className="space-y-5">
        {/* Header & Live Audit Trigger */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Spending Insights &amp; Live Ledger Audit
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              6 diagnostic pillars &amp; interactive Q&amp;A grounded in verified ledger figures
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              handleRunAudit(
                'Perform a full audit of my November spending, duplicate charges, and forgotten subscriptions.'
              )
            }
            disabled={isLoadingAudit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAudit ? 'animate-spin' : ''}`} />
            <span>{isLoadingAudit ? 'Analyzing...' : 'Run Live Audit'}</span>
          </button>
        </div>

        {/* Interactive Ledger Question Form */}
        <div className="space-y-2.5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (userQuestion.trim()) {
                void handleRunAudit(userQuestion.trim());
              }
            }}
            className="flex flex-col sm:flex-row gap-2"
          >
            <input
              type="text"
              value={userQuestion}
              onChange={(e) => setUserQuestion(e.target.value)}
              placeholder="Ask about your spending (e.g., 'Where can I cut $150/month?')"
              className="flex-1 px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400"
            />
            <button
              type="submit"
              disabled={isLoadingAudit || !userQuestion.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Ask</span>
            </button>
          </form>

          {/* Quick Preset Questions */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-slate-500 dark:text-slate-400">
            <span>Quick checks:</span>
            {[
              'Where can I save $150/mo?',
              'Any duplicate or unusual charges?',
              'Compare dining & travel vs Oct',
            ].map((q, idx) => (
              <React.Fragment key={q}>
                {idx > 0 && <span aria-hidden="true">·</span>}
                <button
                  type="button"
                  onClick={() => {
                    setUserQuestion(q);
                    void handleRunAudit(q);
                  }}
                  className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 text-left"
                >
                  {q}
                </button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Error Banner */}
        {auditError && (
          <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg flex items-start gap-2 text-xs text-rose-800 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold">Audit Notice:</strong> {auditError}
            </div>
          </div>
        )}

        {/* Live Audit Response */}
        {auditResult && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
            <div className="space-y-1">
              <div className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                Live Financial Audit
              </div>
              <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                {auditResult.executiveHeadline}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {auditResult.directAnswer}
              </p>
            </div>

            {auditResult.findings && auditResult.findings.length > 0 && (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-slate-200 dark:border-slate-800">
                {auditResult.findings.map((f, idx) => (
                  <div key={idx} className="py-2.5 space-y-0.5 text-xs">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-slate-500 dark:text-slate-400">
                        {f.type}
                      </span>
                      <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(f.estimatedMonthlyImpact)}/mo impact
                      </span>
                    </div>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      {f.title}
                    </div>
                    <p className="text-slate-600 dark:text-slate-400">{f.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Continuous Ledger Findings (All 6 Diagnostic Pillars) */}
        <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
              Continuous Ledger Findings ({insights.length})
            </h3>
            <span className="text-[11px] text-slate-500 dark:text-slate-400">
              Auto-updated from ledger
            </span>
          </div>

          {insights.length === 0 ? (
            <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
              No ledger findings yet. Import starter demo data, scan a receipt, or log transactions to generate live diagnostic insights.
            </div>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {insights.slice(0, 6).map((item) => (
                <div key={item.id} className="py-3 space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span
                      className={`font-medium ${
                        item.severity === 'high'
                          ? 'text-rose-700 dark:text-rose-400'
                          : item.severity === 'medium'
                          ? 'text-amber-700 dark:text-amber-400'
                          : 'text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {item.categoryType}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(item.impactAmount)}
                      {item.impactPeriod === 'month'
                        ? '/mo'
                        : item.impactPeriod === 'year'
                        ? '/yr'
                        : ' impact'}
                    </span>
                  </div>
                  <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1">
                    <span>{item.title}</span>
                    <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                  </div>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer Quick Links & Read-Only Guardrail Notice */}
      <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
        {onNavigateTab && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button
              type="button"
              onClick={() => onNavigateTab('transactions', 'ledger')}
              className="inline-flex items-center gap-1 font-medium text-slate-800 dark:text-slate-200 hover:text-slate-950 dark:hover:text-white transition-colors whitespace-nowrap"
            >
              <span>Open Transactions &amp; Subscriptions</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <button
                type="button"
                onClick={() => onNavigateTab('reports')}
                className="hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 whitespace-nowrap"
              >
                Reports
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => onNavigateTab('goals')}
                className="hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 whitespace-nowrap"
              >
                Savings Goals
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => onNavigateTab('splits')}
                className="hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 whitespace-nowrap"
              >
                Split Bills
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <ShieldCheck className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
          <span>
            Read-only guardrails active: Never invents missing records, never double-counts across feeds, and never executes payments.
          </span>
        </div>
      </div>
    </section>
  );
};
