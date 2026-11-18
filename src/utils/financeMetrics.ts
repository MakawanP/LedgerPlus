import {
  ALL_SPENDING_CATEGORIES,
  SpendingCategory,
  SpendingInsight,
  SubscriptionItem,
  Transaction,
} from '../types/finance';

export const DEFAULT_CATEGORY_BUDGETS: Record<SpendingCategory, number> = {
  'Rent & Housing': 2450,
  Groceries: 450,
  'Food & Restaurants': 350,
  'Coffee & Drinks': 65,
  'Transportation / Uber / Taxi': 150,
  'Gas & Parking': 120,
  'Bills & Utilities': 240,
  'Travel & Hotels': 400,
  'Shopping & Retail': 250,
  'Shopping Online': 250,
  Subscriptions: 150,
  'Health & Fitness': 180,
  Entertainment: 120,
  'Personal Care': 90,
  Education: 100,
  'Other / Uncategorized': 100,
};

export interface TransactionSplitSummary {
  isSplit: boolean;
  totalPaid: number;
  personalShare: number;
  friendsTotalShare: number;
  owedUnpaid: number;
  settledReimbursed: number;
  participantsCount: number;
}

export function getTransactionSplitSummary(tx: Transaction): TransactionSplitSummary {
  const totalPaid = Math.max(0, Number(tx.amount) || 0);
  const participants = tx.splitBill?.participants ?? [];
  if (tx.transactionType !== 'purchase' || participants.length === 0) {
    return {
      isSplit: false,
      totalPaid,
      personalShare: totalPaid,
      friendsTotalShare: 0,
      owedUnpaid: 0,
      settledReimbursed: 0,
      participantsCount: 0,
    };
  }

  let rawFriendsShare = 0;
  let rawOwed = 0;
  let rawSettled = 0;

  for (const p of participants) {
    const share = Math.max(0, Number(p.amountOwed) || 0);
    rawFriendsShare += share;
    if (p.status === 'settled') {
      rawSettled += share;
    } else {
      rawOwed += share;
    }
  }

  const friendsTotalShare = Math.min(totalPaid, Math.round(rawFriendsShare * 100) / 100);
  const settledReimbursed = Math.min(friendsTotalShare, Math.round(rawSettled * 100) / 100);
  const owedUnpaid = Math.max(
    0,
    Math.min(friendsTotalShare - settledReimbursed, Math.round(rawOwed * 100) / 100)
  );
  const personalShare = Math.max(0, Math.round((totalPaid - friendsTotalShare) * 100) / 100);

  return {
    isSplit: friendsTotalShare > 0,
    totalPaid,
    personalShare,
    friendsTotalShare,
    owedUnpaid,
    settledReimbursed,
    participantsCount: participants.length,
  };
}

export function getEffectivePersonalSpend(tx: Transaction): number {
  if (tx.transactionType !== 'purchase') {
    return Math.max(0, Number(tx.amount) || 0);
  }
  return getTransactionSplitSummary(tx).personalShare;
}

