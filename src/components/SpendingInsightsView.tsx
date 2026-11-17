import React, { useState } from 'react';
import { AlertCircle, ArrowUpRight, RefreshCw, Send } from 'lucide-react';
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

interface SpendingInsightsViewProps {
  insights: SpendingInsight[];
  summaryMetrics: DashboardSummaryMetrics;
  categoryBreakdown: CategorySummaryItem[];
  subscriptions: SubscriptionItem[];
  transactions: Transaction[];
}

interface AiAuditResult {
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
}) => {
  const [userQuestion, setUserQuestion] = useState('');
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [aiAuditResult, setAiAuditResult] = useState<AiAuditResult | null>(null);

  const handleRunAiAudit = async (customPrompt?: string) => {
    setIsLoadingAudit(true);
    setAuditError(null);
    try {
      const response = await fetch('/api/finance/audit-insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          summaryMetrics,
          categoryBreakdown: categoryBreakdown.filter((c) => c.amount > 0 || c.previousMonthAmount > 0),
          subscriptions,
          recentTransactions: transactions.filter((t) => t.monthKey === '2026-11'),
          userQuestion: customPrompt ?? userQuestion,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to run Gemini financial audit.');
      }
      setAiAuditResult(data);
    } catch (err: any) {
      setAuditError(err.message || 'Unable to reach AI audit service.');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  return (
    <section className="space-y-6">
      {/* Live AI Financial Assistant Query Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              AI Spending Insights & Anomaly Detection
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Analyzes actual verified ledger figures without inventing transactions or counting duplicates twice
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              handleRunAiAudit(
                'Perform a full audit of my November spending, duplicate charges, and forgotten subscriptions.'
              )
            }
            disabled={isLoadingAudit}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 self-start sm:self-auto"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAudit ? 'animate-spin' : ''}`} />
            <span>{isLoadingAudit ? 'Analyzing Ledger...' : 'Run Live Gemini Audit'}</span>
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (userQuestion.trim()) {
              handleRunAiAudit(userQuestion.trim());
            }
          }}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            type="text"
            value={userQuestion}
            onChange={(e) => setUserQuestion(e.target.value)}
            placeholder="Ask about your spending (e.g., 'Where can I cut $150/month?' or 'Which categories increased vs October?')"
            className="flex-1 px-3.5 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400"
          />
          <button
            type="submit"
            disabled={isLoadingAudit || !userQuestion.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Ask Assistant</span>
          </button>
        </form>

        {/* Quick Preset Questions */}
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Quick checks:</span>
          {[
            'Which subscriptions look forgotten or unused?',
            'Are there any duplicate or suspicious charges this month?',
            'Compare my dining and travel spend against October.',
          ].map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => {
                setUserQuestion(q);
                handleRunAiAudit(q);
              }}
              className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 text-left"
            >
              {q}
            </button>
          ))}
        </div>

        {auditError && (
          <div className="p-3.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg flex items-start gap-2.5 text-xs text-rose-800 dark:text-rose-200">
            <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
            <div>
              <strong className="font-semibold">Audit Error:</strong> {auditError}
            </div>
          </div>
        )}

        {aiAuditResult && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-4">
            <div className="space-y-1">
              <div className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                Live Gemini Financial Analysis
              </div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {aiAuditResult.executiveHeadline}
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {aiAuditResult.directAnswer}
              </p>
            </div>

            {aiAuditResult.findings && aiAuditResult.findings.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {aiAuditResult.findings.map((f, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-500 dark:text-slate-400">{f.type}</span>
                      <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {formatCurrency(f.estimatedMonthlyImpact)}/mo impact
                      </span>
                    </div>
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      {f.title}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{f.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 6 Structured Spending Insight Categories */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Continuous Ledger Findings (6 Core Diagnostic Pillars)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Top categories · Unusual purchases · Increasing patterns · Duplicate charges · Forgotten subscriptions · Savings opportunities
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {insights.slice(0, 3).map((item) => (
              <div key={item.id} className="p-6 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={`font-medium ${
                      item.severity === 'high'
                        ? 'text-rose-700 dark:text-rose-400'
                        : item.severity === 'medium'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-600 dark:text-slate-400'
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
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>{item.title}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>

          <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t md:border-t-0 border-slate-200 dark:border-slate-800">
            {insights.slice(3, 6).map((item) => (
              <div key={item.id} className="p-6 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span
                    className={`font-medium ${
                      item.severity === 'high'
                        ? 'text-rose-700 dark:text-rose-400'
                        : item.severity === 'medium'
                        ? 'text-amber-700 dark:text-amber-400'
                        : 'text-slate-600 dark:text-slate-400'
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
                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <span>{item.title}</span>
                  <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 shrink-0" />
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                  {item.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};
