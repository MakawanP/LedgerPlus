import React, { useMemo, useState } from 'react';
import { Clock, Plus, RotateCcw, Trash2, TrendingUp, X } from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  DataSource,
  SavingsGoal,
  SpendingCategory,
  SubscriptionFrequency,
  SubscriptionItem,
} from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';
import { SubscriptionAlertsPanel } from './SubscriptionAlertsPanel';
import { MerchantLogo } from './MerchantLogo';

interface SubscriptionsTrackerProps {
  subscriptions: SubscriptionItem[];
  savingsGoals: SavingsGoal[];
  onToggleCancelSubscription: (id: string) => void;
  onDismissAlert: (id: string) => void;
  onCancelAndRedirectToGoal: (subId: string, goalId: string) => void;
  onAddSubscription: (sub: Omit<SubscriptionItem, 'id'>) => void;
  onDeleteSubscription: (id: string) => void;
  lastDeletedSubscription?: SubscriptionItem | null;
  onUndoDeleteSubscription?: () => void;
  onDismissUndoSubscription?: () => void;
}

export const SubscriptionsTracker: React.FC<SubscriptionsTrackerProps> = ({
  subscriptions,
  savingsGoals,
  onToggleCancelSubscription,
  onDismissAlert,
  onCancelAndRedirectToGoal,
  onAddSubscription,
  onDeleteSubscription,
  lastDeletedSubscription = null,
  onUndoDeleteSubscription,
  onDismissUndoSubscription,
}) => {
  const [filterFreq, setFilterFreq] = useState<'All' | SubscriptionFrequency | 'Review'>('All');
  const [showAddForm, setShowAddForm] = useState(false);

  // Add Subscription / Recurring Payment form state
  const [merchant, setMerchant] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [frequency, setFrequency] = useState<SubscriptionFrequency>('Monthly subscription');
  const [category, setCategory] = useState<SpendingCategory>('Subscriptions');
  const [billingDayOrDate, setBillingDayOrDate] = useState('1st monthly');
  const [paymentMethod, setPaymentMethod] = useState('Credit Card');
  const [status, setStatus] = useState<SubscriptionItem['status']>('Active');
  const [usageNote, setUsageNote] = useState('');

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
    const activeAll = subscriptions.filter((s) => s.status !== 'Canceled');
    const nonRent = activeAll.filter((s) => s.category !== 'Rent & Housing');
    const rentItems = activeAll.filter((s) => s.category === 'Rent & Housing');

    const monthlyTotal = nonRent.reduce(
      (sum, s) => sum + (s.frequency === 'Annual subscription' ? s.amount / 12 : s.amount),
      0
    );
    const annualTotal = nonRent.reduce((sum, s) => sum + s.estimatedAnnualCost, 0);
    const rentAnnualTotal = rentItems.reduce((sum, s) => sum + s.estimatedAnnualCost, 0);
    const reviewSavingsAnnual = nonRent
      .filter((s) => s.status === 'Unused / Review' || (s.inactiveMonths ?? 0) > 3)
      .reduce((sum, s) => sum + s.estimatedAnnualCost, 0);

    return {
      monthlyTotal,
      annualTotal,
      rentAnnualTotal,
      reviewSavingsAnnual,
      activeCount: activeAll.length,
    };
  }, [subscriptions]);

  const handleFrequencyChange = (nextFreq: SubscriptionFrequency) => {
    setFrequency(nextFreq);
    if (nextFreq === 'Recurring bill' && category === 'Subscriptions') {
      setCategory('Bills & Utilities');
    } else if (nextFreq === 'Membership' && category === 'Bills & Utilities') {
      setCategory('Subscriptions');
    }
    if (nextFreq === 'Annual subscription' && billingDayOrDate === '1st monthly') {
      setBillingDayOrDate('Annual renewal');
    }
  };

  const handleSubmitNewSubscription = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amountInput);
    if (!merchant.trim() || Number.isNaN(numericAmount) || numericAmount <= 0) {
      return;
    }

    const cleanAmount = Math.round(numericAmount * 100) / 100;
    const estimatedAnnualCost =
      frequency === 'Annual subscription'
        ? cleanAmount
        : Math.round(cleanAmount * 12 * 100) / 100;

    const inferredSource: DataSource = paymentMethod.toLowerCase().includes('apple pay')
      ? 'Apple Pay'
      : 'Cash / Manual';

    onAddSubscription({
      merchant: merchant.trim(),
      category,
      amount: cleanAmount,
      frequency,
      billingDayOrDate: billingDayOrDate.trim() || 'Monthly',
      paymentMethod: paymentMethod.trim() || 'Credit Card',
      source: inferredSource,
      estimatedAnnualCost,
      status,
      usageNote: usageNote.trim() ? usageNote.trim() : undefined,
      lastChargedDate: '2026-11-17',
    });

    setMerchant('');
    setAmountInput('');
    setUsageNote('');
    setShowAddForm(false);
  };

  return (
    <section className="space-y-6">
      {/* Inline Undo Banner After Deleting a Subscription / Recurring Payment */}
      {lastDeletedSubscription && onUndoDeleteSubscription && (
        <div
          role="status"
          className="p-3.5 bg-slate-900 dark:bg-slate-800 text-white border border-slate-800 dark:border-slate-700 rounded-xl flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <span>
            Removed recurring payment{' '}
            <strong>{lastDeletedSubscription.merchant}</strong> (
            {formatCurrency(lastDeletedSubscription.amount)} · {lastDeletedSubscription.frequency}).
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onUndoDeleteSubscription}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo Remove</span>
            </button>
            {onDismissUndoSubscription && (
              <button
                type="button"
                onClick={onDismissUndoSubscription}
                className="p-1 text-slate-300 hover:text-white rounded"
                aria-label="Dismiss undo notice"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

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
            Recurring Subscriptions &amp; Bills (Excl. Rent)
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(metrics.monthlyTotal)}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/mo</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Across {metrics.activeCount} active recurring{' '}
            {metrics.activeCount === 1 ? 'commitment' : 'commitments'}
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
            {metrics.rentAnnualTotal > 0
              ? `${formatCurrency(metrics.annualTotal + metrics.rentAnnualTotal)}/yr incl. housing`
              : 'Excludes canceled recurring items'}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Flagged / Unused Subscription Savings
          </div>
          <div className="mt-1.5 text-2xl font-semibold font-mono tabular-nums text-rose-700 dark:text-rose-400">
            {formatCurrency(metrics.reviewSavingsAnnual)}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/yr</span>
          </div>
          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Identified from unused or &gt;3-month inactive plans
          </div>
        </div>
      </div>

      {/* Subscriptions Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Recurring Payments, Memberships &amp; Subscriptions
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Add or remove subscriptions, monthly utilities, rent, and memberships to track recurring cash flow
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
                  className={`min-h-[34px] md:min-h-0 px-3 md:px-2.5 py-1.5 md:py-1 text-xs font-medium rounded-lg md:rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filterFreq === btn.id
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {showAddForm ? (
                <>
                  <X className="w-3.5 h-3.5" />
                  <span>Close Form</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Subscription / Bill</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Inline Add Subscription / Recurring Payment Form */}
        {showAddForm && (
          <form
            onSubmit={handleSubmitNewSubscription}
            className="p-5 sm:px-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 space-y-4 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                Add Subscription or Recurring Payment
              </div>
              <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                {parseFloat(amountInput) > 0
                  ? `Est. ${formatCurrency(
                      frequency === 'Annual subscription'
                        ? parseFloat(amountInput)
                        : parseFloat(amountInput) * 12
                    )}/yr`
                  : 'Calculates annual cost automatically'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Service / Bill Name
                </label>
                <input
                  type="text"
                  required
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g., Spotify, Apartment Rent, Electric"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Billing Amount ($)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  placeholder="14.99"
                  className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Billing Frequency
                </label>
                <select
                  value={frequency}
                  onChange={(e) => handleFrequencyChange(e.target.value as SubscriptionFrequency)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                >
                  <option value="Monthly subscription">Monthly subscription</option>
                  <option value="Annual subscription">Annual subscription</option>
                  <option value="Membership">Membership</option>
                  <option value="Recurring bill">Recurring bill (Rent / Utility)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Category
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as SpendingCategory)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                >
                  {ALL_SPENDING_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Billing Day or Next Date
                </label>
                <input
                  type="text"
                  value={billingDayOrDate}
                  onChange={(e) => setBillingDayOrDate(e.target.value)}
                  placeholder="e.g., 15th monthly or 2026-11-25"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Payment Method
                </label>
                <input
                  type="text"
                  list="sub-payment-methods-list"
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  placeholder="e.g., Credit Card, Apple Pay, ACH"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
                <datalist id="sub-payment-methods-list">
                  <option value="Credit Card" />
                  <option value="Apple Pay" />
                  <option value="Debit / Checking" />
                  <option value="Direct Debit / ACH" />
                </datalist>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as SubscriptionItem['status'])}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                >
                  <option value="Active">Active</option>
                  <option value="Unused / Review">Unused / Review</option>
                  <option value="Price Increased">Price Increased</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Note (Optional)
                </label>
                <input
                  type="text"
                  value={usageNote}
                  onChange={(e) => setUsageNote(e.target.value)}
                  placeholder="Plan tier or renewal reminder..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowAddForm(false)}
                className="px-3.5 py-2 font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-white rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Save Recurring Payment</span>
              </button>
            </div>
          </form>
        )}

        {/* Empty State */}
        {filteredSubs.length === 0 ? (
          <div className="p-10 text-center space-y-3">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {subscriptions.length === 0
                ? 'No recurring payments or subscriptions added yet'
                : 'No recurring items match this filter'}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
              {subscriptions.length === 0
                ? 'Add monthly streaming subscriptions, memberships, rent, or utility bills to forecast upcoming charges and monitor unused services.'
                : 'Switch back to All or add a new recurring payment.'}
            </p>
            {!showAddForm && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Subscription / Recurring Bill</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
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
                              Increased +{formatCurrency(sub.amount - (sub.previousAmount || 0))}/mo
                              (was {formatCurrency(sub.previousAmount || 0)})
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                      <span
                        className={`font-medium truncate ${
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

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onToggleCancelSubscription(sub.id)}
                          className="min-h-[36px] px-3 py-1.5 text-xs font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl transition-colors"
                        >
                          {sub.status === 'Unused / Review'
                            ? 'Mark Kept'
                            : sub.status === 'Canceled'
                            ? 'Reactivate'
                            : 'Flag Unused'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteSubscription(sub.id)}
                          aria-label={`Remove ${sub.merchant}`}
                          title="Remove recurring payment"
                          className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 bg-slate-100 dark:bg-slate-800 rounded-xl transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
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
                    <th className="py-2.5 px-3">Activity &amp; Notes</th>
                    <th className="py-2.5 px-3">Payment Method</th>
                    <th className="py-2.5 px-3">Audit Status</th>
                    <th className="py-2.5 px-3 text-right">Billing Amount</th>
                    <th className="py-2.5 px-3 text-right">Est. Annual Cost</th>
                    <th className="py-2.5 pl-3 pr-6 text-right">Actions</th>
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
                        <td className="py-3.5 px-3">
                          <div className="space-y-0.5">
                            {isInactiveOver3Mo ? (
                              <div className="inline-flex items-center gap-1 text-rose-700 dark:text-rose-400 font-medium">
                                <Clock className="w-3.5 h-3.5 shrink-0" />
                                <span>Inactive {sub.inactiveMonths?.toFixed(1)} mos (&gt;3 mo limit)</span>
                              </div>
                            ) : (
                              <div className="text-slate-600 dark:text-slate-400 truncate max-w-[220px]">
                                {sub.usageNote || 'Active recurring schedule'}
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
                          <div className="inline-flex items-center gap-3">
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
                            <button
                              type="button"
                              onClick={() => onDeleteSubscription(sub.id)}
                              aria-label={`Remove ${sub.merchant}`}
                              title="Remove subscription / recurring payment"
                              className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Remove</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
};
