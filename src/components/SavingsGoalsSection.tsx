import React, { useMemo, useState } from 'react';
import {
  Check,
  Layers,
  Pencil,
  PiggyBank,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { SavingsGoal } from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';

interface SavingsGoalsSectionProps {
  savingsGoals: SavingsGoal[];
  netCashFlowThisMonth: number;
  onContributeToGoal: (goalId: string, amount: number) => void;
  onUpdateGoal: (
    goalId: string,
    updates: Partial<
      Pick<SavingsGoal, 'currentSaved' | 'targetAmount' | 'monthlyContribution' | 'targetDate'>
    >
  ) => void;
  onSetTotalSavedAcrossGoals?: (nextTotalSaved: number) => void;
  onCreateGoal: (newGoal: Omit<SavingsGoal, 'id'>) => void;
  onDeleteGoal?: (goalId: string) => void;
  lastDeletedGoal?: SavingsGoal | null;
  onUndoDeleteGoal?: () => void;
  onDismissUndoGoal?: () => void;
  onLoadStarterDemo?: () => void;
  compact?: boolean;
}

export const SavingsGoalsSection: React.FC<SavingsGoalsSectionProps> = ({
  savingsGoals,
  netCashFlowThisMonth,
  onContributeToGoal,
  onUpdateGoal,
  onSetTotalSavedAcrossGoals,
  onCreateGoal,
  onDeleteGoal,
  lastDeletedGoal = null,
  onUndoDeleteGoal,
  onDismissUndoGoal,
  onLoadStarterDemo,
  compact = false,
}) => {
  const [isAddingGoal, setIsAddingGoal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editSavedStr, setEditSavedStr] = useState('');
  const [editTargetStr, setEditTargetStr] = useState('');
  const [editMonthlyStr, setEditMonthlyStr] = useState('');

  // Editable Total Saved KPI State
  const [isEditingTotalSaved, setIsEditingTotalSaved] = useState(false);
  const [totalSavedInputStr, setTotalSavedInputStr] = useState('');

  // New Goal Form State
  const [newName, setNewName] = useState('');
  const [newCategoryLabel, setNewCategoryLabel] = useState('Dedicated Savings Vault · 4.65% APY');
  const [newTarget, setNewTarget] = useState('5000');
  const [newCurrent, setNewCurrent] = useState('500');
  const [newMonthly, setNewMonthly] = useState('300');
  const [newTargetDate, setNewTargetDate] = useState('2027-08-01');
  const [newLinkedAccount, setNewLinkedAccount] = useState('Marcus HYSA ••4410');
  const [newPriority, setNewPriority] = useState<'High' | 'Medium' | 'Flexible'>('Medium');

  const summary = useMemo(() => {
    const totalSaved = savingsGoals.reduce((acc, g) => acc + g.currentSaved, 0);
    const totalTarget = savingsGoals.reduce((acc, g) => acc + g.targetAmount, 0);
    const totalMonthlyAllocation = savingsGoals.reduce((acc, g) => acc + g.monthlyContribution, 0);
    const overallProgress = totalTarget > 0 ? (totalSaved / totalTarget) * 100 : 0;
    const unallocatedCashFlow = netCashFlowThisMonth - totalMonthlyAllocation;

    return {
      totalSaved,
      totalTarget,
      totalMonthlyAllocation,
      overallProgress,
      unallocatedCashFlow,
    };
  }, [savingsGoals, netCashFlowThisMonth]);

  const handleCreateGoalSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const targetAmount = parseFloat(newTarget);
    const currentSaved = Math.max(0, parseFloat(newCurrent) || 0);
    const monthlyContribution = Math.max(0, parseFloat(newMonthly) || 100);
    if (!newName.trim() || isNaN(targetAmount) || targetAmount <= 0) return;

    onCreateGoal({
      name: newName.trim(),
      categoryLabel: newCategoryLabel.trim() || 'Savings Reserve',
      targetAmount,
      currentSaved,
      monthlyContribution,
      targetDate: newTargetDate,
      linkedAccount: newLinkedAccount,
      priority: newPriority,
    });

    setNewName('');
    setIsAddingGoal(false);
  };

  const openGoalInlineEditor = (goal: SavingsGoal) => {
    setEditingGoalId(goal.id);
    setEditSavedStr(String(goal.currentSaved));
    setEditTargetStr(String(goal.targetAmount));
    setEditMonthlyStr(String(goal.monthlyContribution));
  };

  const handleSaveInlineEdit = (goalId: string) => {
    const sVal = parseFloat(editSavedStr);
    const tVal = parseFloat(editTargetStr);
    const mVal = parseFloat(editMonthlyStr);
    onUpdateGoal(goalId, {
      ...(isNaN(sVal) || sVal < 0 ? {} : { currentSaved: Math.min(100000000, sVal) }),
      ...(isNaN(tVal) || tVal <= 0 ? {} : { targetAmount: Math.min(100000000, tVal) }),
      ...(isNaN(mVal) || mVal < 0 ? {} : { monthlyContribution: Math.min(10000000, mVal) }),
    });
    setEditingGoalId(null);
  };

  const handleOpenTotalSavedEditor = () => {
    if (savingsGoals.length === 0) {
      setIsAddingGoal(true);
      return;
    }
    setTotalSavedInputStr(String(Math.round(summary.totalSaved * 100) / 100));
    setIsEditingTotalSaved(true);
  };

  const handleSaveTotalSavedSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseFloat(totalSavedInputStr);
    if (isNaN(parsed) || parsed < 0) return;
    if (onSetTotalSavedAcrossGoals) {
      onSetTotalSavedAcrossGoals(Math.min(100000000, parsed));
    } else if (savingsGoals[0]) {
      onUpdateGoal(savingsGoals[0].id, { currentSaved: Math.min(100000000, parsed) });
    }
    setIsEditingTotalSaved(false);
  };

  return (
    <section
      aria-label="Personal Savings Goals & Cash Allocation"
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <PiggyBank className="w-4 h-4 text-slate-900 dark:text-slate-100 shrink-0" />
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Personal Savings Goals &amp; Automated Monthly Allocations
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Track target milestones, edit saved balances anytime, and route monthly cash flow surplus into high-yield vaults
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsAddingGoal((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>{isAddingGoal ? 'Close Goal Form' : 'New Savings Goal'}</span>
        </button>
      </div>

      {/* Undo Deleted Savings Goal Banner */}
      {lastDeletedGoal && onUndoDeleteGoal && (
        <div
          role="status"
          aria-live="polite"
          className="px-6 py-3 bg-amber-50/90 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800/70 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="text-slate-800 dark:text-slate-200">
            <span>Deleted savings goal </span>
            <strong className="font-semibold text-slate-900 dark:text-white">
              &ldquo;{lastDeletedGoal.name}&rdquo;
            </strong>
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
              {' '}
              ({formatCurrency(lastDeletedGoal.currentSaved)} saved of{' '}
              {formatCurrency(lastDeletedGoal.targetAmount)} target)
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onUndoDeleteGoal}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Undo Delete</span>
            </button>
            {onDismissUndoGoal && (
              <button
                type="button"
                onClick={onDismissUndoGoal}
                aria-label="Dismiss undo notice"
                className="p-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 rounded transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
        <div className="p-4 sm:px-6">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Total Saved Across Goals
            </span>
            {savingsGoals.length > 0 && !isEditingTotalSaved && (
              <button
                type="button"
                onClick={handleOpenTotalSavedEditor}
                title="Edit total saved balance"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white underline underline-offset-4 whitespace-nowrap shrink-0"
              >
                <Pencil className="w-3 h-3" />
                <span>Edit</span>
              </button>
            )}
          </div>

          {isEditingTotalSaved ? (
            <form onSubmit={handleSaveTotalSavedSubmit} className="mt-1.5 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">$</span>
                <input
                  type="number"
                  min="0"
                  max="100000000"
                  step="0.01"
                  required
                  aria-label="Total Saved Across Goals ($)"
                  value={totalSavedInputStr}
                  onChange={(e) => setTotalSavedInputStr(e.target.value)}
                  className="w-full px-2.5 py-1 text-sm font-semibold font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-md text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-300"
                />
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <button
                  type="submit"
                  className="inline-flex items-center gap-1 px-2.5 py-1 font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  <Check className="w-3 h-3" />
                  <span>Save Total</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditingTotalSaved(false)}
                  className="px-2 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 whitespace-nowrap"
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <button
                type="button"
                onClick={handleOpenTotalSavedEditor}
                title={
                  savingsGoals.length > 0
                    ? 'Click to edit total saved balance'
                    : 'Create a savings goal first'
                }
                className="mt-1 text-left text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 transition-colors"
              >
                {formatCurrency(summary.totalSaved)}
              </button>
              <div className="mt-0.5 text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                {summary.overallProgress.toFixed(1)}% of {formatCurrency(summary.totalTarget)} combined target
              </div>
            </>
          )}
        </div>

        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500 dark:text-slate-400">Monthly Goal Contributions</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(summary.totalMonthlyAllocation)}
            <span className="text-xs font-normal text-slate-500 dark:text-slate-400">/mo</span>
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-slate-500 dark:text-slate-400">
            {formatCurrency(summary.totalMonthlyAllocation * 12)}/yr projected savings velocity
          </div>
        </div>

        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Remaining to Reach All Targets
          </div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(Math.max(0, summary.totalTarget - summary.totalSaved))}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Across {savingsGoals.length} active savings vaults
          </div>
        </div>

        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Unallocated Monthly Cash Flow
          </div>
          <div
            className={`mt-1 text-xl font-semibold font-mono tabular-nums ${
              summary.unallocatedCashFlow >= 0
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {formatCurrency(summary.unallocatedCashFlow, true)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
            Vs. {formatCurrency(netCashFlowThisMonth)} Nov net cash flow surplus
          </div>
        </div>
      </div>

      {/* Add New Savings Goal Drawer */}
      {isAddingGoal && (
        <form
          onSubmit={handleCreateGoalSubmit}
          className="p-6 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 space-y-4 text-xs"
        >
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Create New Savings Goal
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Goal Name
              </label>
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g., European Summer Trip"
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Target Amount ($)
              </label>
              <input
                type="number"
                min="1"
                step="0.01"
                required
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Total Saved ($)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                required
                value={newCurrent}
                onChange={(e) => setNewCurrent(e.target.value)}
                className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Monthly Contribution ($/mo)
              </label>
              <input
                type="number"
                min="0"
                step="10"
                required
                value={newMonthly}
                onChange={(e) => setNewMonthly(e.target.value)}
                className="w-full px-3 py-2 font-mono tabular-nums bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Target Date
              </label>
              <input
                type="date"
                value={newTargetDate}
                onChange={(e) => setNewTargetDate(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Destination Account
              </label>
              <input
                type="text"
                value={newLinkedAccount}
                onChange={(e) => setNewLinkedAccount(e.target.value)}
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Priority Level
              </label>
              <select
                value={newPriority}
                onChange={(e) =>
                  setNewPriority(e.target.value as 'High' | 'Medium' | 'Flexible')
                }
                className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              >
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Flexible">Flexible / Sinking Fund</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <div className="text-[11px] text-slate-500 dark:text-slate-400">
              Label: {newCategoryLabel}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAddingGoal(false)}
                className="px-3 py-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-1.5 font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors"
              >
                <Check className="w-3.5 h-3.5" />
                <span>Save Goal</span>
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Goals Grid or Empty State */}
      {savingsGoals.length === 0 ? (
        <div className="p-10 text-center space-y-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="max-w-md mx-auto space-y-1.5">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              No savings goals configured yet
            </div>
            <p>
              Create target milestones for emergency reserves, travel, or major purchases and automate monthly surplus allocations.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIsAddingGoal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-white dark:text-slate-900 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white rounded-lg transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create First Savings Goal</span>
            </button>
            {lastDeletedGoal && onUndoDeleteGoal && (
              <button
                type="button"
                onClick={onUndoDeleteGoal}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 rounded-lg transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restore &ldquo;{lastDeletedGoal.name}&rdquo;</span>
              </button>
            )}
            {onLoadStarterDemo && (
              <button
                type="button"
                onClick={onLoadStarterDemo}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Load Starter Demo Goals</span>
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {(compact ? savingsGoals.slice(0, 4) : savingsGoals).map((goal) => {
            const pct =
              goal.targetAmount > 0
                ? Math.min(100, (goal.currentSaved / goal.targetAmount) * 100)
                : 0;
            const remaining = Math.max(0, goal.targetAmount - goal.currentSaved);
            const monthsLeft =
              goal.monthlyContribution > 0
                ? Math.ceil(remaining / goal.monthlyContribution)
                : null;
            const isEditing = editingGoalId === goal.id;

            return (
              <div
                key={goal.id}
                className="p-4 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col justify-between gap-3 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
                        <Target className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                        <span>{goal.name}</span>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {goal.linkedAccount} · Priority: {goal.priority} · Target: {goal.targetDate}
                      </div>
                    </div>

                    <span className="font-mono tabular-nums text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                      {pct.toFixed(1)}%
                    </span>
                  </div>

                  {/* Progress Bar (Zero inline styles) */}
                  <svg
                    viewBox="0 0 100 4"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                    className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden"
                  >
                    <rect
                      x={0}
                      y={0}
                      width={Math.max(2, pct)}
                      height={4}
                      className="fill-emerald-600 dark:fill-emerald-500"
                    />
                  </svg>

                  {/* Amounts & Pace — Click saved amount directly to edit */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-0.5">
                    <div className="font-mono tabular-nums flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openGoalInlineEditor(goal)}
                        title={`Click to edit saved balance for ${goal.name}`}
                        className="inline-flex items-center gap-1 font-semibold text-slate-900 dark:text-slate-100 hover:text-emerald-700 dark:hover:text-emerald-400 underline decoration-dotted underline-offset-4 transition-colors"
                      >
                        <span>{formatCurrency(goal.currentSaved)}</span>
                        <Pencil className="w-3 h-3 text-slate-400" />
                      </button>
                      <span className="text-slate-400 dark:text-slate-500"> / </span>
                      <span className="text-slate-600 dark:text-slate-300">
                        {formatCurrency(goal.targetAmount)}
                      </span>
                    </div>

                    <div className="text-slate-500 dark:text-slate-400 font-mono tabular-nums text-[11px]">
                      {remaining === 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                          Goal Reached!
                        </span>
                      ) : (
                        <>
                          {formatCurrency(remaining)} to go
                          {monthsLeft !== null &&
                            ` (~${monthsLeft} mo at ${formatCurrency(goal.monthlyContribution)}/mo)`}
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Interactive Contribution & Edit Footer */}
                {isEditing ? (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                          Total Saved ($)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="100000000"
                          step="0.01"
                          value={editSavedStr}
                          onChange={(e) => setEditSavedStr(e.target.value)}
                          className="w-full px-2.5 py-1 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                          Target ($)
                        </label>
                        <input
                          type="number"
                          min="1"
                          max="100000000"
                          step="0.01"
                          value={editTargetStr}
                          onChange={(e) => setEditTargetStr(e.target.value)}
                          className="w-full px-2.5 py-1 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-slate-100"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                          Monthly ($/mo)
                        </label>
                        <input
                          type="number"
                          min="0"
                          max="10000000"
                          step="10"
                          value={editMonthlyStr}
                          onChange={(e) => setEditMonthlyStr(e.target.value)}
                          className="w-full px-2.5 py-1 font-mono tabular-nums bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-slate-100"
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setEditingGoalId(null)}
                        className="px-2.5 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveInlineEdit(goal.id)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded font-medium"
                      >
                        <Check className="w-3 h-3" />
                        <span>Save Changes</span>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onContributeToGoal(goal.id, 100)}
                        className="px-2.5 py-1 font-mono tabular-nums text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md transition-colors whitespace-nowrap"
                      >
                        +$100 Deposit
                      </button>
                      <button
                        type="button"
                        onClick={() => onContributeToGoal(goal.id, 250)}
                        className="px-2.5 py-1 font-mono tabular-nums text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md transition-colors whitespace-nowrap"
                      >
                        +$250 Deposit
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => openGoalInlineEditor(goal)}
                        className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 text-[11px] whitespace-nowrap"
                      >
                        Edit Saved / Target / Monthly
                      </button>
                      {onDeleteGoal && (
                        <button
                          type="button"
                          onClick={() => onDeleteGoal(goal.id)}
                          aria-label={`Delete savings goal ${goal.name}`}
                          title={`Delete "${goal.name}"`}
                          className="p-1 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 rounded transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
