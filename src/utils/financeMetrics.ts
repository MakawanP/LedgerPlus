import {
  ALL_SPENDING_CATEGORIES,
  SpendingCategory,
  SubscriptionItem,
  Transaction,
} from '../types/finance';

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

  const grossPurchasesThisMonth = novPurchases.reduce((sum, t) => sum + t.amount, 0);
  const totalRefundsThisMonth = novRefunds.reduce((sum, t) => sum + t.amount, 0);
  const excludedTransfersThisMonth = novTransfers.reduce((sum, t) => sum + t.amount, 0);

  // Actual spending is gross purchases minus refunded returns (or tracked separately)
  const totalSpendingThisMonth = Math.max(0, grossPurchasesThisMonth - totalRefundsThisMonth);

  const pendingSpendingThisMonth = novPurchases
    .filter((t) => t.status === 'pending')
    .reduce((sum, t) => sum + t.amount, 0);

  const postedSpendingThisMonth = novPurchases
    .filter((t) => t.status === 'posted')
    .reduce((sum, t) => sum + t.amount, 0);

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
    octPurchases.reduce((sum, t) => sum + t.amount, 0) -
      octRefunds.reduce((sum, t) => sum + t.amount, 0)
  );

  // Category Breakdown across all 16 categories
  const categoryMap = new Map<
    SpendingCategory,
    { novAmount: number; octAmount: number; count: number }
  >();
  ALL_SPENDING_CATEGORIES.forEach((cat) => {
    categoryMap.set(cat, { novAmount: 0, octAmount: 0, count: 0 });
  });

  novPurchases.forEach((t) => {
    const entry = categoryMap.get(t.category) || { novAmount: 0, octAmount: 0, count: 0 };
    entry.novAmount += t.amount;
    entry.count += 1;
    categoryMap.set(t.category, entry);
  });

  octPurchases.forEach((t) => {
    const entry = categoryMap.get(t.category) || { novAmount: 0, octAmount: 0, count: 0 };
    entry.octAmount += t.amount;
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

  // Largest individual purchase
  const sortedPurchases = [...novPurchases].sort((a, b) => b.amount - a.amount);
  const topPurchase = sortedPurchases[0]
    ? {
        merchant: sortedPurchases[0].merchant,
        amount: sortedPurchases[0].amount,
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

  // Top 10 Merchants in November
  const merchantMap = new Map<string, MerchantRankItem>();
  novPurchases.forEach((t) => {
    const existing = merchantMap.get(t.merchant);
    if (existing) {
      existing.totalSpent += t.amount;
      existing.transactionCount += 1;
      if (t.date > existing.lastDate) existing.lastDate = t.date;
    } else {
      merchantMap.set(t.merchant, {
        merchant: t.merchant,
        category: t.category,
        totalSpent: t.amount,
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
    },
    categoryBreakdown,
    topMerchants,
  };
}