export function computeSpendingInsights(
  summary: DashboardSummaryMetrics,
  categoryBreakdown: CategorySummaryItem[],
  subscriptions: SubscriptionItem[],
  transactions: Transaction[],
  categoryBudgets: Record<SpendingCategory, number>
): SpendingInsight[] {
  const insights: SpendingInsight[] = [];

  // 1. Top Spending Category
  const topCat = categoryBreakdown.find((c) => c.amount > 0);
  if (topCat) {
    const budgetLimit = categoryBudgets[topCat.category] ?? 0;
    const isOver = budgetLimit > 0 && topCat.amount > budgetLimit;
    insights.push({
      id: 'ins-top-cat',
      categoryType: 'Top Spending Category',
      title: `${topCat.category} leads monthly spend (${topCat.percentageOfTotal.toFixed(1)}%)`,
      description: isOver
        ? `${topCat.category} has reached ${formatCurrency(topCat.amount)} across ${topCat.transactionCount} transaction(s), exceeding your ${formatCurrency(budgetLimit)} monthly budget by +${formatCurrency(topCat.amount - budgetLimit)}.`
        : `${topCat.category} accounts for ${formatCurrency(topCat.amount)} across ${topCat.transactionCount} verified transaction(s) this month.`,
      impactAmount: topCat.amount,
      impactPeriod: 'month',
      severity: isOver ? 'high' : 'info',
    });
  } else {
    insights.push({
      id: 'ins-top-cat-empty',
      categoryType: 'Top Spending Category',
      title: 'No purchase categories recorded yet',
      description:
        'Import a receipt, PDF statement, or drop files into data/inbox/ to track your top spending categories automatically.',
      impactAmount: 0,
      impactPeriod: 'month',
      severity: 'info',
    });
  }

  // 2. Over-Budget / Increasing Pattern
  const exceededCategories = categoryBreakdown.filter((c) => {
    const limit = categoryBudgets[c.category] ?? 0;
    return limit > 0 && c.amount > limit;
  });

  if (exceededCategories.length > 0) {
    const worst = exceededCategories[0];
    const limit = categoryBudgets[worst.category] ?? 0;
    const overage = worst.amount - limit;
    insights.push({
      id: 'ins-over-budget',
      categoryType: 'Increasing Pattern',
      title: `${exceededCategories.length} ${exceededCategories.length === 1 ? 'category has' : 'categories have'} exceeded monthly budget`,
      description: `${worst.category} is over budget by +${formatCurrency(overage)} (${formatCurrency(worst.amount)} spent vs. ${formatCurrency(limit)} limit).`,
      impactAmount: overage,
      impactPeriod: 'month',
      severity: 'high',
    });
  } else {
    insights.push({
      id: 'ins-on-budget',
      categoryType: 'Increasing Pattern',
      title: 'All budgeted categories are within monthly limits',
      description:
        'No spending categories have exceeded their configured monthly budget limits so far this month.',
      impactAmount: 0,
      impactPeriod: 'month',
      severity: 'info',
    });
  }

  // 3. Largest / Unusual Purchase
  if (summary.largestIndividualPurchase) {
    const largest = summary.largestIndividualPurchase;
    insights.push({
      id: 'ins-largest-purchase',
      categoryType: 'Unusual Purchase',
      title: `Largest single purchase: ${largest.merchant} (${formatCurrency(largest.amount)})`,
      description: `Recorded on ${largest.date} under ${largest.category}.`,
      impactAmount: largest.amount,
      impactPeriod: 'one-time',
      severity: largest.amount >= 250 ? 'medium' : 'info',
      relatedMerchant: largest.merchant,
    });
  } else {
    insights.push({
      id: 'ins-largest-empty',
      categoryType: 'Unusual Purchase',
      title: 'No high-variance purchases detected',
      description: 'Single high-dollar or unusual transactions will be surfaced here automatically.',
      impactAmount: 0,
      impactPeriod: 'one-time',
      severity: 'info',
    });
  }

  // 4. Suspicious / Duplicate or Uncertain Charges
  const flaggedTx = transactions.filter(
    (t) => Boolean(t.anomalyNote) || Boolean(t.uncertainCategory)
  );
  if (flaggedTx.length > 0) {
    const totalFlagged = flaggedTx.reduce((acc, t) => acc + t.amount, 0);
    insights.push({
      id: 'ins-flagged-tx',
      categoryType: 'Suspicious / Duplicate Charge',
      title: `${flaggedTx.length} transaction(s) awaiting review or confirmation`,
      description: `Review ${flaggedTx[0].merchant} (${formatCurrency(flaggedTx[0].amount)}) in the Clarification Queue to confirm its category or remove duplicate holds.`,
      impactAmount: totalFlagged,
      impactPeriod: 'one-time',
      severity: 'high',
    });
  } else {
    insights.push({
      id: 'ins-clean-dedup',
      categoryType: 'Suspicious / Duplicate Charge',
      title: `${summary.duplicatesEliminatedCount} cross-source duplicate(s) merged cleanly`,
      description:
        'Cross-source deduplication is active across Apple Pay notifications, email receipts, and statements with zero unverified anomalies.',
      impactAmount: 0,
      impactPeriod: 'one-time',
      severity: 'info',
    });
  }

  // 5. Forgotten / Price-Hiked Subscriptions
  const flaggedSubs = subscriptions.filter(
    (s) =>
      s.status !== 'Canceled' &&
      (s.status === 'Unused / Review' ||
        s.status === 'Price Increased' ||
        (s.inactiveMonths ?? 0) >= 3)
  );
  if (flaggedSubs.length > 0) {
    const monthlySubImpact = flaggedSubs.reduce((acc, s) => acc + s.amount, 0);
    insights.push({
      id: 'ins-forgotten-subs',
      categoryType: 'Forgotten Subscription',
      title: `${flaggedSubs.length} recurring subscription(s) flagged for review`,
      description: `${flaggedSubs.map((s) => s.merchant).join(', ')} can be reviewed or canceled to save ${formatCurrency(monthlySubImpact)}/mo.`,
      impactAmount: monthlySubImpact,
      impactPeriod: 'month',
      severity: 'medium',
    });
  } else {
    insights.push({
      id: 'ins-subs-clean',
      categoryType: 'Forgotten Subscription',
      title: `Active recurring commitments: ${formatCurrency(summary.totalSubscriptionsMonthly)}/mo`,
      description:
        subscriptions.length > 0
          ? `Tracking ${subscriptions.length} recurring commitment(s) with no unacknowledged price increases or 90-day inactivity flags.`
          : 'No recurring subscriptions logged yet.',
      impactAmount: summary.totalSubscriptionsMonthly,
      impactPeriod: 'month',
      severity: 'info',
    });
  }

  // 6. Net Cash Flow & Savings Opportunity
  insights.push({
    id: 'ins-cashflow-surplus',
    categoryType: 'Savings Opportunity',
    title:
      summary.netCashFlow >= 0
        ? `Net monthly cash flow surplus: +${formatCurrency(summary.netCashFlow)}`
        : `Net monthly cash flow deficit: ${formatCurrency(summary.netCashFlow)}`,
    description:
      summary.totalSpendingThisMonth > 0 || summary.totalIncomeThisMonth > 0
        ? `Verified income of ${formatCurrency(summary.totalIncomeThisMonth)} vs. net spending of ${formatCurrency(summary.totalSpendingThisMonth)} (${formatCurrency(summary.totalRefundsThisMonth)} in refunds offset).`
        : 'Log income and purchases to track your real-time monthly net cash flow surplus.',
    impactAmount: Math.abs(summary.netCashFlow),
    impactPeriod: 'month',
    severity: summary.netCashFlow < 0 ? 'high' : 'info',
  });

  return insights;
}


