import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDownLeft,
  Banknote,
  Check,
  FileText,
  Plus,
  X,
} from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
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

  // Close menu on Escape key or outside click
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

  const openCashExpenseForm = () => {
    setDate('2026-11-17');
    setMerchantOrSource('');
    setAmount('');
    setCategory('Food & Restaurants');
    setPaymentOrAccount('Cash (Physical Currency)');
    setNote('');
    setMenuState('cash_expense');
  };

  const openOneOffIncomeForm = () => {
    setDate('2026-11-17');
    setMerchantOrSource('');
    setAmount('');
    setCategory('Other / Uncategorized');
    setPaymentOrAccount('ACH Checking ••8830');
    setNote('');
    setMenuState('one_off_income');
  };

  const applyQuickPreset = (preset: {
    merchant: string;
    amount: string;
    category?: SpendingCategory;
    account?: string;
    note?: string;
  }) => {
    setMerchantOrSource(preset.merchant);
    setAmount(preset.amount);
    if (preset.category) setCategory(preset.category);
    if (preset.account) setPaymentOrAccount(preset.account);
    if (preset.note) setNote(preset.note);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = parseFloat(amount);
    if (!merchantOrSource.trim() || isNaN(numericAmount) || numericAmount <= 0) {
      return;
    }

    const isIncome = menuState === 'one_off_income';
    const cleanMerchant = merchantOrSource.trim();
    const nowTime = new Date().toTimeString().slice(0, 5) || '11:25';
    const monthKey: '2026-11' | '2026-10' = date.startsWith('2026-10') ? '2026-10' : '2026-11';

    // Deduplication check against existing ledger entries on same date + exact amount + merchant
    const duplicateMatch = existingTransactions.find(
      (tx) =>
        tx.date === date &&
        Math.abs(tx.amount - numericAmount) < 0.01 &&
        tx.transactionType === (isIncome ? 'income' : 'purchase') &&
        tx.merchant.toLowerCase() === cleanMerchant.toLowerCase()
    );

    const rawDesc = isIncome
      ? `ONE-OFF INCOME · ${cleanMerchant.toUpperCase()}${note.trim() ? ` (${note.trim()})` : ''}`
      : `CASH LOG · ${cleanMerchant.toUpperCase()}${note.trim() ? ` (${note.trim()})` : ''}`;

    if (duplicateMatch) {
      onQuickCommitTransaction(
        [],
        [
          {
            existingId: duplicateMatch.id,
            newSource: 'Cash / Manual',
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
        source: 'Cash / Manual',
        isDeduplicated: false,
        mergedSources: [
          {
            source: 'Cash / Manual',
            referenceId: `QCK-${Date.now().toString().slice(-5)}`,
            capturedAt: `${date} ${nowTime}`,
            rawDescriptor: `${cleanMerchant} · ${formatCurrency(numericAmount)}`,
            statusAtCapture: 'posted',
          },
        ],
        uncertainCategory: isUncertain,
        uncertaintyReason: isUncertain
          ? `Cash purchase "${cleanMerchant}" (${formatCurrency(numericAmount)}) was logged as Other / Uncategorized. Confirm exact spending category.`
          : undefined,
        monthKey,
      };

      onQuickCommitTransaction([newTx], []);
    }

    setMenuState('closed');
    if (onViewLedger) {
      // Optional callback if caller wants to notify or highlight
    }
  };

  return (
    <div
      ref={containerRef}
      className="fixed bottom-5 right-5 z-40 flex flex-col items-end gap-2.5"
    >
      {/* Expanded Inline Form Popover (Cash Expense or One-Off Income) */}
      {(menuState === 'cash_expense' || menuState === 'one_off_income') && (
        <div
          role="dialog"
          aria-label={
            menuState === 'cash_expense'
              ? 'Quick Add Cash Transaction'
              : 'Quick Add One-Off Income'
          }
          className="w-[340px] sm:w-[380px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl overflow-hidden"
        >
          {/* Popover Header + Mode Switcher */}
          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            <div className="flex items-center gap-1 p-0.5 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
              <button
                type="button"
                onClick={openCashExpenseForm}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  menuState === 'cash_expense'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Cash Purchase
              </button>
              <button
                type="button"
                onClick={openOneOffIncomeForm}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
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
              className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="p-4 space-y-3 text-xs">
            {/* Quick Fill Presets */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span>Presets:</span>
              {menuState === 'cash_expense' ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      applyQuickPreset({
                        merchant: 'Ferry Plaza Farmers Market',
                        amount: '22.00',
                        category: 'Groceries',
                        note: 'Cash produce stand',
                      })
                    }
                    className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-2"
                  >
                    Farmers Market ($22)
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      applyQuickPreset({
                        merchant: 'Sightglass Espresso Bar',
                        amount: '6.50',
                        category: 'Coffee & Drinks',
                        note: 'Cash + barista tip',
                      })
                    }
                    className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-2"
                  >
                    Cash Coffee ($6.50)
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    onClick={() =>
                      applyQuickPreset({
                        merchant: 'Civic Garage Valet',
                        amount: '15.00',
                        category: 'Gas & Parking',
                        note: 'Cash parking attendant',
                      })
                    }
                    className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-2"
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
                    className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300 underline underline-offset-2"
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
                    className="text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300 underline underline-offset-2"
                  >
                    Cash Sale ($180)
                  </button>
                </>
              )}
            </div>

            {/* Merchant / Income Payer + Exact Amount */}
            <div className="grid grid-cols-12 gap-2.5">
              <div className="col-span-7">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {menuState === 'cash_expense' ? 'Merchant / Store' : 'Income Source / Payer'}
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={merchantOrSource}
                  onChange={(e) => setMerchantOrSource(e.target.value)}
                  placeholder={
                    menuState === 'cash_expense'
                      ? 'e.g., Corner Taqueria'
                      : 'e.g., Consulting Bonus'
                  }
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                />
              </div>

              <div className="col-span-5">
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-2.5 py-1.5 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Category (for Cash Purchase) + Date */}
            <div className="grid grid-cols-12 gap-2.5">
              {menuState === 'cash_expense' ? (
                <div className="col-span-7">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Spending Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as SpendingCategory)}
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
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
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
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
                  className="w-full px-2 py-1.5 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                />
              </div>
            </div>

            {/* Payment Method (for Cash Expense) + Optional Memo */}
            <div className="grid grid-cols-12 gap-2.5">
              {menuState === 'cash_expense' && (
                <div className="col-span-5">
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Tender
                  </label>
                  <select
                    value={paymentOrAccount}
                    onChange={(e) => setPaymentOrAccount(e.target.value)}
                    className="w-full px-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                  >
                    <option value="Cash (Physical Currency)">Cash</option>
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
                  placeholder="Short note routed to ledger descriptor..."
                  className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Routes directly to Unified Ledger
              </span>
              <button
                type="submit"
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                  menuState === 'one_off_income'
                    ? 'bg-emerald-700 hover:bg-emerald-800 text-white'
                    : 'bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-900'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
                <span>
                  {menuState === 'cash_expense' ? 'Log Cash Spend' : 'Log Income to Ledger'}
                </span>
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Floating Action Menu Options (Speed-Dial Stack) */}
      {menuState === 'actions' && (
        <div
          role="menu"
          aria-label="Quick Add Options"
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg p-2 w-64 space-y-1"
        >
          <div className="px-2.5 py-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
            Quick Add to Ledger
          </div>

          <button
            type="button"
            role="menuitem"
            onClick={openCashExpenseForm}
            className="w-full px-3 py-2 text-left text-xs font-medium text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg flex items-center justify-between transition-colors"
          >
            <span className="flex items-center gap-2.5">
              <Banknote className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0" />
              <span>Log Cash Transaction</span>
            </span>
            <span className="text-[11px] font-mono text-slate-400 dark:text-slate-500">Spend</span>
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
            <span>Parse Receipt or CSV...</span>
          </button>
        </div>
      )}

      {/* Primary Floating Action Trigger Button */}
      <button
        type="button"
        aria-expanded={menuState !== 'closed'}
        aria-label="Quick Add cash transaction or one-off income"
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
  );
};
