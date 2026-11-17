import React, { useMemo, useState } from 'react';
import {
  Check,
  PiggyBank,
  Plus,
  Target,
} from 'lucide-react';
import { SavingsGoal } from '../types/finance';
import { formatCurrency } from '../utils/financeMetrics';

interface SavingsGoalsSectionProps {
  savingsGoals: SavingsGoal[];
  netCashFlowThisMonth: number;
  onContributeToGoal: (goalId: string, amount: number) => void;
  onUpdateGoal: (
    goalId: string,
    updates: Partial<Pick<SavingsGoal, 'targetAmount' | 'monthlyContribution' | 'targetDate'>>
  ) => void;
  onCreateGoal: (newGoal: Omit<SavingsGoal, 'id'>) => void;
  compact?: boolean;
}

export const SavingsGoalsSection: React.FC<SavingsGoalsSectionProps> = ({
  savingsGoals,
  netCashFlowThisMonth,
  onContributeToGoal,
  onUpdateGoal,
  onCreateGoal,
  compact = false,
}) => {
  const [isAddingGoal, setIsAddingGoal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editTargetStr, setEditTargetStr] = useState('');
  const [editMonthlyStr, setEditMonthlyStr] = useState('');

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
    const currentSaved = parseFloat(newCurrent) || 0;
    const monthlyContribution = parseFloat(newMonthly) || 100;
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

  const handleSaveInlineEdit = (goalId: string) => {
    const tVal = parseFloat(editTargetStr);
    const mVal = parseFloat(editMonthlyStr);
    onUpdateGoal(goalId, {
      ...(isNaN(tVal) || tVal <= 0 ? {} : { targetAmount: tVal }),
      ...(isNaN(mVal) || mVal < 0 ? {} : { monthlyContribution: mVal }),
    });
    setEditingGoalId(null);
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
              Personal Savings Goals & Automated Monthly Allocations
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Track target milestones, log contributions, and route monthly cash flow surplus directly into high-yield vaults
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

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
        <div className="p-4 sm:px-6">
          <div className="text-xs text-slate-500 dark:text-slate-400">Total Saved Across Goals</div>
          <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {formatCurrency(summary.totalSaved)}
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
            {summary.overallProgress.toFixed(1)}% of {formatCurrency(summary.totalTarget)} combined target
          </div>
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
                min="100"
                step="50"
                required
                value={newTarget}
                onChange={(e) => setNewTarget(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Current Saved ($)
              </label>
              <input
                type="number"
                min="0"
                step="50"
                required
                value={newCurrent}
                onChange={(e) => setNewCurrent(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
              />
            </div>

            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                Monthly Contribution ($/mo)
              </label>
              <input
                type="number"
                min="10"
                step="10"
                required
                value={newMonthly}
                onChange={(e) => setNewMonthly(e.target.value)}
                className="w-full px-3 py-2 font-mono bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
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

          <div className="flex justify-end gap-2 pt-2">
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
        </form>
      )}

      {/* Goals Grid */}
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

                  <span className="font-mono text-xs font-semibold text-emerald-700 dark:text-emerald-400 shrink-0">
                    {pct.toFixed(1)}%
                  </span>
                </div>

                {/* Progress Bar */}
                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 dark:bg-emerald-500 rounded-full transition-all duration-200"
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                </div>

                {/* Amounts & Pace */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-0.5">
                  <div className="font-mono tabular-nums">
                    <strong className="text-slate-900 dark:text-slate-100">
                      {formatCurrency(goal.currentSaved)}
                    </strong>
                    <span className="text-slate-400 dark:text-slate-500"> / </span>
                    <span className="text-slate-600 dark:text-slate-300">
                      {formatCurrency(goal.targetAmount)}
                    </span>
                  </div>

                  <div className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                    {remaining === 0 ? (
                      <span className="text-emerald-700 dark:text-emerald-400 font-semibold">
                        Goal Reached!
                      </span>
                    ) : (
                      <>
                        {formatCurrency(remaining)} to go
                        {monthsLeft !== null && ` (~${monthsLeft} mo at ${formatCurrency(goal.monthlyContribution)}/mo)`}
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Interactive Contribution & Edit Footer */}
              {isEditing ? (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2">
                    <label className="text-slate-500 dark:text-slate-400">Target ($):</label>
                    <input
                      type="number"
                      min="100"
                      step="100"
                      value={editTargetStr}
                      onChange={(e) => setEditTargetStr(e.target.value)}
                      className="w-24 px-2 py-1 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-slate-100"
                    />
                    <label className="text-slate-500 dark:text-slate-400">Monthly ($):</label>
                    <input
                      type="number"
                      min="0"
                      step="25"
                      value={editMonthlyStr}
                      onChange={(e) => setEditMonthlyStr(e.target.value)}
                      className="w-20 px-2 py-1 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded text-slate-900 dark:text-slate-100"
                    />
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingGoalId(null)}
                      className="px-2 py-1 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSaveInlineEdit(goal.id)}
                      className="px-2.5 py-1 bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded font-medium"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onContributeToGoal(goal.id, 100)}
                      className="px-2.5 py-1 font-mono text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md transition-colors"
                    >
                      +$100 Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => onContributeToGoal(goal.id, 250)}
                      className="px-2.5 py-1 font-mono text-[11px] font-medium bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-md transition-colors"
                    >
                      +$250 Deposit
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setEditingGoalId(goal.id);
                      setEditTargetStr(String(goal.targetAmount));
                      setEditMonthlyStr(String(goal.monthlyContribution));
                    }}
                    className="text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4 text-[11px]"
                  >
                    Edit Target / Monthly ({formatCurrency(goal.monthlyContribution)}/mo)
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
};