export interface CategorySummaryItem {
  category: SpendingCategory;
  amount: number;
  previousMonthAmount: number;
  transactionCount: number;
  percentageOfTotal: number;
  momDeltaAmount: number;
  momDeltaPercent: number | null;
}

export interface MerchantRankItem {
  merchant: string;
  category: SpendingCategory;
  totalSpent: number;
  transactionCount: number;
  lastDate: string;
}

export interface DashboardSummaryMetrics {
  totalSpendingThisMonth: number;
  grossPurchasesThisMonth: number;
  totalRefundsThisMonth: number;
  excludedTransfersThisMonth: number;
  pendingSpendingThisMonth: number;
  postedSpendingThisMonth: number;
  totalIncomeThisMonth: number;
  netCashFlow: number;
  totalSubscriptionsMonthly: number;
  totalSubscriptionsAnnual: number;
  largestSpendingCategory: {
    category: SpendingCategory;
    amount: number;
    percentage: number;
  };
  largestIndividualPurchase: {
    merchant: string;
    amount: number;
    date: string;
    category: SpendingCategory;
  } | null;
  averageDailySpending: number;
  previousMonthTotalSpending: number;
  momSpendingChangePercent: number;
  momPaceChangePercent: number;
  duplicatesEliminatedCount: number;
  uncertainCount: number;
  grossCardOutflowThisMonth: number;
  totalSplitCoveredThisMonth: number;
  totalSplitOwedToYou: number;
  totalSplitSettledThisMonth: number;
}

export function formatCurrency(amount: number, showSign = false): string {
  const absFormatted = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(amount));

  if (amount < 0) return `-${absFormatted}`;
  if (showSign && amount > 0) return `+${absFormatted}`;
  return absFormatted;
}

