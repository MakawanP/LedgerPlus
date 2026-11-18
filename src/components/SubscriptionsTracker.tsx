import React, { useMemo, useState } from 'react';
import { Clock, TrendingUp } from 'lucide-react';
import { SavingsGoal, SubscriptionFrequency, SubscriptionItem } from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';
import { SubscriptionAlertsPanel } from './SubscriptionAlertsPanel';
import { MerchantLogo } from './MerchantLogo';

interface SubscriptionsTrackerProps {
  subscriptions: SubscriptionItem[];
  savingsGoals: SavingsGoal[];
  onToggleCancelSubscription: (id: string) => void;
  onDismissAlert: (id: string) => void;
  onCancelAndRedirectToGoal: (subId: string, goalId: string) => void;
}

export const SubscriptionsTracker: React.FC<SubscriptionsTrackerProps> = ({
  subscriptions,
  savingsGoals,
  onToggleCancelSubscription,
  onDismissAlert,
  onCancelAndRedirectToGoal,
}) => {
  const [filterFreq, setFilterFreq] = useState<'All' | SubscriptionFrequency | 'Review'>('All');

  const filteredSubs = useMemo(() => {
    return subscriptions.filter((sub) => {
      if (filterFreq === 'All') return true;
      if (filterFreq === 'Review') {
        const isHike = sub.previousAmount !== undefined && sub.amount > sub.previousAmount;
        const isInactive3Mo = (sub.inactiveMonths ?? 0) > 3;
        return sub.status !== 'Active' || isHike || isInactive3Mo;
      }
      return sub.frequency === filterFreq;
    });
  }, [subscriptions, filterFreq]);

  const metrics = useMemo(() => {
    const nonRent = subscriptions.filter(
      (s) => s.category !== 'Rent & Housing' && s.status !== 'Canceled'
    );
    const monthlyTotal = nonRent.reduce(
      (sum, s) => sum + (s.frequency === 'Annual subscription' ? s.amount / 12 : s.amount),
      0
    );
    const annualTotal = nonRent.reduce((sum, s) => sum + s.estimatedAnnualCost, 0);
    const reviewSavingsAnnual = nonRent
      .filter((s) => s.status === 'Unused / Review' || (s.inactiveMonths ?? 0) > 3)
      .reduce((sum, s) => sum + s.estimatedAnnualCost, 0);

    return { monthlyTotal, annualTotal, reviewSavingsAnnual };
  }, [subscriptions]);

  return (
    <section className="space-y-6">
      {/* Automated Price Increase & >3-Month Inactivity Watchdog Panel */}
      <SubscriptionAlertsPanel
        subscriptions={subscriptions}
        savingsGoals={savingsGoals}
        onDismissAlert={onDismissAlert}
        onCancelAndRedirectToGoal={onCancelAndRedirectToGoal}
      />

      {/* Summary Header */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200 dark:divide-slate-800">
        <div className="p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Recurring Subscriptions & Bills (Excl. Rent)
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(metrics.monthlyTotal)}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/mo</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Across active subscriptions, memberships & utilities
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Estimated Annual Recurring Cost
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(metrics.annualTotal)}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/yr</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
            {formatCurrency(metrics.annualTotal + 29400)}/yr including $2,450/mo rent
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            &gt;3-Month Inactive Subscription Savings
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(metrics.reviewSavingsAnnual)}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/yr</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Identified from &gt;3.0 months inactivity & completed courses
          </div>
        </div>
      </div>

      {/* Subscriptions Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recurring Payments, Memberships & Bills
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Automatically monitored for billing rate increases and &gt;3-month inactivity
            </p>
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800/90 rounded-xl md:rounded-lg overflow-x-auto max-w-full">
            {(
              [
                { id: 'All', label: 'All' },
                { id: 'Monthly subscription', label: 'Monthly' },
                { id: 'Annual subscription', label: 'Annual' },
                { id: 'Membership', label: 'Memberships' },
                { id: 'Recurring bill', label: 'Bills & Rent' },
                { id: 'Review', label: 'Alerts' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilterFreq(btn.id)}
                className={`min-h-[36px] md:min-h-0 px-3 md:px-2.5 py-1.5 md:py-1 text-xs font-medium rounded-lg md:rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filterFreq === btn.id
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* MOBILE iOS TOUCH CARDS (< 768px) */}
        <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800">
          {filteredSubs.map((sub) => {
            const isPriceHike =
              sub.previousAmount !== undefined && sub.amount > sub.previousAmount;
            const isInactiveOver3Mo = (sub.inactiveMonths ?? 0) > 3;

            return (
              <div
                key={`mob-sub-${sub.id}`}
                className={`p-4 space-y-2.5 ${sub.status === 'Canceled' ? 'opacity-55' : ''}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <MerchantLogo
                      merchant={sub.merchant}
                      paymentMethod={sub.paymentMethod}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {sub.merchant}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {sub.frequency} · {sub.billingDayOrDate}
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div className="text-sm font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(sub.amount)}
                    </div>
                    <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                      {formatCurrency(sub.estimatedAnnualCost)}/yr
                    </div>
                  </div>
                </div>

                {(isInactiveOver3Mo || isPriceHike) && (
                  <div className="text-[11px] space-y-1">
                    {isInactiveOver3Mo && (
                      <div className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-medium">
                        <Clock className="w-3.5 h-3.5 shrink-0" />
                        <span>Inactive {sub.inactiveMonths?.toFixed(1)} mos (&gt;3 mo limit)</span>
                      </div>
                    )}
                    {isPriceHike && (
                      <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
                        <TrendingUp className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          Increased +{formatCurrency(sub.amount - (sub.previousAmount || 0))}/mo (was{' '}
                          {formatCurrency(sub.previousAmount || 0)})
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                  <span
                    className={`font-medium ${
                      sub.status === 'Active'
                        ? 'text-emerald-700 dark:text-emerald-400'
                        : sub.status === 'Canceled'
                        ? 'text-slate-400 dark:text-slate-500 line-through'
                        : sub.status === 'Unused / Review'
                        ? 'text-rose-700 dark:text-rose-400'
                        : 'text-amber-700 dark:text-amber-400'
                    }`}
                  >
                    {sub.status} · {sub.paymentMethod}
                  </span>

                  <button
                    type="button"
                    onClick={() => onToggleCancelSubscription(sub.id)}
                    className="min-h-[38px] px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl transition-colors shrink-0"
                  >
                    {sub.status === 'Unused / Review'
                      ? 'Mark Kept'
                      : sub.status === 'Canceled'
                      ? 'Reactivate'
                      : 'Flag Unused'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* DESKTOP ANALYTICAL SUBSCRIPTIONS TABLE (>= 768px) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-500 dark:text-slate-400 font-medium">
                <th className="py-2.5 pl-6 pr-3">Merchant / Service</th>
                <th className="py-2.5 px-3">Billing Frequency</th>
                <th className="py-2.5 px-3">Activity & Rate Change</th>
                <th className="py-2.5 px-3">Payment Method</th>
                <th className="py-2.5 px-3">Audit Status</th>
                <th className="py-2.5 px-3 text-right">Billing Amount</th>
                <th className="py-2.5 px-3 text-right">Est. Annual Cost</th>
                <th className="py-2.5 pl-3 pr-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {filteredSubs.map((sub) => {
                const isPriceHike =
                  sub.previousAmount !== undefined && sub.amount > sub.previousAmount;
                const isInactiveOver3Mo = (sub.inactiveMonths ?? 0) > 3;

                return (
                  <tr
                    key={sub.id}
                    className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 ${
                      sub.status === 'Canceled' ? 'opacity-50' : ''
                    }`}
                  >
                    <td className="py-3.5 pl-6 pr-3">
                      <div className="flex items-center gap-2.5">
                        <MerchantLogo
                          merchant={sub.merchant}
                          paymentMethod={sub.paymentMethod}
                          size="sm"
                        />
                        <div>
                          <div className="font-semibold text-slate-900 dark:text-slate-100">
                            {sub.merchant}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {sub.category} · {sub.billingDayOrDate}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {sub.frequency}
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <div className="space-y-0.5">
                        {isInactiveOver3Mo ? (
                          <div className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-medium">
                            <Clock className="w-3.5 h-3.5 shrink-0" />
                            <span>Inactive {sub.inactiveMonths?.toFixed(1)} mos (&gt;3 mo limit)</span>
                          </div>
                        ) : (
                          <div className="text-slate-600 dark:text-slate-400">
                            Active within last 30 days
                          </div>
                        )}
                        {isPriceHike && (
                          <div className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium text-[11px]">
                            <TrendingUp className="w-3 h-3 shrink-0" />
                            <span>
                              Up +{formatCurrency(sub.amount - (sub.previousAmount || 0))}/mo (was{' '}
                              {formatCurrency(sub.previousAmount || 0)})
                            </span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {sub.paymentMethod}
                    </td>
                    <td className="py-3.5 px-3 whitespace-nowrap">
                      <span
                        className={`font-medium ${
                          sub.status === 'Active'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : sub.status === 'Canceled'
                            ? 'text-slate-400 dark:text-slate-500 line-through'
                            : sub.status === 'Unused / Review'
                            ? 'text-rose-700 dark:text-rose-400'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {sub.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums font-medium text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatCurrency(sub.amount)}
                    </td>
                    <td className="py-3.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                      {formatCurrency(sub.estimatedAnnualCost)}/yr
                    </td>
                    <td className="py-3.5 pl-3 pr-6 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onToggleCancelSubscription(sub.id)}
                        className="text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4"
                      >
                        {sub.status === 'Unused / Review'
                          ? 'Mark Kept'
                          : sub.status === 'Canceled'
                          ? 'Reactivate'
                          : 'Flag Unused'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
