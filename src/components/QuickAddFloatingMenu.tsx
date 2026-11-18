import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  Banknote,
  Check,
  FileText,
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

interface QuickAddFloatingMenuProps {
  existingTransactions: Transaction[];
  onQuickCommitTransaction: (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>
  ) => void;
  onOpenFullIngestModal: () => void;
  onViewLedger?: () => void;
}

type QuickMenuState = 'closed' | 'actions' | 'cash_expense' | 'one_off_income';

export const QuickAddFloatingMenu: React.FC<QuickAddFloatingMenuProps> = ({
  existingTransactions,
  onQuickCommitTransaction,
  onOpenFullIngestModal,
  onViewLedger,
}) => {
  const [menuState, setMenuState] = useState<QuickMenuState>('closed');
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  const openCashExpenseForm = (enableSplit = false) => {
    setDate('2026-11-17');
    setMerchantOrSource('');
    setAmount('');
    setCategory(enableSplit ? 'Coffee & Drinks' : 'Food & Restaurants');
    setPaymentOrAccount(
      enableSplit ? 'Apple Pay · Chase Sapphire ••4821' : 'Cash (Physical Currency)'
    );
    setNote('');
    setSplitEnabled(enableSplit);
    setSplitFriendName('');
    setSplitFriendAmount('');
    setSplitItemNote('');
    setMenuState('cash_expense');
  };

  const openOneOffIncomeForm = () => {
    setDate('2026-11-17');
    setMerchantOrSource('');
    setAmount('');
    setCategory('Other / Uncategorized');
    setPaymentOrAccount('ACH Checking ••8830');
    setNote('');
    setSplitEnabled(false);
    setMenuState('one_off_income');
  };

  const applyQuickPreset = (preset: {
    merchant: string;
    amount: string;
    category?: SpendingCategory;
    account?: string;
    note?: string;
    splitFriendName?: string;
    splitFriendAmount?: string;
    splitItemNote?: string;
  }) => {
    setMerchantOrSource(preset.merchant);
    setAmount(preset.amount);
    if (preset.category) setCategory(preset.category);
    if (preset.account) setPaymentOrAccount(preset.account);
    if (preset.note !== undefined) setNote(preset.note);
    if (preset.splitFriendName && preset.splitFriendAmount) {
      setSplitEnabled(true);
      setSplitFriendName(preset.splitFriendName);
      setSplitFriendAmount(preset.splitFriendAmount);
      setSplitItemNote(preset.splitItemNote || '');
    } else {
      setSplitEnabled(false);
      setSplitFriendName('');
      setSplitFriendAmount('');
      setSplitItemNote('');
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
    if (!merchantOrSource.trim() || isNaN(numericAmount) || numericAmount <= 0) {
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
              {/* Quick Fill Presets */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                <span>Presets:</span>
                {menuState === 'cash_expense' ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        applyQuickPreset({
                          merchant: 'Sightglass Coffee',
                          amount: '20.00',
                          category: 'Coffee & Drinks',
                          account: 'Apple Pay · Chase Sapphire ••4821',
                          note: 'Covered coffee run',
                          splitFriendName: 'Alex',
                          splitFriendAmount: '10.00',
                          splitItemNote: "Friend's drink",
                        })
                      }
                      className="font-semibold text-amber-700 dark:text-amber-400 hover:underline underline-offset-2 py-0.5"
                    >
                      Coffee Split ($20 paid · $10 owed)
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() =>
                        applyQuickPreset({
                          merchant: 'Ferry Plaza Farmers Market',
                          amount: '22.00',
                          category: 'Groceries',
                          account: 'Cash (Physical Currency)',
                          note: 'Cash produce stand',
                        })
                      }
                      className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-2 py-0.5"
                    >
                      Farmers Market ($22)
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() =>
                        applyQuickPreset({
                          merchant: 'Civic Garage Valet',
                          amount: '15.00',
                          category: 'Gas & Parking',
                          account: 'Cash (Physical Currency)',
                          note: 'Cash parking attendant',
                        })
                      }
                      className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-2 py-0.5"
                    >
                      Valet ($15)
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        applyQuickPreset({
                          merchant: 'Freelance UI Advisory Payout',
                          amount: '650.00',
                          account: 'ACH Checking ••8830',
                          note: 'One-off client invoice',
                        })
                      }
                      className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300 underline underline-offset-2 py-0.5"
                    >
                      Freelance ($650)
                    </button>
                    <span aria-hidden="true">·</span>
                    <button
                      type="button"
                      onClick={() =>
                        applyQuickPreset({
                          merchant: 'Marketplace Gear Sale (Cash)',
                          amount: '180.00',
                          account: 'Cash (Physical Currency)',
                          note: 'Sold camera lens locally',
                        })
                      }
                      className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300 underline underline-offset-2 py-0.5"
                    >
                      Cash Sale ($180)
                    </button>
                  </>
                )}
              </div>

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
                    min="0.01"
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
                      <option value="ACH Checking ••8830">ACH Checking ••8830</option>
                      <option value="Cash (Physical Currency)">Cash (Physical Currency)</option>
                      <option value="Marcus HYSA ••4410">Marcus HYSA ••4410</option>
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
                      <option value="Apple Pay · Chase Sapphire ••4821">Apple Pay ••4821</option>
                      <option value="Chase Sapphire ••4821">Chase ••4821</option>
                      <option value="Amex Gold ••1094">Amex ••1094</option>
                      <option value="Debit / Checking ••8830">Debit ••8830</option>
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
              onClick={() => openCashExpenseForm(false)}
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
              className="w-full px-3 py-2 text-left text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center gap-2.5 transition-colors"
            >
              <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500 shrink-0" />
              <span>Import Receipt PDF / Image / CSV...</span>
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