export function computeDashboardMetrics(
  transactions: Transaction[],
  subscriptions: SubscriptionItem[],
  daysElapsedInMonth = 17
): {
  summary: DashboardSummaryMetrics;
  categoryBreakdown: CategorySummaryItem[];
  topMerchants: MerchantRankItem[];
} {
  const novTransactions = transactions.filter((t) => t.monthKey === '2026-11');
  const octTransactions = transactions.filter((t) => t.monthKey === '2026-10');

  const novPurchases = novTransactions.filter((t) => t.transactionType === 'purchase');
  const novRefunds = novTransactions.filter((t) => t.transactionType === 'refund');
  const novIncome = novTransactions.filter((t) => t.transactionType === 'income');
  const novTransfers = novTransactions.filter((t) => t.transactionType === 'transfer');

  const grossCardOutflowThisMonth = novPurchases.reduce((sum, t) => sum + t.amount, 0);
  const grossPurchasesThisMonth = novPurchases.reduce(
    (sum, t) => sum + getEffectivePersonalSpend(t),
    0
  );
  const totalRefundsThisMonth = novRefunds.reduce((sum, t) => sum + t.amount, 0);
  const excludedTransfersThisMonth = novTransfers.reduce((sum, t) => sum + t.amount, 0);

  // Split Bill Receivables (Owed to you vs Settled)
  const totalSplitCoveredThisMonth = novPurchases.reduce(
    (sum, t) => sum + getTransactionSplitSummary(t).friendsTotalShare,
    0
  );
  const totalSplitSettledThisMonth = novPurchases.reduce(
    (sum, t) => sum + getTransactionSplitSummary(t).settledReimbursed,
    0
  );
  const totalSplitOwedToYou = transactions
    .filter((t) => t.transactionType === 'purchase')
    .reduce((sum, t) => sum + getTransactionSplitSummary(t).owedUnpaid, 0);

  // Personal spending is your personal share of purchases minus refunded returns
  const totalSpendingThisMonth = Math.max(0, grossPurchasesThisMonth - totalRefundsThisMonth);

  const pendingSpendingThisMonth = novPurchases
    .filter((t) => t.status === 'pending')
    .reduce((sum, t) => sum + getEffectivePersonalSpend(t), 0);

  const postedSpendingThisMonth = novPurchases
    .filter((t) => t.status === 'posted')
    .reduce((sum, t) => sum + getEffectivePersonalSpend(t), 0);

  const totalIncomeThisMonth = novIncome.reduce((sum, t) => sum + t.amount, 0);
  const netCashFlow = totalIncomeThisMonth - totalSpendingThisMonth;

  // Subscriptions monthly equivalent (excluding rent so users see both recurring bills and subscriptions clearly, or all recurring)
  const nonRentSubscriptions = subscriptions.filter((s) => s.category !== 'Rent & Housing');
  const totalSubscriptionsMonthly = nonRentSubscriptions.reduce((sum, s) => {
    if (s.frequency === 'Annual subscription') {
      return sum + s.amount / 12;
    }
    return sum + s.amount;
  }, 0);

  const totalSubscriptionsAnnual = nonRentSubscriptions.reduce(
    (sum, s) => sum + s.estimatedAnnualCost,
    0
  );

  // Previous month total spending
  const octPurchases = octTransactions.filter((t) => t.transactionType === 'purchase');
  const octRefunds = octTransactions.filter((t) => t.transactionType === 'refund');
  const previousMonthTotalSpending = Math.max(
    0,
    octPurchases.reduce((sum, t) => sum + getEffectivePersonalSpend(t), 0) -
      octRefunds.reduce((sum, t) => sum + t.amount, 0)
  );

  // Category Breakdown across all 16 categories (using personal spend share)
  const categoryMap = new Map<
    SpendingCategory,
    { novAmount: number; octAmount: number; count: number }
  >();
  ALL_SPENDING_CATEGORIES.forEach((cat) => {
    categoryMap.set(cat, { novAmount: 0, octAmount: 0, count: 0 });
  });

  novPurchases.forEach((t) => {
    const entry = categoryMap.get(t.category) || { novAmount: 0, octAmount: 0, count: 0 };
    entry.novAmount += getEffectivePersonalSpend(t);
    entry.count += 1;
    categoryMap.set(t.category, entry);
  });

  octPurchases.forEach((t) => {
    const entry = categoryMap.get(t.category) || { novAmount: 0, octAmount: 0, count: 0 };
    entry.octAmount += getEffectivePersonalSpend(t);
    categoryMap.set(t.category, entry);
  });

  const categoryBreakdown: CategorySummaryItem[] = Array.from(categoryMap.entries())
    .map(([category, data]) => {
      const percentageOfTotal =
        grossPurchasesThisMonth > 0 ? (data.novAmount / grossPurchasesThisMonth) * 100 : 0;
      const momDeltaAmount = data.novAmount - data.octAmount;
      const momDeltaPercent =
        data.octAmount > 0 ? ((data.novAmount - data.octAmount) / data.octAmount) * 100 : null;
      return {
        category,
        amount: data.novAmount,
        previousMonthAmount: data.octAmount,
        transactionCount: data.count,
        percentageOfTotal,
        momDeltaAmount,
        momDeltaPercent,
      };
    })
    .sort((a, b) => b.amount - a.amount);

  const topCat = categoryBreakdown[0] || {
    category: 'Other / Uncategorized' as SpendingCategory,
    amount: 0,
    percentageOfTotal: 0,
  };

  // Largest individual purchase (by personal share)
  const sortedPurchases = [...novPurchases].sort(
    (a, b) => getEffectivePersonalSpend(b) - getEffectivePersonalSpend(a)
  );
  const topPurchase = sortedPurchases[0]
    ? {
        merchant: sortedPurchases[0].merchant,
        amount: getEffectivePersonalSpend(sortedPurchases[0]),
        date: sortedPurchases[0].date,
        category: sortedPurchases[0].category,
      }
    : null;

  const averageDailySpending =
    daysElapsedInMonth > 0 ? totalSpendingThisMonth / daysElapsedInMonth : 0;

  const momSpendingChangePercent =
    previousMonthTotalSpending > 0
      ? ((totalSpendingThisMonth - previousMonthTotalSpending) / previousMonthTotalSpending) * 100
      : 0;

  // Compare daily run-rate or month-over-month
  const octDailyAvg = previousMonthTotalSpending / 31;
  const momPaceChangePercent =
    octDailyAvg > 0 ? ((averageDailySpending - octDailyAvg) / octDailyAvg) * 100 : 0;

  // Count how many duplicate source entries were consolidated
  const duplicatesEliminatedCount = novTransactions.reduce((sum, t) => {
    const extraSources = Math.max(0, (t.mergedSources?.length || 1) - 1);
    return sum + extraSources;
  }, 0);

  const uncertainCount = novTransactions.filter((t) => t.uncertainCategory).length;

  // Top 10 Merchants in November (personal spend share)
  const merchantMap = new Map<string, MerchantRankItem>();
  novPurchases.forEach((t) => {
    const personalAmt = getEffectivePersonalSpend(t);
    const existing = merchantMap.get(t.merchant);
    if (existing) {
      existing.totalSpent += personalAmt;
      existing.transactionCount += 1;
      if (t.date > existing.lastDate) existing.lastDate = t.date;
    } else {
      merchantMap.set(t.merchant, {
        merchant: t.merchant,
        category: t.category,
        totalSpent: personalAmt,
        transactionCount: 1,
        lastDate: t.date,
      });
    }
  });

  const topMerchants = Array.from(merchantMap.values())
    .sort((a, b) => b.totalSpent - a.totalSpent)
    .slice(0, 10);

  return {
    summary: {
      totalSpendingThisMonth,
      grossPurchasesThisMonth,
      totalRefundsThisMonth,
      excludedTransfersThisMonth,
      pendingSpendingThisMonth,
      postedSpendingThisMonth,
      totalIncomeThisMonth,
      netCashFlow,
      totalSubscriptionsMonthly,
      totalSubscriptionsAnnual,
      largestSpendingCategory: {
        category: topCat.category,
        amount: topCat.amount,
        percentage: topCat.percentageOfTotal,
      },
      largestIndividualPurchase: topPurchase,
      averageDailySpending,
      previousMonthTotalSpending,
      momSpendingChangePercent,
      momPaceChangePercent,
      duplicatesEliminatedCount,
      uncertainCount,
      grossCardOutflowThisMonth,
      totalSplitCoveredThisMonth,
      totalSplitOwedToYou,
      totalSplitSettledThisMonth,
    },
    categoryBreakdown,
    topMerchants,
  };
}
