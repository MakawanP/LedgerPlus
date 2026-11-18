import React, { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Trash2, Users, X } from 'lucide-react';
import { BillSplitDetails, SplitParticipant, Transaction } from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';
import { MerchantLogo } from './MerchantLogo';

interface SplitBillModalProps {
  transaction: Transaction | null;
  onClose: () => void;
  onSaveSplit: (txId: string, splitBill: BillSplitDetails | undefined) => void;
}

interface DraftParticipant {
  id: string;
  friendName: string;
  itemNote: string;
  amountInput: string;
  status: 'owed' | 'settled';
  settledDate?: string;
}

export const SplitBillModal: React.FC<SplitBillModalProps> = ({
  transaction,
  onClose,
  onSaveSplit,
}) => {
  const [participants, setParticipants] = useState<DraftParticipant[]>([]);
  const [splitNote, setSplitNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    if (!transaction) return;
    setValidationError(null);

    if (transaction.splitBill && transaction.splitBill.participants.length > 0) {
      setParticipants(
        transaction.splitBill.participants.map((p) => ({
          id: p.id,
          friendName: p.friendName,
          itemNote: p.itemNote || '',
          amountInput: p.amountOwed.toFixed(2),
          status: p.status,
          settledDate: p.settledDate,
        }))
      );
      setSplitNote(transaction.splitBill.note || '');
    } else {
      const half = Math.round((transaction.amount / 2) * 100) / 100;
      setParticipants([
        {
          id: `sp-${Date.now()}-1`,
          friendName: '',
          itemNote: '',
          amountInput: half > 0 ? half.toFixed(2) : '',
          status: 'owed',
        },
      ]);
      setSplitNote('');
    }
  }, [transaction]);

  useEffect(() => {
    if (!transaction) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [transaction, onClose]);

  const liveMath = useMemo(() => {
    const totalPaid = transaction?.amount ?? 0;
    let friendsTotal = 0;
    let owedTotal = 0;
    let settledTotal = 0;

    for (const p of participants) {
      const val = Math.max(0, parseFloat(p.amountInput) || 0);
      friendsTotal += val;
      if (p.status === 'settled') {
        settledTotal += val;
      } else {
        owedTotal += val;
      }
    }

    const roundedFriends = Math.round(friendsTotal * 100) / 100;
    const personalShare = Math.round((totalPaid - roundedFriends) * 100) / 100;
    const isOverAllocated = roundedFriends > totalPaid + 0.001;

    const personalPct =
      totalPaid > 0 ? Math.max(0, Math.min(100, (Math.max(0, personalShare) / totalPaid) * 100)) : 50;
    const friendsPct = 100 - personalPct;

    return {
      totalPaid,
      friendsTotal: roundedFriends,
      owedTotal: Math.round(owedTotal * 100) / 100,
      settledTotal: Math.round(settledTotal * 100) / 100,
      personalShare,
      isOverAllocated,
      personalPct,
      friendsPct,
    };
  }, [participants, transaction?.amount]);

  if (!transaction) return null;

  const applyEqualSplit = (totalPeople: number) => {
    if (totalPeople < 2) return;
    const friendCount = totalPeople - 1;
    const perPerson = Math.floor((transaction.amount / totalPeople) * 100) / 100;

    setParticipants((prev) => {
      const next: DraftParticipant[] = [];
      for (let i = 0; i < friendCount; i++) {
        const existing = prev[i];
        next.push({
          id: existing?.id || `sp-${Date.now()}-${i + 1}`,
          friendName: existing?.friendName || '',
          itemNote: existing?.itemNote || '',
          amountInput: perPerson.toFixed(2),
          status: existing?.status || 'owed',
          settledDate: existing?.settledDate,
        });
      }
      return next;
    });
    setValidationError(null);
  };

  const applyFriendOwesFull = () => {
    setParticipants((prev) => [
      {
        id: prev[0]?.id || `sp-${Date.now()}-1`,
        friendName: prev[0]?.friendName || '',
        itemNote: prev[0]?.itemNote || 'Covered full purchase',
        amountInput: transaction.amount.toFixed(2),
        status: prev[0]?.status || 'owed',
        settledDate: prev[0]?.settledDate,
      },
    ]);
    setValidationError(null);
  };

  const handleAddFriendRow = () => {
    if (participants.length >= 8) return;
    const remaining = Math.max(0, Math.round((transaction.amount - liveMath.friendsTotal) * 100) / 100);
    const suggested = remaining > 0 ? Math.round((remaining / 2) * 100) / 100 : 0;
    setParticipants((prev) => [
      ...prev,
      {
        id: `sp-${Date.now()}-${prev.length + 1}`,
        friendName: '',
        itemNote: '',
        amountInput: suggested > 0 ? suggested.toFixed(2) : '',
        status: 'owed',
      },
    ]);
  };

  const handleRemoveFriendRow = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  };

  const handleUpdateField = (
    id: string,
    field: keyof DraftParticipant,
    value: string
  ) => {
    setValidationError(null);
    setParticipants((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        if (field === 'status') {
          const nextStatus = value === 'settled' ? 'settled' : 'owed';
          return {
            ...p,
            status: nextStatus,
            settledDate: nextStatus === 'settled' ? '2026-11-17' : undefined,
          };
        }
        return { ...p, [field]: value };
      })
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (participants.length === 0) {
      onSaveSplit(transaction.id, undefined);
      onClose();
      return;
    }

    const cleaned: SplitParticipant[] = [];
    let sumCents = 0;

    for (let i = 0; i < participants.length; i++) {
      const p = participants[i];
      const name = p.friendName.trim();
      const amt = Math.round((parseFloat(p.amountInput) || 0) * 100) / 100;

      if (!name) {
        setValidationError(`Enter a name for Friend #${i + 1} (e.g., Alex).`);
        return;
      }
      if (amt <= 0) {
        setValidationError(`Enter an amount greater than $0.00 for ${name}.`);
        return;
      }

      sumCents += Math.round(amt * 100);
      cleaned.push({
        id: p.id,
        friendName: name.slice(0, 80),
        itemNote: p.itemNote.trim() ? p.itemNote.trim().slice(0, 120) : undefined,
        amountOwed: amt,
        status: p.status,
        settledDate: p.status === 'settled' ? p.settledDate || '2026-11-17' : undefined,
      });
    }

    const maxCents = Math.round(transaction.amount * 100);
    if (sumCents > maxCents) {
      setValidationError(
        `Friends' combined share (${formatCurrency(
          sumCents / 100
        )}) cannot exceed the ${formatCurrency(transaction.amount)} total you paid.`
      );
      return;
    }

    onSaveSplit(transaction.id, {
      participants: cleaned,
      note: splitNote.trim() ? splitNote.trim().slice(0, 200) : undefined,
    });
    onClose();
  };

  const handleRemoveSplit = () => {
    onSaveSplit(transaction.id, undefined);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="split-bill-modal-title"
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <MerchantLogo
              merchant={transaction.merchant}
              rawDescription={transaction.rawDescription}
              transactionType={transaction.transactionType}
              paymentMethod={transaction.paymentMethod}
              size="md"
            />
            <div className="min-w-0">
              <h2
                id="split-bill-modal-title"
                className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 truncate"
              >
                Split Bill — {transaction.merchant}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                <span>Paid {formatCurrency(transaction.amount)} total</span>
                <span aria-hidden="true"> · </span>
                <span>{transaction.date}</span>
                <span aria-hidden="true"> · </span>
                <span>{transaction.category}</span>
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Split Bill modal"
            className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto text-xs">
          {/* Quick Split Presets */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-slate-600 dark:text-slate-400">
              Quick Split:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => applyEqualSplit(2)}
                className="min-h-[34px] px-2.5 py-1 font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                50 / 50 ({formatCurrency(transaction.amount / 2)} each)
              </button>
              <button
                type="button"
                onClick={() => applyEqualSplit(3)}
                className="min-h-[34px] px-2.5 py-1 font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                3-Way Split
              </button>
              <button
                type="button"
                onClick={applyFriendOwesFull}
                className="min-h-[34px] px-2.5 py-1 font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Covered 100% for Friend
              </button>
            </div>
          </div>

          {/* Live Math & Visual Split Bar */}
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl space-y-2.5">
            <div className="grid grid-cols-3 gap-2 text-center sm:text-left">
              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Total Paid by You
                </div>
                <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100 mt-0.5">
                  {formatCurrency(liveMath.totalPaid)}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Your Personal Share
                </div>
                <div
                  className={`text-sm sm:text-base font-bold font-mono tabular-nums mt-0.5 ${
                    liveMath.isOverAllocated
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-emerald-700 dark:text-emerald-400'
                  }`}
                >
                  {formatCurrency(Math.max(0, liveMath.personalShare))}
                </div>
              </div>

              <div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400">
                  Friend(s) Share
                </div>
                <div className="text-sm sm:text-base font-bold font-mono tabular-nums text-amber-700 dark:text-amber-400 mt-0.5">
                  {formatCurrency(liveMath.friendsTotal)}
                </div>
              </div>
            </div>

            {/* Proportional SVG Bar (Zero inline styles) */}
            <svg
              viewBox="0 0 100 6"
              preserveAspectRatio="none"
              aria-hidden="true"
              className="w-full h-2.5 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700"
            >
              <rect
                x={0}
                y={0}
                width={liveMath.personalPct}
                height={6}
                className="fill-emerald-600 dark:fill-emerald-500"
              />
              <rect
                x={liveMath.personalPct}
                y={0}
                width={liveMath.friendsPct}
                height={6}
                className={
                  liveMath.isOverAllocated
                    ? 'fill-rose-600 dark:fill-rose-500'
                    : 'fill-amber-500 dark:fill-amber-400'
                }
              />
            </svg>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <span>
                Only your <strong className="font-mono text-slate-800 dark:text-slate-200">{formatCurrency(Math.max(0, liveMath.personalShare))}</strong> share counts toward your {transaction.category} budget.
              </span>
              <span className="font-mono tabular-nums">
                {liveMath.owedTotal > 0
                  ? `${formatCurrency(liveMath.owedTotal)} owed to you`
                  : `${formatCurrency(liveMath.settledTotal)} settled`}
              </span>
            </div>
          </div>

          {/* Friends / Participants Rows */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-slate-500" />
                <span>Who owes you for this bill?</span>
              </span>
              {participants.length < 8 && (
                <button
                  type="button"
                  onClick={handleAddFriendRow}
                  className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Another Person</span>
                </button>
              )}
            </div>

            {participants.map((p, idx) => (
              <div
                key={p.id}
                className="p-3 bg-white dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5"
              >
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Friend&apos;s Name
                    </label>
                    <input
                      type="text"
                      required
                      value={p.friendName}
                      onChange={(e) => handleUpdateField(p.id, 'friendName', e.target.value)}
                      placeholder={idx === 0 ? 'e.g., Alex' : 'e.g., Sam'}
                      className="w-full min-h-[40px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Their Item / Note (Optional)
                    </label>
                    <input
                      type="text"
                      value={p.itemNote}
                      onChange={(e) => handleUpdateField(p.id, 'itemNote', e.target.value)}
                      placeholder="e.g., Friend's drink"
                      className="w-full min-h-[40px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    />
                  </div>

                  <div className="sm:col-span-4">
                    <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                      Amount They Owe ($)
                    </label>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0.01"
                      max={transaction.amount}
                      required
                      value={p.amountInput}
                      onChange={(e) => handleUpdateField(p.id, 'amountInput', e.target.value)}
                      placeholder="10.00"
                      className="w-full min-h-[40px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => handleUpdateField(p.id, 'status', 'owed')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                        p.status === 'owed'
                          ? 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-400 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Owes Me
                    </button>
                    <button
                      type="button"
                      onClick={() => handleUpdateField(p.id, 'status', 'settled')}
                      className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                        p.status === 'settled'
                          ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                      }`}
                    >
                      Paid Back
                    </button>
                  </div>

                  {participants.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveFriendRow(p.id)}
                      className="inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Optional Shared Memo */}
          <div>
            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
              Split Memo (Optional)
            </label>
            <input
              type="text"
              value={splitNote}
              onChange={(e) => setSplitNote(e.target.value)}
              placeholder="e.g., Covered coffee run — Venmo requested"
              className="w-full min-h-[40px] sm:min-h-0 px-3 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
            />
          </div>

          {validationError && (
            <div
              role="alert"
              className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 font-medium"
            >
              {validationError}
            </div>
          )}

          {/* Footer Actions */}
          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
            <div>
              {transaction.splitBill && transaction.splitBill.participants.length > 0 && (
                <button
                  type="button"
                  onClick={handleRemoveSplit}
                  className="min-h-[40px] sm:min-h-0 inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Remove Split</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="min-h-[40px] sm:min-h-0 px-3.5 py-2 font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={liveMath.isOverAllocated}
                className="min-h-[40px] sm:min-h-0 inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 rounded-xl sm:rounded-lg transition-colors whitespace-nowrap"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Bill Split</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
