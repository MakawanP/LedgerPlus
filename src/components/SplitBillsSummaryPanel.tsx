import React, { useMemo, useState } from 'react';
import {
  Check,
  Plus,
  RotateCcw,
  Search,
  Split,
  Users,
  X,
} from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  DataSource,
  SpendingCategory,
  Transaction,
} from '../types/finance';
import { formatCurrency, getTransactionSplitSummary } from '../utils/financeMetrics';
import { MerchantLogo } from './MerchantLogo';

interface SplitBillsSummaryPanelProps {
  transactions: Transaction[];
  onToggleParticipantSettled: (txId: string, participantId: string) => void;
  onSettleAllForFriend?: (friendName: string) => void;
  onOpenSplitModal: (tx: Transaction) => void;
  onQuickCommitTransaction?: (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>
  ) => void;
}

export const SplitBillsSummaryPanel: React.FC<SplitBillsSummaryPanelProps> = ({
  transactions,
  onToggleParticipantSettled,
  onSettleAllForFriend,
  onOpenSplitModal,
  onQuickCommitTransaction,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'owed' | 'settled'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showPickPurchase, setShowPickPurchase] = useState(false);
  const [showNewSplitForm, setShowNewSplitForm] = useState(false);

  // Quick New Split Bill Form State
  const [merchant, setMerchant] = useState('');
  const [totalPaidInput, setTotalPaidInput] = useState('');
  const [category, setCategory] = useState<SpendingCategory>('Coffee & Drinks');
  const [date, setDate] = useState('2026-11-17');
  const [paymentMethod, setPaymentMethod] = useState('Apple Pay');
  const [friendName, setFriendName] = useState('');
  const [friendAmountInput, setFriendAmountInput] = useState('');
  const [itemNote, setItemNote] = useState('');

  const unsplitPurchases = useMemo(
    () =>
      transactions.filter(
        (t) => t.transactionType === 'purchase' && !getTransactionSplitSummary(t).isSplit
      ),
    [transactions]
  );

  const splitData = useMemo(() => {
    const entries: Array<{
      tx: Transaction;
      participantId: string;
      friendName: string;
      itemNote?: string;
      amountOwed: number;
      status: 'owed' | 'settled';
      settledDate?: string;
      personalShare: number;
    }> = [];

    const friendBalances = new Map<string, { owed: number; count: number }>();
    let totalOwed = 0;
    let totalSettled = 0;

    for (const tx of transactions) {
      if (tx.transactionType !== 'purchase' || !tx.splitBill?.participants?.length) continue;
      const summary = getTransactionSplitSummary(tx);
      if (!summary.isSplit) continue;

      for (const p of tx.splitBill.participants) {
        if (p.status === 'owed') {
          totalOwed += p.amountOwed;
          const prev = friendBalances.get(p.friendName) || { owed: 0, count: 0 };
          friendBalances.set(p.friendName, {
            owed: Math.round((prev.owed + p.amountOwed) * 100) / 100,
            count: prev.count + 1,
          });
        } else {
          totalSettled += p.amountOwed;
        }

        entries.push({
          tx,
          participantId: p.id,
          friendName: p.friendName,
          itemNote: p.itemNote,
          amountOwed: p.amountOwed,
          status: p.status,
          settledDate: p.settledDate,
          personalShare: summary.personalShare,
        });
      }
    }

    const perFriendOwed = Array.from(friendBalances.entries())
      .map(([name, info]) => ({ name, owed: info.owed, count: info.count }))
      .sort((a, b) => b.owed - a.owed);

    const unpaidCount = entries.filter((e) => e.status === 'owed').length;
    const settledCount = entries.filter((e) => e.status === 'settled').length;

    return {
      entries,
      perFriendOwed,
      unpaidCount,
      settledCount,
      totalOwed: Math.round(totalOwed * 100) / 100,
      totalSettled: Math.round(totalSettled * 100) / 100,
      totalCovered: Math.round((totalOwed + totalSettled) * 100) / 100,
    };
  }, [transactions]);

  const visibleRows = useMemo(() => {
    return splitData.entries.filter((entry) => {
      if (filterMode === 'owed' && entry.status !== 'owed') return false;
      if (filterMode === 'settled' && entry.status !== 'settled') return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchFriend = entry.friendName.toLowerCase().includes(q);
        const matchMerchant = entry.tx.merchant.toLowerCase().includes(q);
        const matchNote = Boolean(entry.itemNote?.toLowerCase().includes(q));
        if (!matchFriend && !matchMerchant && !matchNote) return false;
      }
      return true;
    });
  }, [splitData.entries, filterMode, searchQuery]);

  const numericTotal = parseFloat(totalPaidInput) || 0;
  const numericFriend = Math.max(0, parseFloat(friendAmountInput) || 0);
  const personalPreview = Math.max(0, Math.round((numericTotal - numericFriend) * 100) / 100);
  const isNewFormInvalid =
    !merchant.trim() ||
    !friendName.trim() ||
    numericTotal <= 0 ||
    numericFriend <= 0 ||
    numericFriend > numericTotal + 0.001;

  const handleCreateSplitBill = (e: React.FormEvent) => {
    e.preventDefault();
    if (isNewFormInvalid || !onQuickCommitTransaction) return;

    const cleanMerchant = merchant.trim();
    const cleanFriend = friendName.trim().slice(0, 80);
    const clampedFriendAmt = Math.min(
      Math.round(numericTotal * 100) / 100,
      Math.round(numericFriend * 100) / 100
    );
    const nowTime = new Date().toTimeString().slice(0, 5) || '11:30';
    const inferredSource: DataSource = paymentMethod.toLowerCase().includes('apple pay')
      ? 'Apple Pay'
      : 'Cash / Manual';

    const newTx: Transaction = {
      id: `tx-split-${Date.now()}`,
      date,
      time: nowTime,
      merchant: cleanMerchant,
      rawDescription: `SPLIT BILL · ${cleanMerchant.toUpperCase()}`,
      amount: Math.round(numericTotal * 100) / 100,
      paymentMethod,
      category,
      status: 'posted',
      transactionType: 'purchase',
      source: inferredSource,
      isDeduplicated: false,
      mergedSources: [
        {
          source: inferredSource,
          referenceId: `SPL-${Date.now().toString().slice(-5)}`,
          capturedAt: `${date} ${nowTime}`,
          rawDescriptor: `${cleanMerchant} · ${formatCurrency(numericTotal)}`,
          statusAtCapture: 'posted',
        },
      ],
      monthKey: date.startsWith('2026-10') ? '2026-10' : '2026-11',
      splitBill: {
        participants: [
          {
            id: `sp-${Date.now()}-1`,
            friendName: cleanFriend,
            itemNote: itemNote.trim() ? itemNote.trim().slice(0, 120) : undefined,
            amountOwed: clampedFriendAmt,
            status: 'owed',
          },
        ],
      },
    };

    onQuickCommitTransaction([newTx], []);
    setMerchant('');
    setTotalPaidInput('');
    setFriendName('');
    setFriendAmountInput('');
    setItemNote('');
    setShowNewSplitForm(false);
  };

  return (
    <section
      aria-label="Split Bills & Friend Reimbursements Tracker"
      className="space-y-6"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-2.5">
            <Users className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-1" />
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                Split Bills &amp; Friend Reimbursements Tracker
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Track shared bills where you covered for friends so only your personal share counts toward your monthly budgets
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {unsplitPurchases.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setShowPickPurchase((prev) => !prev);
                  setShowNewSplitForm(false);
                }}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors whitespace-nowrap"
              >
                <Split className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>{showPickPurchase ? 'Close Picker' : 'Split Existing Purchase'}</span>
              </button>
            )}

            {onQuickCommitTransaction && (
              <button
                type="button"
                onClick={() => {
                  setShowNewSplitForm((prev) => !prev);
                  setShowPickPurchase(false);
                }}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{showNewSplitForm ? 'Close Form' : 'Log Split Bill'}</span>
              </button>
            )}
          </div>
        </div>

        {/* 4-Column KPI Strip */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
          <div className="p-4 sm:px-6">
            <div className="text-xs text-slate-500 dark:text-slate-400">Total Owed to You</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-amber-700 dark:text-amber-400">
              {formatCurrency(splitData.totalOwed)}
            </div>
            <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {splitData.unpaidCount} unpaid friend {splitData.unpaidCount === 1 ? 'share' : 'shares'}
            </div>
          </div>

          <div className="p-4 sm:px-6">
            <div className="text-xs text-slate-500 dark:text-slate-400">Paid Back / Settled</div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-emerald-700 dark:text-emerald-400">
              {formatCurrency(splitData.totalSettled)}
            </div>
            <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
              {splitData.settledCount} reimbursed {splitData.settledCount === 1 ? 'share' : 'shares'}
            </div>
          </div>

          <div className="p-4 sm:px-6">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Excluded from Your Budgets
            </div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {formatCurrency(splitData.totalCovered)}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
              Total covered on behalf of friends
            </div>
          </div>

          <div className="p-4 sm:px-6">
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Friends with Open Balances
            </div>
            <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
              {splitData.perFriendOwed.length}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 truncate">
              {splitData.perFriendOwed.length > 0
                ? splitData.perFriendOwed
                    .map((f) => `${f.name} (${formatCurrency(f.owed)})`)
                    .join(' · ')
                : 'Everyone settled up'}
            </div>
          </div>
        </div>

        {/* Picker Drawer: Split an Existing Ledger Purchase */}
        {showPickPurchase && unsplitPurchases.length > 0 && (
          <div className="p-5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 space-y-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                Choose a Recorded Purchase to Split
              </span>
              <button
                type="button"
                onClick={() => setShowPickPurchase(false)}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto">
              {unsplitPurchases.slice(0, 15).map((tx) => (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => {
                    setShowPickPurchase(false);
                    onOpenSplitModal(tx);
                  }}
                  className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-500 rounded-xl flex items-center justify-between gap-2.5 text-left transition-colors"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                      {tx.merchant}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                      {tx.date} · {tx.category}
                    </div>
                  </div>
                  <span className="font-mono tabular-nums font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                    {formatCurrency(tx.amount)}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Inline Form Drawer: Log a Brand-New Split Bill */}
        {showNewSplitForm && onQuickCommitTransaction && (
          <form
            onSubmit={handleCreateSplitBill}
            className="p-5 sm:px-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 space-y-4 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                Log New Split Purchase
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Merchant / Store
                </label>
                <input
                  type="text"
                  required
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="e.g., Sightglass Coffee"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Total Bill You Paid ($)
                </label>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  required
                  value={totalPaidInput}
                  onChange={(e) => setTotalPaidInput(e.target.value)}
                  placeholder="20.00"
                  className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Friend&apos;s Name
                </label>
                <input
                  type="text"
                  required
                  value={friendName}
                  onChange={(e) => setFriendName(e.target.value)}
                  placeholder="e.g., Alex"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-medium text-slate-700 dark:text-slate-300">
                    Friend Owes ($)
                  </label>
                  {numericTotal > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        setFriendAmountInput((Math.round((numericTotal / 2) * 100) / 100).toFixed(2))
                      }
                      className="text-[11px] font-mono text-amber-700 dark:text-amber-400 hover:underline"
                    >
                      50/50
                    </button>
                  )}
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  max={numericTotal > 0 ? numericTotal : undefined}
                  required
                  value={friendAmountInput}
                  onChange={(e) => setFriendAmountInput(e.target.value)}
                  placeholder="10.00"
                  className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
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

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Paid With
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                >
                  <option value="Apple Pay">Apple Pay</option>
                  <option value="Wise">Wise</option>
                  <option value="Credit Card">Credit Card</option>
                  <option value="Debit / Checking">Debit / Checking</option>
                  <option value="Cash (Physical Currency)">Cash</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Item Note (Optional)
                </label>
                <input
                  type="text"
                  value={itemNote}
                  onChange={(e) => setItemNote(e.target.value)}
                  placeholder="e.g., Friend's drink"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <div className="font-mono text-xs text-slate-600 dark:text-slate-300">
                {numericTotal > 0 && (
                  <>
                    <span>Your personal spend: </span>
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {formatCurrency(personalPreview)}
                    </strong>
                    <span aria-hidden="true"> · </span>
                    <span>{friendName.trim() || 'Friend'} owes: </span>
                    <strong className="text-amber-700 dark:text-amber-400">
                      {formatCurrency(numericFriend)}
                    </strong>
                  </>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowNewSplitForm(false)}
                  className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isNewFormInvalid}
                  className="inline-flex items-center gap-1.5 px-4 py-1.5 font-semibold bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 disabled:opacity-50 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Save Split Purchase</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Per-Friend Open Balances Bar */}
        {splitData.perFriendOwed.length > 0 && (
          <div className="px-5 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Open Balances by Friend:
              </span>
              {splitData.perFriendOwed.map((f, idx) => (
                <React.Fragment key={f.name}>
                  {idx > 0 && (
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                  )}
                  <span className="inline-flex items-center gap-2">
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {f.name}
                    </span>
                    <span className="font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                      {formatCurrency(f.owed)}
                    </span>
                    {onSettleAllForFriend && f.count > 1 && (
                      <button
                        type="button"
                        onClick={() => onSettleAllForFriend(f.name)}
                        className="text-[11px] font-medium text-emerald-700 dark:text-emerald-400 underline underline-offset-2"
                      >
                        Settle all ({f.count})
                      </button>
                    )}
                  </span>
                </React.Fragment>
              ))}
            </div>
          </div>
        )}

        {/* Filter & Search Bar */}
        {splitData.entries.length > 0 && (
          <div className="px-5 sm:px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                aria-label="Search split bills by friend, merchant, or item"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by friend name, merchant, or item..."
                className="w-full pl-8 pr-8 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear split search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg self-start sm:self-auto">
              {(
                [
                  { id: 'all', label: `All Splits (${splitData.entries.length})` },
                  { id: 'owed', label: `Unpaid (${splitData.unpaidCount})` },
                  { id: 'settled', label: `Paid Back (${splitData.settledCount})` },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterMode(tab.id)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filterMode === tab.id
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Main Split Entries List or Empty State */}
        {splitData.entries.length === 0 ? (
          <div className="p-10 text-center space-y-3 text-xs text-slate-500 dark:text-slate-400">
            <div className="max-w-md mx-auto space-y-1.5">
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                No split bills recorded yet
              </div>
              <p>
                Covered coffee, dinner, or a ride for a friend? Log a split bill or split an existing purchase so only your personal share counts toward your monthly budgets.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              {onQuickCommitTransaction && (
                <button
                  type="button"
                  onClick={() => setShowNewSplitForm(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white rounded-lg transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Log First Split Bill</span>
                </button>
              )}
              {unsplitPurchases.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowPickPurchase(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <Split className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Split Existing Purchase</span>
                </button>
              )}
            </div>
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="px-6 py-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
            <p>No split bill items match the current filter.</p>
            <button
              type="button"
              onClick={() => {
                setFilterMode('all');
                setSearchQuery('');
              }}
              className="font-medium text-slate-900 dark:text-slate-100 underline underline-offset-4"
            >
              Show all split bills
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {visibleRows.map((entry) => {
              const isSettled = entry.status === 'settled';
              return (
                <div
                  key={`${entry.tx.id}-${entry.participantId}`}
                  className="px-5 sm:px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <MerchantLogo
                      merchant={entry.tx.merchant}
                      rawDescription={entry.tx.rawDescription}
                      transactionType={entry.tx.transactionType}
                      paymentMethod={entry.tx.paymentMethod}
                      size="md"
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900 dark:text-slate-100 truncate text-sm">
                        <span>{entry.friendName}</span>
                        <span aria-hidden="true" className="text-slate-400 mx-1.5">
                          ·
                        </span>
                        <span className="font-normal text-slate-600 dark:text-slate-300">
                          {entry.itemNote ? `${entry.itemNote} at ` : ''}
                          {entry.tx.merchant}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                        <span>{entry.tx.date}</span>
                        <span aria-hidden="true"> · </span>
                        <span>Paid {formatCurrency(entry.tx.amount)} total</span>
                        <span aria-hidden="true"> · </span>
                        <span>Your share {formatCurrency(entry.personalShare)}</span>
                        <span aria-hidden="true"> · </span>
                        <span>{entry.tx.category}</span>
                        {isSettled && entry.settledDate && (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span className="text-emerald-700 dark:text-emerald-400">
                              Settled {entry.settledDate}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <div className="text-left sm:text-right font-mono tabular-nums">
                      <div
                        className={`text-sm font-bold ${
                          isSettled
                            ? 'text-emerald-700 dark:text-emerald-400 line-through'
                            : 'text-amber-700 dark:text-amber-400'
                        }`}
                      >
                        {formatCurrency(entry.amountOwed)}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400">
                        {isSettled ? 'Paid back' : 'Owes you'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleParticipantSettled(entry.tx.id, entry.participantId)}
                        className={`min-h-[36px] sm:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg transition-colors whitespace-nowrap ${
                          isSettled
                            ? 'text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700'
                            : 'text-white bg-emerald-700 hover:bg-emerald-800'
                        }`}
                      >
                        {isSettled ? (
                          <>
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Mark Unpaid</span>
                          </>
                        ) : (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span>Mark Paid</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onOpenSplitModal(entry.tx)}
                        className="min-h-[36px] sm:min-h-0 inline-flex items-center gap-1 px-2.5 py-1.5 font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap"
                      >
                        <Split className="w-3.5 h-3.5" />
                        <span>Edit Split</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
