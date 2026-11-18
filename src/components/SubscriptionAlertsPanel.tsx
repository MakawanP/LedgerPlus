import React from 'react';
import {
  ArrowUpRight,
  BellRing,
  CheckCircle2,
  Clock,
  PiggyBank,
  TrendingUp,
} from 'lucide-react';
import { SavingsGoal, SubscriptionItem } from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';
import { MerchantLogo } from './MerchantLogo';

interface SubscriptionAlertsPanelProps {
  subscriptions: SubscriptionItem[];
  savingsGoals: SavingsGoal[];
  onDismissAlert: (subscriptionId: string) => void;
  onCancelAndRedirectToGoal: (subscriptionId: string, goalId: string) => void;
}

export interface TriggeredSubscriptionAlert {
  subscription: SubscriptionItem;
  isPriceIncreased: boolean;
  isInactiveOver3Months: boolean;
  priceDeltaMonthly: number;
  priceDeltaPercent: number;
  inactiveMonths: number;
  annualSavingsIfCanceled: number;
}

export function evaluateSubscriptionAlerts(
  subscriptions: SubscriptionItem[]
): TriggeredSubscriptionAlert[] {
  return subscriptions
    .filter((sub) => sub.status !== 'Canceled' && !sub.alertDismissed)
    .map((sub) => {
      const priceDeltaMonthly =
        sub.previousAmount !== undefined && sub.amount > sub.previousAmount
          ? sub.amount - sub.previousAmount
          : 0;
      const priceDeltaPercent =
        sub.previousAmount && sub.previousAmount > 0
          ? (priceDeltaMonthly / sub.previousAmount) * 100
          : 0;
      const inactiveMonths = sub.inactiveMonths ?? 0;

      const isPriceIncreased = priceDeltaMonthly > 0.009;
      const isInactiveOver3Months = inactiveMonths > 3.0;

      return {
        subscription: sub,
        isPriceIncreased,
        isInactiveOver3Months,
        priceDeltaMonthly,
        priceDeltaPercent,
        inactiveMonths,
        annualSavingsIfCanceled: sub.estimatedAnnualCost,
      };
    })
    .filter((a) => a.isPriceIncreased || a.isInactiveOver3Months);
}

export const SubscriptionAlertsPanel: React.FC<SubscriptionAlertsPanelProps> = ({
  subscriptions,
  savingsGoals,
  onDismissAlert,
  onCancelAndRedirectToGoal,
}) => {
  const alerts = evaluateSubscriptionAlerts(subscriptions);
  const primaryGoal = savingsGoals[0];

  const totalAnnualWasteAtRisk = alerts.reduce((sum, a) => {
    if (a.isInactiveOver3Months) {
      return sum + a.annualSavingsIfCanceled;
    }
    return sum + a.priceDeltaMonthly * 12;
  }, 0);

  return (
    <section
      aria-label="Automated Subscription Price & Inactivity Alerts"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-rose-50/30 dark:bg-rose-950/20">
        <div className="flex items-center gap-2.5">
          <BellRing className="w-4 h-4 text-rose-700 dark:text-rose-400 shrink-0" />
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Automated Subscription Watchdog — Price Increases & &gt;3-Month Inactivity Alerts
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Triggers automatically when a recurring charge rises above its prior billing rate or shows &gt;3.0 months (90+ days) of zero usage
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-slate-700 dark:text-slate-300">
            <strong>{alerts.length}</strong> active {alerts.length === 1 ? 'alert' : 'alerts'} ·{' '}
            <strong className="text-rose-700 dark:text-rose-400">
              {formatCurrency(totalAnnualWasteAtRisk)}/yr
            </strong>{' '}
            at risk
          </span>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="px-6 py-5 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              All recurring subscriptions are within historical price baselines and active within the last 3 months.
            </span>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {alerts.map((alert) => {
            const { subscription: sub } = alert;
            return (
              <div
                key={sub.id}
                className="px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors"
              >
                <div className="flex items-start gap-3 max-w-3xl">
                  <MerchantLogo
                    merchant={sub.merchant}
                    paymentMethod={sub.paymentMethod}
                    size="sm"
                  />
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap text-sm font-semibold text-slate-900 dark:text-slate-100">
                      <span>{sub.merchant}</span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="font-mono text-slate-900 dark:text-slate-100">
                        {formatCurrency(sub.amount)}/mo
                      </span>
                      <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
                      <span className="text-xs font-normal font-mono text-slate-500 dark:text-slate-400">
                        {formatCurrency(sub.estimatedAnnualCost)}/yr
                      </span>

                      {alert.isInactiveOver3Months && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-700 dark:text-rose-400">
                          <Clock className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Inactive {alert.inactiveMonths.toFixed(1)} months ({Math.round(alert.inactiveMonths * 30)} days)
                          </span>
                        </span>
                      )}

                      {alert.isPriceIncreased && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                          <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            Price up +{formatCurrency(alert.priceDeltaMonthly)}/mo (+{alert.priceDeltaPercent.toFixed(1)}% from {formatCurrency(sub.previousAmount || 0)})
                          </span>
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600 dark:text-slate-400">
                      {sub.usageNote} · Billed via {sub.paymentMethod} ({sub.source})
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {sub.category !== 'Bills & Utilities' && sub.category !== 'Rent & Housing' && primaryGoal && (
                    <button
                      type="button"
                      onClick={() => onCancelAndRedirectToGoal(sub.id, primaryGoal.id)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
                    >
                      <PiggyBank className="w-3.5 h-3.5" />
                      <span>
                        Cancel & Add +{formatCurrency(sub.amount)}/mo to &ldquo;{primaryGoal.name}&rdquo;
                      </span>
                      <ArrowUpRight className="w-3 h-3" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => onDismissAlert(sub.id)}
                    className="px-3 py-1.5 text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
                  >
                    Acknowledge Alert
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
