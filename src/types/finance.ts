export type SpendingCategory =
  | 'Food & Restaurants'
  | 'Coffee & Drinks'
  | 'Groceries'
  | 'Shopping & Retail'
  | 'Transportation / Uber / Taxi'
  | 'Gas & Parking'
  | 'Bills & Utilities'
  | 'Rent & Housing'
  | 'Travel & Hotels'
  | 'Entertainment'
  | 'Health & Fitness'
  | 'Subscriptions'
  | 'Personal Care'
  | 'Shopping Online'
  | 'Education'
  | 'Other / Uncategorized';

export const ALL_SPENDING_CATEGORIES: SpendingCategory[] = [
  'Food & Restaurants',
  'Coffee & Drinks',
  'Groceries',
  'Shopping & Retail',
  'Transportation / Uber / Taxi',
  'Gas & Parking',
  'Bills & Utilities',
  'Rent & Housing',
  'Travel & Hotels',
  'Entertainment',
  'Health & Fitness',
  'Subscriptions',
  'Personal Care',
  'Shopping Online',
  'Education',
  'Other / Uncategorized',
];

export type TransactionStatus = 'posted' | 'pending' | 'refunded';

export type TransactionType = 'purchase' | 'refund' | 'income' | 'transfer';

export type DataSource =
  | 'Gmail'
  | 'Bank Statement'
  | 'Apple Pay'
  | 'Uploaded Statement'
  | 'Cash / Manual';

export interface SourceRecord {
  source: DataSource;
  referenceId: string;
  capturedAt: string;
  rawDescriptor: string;
  statusAtCapture: TransactionStatus;
}

export interface Transaction {
  id: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:mm
  merchant: string;
  rawDescription: string;
  amount: number; // Always positive exact figure
  paymentMethod: string;
  category: SpendingCategory;
  status: TransactionStatus;
  transactionType: TransactionType;
  source: DataSource;
  /**
   * When a single purchase appears across multiple sources (e.g. Apple Pay tap,
   * Gmail receipt, and Credit Card statement), we merge them and count the actual
   * purchase only once.
   */
  mergedSources: SourceRecord[];
  isDeduplicated: boolean;
  /**
   * Rules compliance: clearly identify uncertain transactions and ask the user
   * when a transaction cannot be confidently categorized.
   */
  uncertainCategory?: boolean;
  uncertaintyReason?: string;
  suggestedCategories?: SpendingCategory[];
  /**
   * Flags unusual or suspicious charges (e.g., potential duplicate charge on same day)
   */
  anomalyNote?: string;
  isRecurring?: boolean;
  monthKey: '2026-11' | '2026-10';
}

export type SubscriptionFrequency =
  | 'Monthly subscription'
  | 'Annual subscription'
  | 'Membership'
  | 'Recurring bill';

export interface SubscriptionItem {
  id: string;
  merchant: string;
  category: SpendingCategory;
  amount: number;
  previousAmount?: number;
  inactiveMonths?: number;
  alertDismissed?: boolean;
  frequency: SubscriptionFrequency;
  billingDayOrDate: string;
  paymentMethod: string;
  source: DataSource;
  estimatedAnnualCost: number;
  status: 'Active' | 'Unused / Review' | 'Price Increased' | 'Canceled';
  usageNote?: string;
  lastChargedDate: string;
}

export interface SavingsGoal {
  id: string;
  name: string;
  categoryLabel: string;
  targetAmount: number;
  currentSaved: number;
  monthlyContribution: number;
  targetDate: string;
  linkedAccount: string;
  priority: 'High' | 'Medium' | 'Flexible';
}

export interface SpendingInsight {
  id: string;
  categoryType:
    | 'Top Spending Category'
    | 'Unusual Purchase'
    | 'Increasing Pattern'
    | 'Suspicious / Duplicate Charge'
    | 'Forgotten Subscription'
    | 'Savings Opportunity';
  title: string;
  description: string;
  impactAmount: number;
  impactPeriod: 'month' | 'year' | 'one-time';
  severity: 'high' | 'medium' | 'info';
  relatedMerchant?: string;
  actionLabel?: string;
}

export interface ConnectedSourceStatus {
  id: string;
  name: string;
  sourceType: DataSource;
  accountDetail: string;
  lastSynced: string;
  recordsScanned: number;
  duplicatesMerged: number;
  status: 'Synced' | 'Attention';
}

