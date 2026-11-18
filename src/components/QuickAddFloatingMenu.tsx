import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  Banknote,
  Check,
  Layers,
  Mic,
  Plus,
  Split,
  X,
} from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  BillSplitDetails,
  DataSource,
  SpendingCategory,
  Transaction,
} from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';
import { fetchLiveUsdRates, getCachedUsdRates } from '../utils/currencyConverter';
import { parseSpokenTransactionDraft } from '../utils/spokenExpenseParser';
import { VoiceRecorderControl } from './VoiceRecorderControl';

interface QuickAddFloatingMenuProps {
  existingTransactions: Transaction[];
  onQuickCommitTransaction: (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>
  ) => void;
  onOpenFullIngestModal: () => void;
  onViewLedger?: () => void;
  voiceLaunchSignal?: number;
}

type QuickMenuState = 'closed' | 'actions' | 'cash_expense' | 'one_off_income';

export const QuickAddFloatingMenu: React.FC<QuickAddFloatingMenuProps> = ({
  existingTransactions,
  onQuickCommitTransaction,
  onOpenFullIngestModal,
  onViewLedger,
  voiceLaunchSignal,
}) => {
  const [menuState, setMenuState] = useState<QuickMenuState>('closed');
  const [autoStartVoiceSignal, setAutoStartVoiceSignal] = useState<number>(0);
  const [fxRates, setFxRates] = useState<Record<string, number>>(() => getCachedUsdRates());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastLaunchSignalRef = useRef<number | undefined>(undefined);

  // Shared Form Fields
  const [date, setDate] = useState('2026-11-17');
  const [merchantOrSource, setMerchantOrSource] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<SpendingCategory>('Food & Restaurants');
  const [paymentOrAccount, setPaymentOrAccount] = useState('Cash (Physical Currency)');
  const [note, setNote] = useState('');

  // Optional Inline Split Bill Fields (for Purchases)
  const [splitEnabled, setSplitEnabled] = useState(false);
  const [splitFriendName, setSplitFriendName] = useState('');
  const [splitFriendAmount, setSplitFriendAmount] = useState('');
  const [splitItemNote, setSplitItemNote] = useState('');

  useEffect(() => {
    if (menuState !== 'closed') {
      void fetchLiveUsdRates().then((rates) => setFxRates({ ...rates }));
    }
  }, [menuState]);

  // Close menu on Escape key or outside click on desktop
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuState('closed');
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuState !== 'closed' &&
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setMenuState('closed');
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuState]);

  const openCashExpenseForm = (enableSplit = false, startMic = false) => {
    setDate('2026-11-17');
    setMerchantOrSource('');
    setAmount('');
    setCategory(enableSplit ? 'Coffee & Drinks' : 'Food & Restaurants');
    setPaymentOrAccount(
      enableSplit ? 'Apple Pay' : 'Cash (Physical Currency)'
    );
    setNote('');
    setSplitEnabled(enableSplit);
    setSplitFriendName('');
    setSplitFriendAmount('');
    setSplitItemNote('');
    setMenuState('cash_expense');
    if (startMic) {
      setAutoStartVoiceSignal((prev) => prev + 1);
    }
  };

  useEffect(() => {
    if (
      voiceLaunchSignal &&
      voiceLaunchSignal > 0 &&
      lastLaunchSignalRef.current !== voiceLaunchSignal
    ) {
      lastLaunchSignalRef.current = voiceLaunchSignal;
      openCashExpenseForm(false, true);
    }
  }, [voiceLaunchSignal]);

  const openOneOffIncomeForm = () => {
    setDate('2026-11-17');
    setMerchantOrSource('');
    setAmount('');
    setCategory('Other / Uncategorized');
    setPaymentOrAccount('Direct Deposit / Checking');
    setNote('');
    setSplitEnabled(false);
    setMenuState('one_off_income');
  };

  const handleVoiceTranscribed = (transcript: string) => {
    const draft = parseSpokenTransactionDraft(transcript, fxRates);
    if (draft.transactionType === 'income') {
      setMenuState('one_off_income');
      setSplitEnabled(false);
    } else if (menuState !== 'cash_expense') {
      setMenuState('cash_expense');
    }

    if (draft.merchant) {
      setMerchantOrSource(draft.merchant);
    }
    if (draft.usdAmount !== null) {
      setAmount(draft.usdAmount.toFixed(2));
    }
    if (draft.transactionType !== 'income') {
      setCategory(draft.category);
    }
    setDate(draft.date);
    setPaymentOrAccount(draft.paymentMethod);
    setNote(draft.memo);

    if (draft.splitFriendName && draft.transactionType !== 'income') {
      setSplitEnabled(true);
      setSplitFriendName(draft.splitFriendName);
      if (draft.splitFriendAmount && draft.splitFriendAmount > 0) {
        setSplitFriendAmount(draft.splitFriendAmount.toFixed(2));
      }
    }
  };

  const numericTotal = parseFloat(amount) || 0;
  const numericFriendShare = Math.max(0, parseFloat(splitFriendAmount) || 0);
  const personalSharePreview = Math.max(
    0,
    Math.round((numericTotal - numericFriendShare) * 100) / 100
  );
  const isSplitInvalid =
    menuState === 'cash_expense' &&
    splitEnabled &&
    (!splitFriendName.trim() ||
      numericFriendShare <= 0 ||
      numericFriendShare > numericTotal + 0.001);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount);
    if (!merchantOrSource.trim() || isNaN(numericAmount) || numericAmount < 0) {
      return;
    }

    const isIncome = menuState === 'one_off_income';
    if (!isIncome && splitEnabled && isSplitInvalid) {
      return;
    }

    const cleanMerchant = merchantOrSource.trim();
    const nowTime = new Date().toTimeString().slice(0, 5) || '11:25';
    const monthKey: '2026-11' | '2026-10' = date.startsWith('2026-10') ? '2026-10' : '2026-11';

    let splitBillPayload: BillSplitDetails | undefined;
    if (!isIncome && splitEnabled && splitFriendName.trim() && numericFriendShare > 0) {
      const clampedOwed = Math.min(
        Math.round(numericAmount * 100) / 100,
        Math.round(numericFriendShare * 100) / 100
      );
      splitBillPayload = {
        participants: [
          {
            id: `sp-${Date.now()}-1`,
            friendName: splitFriendName.trim().slice(0, 80),
            itemNote: splitItemNote.trim() ? splitItemNote.trim().slice(0, 120) : undefined,
            amountOwed: clampedOwed,
            status: 'owed',
          },
        ],
        note: note.trim() ? note.trim().slice(0, 200) : undefined,
      };
    }

    const duplicateMatch = !splitBillPayload
      ? existingTransactions.find(
          (tx) =>
            tx.date === date &&
            Math.abs(tx.amount - numericAmount) < 0.01 &&
            tx.transactionType === (isIncome ? 'income' : 'purchase') &&
            tx.merchant.toLowerCase() === cleanMerchant.toLowerCase()
        )
      : undefined;

    const rawDesc = isIncome
      ? `ONE-OFF INCOME · ${cleanMerchant.toUpperCase()}${note.trim() ? ` (${note.trim()})` : ''}`
      : `QUICK LOG · ${cleanMerchant.toUpperCase()}${note.trim() ? ` (${note.trim()})` : ''}`;

    const inferredSource: DataSource = paymentOrAccount.toLowerCase().includes('apple pay')
      ? 'Apple Pay'
      : 'Cash / Manual';

    if (duplicateMatch) {
      onQuickCommitTransaction(
        [],
        [
          {
            existingId: duplicateMatch.id,
            newSource: inferredSource,
            rawDescriptor: `${rawDesc} · ${formatCurrency(numericAmount)}`,
          },
        ]
      );
    } else {
      const isUncertain = !isIncome && category === 'Other / Uncategorized';
      const newTx: Transaction = {
        id: `tx-quick-${Date.now()}`,
        date,
        time: nowTime,
        merchant: cleanMerchant,
        rawDescription: rawDesc,
        amount: numericAmount,
        paymentMethod: paymentOrAccount,
        category: isIncome ? 'Other / Uncategorized' : category,
        status: 'posted',
        transactionType: isIncome ? 'income' : 'purchase',
        source: inferredSource,
        isDeduplicated: false,
        mergedSources: [
          {
            source: inferredSource,
            referenceId: `QCK-${Date.now().toString().slice(-5)}`,
            capturedAt: `${date} ${nowTime}`,
            rawDescriptor: `${cleanMerchant} · ${formatCurrency(numericAmount)}`,
            statusAtCapture: 'posted',
          },
        ],
        uncertainCategory: isUncertain,
        uncertaintyReason: isUncertain
          ? `Purchase "${cleanMerchant}" (${formatCurrency(numericAmount)}) was logged as Other / Uncategorized. Confirm exact spending category.`
          : undefined,
        monthKey,
        splitBill: splitBillPayload,
      };

      onQuickCommitTransaction([newTx], []);
    }

    setMenuState('closed');
    onViewLedger?.();
  };

  return (
    <div ref={containerRef}>
      <div className="fixed bottom-20 md:bottom-5 right-4 md:right-5 z-40 flex flex-col items-end gap-2.5">
        {/* Expanded Inline Form Popover */}
        {(menuState === 'cash_expense' || menuState === 'one_off_income') && (
          <div
            role="dialog"
            aria-label={
              menuState === 'cash_expense'
                ? 'Quick Add Purchase or Split Bill'
                : 'Quick Add One-Off Income'
            }
            className="w-[400px] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden max-h-[82vh] flex flex-col"
          >
            {/* Header + Mode Switcher */}
            <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-xl flex-1 sm:flex-initial">
                <button
                  type="button"
                  onClick={() => openCashExpenseForm(false)}
                  className={`flex-1 sm:flex-initial min-h-[36px] sm:min-h-0 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    menuState === 'cash_expense'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Log Purchase
                </button>
                <button
                  type="button"
                  onClick={openOneOffIncomeForm}
                  className={`flex-1 sm:flex-initial min-h-[36px] sm:min-h-0 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                    menuState === 'one_off_income'
                      ? 'bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-400 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  One-Off Income
                </button>
              </div>

              <button
                type="button"
                aria-label="Close Quick Add form"
                onClick={() => setMenuState('closed')}
                className="min-h-[40px] min-w-[40px] sm:min-h-0 sm:min-w-0 p-1.5 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs overflow-y-auto">
              <VoiceRecorderControl
                variant="card"
                buttonLabel="Record Voice"
                autoStartSignal={autoStartVoiceSignal}
                placeholderHint='Speak naturally: "Spent $14.50 at Starbucks with Apple Pay" or "Sent 3,500 THB on Wise for electricity"'
                onTranscribed={handleVoiceTranscribed}
              />

              {/* Merchant / Income Payer + Exact Total Paid */}
              <div className="grid grid-cols-12 gap-2.5">
                <div className="col-span-7">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {menuState === 'cash_expense' ? 'Merchant / Store' : 'Income Source / Payer'}
                  </label>
                  <input
                    type="text"
                    required
                    value={merchantOrSource}
                    onChange={(e) => setMerchantOrSource(e.target.value)}
                    placeholder={
                      menuState === 'cash_expense'
                        ? 'e.g., Sightglass Coffee'
                        : 'e.g., Consulting Bonus'
                    }
                    className="w-full min-h-[42px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                  />
                </div>

                <div className="col-span-5">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {menuState === 'cash_expense' ? 'Total Paid ($)' : 'Amount ($)'}
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="0"
                    required
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="20.00"
                    className="w-full min-h-[42px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Category (for Purchase) + Date */}
              <div className="grid grid-cols-12 gap-2.5">
                {menuState === 'cash_expense' ? (
                  <div className="col-span-7">
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Spending Category
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value as SpendingCategory)}
                      className="w-full min-h-[42px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                    >
                      {ALL_SPENDING_CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="col-span-7">
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Deposit Destination
                    </label>
                    <select
                      value={paymentOrAccount}
                      onChange={(e) => setPaymentOrAccount(e.target.value)}
                      className="w-full min-h-[42px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                    >
                      <option value="Direct Deposit / Checking">Direct Deposit / Checking</option>
                      <option value="Wise Account">Wise Account</option>
                      <option value="Cash (Physical Currency)">Cash (Physical Currency)</option>
                      <option value="High-Yield Savings">High-Yield Savings</option>
                    </select>
                  </div>
                )}

                <div className="col-span-5">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full min-h-[42px] sm:min-h-0 px-2 py-1.5 text-base sm:text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Payment Method + Optional Memo */}
              <div className="grid grid-cols-12 gap-2.5">
                {menuState === 'cash_expense' && (
                  <div className="col-span-5">
                    <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Paid With
                    </label>
                    <select
                      value={paymentOrAccount}
                      onChange={(e) => setPaymentOrAccount(e.target.value)}
                      className="w-full min-h-[42px] sm:min-h-0 px-2 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                    >
                      <option value="Cash (Physical Currency)">Cash</option>
                      <option value="Apple Pay">Apple Pay</option>
                      <option value="Wise">Wise</option>
                      <option value="Credit Card">Credit Card</option>
                      <option value="Debit / Checking">Debit / Checking</option>
                      <option value="Rewards / Promo ($0.00)">Rewards / Promo ($0.00)</option>
                    </select>
                  </div>
                )}

                <div className={menuState === 'cash_expense' ? 'col-span-7' : 'col-span-12'}>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Memo (Optional)
                  </label>
                  <input
                    type="text"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Short note routed to ledger..."
                    className="w-full min-h-[42px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl sm:rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                  />
                </div>
              </div>

              {/* Inline Split Bill Toggle (for Purchases) */}
              {menuState === 'cash_expense' && (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 font-medium text-slate-800 dark:text-slate-200 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={splitEnabled}
                        onChange={(e) => {
                          const next = e.target.checked;
                          setSplitEnabled(next);
                          if (next && !splitFriendAmount && numericTotal > 0) {
                            setSplitFriendAmount((Math.round((numericTotal / 2) * 100) / 100).toFixed(2));
                          }
                        }}
                        className="rounded border-slate-300 dark:border-slate-600 text-slate-900 focus:ring-slate-500"
                      />
                      <Split className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span>Split this bill (someone owes me)</span>
                    </label>

                    {splitEnabled && numericTotal > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setSplitFriendAmount((Math.round((numericTotal / 2) * 100) / 100).toFixed(2))
                        }
                        className="text-[11px] font-mono text-amber-700 dark:text-amber-400 hover:underline"
                      >
                        50/50 ({formatCurrency(numericTotal / 2)})
                      </button>
                    )}
                  </div>

                  {splitEnabled && (
                    <div className="space-y-2 pt-0.5">
                      <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-6">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Friend&apos;s Name
                          </label>
                          <input
                            type="text"
                            required={splitEnabled}
                            value={splitFriendName}
                            onChange={(e) => setSplitFriendName(e.target.value)}
                            placeholder="e.g., Alex"
                            className="w-full min-h-[38px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                          />
                        </div>

                        <div className="col-span-6">
                          <label className="block text-[11px] text-slate-600 dark:text-slate-400 mb-0.5">
                            Their Share ($)
                          </label>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            min="0.01"
                            max={numericTotal > 0 ? numericTotal : undefined}
                            required={splitEnabled}
                            value={splitFriendAmount}
                            onChange={(e) => setSplitFriendAmount(e.target.value)}
                            placeholder="10.00"
                            className="w-full min-h-[38px] sm:min-h-0 px-2.5 py-1.5 text-base sm:text-xs font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                          />
                        </div>
                      </div>

                      <div>
                        <input
                          type="text"
                          value={splitItemNote}
                          onChange={(e) => setSplitItemNote(e.target.value)}
                          placeholder="Optional item note (e.g., Friend's drink)"
                          className="w-full min-h-[36px] sm:min-h-0 px-2.5 py-1 text-base sm:text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                        />
                      </div>

                      {numericTotal > 0 && (
                        <div className="text-[11px] font-mono tabular-nums text-slate-600 dark:text-slate-300 flex items-center justify-between">
                          <span>Your spend: {formatCurrency(personalSharePreview)}</span>
                          <span className="text-amber-700 dark:text-amber-400 font-semibold">
                            {splitFriendName.trim() || 'Friend'} owes: {formatCurrency(numericFriendShare)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Saved &amp; synced to Ledger
                </span>
                <button
                  type="submit"
                  disabled={isSplitInvalid}
                  className={`min-h-[44px] sm:min-h-0 inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl sm:rounded-lg transition-colors whitespace-nowrap shrink-0 disabled:opacity-50 ${
                    menuState === 'one_off_income'
                      ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                      : 'bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900'
                  }`}
                >
                  <Check className="w-4 h-4" />
                  <span>
                    {menuState === 'one_off_income'
                      ? 'Log Income'
                      : splitEnabled
                      ? 'Log Split Purchase'
                      : 'Log Purchase'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Speed-Dial Action Sheet (Slide-Up Sheet on Mobile, Popover on Desktop) */}
        {menuState === 'actions' && (
          <div
            role="menu"
            aria-label="Quick Add Options"
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg p-2 w-72 space-y-1"
          >
            <div className="px-3 py-1 flex items-center justify-between text-[11px] font-medium text-slate-400 dark:text-slate-500">
              <span>Quick Add to Ledger</span>
            </div>

            <button
              type="button"
              role="menuitem"
              onClick={() => openCashExpenseForm(false, true)}
              className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Mic className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span>Voice Record Transaction</span>
              </span>
              <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                Mic
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openCashExpenseForm(false, false)}
              className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Banknote className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
                <span>Log Purchase</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                Spend
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => openCashExpenseForm(true)}
              className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Split className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Log Split Bill (Friend Owes Me)</span>
              </span>
              <span className="text-[11px] font-mono text-amber-700 dark:text-amber-400">
                Split
              </span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={openOneOffIncomeForm}
              className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <ArrowDownLeft className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span>Log One-Off Income</span>
              </span>
              <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                +Cash
              </span>
            </button>

            <div className="border-t border-slate-100 dark:border-slate-800 my-1" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuState('closed');
                onOpenFullIngestModal();
              }}
              className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center justify-between transition-colors"
            >
              <span className="flex items-center gap-2.5">
                <Layers className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                <span>Import, Export &amp; Scan...</span>
              </span>
              <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                CSV · PDF
              </span>
            </button>
          </div>
        )}

        {/* Primary Floating Action Trigger Button */}
        <button
          type="button"
          aria-expanded={menuState !== 'closed'}
          aria-label="Quick Add purchase, split bill, income, or receipt file"
          onClick={() =>
            setMenuState((prev) => (prev === 'closed' ? 'actions' : 'closed'))
          }
          className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white rounded-xl shadow-lg transition-transform active:scale-95 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 dark:focus-visible:ring-slate-100 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
        >
          {menuState === 'closed' ? (
            <>
              <Plus className="w-4 h-4" />
              <span>Quick Add</span>
            </>
          ) : (
            <>
              <X className="w-4 h-4" />
              <span>Close</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};
