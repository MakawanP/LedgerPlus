import React, { useMemo, useState } from 'react';
import { SubscriptionFrequency, SubscriptionItem } from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';

interface SubscriptionsTrackerProps {
  subscriptions: SubscriptionItem[];
  onToggleCancelSubscription: (id: string) => void;
}

export const SubscriptionsTracker: React.FC<SubscriptionsTrackerProps> = ({
  subscriptions,
  onToggleCancelSubscription,
}) => {
  const [filterFreq, setFilterFreq] = useState<'All' | SubscriptionFrequency | 'Review'>('All');

  const filteredSubs = useMemo(() => {
    return subscriptions.filter((sub) => {
      if (filterFreq === 'All') return true;
      if (filterFreq === 'Review') return sub.status !== 'Active';
      return sub.frequency === filterFreq;
    });
  }, [subscriptions, filterFreq]);

  const metrics = useMemo(() => {
    const nonRent = subscriptions.filter((s) => s.category !== 'Rent & Housing');
    const monthlyTotal = nonRent.reduce(
      (sum, s) => sum + (s.frequency === 'Annual subscription' ? s.amount / 12 : s.amount),
      0
    );
    const annualTotal = nonRent.reduce((sum, s) => sum + s.estimatedAnnualCost, 0);
    const reviewSavingsAnnual = nonRent
      .filter((s) => s.status === 'Unused / Review')
      .reduce((sum, s) => sum + s.estimatedAnnualCost, 0);

    return { monthlyTotal, annualTotal, reviewSavingsAnnual };
  }, [subscriptions]);

  return (
    <section className="space-y-6">
      {/* Summary Header */}
      <div className="bg-white border border-slate-200 rounded-xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-200">
        <div className="p-5">
          <div className="text-xs text-slate-500">Recurring Subscriptions & Bills (Excl. Rent)</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(metrics.monthlyTotal)}
            <span className="text-xs font-normal text-slate-500">/mo</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Across {subscriptions.length - 1} active subscriptions, memberships & utilities
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Estimated Annual Recurring Cost</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900">
            {formatCurrency(metrics.annualTotal)}
            <span className="text-xs font-normal text-slate-500">/yr</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 font-mono">
            {formatCurrency(metrics.annualTotal + 29400)}/yr including $2,450/mo rent
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500">Forgotten / Unused Subscription Savings</div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-amber-700">
            {formatCurrency(metrics.reviewSavingsAnnual)}
            <span className="text-xs font-normal text-slate-500">/yr</span>
          </div>
          <div className="mt-1 text-xs text-slate-500">
            Identified from zero-usage & completed course signals
          </div>
        </div>
      </div>

      {/* Subscriptions Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Recurring Payments, Memberships & Bills
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Automatically detected from Gmail billing receipts, Apple Pay tokens, and bank statements
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(
              [
                { id: 'All', label: 'All Recurring' },
                { id: 'Monthly subscription', label: 'Monthly' },
                { id: 'Annual subscription', label: 'Annual' },
                { id: 'Membership', label: 'Memberships' },
                { id: 'Recurring bill', label: 'Bills & Rent' },
                { id: 'Review', label: 'Flagged for Review' },
              ] as const
            ).map((btn) => (
              <button
                key={btn.id}
                type="button"
                onClick={() => setFilterFreq(btn.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filterFreq === btn.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-500 font-medium">
                <th className="py-2.5 pl-6 pr-3">Merchant / Service</th>
                <th className="py-2.5 px-3">Billing Frequency</th>
                <th className="py-2.5 px-3">Schedule & Source</th>
                <th className="py-2.5 px-3">Payment Method</th>
                <th className="py-2.5 px-3">Audit Status</th>
                <th className="py-2.5 px-3 text-right">Billing Amount</th>
                <th className="py-2.5 px-3 text-right">Est. Annual Cost</th>
                <th className="py-2.5 pl-3 pr-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredSubs.map((sub) => (
                <tr key={sub.id} className="hover:bg-slate-50/80">
                  <td className="py-3.5 pl-6 pr-3">
                    <div className="font-semibold text-slate-900">{sub.merchant}</div>
                    <div className="text-[11px] text-slate-500">
                      {sub.category}
                      {sub.usageNote && (
                        <span className="text-amber-700"> · {sub.usageNote}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3.5 px-3 text-slate-700 whitespace-nowrap">
                    {sub.frequency}
                  </td>
                  <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap">
                    <div>{sub.billingDayOrDate}</div>
                    <div className="text-[11px] text-slate-400 font-mono">
                      Source: {sub.source} · Last: {sub.lastChargedDate}
                    </div>
                  </td>
                  <td className="py-3.5 px-3 text-slate-600 whitespace-nowrap">
                    {sub.paymentMethod}
                  </td>
                  <td className="py-3.5 px-3 whitespace-nowrap">
                    <span
                      className={`font-medium ${
                        sub.status === 'Active'
                          ? 'text-emerald-700'
                          : sub.status === 'Unused / Review'
                          ? 'text-rose-700'
                          : 'text-amber-700'
                      }`}
                    >
                      {sub.status}
                    </span>
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums font-medium text-slate-900 whitespace-nowrap">
                    {formatCurrency(sub.amount)}
                  </td>
                  <td className="py-3.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                    {formatCurrency(sub.estimatedAnnualCost)}/yr
                  </td>
                  <td className="py-3.5 pl-3 pr-6 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onToggleCancelSubscription(sub.id)}
                      className="text-xs font-medium text-slate-600 hover:text-slate-900 underline underline-offset-4"
                    >
                      {sub.status === 'Unused / Review' ? 'Mark Kept' : 'Flag Unused'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
};
