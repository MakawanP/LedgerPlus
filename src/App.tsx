import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  ChevronDown,
  Cloud,
  Database,
  Download,
  Layers,
  Moon,
  Plus,
  RotateCcw,
  Sun,
} from 'lucide-react';
import {
  BillSplitDetails,
  DataSource,
  SavingsGoal,
  SpendingCategory,
  SubscriptionItem,
  Transaction,
  TransactionStatus,
} from './types/finance';
import {
  DEMO_CATEGORY_BUDGETS,
  DEMO_SAVINGS_GOALS,
  DEMO_SUBSCRIPTIONS,
  DEMO_TRANSACTIONS,
} from './data/demoImports';
import {
  DEFAULT_CATEGORY_BUDGETS,
  computeDashboardMetrics,
  computeSpendingInsights,
  formatCurrency,
  getTransactionSplitSummary,
} from './utils/financeMetrics';
import {
  ensureCloudLedgerWorkspace,
  initWorkspaceAndCloudAuth,
  sanitizeDocId,
  signInWithGoogleAndGmail,
  signOutFromCloud,
  subscribeToCloudLedger,
  syncDeleteSavingsGoalsFromCloud,
  syncDeleteSubscriptionsFromCloud,
  syncDeleteTransactionsFromCloud,
  syncUpdateCategoryBudgetsInCloud,
  syncUpsertSavingsGoalsToCloud,
  syncUpsertSubscriptionsToCloud,
  syncUpsertTransactionsToCloud,
} from './services/firebaseAndGmail';
import { RunningSummaryGrid } from './components/RunningSummaryGrid';
import { UncertainQueuePanel } from './components/UncertainQueuePanel';
import { TransactionLedgerTable } from './components/TransactionLedgerTable';
import { FinancialReportsSection } from './components/FinancialReportsSection';
import { SubscriptionsTracker } from './components/SubscriptionsTracker';
import { SpendingInsightsView } from './components/SpendingInsightsView';
import { IngestSourceModal } from './components/IngestSourceModal';
import { CategoryBudgetDistribution } from './components/CategoryBudgetDistribution';
import { SavingsGoalsSection } from './components/SavingsGoalsSection';
import { QuickAddFloatingMenu } from './components/QuickAddFloatingMenu';
import { OfflineBanner } from './components/OfflineBanner';
import { MobileBottomNav, NavTabId } from './components/MobileBottomNav';
import {
  WindowsVaultAndSyncPanel,
  WindowsVaultPayload,
} from './components/WindowsVaultAndSyncPanel';
import { SplitBillModal } from './components/SplitBillModal';
import { SplitBillsSummaryPanel } from './components/SplitBillsSummaryPanel';

type ActiveTab = NavTabId;

const PRIMARY_NAV_ITEMS: ReadonlyArray<{ id: ActiveTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'transactions', label: 'Transactions & Subscriptions' },
  { id: 'reports', label: 'Reports' },
  { id: 'goals', label: 'Savings Goals' },
  { id: 'splits', label: 'Split Bills' },
];

const STORAGE_KEYS = {
  transactions: 'ledgerpulse_v2_transactions',
  subscriptions: 'ledgerpulse_v2_subscriptions',
  budgets: 'ledgerpulse_v2_budgets',
  goals: 'ledgerpulse_v2_goals',
} as const;

function loadPersistedState<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview');
  const [txSubView, setTxSubView] = useState<'both' | 'ledger' | 'subscriptions'>('both');
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('ledgerpulse_theme');
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  // Local-first + real-time Cloud Ledger state (starts clean with 0 fake transactions; optional 1-click Demo Import)
  const [transactions, setTransactions] = useState<Transaction[]>(() =>
    loadPersistedState(STORAGE_KEYS.transactions, [])
  );
  const [subscriptions, setSubscriptions] = useState<SubscriptionItem[]>(() =>
    loadPersistedState(STORAGE_KEYS.subscriptions, [])
  );
  const [categoryBudgets, setCategoryBudgets] = useState<Record<SpendingCategory, number>>(() =>
    loadPersistedState(STORAGE_KEYS.budgets, DEFAULT_CATEGORY_BUDGETS)
  );
  const [savingsGoals, setSavingsGoals] = useState<SavingsGoal[]>(() =>
    loadPersistedState(STORAGE_KEYS.goals, [])
  );

  const [isIngestModalOpen, setIsIngestModalOpen] = useState(false);
  const [splitModalTxId, setSplitModalTxId] = useState<string | null>(null);
  const [showSyncHub, setShowSyncHub] = useState<boolean>(
    () => loadPersistedState<Transaction[]>(STORAGE_KEYS.transactions, []).length === 0
  );
  const [toastBanner, setToastBanner] = useState<string | null>(null);
  const [lastDeletedBatch, setLastDeletedBatch] = useState<Transaction[] | null>(null);
  const [lastDeletedGoal, setLastDeletedGoal] = useState<SavingsGoal | null>(null);
  const [confirmResetVault, setConfirmResetVault] = useState(false);

  // Google Cloud Sync (Phone + Computer) & Gmail Auth State
  const [cloudUser, setCloudUser] = useState<User | null>(null);
  const [hasGmailToken, setHasGmailToken] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [cloudSyncMeta, setCloudSyncMeta] = useState<{
    lastSyncedDevice: string;
    updatedAtIso: string | null;
    isCloudReady: boolean;
  }>({
    lastSyncedDevice: 'This Device',
    updatedAtIso: null,
    isCloudReady: false,
  });

  // Latest state & cloud ID refs for race-free real-time Firestore synchronization
  const cloudTxIdsRef = useRef<Set<string>>(new Set());
  const cloudSubIdsRef = useRef<Set<string>>(new Set());
  const cloudGoalIdsRef = useRef<Set<string>>(new Set());

  const transactionsRef = useRef(transactions);
  transactionsRef.current = transactions;
  const subscriptionsRef = useRef(subscriptions);
  subscriptionsRef.current = subscriptions;
  const savingsGoalsRef = useRef(savingsGoals);
  savingsGoalsRef.current = savingsGoals;
  const categoryBudgetsRef = useRef(categoryBudgets);
  categoryBudgetsRef.current = categoryBudgets;

  // Local Disk Vault Metadata (data/local-ledger-vault.json)
  const [diskMeta, setDiskMeta] = useState<{
    vaultFilePath: string;
    inboxDirPath: string;
    fileSizeBytes: number | null;
    lastSavedAt: string | null;
    isSavingDisk: boolean;
  }>({
    vaultFilePath: 'data/local-ledger-vault.json',
    inboxDirPath: 'data/inbox/',
    fileSizeBytes: null,
    lastSavedAt: null,
    isSavingDisk: false,
  });
  const initialDiskHydratedRef = useRef(false);

  const showToast = useCallback((msg: string) => {
    setToastBanner(msg);
    setTimeout(() => {
      setToastBanner((prev) => (prev === msg ? null : prev));
    }, 4800);
  }, []);

  // Sync Dark Mode class & window theme-color meta tag
  useEffect(() => {
    const root = document.documentElement;
    const themeMeta = document.getElementById('meta-theme-color');
    if (isDarkMode) {
      root.classList.add('dark');
      themeMeta?.setAttribute('content', '#020617');
    } else {
      root.classList.remove('dark');
      themeMeta?.setAttribute('content', '#f8fafc');
    }
    try {
      localStorage.setItem('ledgerpulse_theme', isDarkMode ? 'dark' : 'light');
    } catch {}
  }, [isDarkMode]);

  // Initialize Firebase Auth & In-Memory Gmail Token Listener
  useEffect(() => {
    const unsubscribe = initWorkspaceAndCloudAuth((user, gmailReady) => {
      setCloudUser(user);
      setHasGmailToken(gmailReady);
      if (!user) {
        cloudTxIdsRef.current = new Set();
        cloudSubIdsRef.current = new Set();
        cloudGoalIdsRef.current = new Set();
        setCloudSyncMeta({
          lastSyncedDevice: 'This Device',
          updatedAtIso: null,
          isCloudReady: false,
        });
      }
    });
    return unsubscribe;
  }, []);

  // Attach Real-Time Phone & Computer Firestore Listeners when Authenticated
  useEffect(() => {
    const uid = cloudUser?.uid;
    if (!uid) return;

    let cancelled = false;
    let unsubscribeSnapshots: (() => void) | null = null;

    const connectCloudLedger = async () => {
      try {
        const { isNewWorkspace } = await ensureCloudLedgerWorkspace(
          uid,
          categoryBudgetsRef.current
        );
        if (cancelled) return;

        // Seed brand-new cloud workspace with any existing local ledger items so nothing is lost on first sign-in
        if (isNewWorkspace) {
          if (transactionsRef.current.length > 0) {
            await syncUpsertTransactionsToCloud(
              uid,
              transactionsRef.current,
              cloudTxIdsRef.current
            );
          }
          if (subscriptionsRef.current.length > 0) {
            await syncUpsertSubscriptionsToCloud(
              uid,
              subscriptionsRef.current,
              cloudSubIdsRef.current
            );
          }
          if (savingsGoalsRef.current.length > 0) {
            await syncUpsertSavingsGoalsToCloud(
              uid,
              savingsGoalsRef.current,
              cloudGoalIdsRef.current
            );
          }
        }

        if (cancelled) return;

        unsubscribeSnapshots = subscribeToCloudLedger(uid, {
          onWorkspaceMetadata: (meta) => {
            setCategoryBudgets(meta.categoryBudgets);
            setCloudSyncMeta({
              lastSyncedDevice: meta.lastSyncedDevice,
              updatedAtIso: meta.updatedAtIso,
              isCloudReady: true,
            });
          },
          onTransactions: (items, ids) => {
            cloudTxIdsRef.current = ids;
            setTransactions(items);
          },
          onSubscriptions: (items, ids) => {
            cloudSubIdsRef.current = ids;
            setSubscriptions(items);
          },
          onSavingsGoals: (items, ids) => {
            cloudGoalIdsRef.current = ids;
            setSavingsGoals(items);
          },
        });
      } catch (err) {
        console.error('Cloud sync setup error:', err);
      }
    };

    void connectCloudLedger();

    return () => {
      cancelled = true;
      if (unsubscribeSnapshots) {
        unsubscribeSnapshots();
      }
    };
  }, [cloudUser?.uid]);

  // Hydrate from Local Disk Vault (/api/local-vault) on launch when not yet using Cloud Sync
  useEffect(() => {
    let cancelled = false;
    const loadFromDisk = async () => {
      try {
        const res = await fetch('/api/local-vault');
        if (!res.ok) {
          initialDiskHydratedRef.current = true;
          return;
        }
        const data = await res.json();
        if (cancelled) return;

        // Only hydrate from local server vault if user isn't actively signed into a cloud-synced session
        if (
          !cloudUser &&
          data.exists &&
          data.vault &&
          Array.isArray(data.vault.transactions)
        ) {
          setTransactions(data.vault.transactions);
          if (Array.isArray(data.vault.subscriptions)) {
            setSubscriptions(data.vault.subscriptions);
          }
          if (data.vault.categoryBudgets && typeof data.vault.categoryBudgets === 'object') {
            setCategoryBudgets(data.vault.categoryBudgets);
          }
          if (Array.isArray(data.vault.savingsGoals)) {
            setSavingsGoals(data.vault.savingsGoals);
          }
          setDiskMeta({
            vaultFilePath: data.vaultFilePath || 'data/local-ledger-vault.json',
            inboxDirPath: data.inboxDirPath || 'data/inbox/',
            fileSizeBytes: data.fileSizeBytes ?? null,
            lastSavedAt: data.updatedAt ?? null,
            isSavingDisk: false,
          });
        } else {
          setDiskMeta((prev) => ({
            ...prev,
            vaultFilePath: data.vaultFilePath || prev.vaultFilePath,
            inboxDirPath: data.inboxDirPath || prev.inboxDirPath,
          }));
        }
      } catch {
        // Offline launch: relies on localStorage + Firestore offline cache
      } finally {
        if (!cancelled) {
          initialDiskHydratedRef.current = true;
        }
      }
    };
    void loadFromDisk();
    return () => {
      cancelled = true;
    };
  }, [cloudUser]);

  // Persist every mutation to localStorage + local backup vault (data/local-ledger-vault.json)
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.transactions, JSON.stringify(transactions));
      localStorage.setItem(STORAGE_KEYS.subscriptions, JSON.stringify(subscriptions));
      localStorage.setItem(STORAGE_KEYS.budgets, JSON.stringify(categoryBudgets));
      localStorage.setItem(STORAGE_KEYS.goals, JSON.stringify(savingsGoals));
    } catch {}

    if (!initialDiskHydratedRef.current) return;

    const timer = window.setTimeout(async () => {
      setDiskMeta((prev) => ({ ...prev, isSavingDisk: true }));
      try {
        const res = await fetch('/api/local-vault', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            version: '1.0',
            app: 'LedgerPulse Windows Local Vault',
            transactions,
            subscriptions,
            categoryBudgets,
            savingsGoals,
          }),
        });
        if (res.ok) {
          const saved = await res.json();
          setDiskMeta((prev) => ({
            ...prev,
            vaultFilePath: saved.vaultFilePath || prev.vaultFilePath,
            inboxDirPath: saved.inboxDirPath || prev.inboxDirPath,
            fileSizeBytes: saved.fileSizeBytes ?? prev.fileSizeBytes,
            lastSavedAt: saved.updatedAt ?? new Date().toISOString(),
            isSavingDisk: false,
          }));
        } else {
          setDiskMeta((prev) => ({ ...prev, isSavingDisk: false }));
        }
      } catch {
        setDiskMeta((prev) => ({ ...prev, isSavingDisk: false }));
      }
    }, 240);

    return () => window.clearTimeout(timer);
  }, [transactions, subscriptions, categoryBudgets, savingsGoals]);

  const handleToggleDarkMode = () => {
    setIsDarkMode((prev) => !prev);
  };

  const handleSignInGoogle = useCallback(async (): Promise<boolean> => {
    setIsSigningIn(true);
    try {
      const { user, accessToken } = await signInWithGoogleAndGmail();
      setCloudUser(user);
      setHasGmailToken(Boolean(accessToken));
      showToast(
        `Signed in as ${user.email || 'Google User'} — Phone & Computer live sync and Gmail receipt scanning ready.`
      );
      return Boolean(accessToken);
    } catch (err: any) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        showToast(err?.message || 'Google Sign-In could not complete. Please try again.');
      }
      return false;
    } finally {
      setIsSigningIn(false);
    }
  }, [showToast]);

  const handleSignOutGoogle = useCallback(async (): Promise<void> => {
    await signOutFromCloud();
    setCloudUser(null);
    setHasGmailToken(false);
    showToast('Signed out of cloud sync on this device. Local backup remains available.');
  }, [showToast]);

  const handleLoadStarterDemo = useCallback(() => {
    const existingTxIds = new Set(
      transactionsRef.current.map((t) => sanitizeDocId(t.id, 'tx'))
    );
    const demoTxToAdd = DEMO_TRANSACTIONS.filter(
      (t) => !existingTxIds.has(sanitizeDocId(t.id, 'tx'))
    );
    const nextTransactions = [...demoTxToAdd, ...transactionsRef.current];

    const existingSubIds = new Set(
      subscriptionsRef.current.map((s) => sanitizeDocId(s.id, 'sub'))
    );
    const demoSubToAdd = DEMO_SUBSCRIPTIONS.filter(
      (s) => !existingSubIds.has(sanitizeDocId(s.id, 'sub'))
    );
    const nextSubscriptions = [...subscriptionsRef.current, ...demoSubToAdd];

    const existingGoalIds = new Set(
      savingsGoalsRef.current.map((g) => sanitizeDocId(g.id, 'goal'))
    );
    const demoGoalToAdd = DEMO_SAVINGS_GOALS.filter(
      (g) => !existingGoalIds.has(sanitizeDocId(g.id, 'goal'))
    );
    const nextGoals = [...savingsGoalsRef.current, ...demoGoalToAdd];

    setTransactions(nextTransactions);
    setSubscriptions(nextSubscriptions);
    setSavingsGoals(nextGoals);
    setCategoryBudgets(DEMO_CATEGORY_BUDGETS);
    setShowSyncHub(false);

    if (cloudUser?.uid) {
      const uid = cloudUser.uid;
      void (async () => {
        await syncUpsertTransactionsToCloud(uid, DEMO_TRANSACTIONS, cloudTxIdsRef.current);
        await syncUpsertSubscriptionsToCloud(uid, DEMO_SUBSCRIPTIONS, cloudSubIdsRef.current);
        await syncUpsertSavingsGoalsToCloud(uid, DEMO_SAVINGS_GOALS, cloudGoalIdsRef.current);
        await syncUpdateCategoryBudgetsInCloud(uid, DEMO_CATEGORY_BUDGETS);
      })();
    }

    showToast(
      `Loaded starter demo data (${DEMO_TRANSACTIONS.length} transactions, ${DEMO_SUBSCRIPTIONS.length} subscriptions, ${DEMO_SAVINGS_GOALS.length} savings goals). Delete any row anytime.`
    );
  }, [cloudUser?.uid, showToast]);

  const handleHydrateFromVaultFile = useCallback(
    (loaded: Partial<WindowsVaultPayload>, sourceLabel: string) => {
      if (Array.isArray(loaded.transactions)) setTransactions(loaded.transactions);
      if (Array.isArray(loaded.subscriptions)) setSubscriptions(loaded.subscriptions);
      if (loaded.categoryBudgets) setCategoryBudgets(loaded.categoryBudgets);
      if (Array.isArray(loaded.savingsGoals)) setSavingsGoals(loaded.savingsGoals);

      if (cloudUser?.uid) {
        const uid = cloudUser.uid;
        void (async () => {
          if (Array.isArray(loaded.transactions) && loaded.transactions.length > 0) {
            await syncUpsertTransactionsToCloud(uid, loaded.transactions, cloudTxIdsRef.current);
          }
          if (Array.isArray(loaded.subscriptions) && loaded.subscriptions.length > 0) {
            await syncUpsertSubscriptionsToCloud(
              uid,
              loaded.subscriptions,
              cloudSubIdsRef.current
            );
          }
          if (Array.isArray(loaded.savingsGoals) && loaded.savingsGoals.length > 0) {
            await syncUpsertSavingsGoalsToCloud(uid, loaded.savingsGoals, cloudGoalIdsRef.current);
          }
          if (loaded.categoryBudgets) {
            await syncUpdateCategoryBudgetsInCloud(uid, loaded.categoryBudgets);
          }
        })();
      }

      showToast(
        `Loaded vault "${sourceLabel}" (${loaded.transactions?.length || 0} transactions)${
          cloudUser ? ' and synced to cloud.' : '.'
        }`
      );
    },
    [cloudUser, showToast]
  );

  const handleResetDemoData = () => {
    const prevTxIds = Array.from(cloudTxIdsRef.current);
    const prevSubIds = Array.from(cloudSubIdsRef.current);
    const prevGoalIds = Array.from(cloudGoalIdsRef.current);

    setTransactions([]);
    setSubscriptions([]);
    setCategoryBudgets(DEFAULT_CATEGORY_BUDGETS);
    setSavingsGoals([]);
    setConfirmResetVault(false);

    if (cloudUser?.uid) {
      const uid = cloudUser.uid;
      void (async () => {
        if (prevTxIds.length > 0) await syncDeleteTransactionsFromCloud(uid, prevTxIds);
        if (prevSubIds.length > 0) await syncDeleteSubscriptionsFromCloud(uid, prevSubIds);
        if (prevGoalIds.length > 0) await syncDeleteSavingsGoalsFromCloud(uid, prevGoalIds);
        await syncUpdateCategoryBudgetsInCloud(uid, DEFAULT_CATEGORY_BUDGETS);
      })();
    }

    showToast('Cleared all records and reset your ledger to a clean state.');
  };

  const { summary, categoryBreakdown, topMerchants } = useMemo(
    () => computeDashboardMetrics(transactions, subscriptions, 17),
    [transactions, subscriptions]
  );

  const liveInsights = useMemo(
    () =>
      computeSpendingInsights(
        summary,
        categoryBreakdown,
        subscriptions,
        transactions,
        categoryBudgets
      ),
    [summary, categoryBreakdown, subscriptions, transactions, categoryBudgets]
  );

  const vaultPayload: WindowsVaultPayload = useMemo(
    () => ({
      version: '1.0',
      app: 'LedgerPulse Windows Local Vault',
      transactions,
      subscriptions,
      categoryBudgets,
      savingsGoals,
    }),
    [transactions, subscriptions, categoryBudgets, savingsGoals]
  );

  const handleUpdateCategory = (id: string, category: SpendingCategory) => {
    let updatedItem: Transaction | null = null;
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== id) return tx;
        updatedItem = {
          ...tx,
          category,
          uncertainCategory: false,
          uncertaintyReason: undefined,
        };
        return updatedItem;
      })
    );
    if (cloudUser?.uid && updatedItem) {
      void syncUpsertTransactionsToCloud(cloudUser.uid, [updatedItem], cloudTxIdsRef.current);
    }
    showToast(`Updated category to "${category}" and recalculated monthly summary.`);
  };

  const handleUpdateStatus = (id: string, status: TransactionStatus) => {
    let updatedItem: Transaction | null = null;
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id !== id) return tx;
        updatedItem = {
          ...tx,
          status,
          transactionType: status === 'refunded' ? 'refund' : tx.transactionType,
        };
        return updatedItem;
      })
    );
    if (cloudUser?.uid && updatedItem) {
      void syncUpsertTransactionsToCloud(cloudUser.uid, [updatedItem], cloudTxIdsRef.current);
    }
    showToast(`Updated transaction status to ${status}.`);
  };

  const handleSaveTransactionSplit = useCallback(
    (txId: string, splitBill: BillSplitDetails | undefined) => {
      const target = transactionsRef.current.find((t) => t.id === txId);
      if (!target) return;

      const updatedItem: Transaction = {
        ...target,
        splitBill: splitBill && splitBill.participants.length > 0 ? splitBill : undefined,
      };

      setTransactions((prev) => prev.map((tx) => (tx.id === txId ? updatedItem : tx)));

      if (cloudUser?.uid) {
        void syncUpsertTransactionsToCloud(cloudUser.uid, [updatedItem], cloudTxIdsRef.current);
      }

      if (updatedItem.splitBill && updatedItem.splitBill.participants.length > 0) {
        const splitInfo = getTransactionSplitSummary(updatedItem);
        showToast(
          `Saved bill split on "${updatedItem.merchant}" — your share ${formatCurrency(
            splitInfo.personalShare
          )}, ${formatCurrency(splitInfo.owedUnpaid)} owed to you.`
        );
      } else {
        showToast(
          `Removed bill split on "${updatedItem.merchant}" — full ${formatCurrency(
            updatedItem.amount
          )} restored to personal spend.`
        );
      }
    },
    [cloudUser?.uid, showToast]
  );

  const handleToggleSplitParticipantSettled = useCallback(
    (txId: string, participantId: string) => {
      const target = transactionsRef.current.find((t) => t.id === txId);
      if (!target?.splitBill?.participants?.length) return;

      let toggledFriend = '';
      let toggledAmount = 0;
      let nextStatus: 'owed' | 'settled' = 'settled';

      const nextParticipants = target.splitBill.participants.map((p) => {
        if (p.id !== participantId) return p;
        toggledFriend = p.friendName;
        toggledAmount = p.amountOwed;
        nextStatus = p.status === 'settled' ? 'owed' : 'settled';
        return {
          ...p,
          status: nextStatus,
          settledDate: nextStatus === 'settled' ? '2026-11-17' : undefined,
        };
      });

      const updatedItem: Transaction = {
        ...target,
        splitBill: {
          ...target.splitBill,
          participants: nextParticipants,
        },
      };

      setTransactions((prev) => prev.map((tx) => (tx.id === txId ? updatedItem : tx)));

      if (cloudUser?.uid) {
        void syncUpsertTransactionsToCloud(cloudUser.uid, [updatedItem], cloudTxIdsRef.current);
      }

      if (toggledFriend) {
        showToast(
          nextStatus === 'settled'
            ? `Marked ${toggledFriend}'s ${formatCurrency(toggledAmount)} share on "${
                target.merchant
              }" as paid back.`
            : `Marked ${toggledFriend}'s ${formatCurrency(toggledAmount)} share on "${
                target.merchant
              }" as unpaid.`
        );
      }
    },
    [cloudUser?.uid, showToast]
  );

  const handleSettleAllForFriend = useCallback(
    (friendName: string) => {
      const updatedItems: Transaction[] = [];
      let settledTotal = 0;
      let settledSharesCount = 0;

      setTransactions((prev) =>
        prev.map((tx) => {
          if (tx.transactionType !== 'purchase' || !tx.splitBill?.participants?.length) {
            return tx;
          }
          const hasUnpaidForFriend = tx.splitBill.participants.some(
            (p) => p.friendName === friendName && p.status === 'owed'
          );
          if (!hasUnpaidForFriend) return tx;

          const nextParticipants = tx.splitBill.participants.map((p) => {
            if (p.friendName !== friendName || p.status !== 'owed') return p;
            settledTotal += p.amountOwed;
            settledSharesCount += 1;
            return {
              ...p,
              status: 'settled' as const,
              settledDate: '2026-11-17',
            };
          });

          const nextTx: Transaction = {
            ...tx,
            splitBill: {
              ...tx.splitBill,
              participants: nextParticipants,
            },
          };
          updatedItems.push(nextTx);
          return nextTx;
        })
      );

      if (cloudUser?.uid && updatedItems.length > 0) {
        void syncUpsertTransactionsToCloud(cloudUser.uid, updatedItems, cloudTxIdsRef.current);
      }

      if (settledSharesCount > 0) {
        showToast(
          `Settled all ${settledSharesCount} open split shares (${formatCurrency(
            settledTotal
          )}) for ${friendName}.`
        );
      }
    },
    [cloudUser?.uid, showToast]
  );

  const handleDeleteTransactions = useCallback(
    (ids: string[], customReason?: string) => {
      if (ids.length === 0) return;
      const idSet = new Set(ids);
      const removed = transactionsRef.current.filter((tx) => idSet.has(tx.id));
      if (removed.length > 0) {
        setLastDeletedBatch(removed);
      }

      setTransactions((prev) => prev.filter((tx) => !idSet.has(tx.id)));

      if (cloudUser?.uid) {
        void syncDeleteTransactionsFromCloud(cloudUser.uid, ids);
      }

      if (customReason) {
        showToast(`${customReason}${cloudUser ? ' · Synced across devices.' : '.'}`);
      } else if (ids.length === 1) {
        const target = removed[0];
        showToast(
          target
            ? `Deleted "${target.merchant}" (${formatCurrency(target.amount)}).`
            : 'Deleted transaction from ledger.'
        );
      } else {
        showToast(`Deleted ${ids.length} transactions from ledger.`);
      }
    },
    [cloudUser, showToast]
  );

  const handleUndoDelete = useCallback(() => {
    if (!lastDeletedBatch || lastDeletedBatch.length === 0) return;
    const restoredBatch = [...lastDeletedBatch];
    const existingIds = new Set(transactionsRef.current.map((t) => t.id));
    const toRestore = restoredBatch.filter((t) => !existingIds.has(t.id));

    setTransactions((prev) => [...toRestore, ...prev]);
    setLastDeletedBatch(null);

    if (cloudUser?.uid && toRestore.length > 0) {
      void syncUpsertTransactionsToCloud(cloudUser.uid, toRestore, cloudTxIdsRef.current);
    }

    showToast(
      `Restored ${restoredBatch.length} deleted ${
        restoredBatch.length === 1 ? 'transaction' : 'transactions'
      } back to ledger.`
    );
  }, [cloudUser?.uid, lastDeletedBatch, showToast]);

  const handleDismissAnomaly = (id: string, action: 'keep' | 'remove_duplicate') => {
    if (action === 'remove_duplicate') {
      handleDeleteTransactions([id], 'Excluded duplicate pending hold from active spending totals');
    } else {
      let updatedItem: Transaction | null = null;
      setTransactions((prev) =>
        prev.map((tx) => {
          if (tx.id !== id) return tx;
          updatedItem = { ...tx, anomalyNote: undefined };
          return updatedItem;
        })
      );
      if (cloudUser?.uid && updatedItem) {
        void syncUpsertTransactionsToCloud(cloudUser.uid, [updatedItem], cloudTxIdsRef.current);
      }
      showToast('Acknowledged charge alert.');
    }
  };

  const handleToggleCancelSubscription = (id: string) => {
    let updatedSub: SubscriptionItem | null = null;
    setSubscriptions((prev) =>
      prev.map((sub) => {
        if (sub.id !== id) return sub;
        updatedSub = {
          ...sub,
          status:
            sub.status === 'Unused / Review'
              ? 'Active'
              : sub.status === 'Canceled'
              ? 'Active'
              : 'Unused / Review',
        };
        return updatedSub;
      })
    );
    if (cloudUser?.uid && updatedSub) {
      void syncUpsertSubscriptionsToCloud(cloudUser.uid, [updatedSub], cloudSubIdsRef.current);
    }
  };

  const handleDismissSubscriptionAlert = (id: string) => {
    let updatedSub: SubscriptionItem | null = null;
    setSubscriptions((prev) =>
      prev.map((sub) => {
        if (sub.id !== id) return sub;
        updatedSub = { ...sub, alertDismissed: true };
        return updatedSub;
      })
    );
    if (cloudUser?.uid && updatedSub) {
      void syncUpsertSubscriptionsToCloud(cloudUser.uid, [updatedSub], cloudSubIdsRef.current);
    }
    showToast('Acknowledged and dismissed subscription alert.');
  };

  const handleCancelAndRedirectToGoal = (subId: string, goalId: string) => {
    const targetSub = subscriptionsRef.current.find((s) => s.id === subId);
    if (!targetSub) return;

    const nextSub: SubscriptionItem = {
      ...targetSub,
      status: 'Canceled',
      alertDismissed: true,
    };

    setSubscriptions((prev) => prev.map((sub) => (sub.id === subId ? nextSub : sub)));

    let updatedGoal: SavingsGoal | null = null;
    setSavingsGoals((prev) =>
      prev.map((g) => {
        if (g.id !== goalId) return g;
        updatedGoal = {
          ...g,
          monthlyContribution: g.monthlyContribution + targetSub.amount,
        };
        return updatedGoal;
      })
    );

    if (cloudUser?.uid) {
      void syncUpsertSubscriptionsToCloud(cloudUser.uid, [nextSub], cloudSubIdsRef.current);
      if (updatedGoal) {
        void syncUpsertSavingsGoalsToCloud(cloudUser.uid, [updatedGoal], cloudGoalIdsRef.current);
      }
    }

    const targetGoal = savingsGoalsRef.current.find((g) => g.id === goalId);
    showToast(
      `Canceled "${targetSub.merchant}" and redirected +${formatCurrency(
        targetSub.amount
      )}/mo into "${targetGoal?.name || 'Savings Goal'}".`
    );
  };

  const handleSimulateNewPriceHike = () => {
    const nextSubs = subscriptionsRef.current.map((sub) => {
      if (sub.id === 'sub-07') {
        return {
          ...sub,
          previousAmount: 22.99,
          amount: 25.99,
          estimatedAnnualCost: 311.88,
          status: 'Price Increased' as const,
          alertDismissed: false,
          usageNote:
            'Automated Alert: Netflix 4K plan increased +$3.00/mo (+13.0%) from $22.99 to $25.99',
        };
      }
      return { ...sub, alertDismissed: false };
    });

    setSubscriptions(nextSubs);
    if (cloudUser?.uid && nextSubs.length > 0) {
      void syncUpsertSubscriptionsToCloud(cloudUser.uid, nextSubs, cloudSubIdsRef.current);
    }

    showToast(
      'Automated Watchdog Alert: Detected price increase on Netflix 4K (+$3.00/mo) and refreshed >3-month inactivity alerts.'
    );
  };

  const handleContributeToGoal = (goalId: string, amount: number) => {
    let updatedGoal: SavingsGoal | null = null;
    setSavingsGoals((prev) =>
      prev.map((g) => {
        if (g.id !== goalId) return g;
        updatedGoal = { ...g, currentSaved: g.currentSaved + amount };
        return updatedGoal;
      })
    );
    if (cloudUser?.uid && updatedGoal) {
      void syncUpsertSavingsGoalsToCloud(cloudUser.uid, [updatedGoal], cloudGoalIdsRef.current);
    }
    const goal = savingsGoalsRef.current.find((g) => g.id === goalId);
    showToast(`Logged +${formatCurrency(amount)} deposit toward "${goal?.name || 'Goal'}".`);
  };

  const handleNavigateTab = useCallback(
    (tab: ActiveTab, subView?: 'ledger' | 'subscriptions') => {
      setActiveTab(tab);
      if (tab === 'transactions' && subView) {
        setTxSubView(subView);
      }
    },
    []
  );

  const handleUpdateGoal = (
    goalId: string,
    updates: Partial<
      Pick<SavingsGoal, 'currentSaved' | 'targetAmount' | 'monthlyContribution' | 'targetDate'>
    >
  ) => {
    const sanitizedUpdates = { ...updates };
    if (typeof sanitizedUpdates.currentSaved === 'number') {
      sanitizedUpdates.currentSaved = Math.max(
        0,
        Math.min(100000000, Math.round(sanitizedUpdates.currentSaved * 100) / 100)
      );
    }
    if (typeof sanitizedUpdates.targetAmount === 'number') {
      sanitizedUpdates.targetAmount = Math.max(
        1,
        Math.min(100000000, Math.round(sanitizedUpdates.targetAmount * 100) / 100)
      );
    }

    let updatedGoal: SavingsGoal | null = null;
    setSavingsGoals((prev) =>
      prev.map((g) => {
        if (g.id !== goalId) return g;
        updatedGoal = { ...g, ...sanitizedUpdates };
        return updatedGoal;
      })
    );
    if (cloudUser?.uid && updatedGoal) {
      void syncUpsertSavingsGoalsToCloud(cloudUser.uid, [updatedGoal], cloudGoalIdsRef.current);
    }
    showToast('Updated savings goal balance and parameters.');
  };

  const handleSetTotalSavedAcrossGoals = useCallback(
    (nextTotalSaved: number) => {
      const currentGoals = savingsGoalsRef.current;
      if (currentGoals.length === 0) return;

      const clampedTotal = Math.max(
        0,
        Math.min(100000000, Math.round(nextTotalSaved * 100) / 100)
      );
      const currentTotal = currentGoals.reduce((sum, g) => sum + g.currentSaved, 0);
      const delta = Math.round((clampedTotal - currentTotal) * 100) / 100;
      if (Math.abs(delta) < 0.005) return;

      const changedGoals: SavingsGoal[] = [];
      let nextGoals: SavingsGoal[];

      if (delta > 0) {
        nextGoals = currentGoals.map((g, idx) => {
          if (idx !== 0) return g;
          const updated: SavingsGoal = {
            ...g,
            currentSaved: Math.min(100000000, Math.round((g.currentSaved + delta) * 100) / 100),
          };
          changedGoals.push(updated);
          return updated;
        });
      } else {
        let remainingReduction = Math.abs(delta);
        nextGoals = currentGoals.map((g) => {
          if (remainingReduction <= 0.001 || g.currentSaved <= 0) return g;
          const deduction = Math.min(g.currentSaved, remainingReduction);
          remainingReduction = Math.round((remainingReduction - deduction) * 100) / 100;
          const updated: SavingsGoal = {
            ...g,
            currentSaved: Math.max(0, Math.round((g.currentSaved - deduction) * 100) / 100),
          };
          changedGoals.push(updated);
          return updated;
        });
      }

      setSavingsGoals(nextGoals);
      if (cloudUser?.uid && changedGoals.length > 0) {
        void syncUpsertSavingsGoalsToCloud(cloudUser.uid, changedGoals, cloudGoalIdsRef.current);
      }
      showToast(`Updated total saved across goals to ${formatCurrency(clampedTotal)}.`);
    },
    [cloudUser?.uid, showToast]
  );

  const handleCreateGoal = (newGoal: Omit<SavingsGoal, 'id'>) => {
    const created: SavingsGoal = {
      ...newGoal,
      id: `goal-${Date.now()}`,
    };
    setSavingsGoals((prev) => [created, ...prev]);
    if (cloudUser?.uid) {
      void syncUpsertSavingsGoalsToCloud(cloudUser.uid, [created], cloudGoalIdsRef.current);
    }
    showToast(
      `Created new savings goal "${newGoal.name}" (${formatCurrency(newGoal.targetAmount)} target).`
    );
  };

  const handleDeleteGoal = useCallback(
    (goalId: string) => {
      const target = savingsGoalsRef.current.find((g) => g.id === goalId);
      if (target) {
        setLastDeletedGoal(target);
      }
      setSavingsGoals((prev) => prev.filter((g) => g.id !== goalId));
      cloudGoalIdsRef.current.delete(sanitizeDocId(goalId, 'goal'));
      if (cloudUser?.uid) {
        void syncDeleteSavingsGoalsFromCloud(cloudUser.uid, [goalId]);
      }
      showToast(
        target
          ? `Deleted savings goal "${target.name}" (${formatCurrency(target.currentSaved)} saved). Click Undo to restore.`
          : 'Deleted savings goal.'
      );
    },
    [cloudUser?.uid, showToast]
  );

  const handleUndoDeleteGoal = useCallback(() => {
    if (!lastDeletedGoal) return;
    const goalToRestore = { ...lastDeletedGoal };
    const alreadyExists = savingsGoalsRef.current.some((g) => g.id === goalToRestore.id);
    if (!alreadyExists) {
      setSavingsGoals((prev) => [goalToRestore, ...prev]);
      if (cloudUser?.uid) {
        void syncUpsertSavingsGoalsToCloud(
          cloudUser.uid,
          [goalToRestore],
          cloudGoalIdsRef.current
        );
      }
    }
    setLastDeletedGoal(null);
    showToast(
      `Restored savings goal "${goalToRestore.name}" (${formatCurrency(goalToRestore.currentSaved)} saved).`
    );
  }, [cloudUser?.uid, lastDeletedGoal, showToast]);

  const handleUpdateCategoryBudget = (category: SpendingCategory, newLimit: number) => {
    const nextBudgets = {
      ...categoryBudgetsRef.current,
      [category]: newLimit,
    };
    setCategoryBudgets(nextBudgets);
    if (cloudUser?.uid) {
      void syncUpdateCategoryBudgetsInCloud(cloudUser.uid, nextBudgets);
    }
    showToast(`Updated monthly budget for "${category}" to ${formatCurrency(newLimit)}.`);
  };

  const handleUpdateMultipleBudgets = (updated: Record<SpendingCategory, number>) => {
    setCategoryBudgets(updated);
    if (cloudUser?.uid) {
      void syncUpdateCategoryBudgetsInCloud(cloudUser.uid, updated);
    }
    showToast('Saved monthly category budget limits.');
  };

  const handleCommitTransactions = useCallback(
    (
      newItems: Transaction[],
      mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>,
      customToast?: string
    ) => {
      const cloudItemsToUpsert: Transaction[] = [...newItems];

      setTransactions((prev) => {
        let updated = [...prev];

        mergedUpdates.forEach((m) => {
          updated = updated.map((tx) => {
            if (tx.id !== m.existingId) return tx;
            const nextSources = [
              ...(tx.mergedSources || []),
              {
                source: m.newSource,
                referenceId: `SYNC-${Date.now().toString().slice(-4)}`,
                capturedAt: '2026-11-17 10:03',
                rawDescriptor: m.rawDescriptor,
                statusAtCapture: tx.status,
              },
            ];
            const mergedTx: Transaction = {
              ...tx,
              isDeduplicated: true,
              mergedSources: nextSources,
            };
            cloudItemsToUpsert.push(mergedTx);
            return mergedTx;
          });
        });

        return [...newItems, ...updated];
      });

      if (cloudUser?.uid && cloudItemsToUpsert.length > 0) {
        void syncUpsertTransactionsToCloud(
          cloudUser.uid,
          cloudItemsToUpsert,
          cloudTxIdsRef.current
        );
      }

      if (customToast) {
        showToast(customToast);
        return;
      }

      const msgParts: string[] = [];
      if (newItems.length === 1 && mergedUpdates.length === 0) {
        const item = newItems[0];
        const splitInfo = getTransactionSplitSummary(item);
        if (splitInfo.isSplit) {
          msgParts.push(
            `Saved split purchase "${item.merchant}" (${formatCurrency(
              item.amount
            )} paid · your share ${formatCurrency(splitInfo.personalShare)} · ${formatCurrency(
              splitInfo.owedUnpaid
            )} owed to you)`
          );
        } else {
          const kind = item.transactionType === 'income' ? 'one-off income' : 'transaction';
          msgParts.push(
            `Saved ${kind} "${item.merchant}" (${formatCurrency(item.amount)})${
              cloudUser ? ' & synced to cloud' : ''
            }`
          );
        }
      } else if (newItems.length > 0) {
        msgParts.push(
          `${newItems.length} new record(s) saved${cloudUser ? ' & synced' : ''}`
        );
      }
      if (mergedUpdates.length > 0) {
        msgParts.push(`${mergedUpdates.length} duplicate(s) merged without double-counting`);
      }
      showToast(msgParts.join(' · ') || 'Ledger updated.');
    },
    [cloudUser, showToast]
  );

  const handleExportCsv = () => {
    const headers = [
      'ID',
      'Date',
      'Merchant',
      'AmountPaid',
      'PersonalShare',
      'SplitOwedToYou',
      'Type',
      'Status',
      'Category',
      'PaymentMethod',
      'PrimarySource',
      'MergedSourcesCount',
    ];
    const rows = transactions
      .filter((t) => t.monthKey === '2026-11')
      .map((t) => {
        const split = getTransactionSplitSummary(t);
        return [
          t.id,
          t.date,
          `"${t.merchant.replace(/"/g, '""')}"`,
          t.amount.toFixed(2),
          split.personalShare.toFixed(2),
          split.owedUnpaid.toFixed(2),
          t.transactionType,
          t.status,
          `"${t.category}"`,
          `"${t.paymentMethod}"`,
          t.source,
          t.mergedSources?.length || 1,
        ];
      });

    const csvContent = [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'ledgerpulse_reconciled_nov_2026.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast('Exported deduplicated November 2026 ledger to CSV.');
  };

  const uncertainCount = useMemo(
    () => transactions.filter((t) => t.uncertainCategory).length,
    [transactions]
  );

  const unpaidSplitsCount = useMemo(() => {
    let count = 0;
    for (const tx of transactions) {
      if (tx.transactionType !== 'purchase' || !tx.splitBill?.participants?.length) continue;
      for (const p of tx.splitBill.participants) {
        if (p.status === 'owed') count += 1;
      }
    }
    return count;
  }, [transactions]);

  const activeSplitModalTx = useMemo(
    () => (splitModalTxId ? transactions.find((t) => t.id === splitModalTxId) || null : null),
    [splitModalTxId, transactions]
  );

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 transition-colors duration-150">
      {/* STRICT 3-ZONE TOP BAR CONTRACT */}
      <header className="flex sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur-xs border-b border-slate-200 dark:border-slate-800 px-4 sm:px-6 py-2.5 md:py-3.5 items-center justify-between gap-8">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#overview"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('overview');
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 font-display"
        >
          LedgerPulse
        </a>

        {/* Zone 2: Single-line text navigation links (Desktop >=1024px; Tablet uses clean strip below; Mobile uses MobileBottomNav) */}
        <nav
          aria-label="Primary Navigation"
          className="hidden lg:flex items-center gap-5 text-sm font-medium text-slate-600 dark:text-slate-400"
        >
          {PRIMARY_NAV_ITEMS.map((nav) => (
            <button
              key={nav.id}
              type="button"
              onClick={() => setActiveTab(nav.id)}
              className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                activeTab === nav.id
                  ? 'border-slate-900 dark:border-slate-100 text-slate-900 dark:text-slate-100 font-semibold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-600'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={() => setIsIngestModalOpen(true)}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 sm:px-4 py-2 text-xs font-medium text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors whitespace-nowrap shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Collect Transactions</span>
          </button>
        </div>
      </header>

      {/* Main Responsive Workbench Content Container (1400px Desktop Baseline + Mobile Bottom Nav Safe Padding) */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 lg:px-8 pt-5 pb-24 md:py-6 space-y-6">
        {/* Feedback Toast */}
        {toastBanner && (
          <div
            role="status"
            className="bg-slate-900 dark:bg-slate-800 text-white dark:text-slate-100 border border-transparent dark:border-slate-700 px-4 py-2.5 rounded-lg text-xs flex items-center justify-between gap-4 shadow-sm"
          >
            <span>{toastBanner}</span>
            <div className="flex items-center gap-3 shrink-0">
              {lastDeletedGoal && (
                <button
                  type="button"
                  onClick={handleUndoDeleteGoal}
                  className="px-2.5 py-1 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors whitespace-nowrap"
                >
                  Undo Delete Goal
                </button>
              )}
              {lastDeletedBatch && lastDeletedBatch.length > 0 && (
                <button
                  type="button"
                  onClick={handleUndoDelete}
                  className="px-2.5 py-1 font-semibold bg-emerald-600 hover:bg-emerald-500 text-white rounded-md transition-colors whitespace-nowrap"
                >
                  Undo Delete ({lastDeletedBatch.length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setToastBanner(null)}
                className="text-slate-300 dark:text-slate-400 hover:text-white dark:hover:text-slate-100 underline whitespace-nowrap"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Tablet Horizontal Navigation Bar (768px - 1023px) */}
        <nav
          aria-label="Workspace Tabs"
          className="hidden md:flex lg:hidden items-center gap-1 p-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto"
        >
          {PRIMARY_NAV_ITEMS.map((nav) => (
            <button
              key={`tab-md-${nav.id}`}
              type="button"
              onClick={() => setActiveTab(nav.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                activeTab === nav.id
                  ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              {nav.label}
            </button>
          ))}
        </nav>

        {/* Compact Workspace Toolbar & Collapsible Cloud Sync / Gmail Drawer */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl md:rounded-xl p-4 sm:px-5 sm:py-3.5 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                LedgerPulse — Personal Finance &amp; Multi-Device Ledger
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                <span>
                  {cloudUser
                    ? `Cloud synced (${cloudUser.email || 'Google Account'})`
                    : 'Local vault active · Sign in for Phone & Computer sync'}
                </span>
                <span aria-hidden="true"> · </span>
                <span className="font-mono text-slate-800 dark:text-slate-200">
                  Nov 1 – Nov 17, 2026
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {transactions.length === 0 && (
                <button
                  type="button"
                  onClick={handleLoadStarterDemo}
                  className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Database className="w-3.5 h-3.5" />
                  <span>Import Starter Demo</span>
                </button>
              )}

              <button
                type="button"
                aria-expanded={showSyncHub}
                onClick={() => setShowSyncHub((prev) => !prev)}
                className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                  showSyncHub
                    ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 border-slate-900 dark:border-slate-100'
                    : 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <Cloud className="w-3.5 h-3.5" />
                <span>{cloudUser ? 'Sync & Gmail' : 'Connect Sync & Gmail'}</span>
                <ChevronDown
                  className={`w-3.5 h-3.5 transition-transform duration-150 ${
                    showSyncHub ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={handleToggleDarkMode}
                aria-pressed={isDarkMode}
                aria-label={isDarkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                {isDarkMode ? (
                  <>
                    <Sun className="w-3.5 h-3.5 text-amber-400" />
                    <span>Light Mode</span>
                  </>
                ) : (
                  <>
                    <Moon className="w-3.5 h-3.5 text-slate-600" />
                    <span>Dark Mode</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportCsv}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>

              <button
                type="button"
                onClick={() => setIsIngestModalOpen(true)}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800/80 border border-transparent dark:border-slate-700/80 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>Import Receipt / Presets</span>
              </button>
            </div>
          </div>

          {showSyncHub && (
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
              <WindowsVaultAndSyncPanel
                vaultPayload={vaultPayload}
                diskMeta={diskMeta}
                cloudUser={cloudUser}
                hasGmailToken={hasGmailToken}
                isSigningIn={isSigningIn}
                cloudSyncMeta={cloudSyncMeta}
                onSignInGoogle={handleSignInGoogle}
                onSignOutGoogle={handleSignOutGoogle}
                onLoadStarterDemo={handleLoadStarterDemo}
                onHydrateVault={handleHydrateFromVaultFile}
                onCommitPulledTransactions={handleCommitTransactions}
                onShowToast={showToast}
              />
            </div>
          )}
        </div>

        {/* 1. OVERVIEW TAB — Executive Summary, Budgets & Integrated Insights (No Subscription Watchdog) */}
        {activeTab === 'overview' && (
          <>
            <RunningSummaryGrid
              metrics={summary}
              onNavigateTab={handleNavigateTab}
            />

            <UncertainQueuePanel
              transactions={transactions}
              onResolveCategory={handleUpdateCategory}
              onDismissAnomaly={handleDismissAnomaly}
              onDeleteTransaction={(id) => handleDeleteTransactions([id])}
            />

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 flex flex-col">
                <CategoryBudgetDistribution
                  categoryBreakdown={categoryBreakdown}
                  categoryBudgets={categoryBudgets}
                  onUpdateCategoryBudget={handleUpdateCategoryBudget}
                  onUpdateMultipleBudgets={handleUpdateMultipleBudgets}
                  onNavigateReports={() => setActiveTab('reports')}
                />
              </div>

              <div className="lg:col-span-5 flex flex-col">
                <SpendingInsightsView
                  insights={liveInsights}
                  summaryMetrics={summary}
                  categoryBreakdown={categoryBreakdown}
                  subscriptions={subscriptions}
                  transactions={transactions}
                  onNavigateTab={handleNavigateTab}
                />
              </div>
            </div>
          </>
        )}

        {/* 2. COMBINED TRANSACTIONS & SUBSCRIPTIONS TAB (Includes Automated Subscription Watchdog Exclusively Here) */}
        {activeTab === 'transactions' && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 sm:px-5 sm:py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  Transactions &amp; Subscriptions
                </span>
                <span aria-hidden="true"> · </span>
                <span className="font-mono tabular-nums">
                  {transactions.length} ledger records · {subscriptions.length} recurring bills
                </span>
              </div>

              <div
                role="tablist"
                aria-label="Transactions and Subscriptions Subview"
                className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg overflow-x-auto"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={txSubView === 'both'}
                  onClick={() => setTxSubView('both')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    txSubView === 'both'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Combined View
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={txSubView === 'ledger'}
                  onClick={() => setTxSubView('ledger')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 font-mono tabular-nums ${
                    txSubView === 'ledger'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Transactions ({transactions.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={txSubView === 'subscriptions'}
                  onClick={() => setTxSubView('subscriptions')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 font-mono tabular-nums ${
                    txSubView === 'subscriptions'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                  }`}
                >
                  Subscriptions &amp; Watchdog ({subscriptions.length})
                </button>
              </div>
            </div>

            {(txSubView === 'both' || txSubView === 'ledger') && (
              <>
                <UncertainQueuePanel
                  transactions={transactions}
                  onResolveCategory={handleUpdateCategory}
                  onDismissAnomaly={handleDismissAnomaly}
                  onDeleteTransaction={(id) => handleDeleteTransactions([id])}
                />
                <TransactionLedgerTable
                  transactions={transactions}
                  onUpdateCategory={handleUpdateCategory}
                  onUpdateStatus={handleUpdateStatus}
                  onDeleteTransactions={handleDeleteTransactions}
                  onOpenSplitModal={(tx) => setSplitModalTxId(tx.id)}
                  onToggleSplitParticipantSettled={handleToggleSplitParticipantSettled}
                  onLoadStarterDemo={handleLoadStarterDemo}
                  onOpenIngestModal={() => setIsIngestModalOpen(true)}
                />
              </>
            )}

            {(txSubView === 'both' || txSubView === 'subscriptions') && (
              <SubscriptionsTracker
                subscriptions={subscriptions}
                savingsGoals={savingsGoals}
                onToggleCancelSubscription={handleToggleCancelSubscription}
                onDismissAlert={handleDismissSubscriptionAlert}
                onCancelAndRedirectToGoal={handleCancelAndRedirectToGoal}
                onSimulateNewPriceHike={handleSimulateNewPriceHike}
              />
            )}
          </div>
        )}

        {/* 3. REPORTS TAB */}
        {activeTab === 'reports' && (
          <FinancialReportsSection
            transactions={transactions}
            subscriptions={subscriptions}
            summaryMetrics={summary}
            categoryBreakdown={categoryBreakdown}
            topMerchants={topMerchants}
            categoryBudgets={categoryBudgets}
            onUpdateCategoryBudget={handleUpdateCategoryBudget}
          />
        )}

        {/* 4. PERSONAL SAVINGS GOALS & AUTOMATED ALLOCATIONS TAB */}
        {activeTab === 'goals' && (
          <SavingsGoalsSection
            savingsGoals={savingsGoals}
            netCashFlowThisMonth={summary.netCashFlow}
            onContributeToGoal={handleContributeToGoal}
            onUpdateGoal={handleUpdateGoal}
            onSetTotalSavedAcrossGoals={handleSetTotalSavedAcrossGoals}
            onCreateGoal={handleCreateGoal}
            onDeleteGoal={handleDeleteGoal}
            lastDeletedGoal={lastDeletedGoal}
            onUndoDeleteGoal={handleUndoDeleteGoal}
            onDismissUndoGoal={() => setLastDeletedGoal(null)}
            onLoadStarterDemo={handleLoadStarterDemo}
          />
        )}

        {/* 5. SPLIT BILLS & FRIEND REIMBURSEMENTS TAB */}
        {activeTab === 'splits' && (
          <SplitBillsSummaryPanel
            transactions={transactions}
            onToggleParticipantSettled={handleToggleSplitParticipantSettled}
            onSettleAllForFriend={handleSettleAllForFriend}
            onOpenSplitModal={(tx) => setSplitModalTxId(tx.id)}
            onQuickCommitTransaction={handleCommitTransactions}
            onLoadStarterDemo={handleLoadStarterDemo}
          />
        )}
      </main>

      {/* Quiet Responsive Footer (hidden behind bottom nav padding on mobile, clean links on desktop) */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4 mb-14 md:mb-0 mt-8">
        <div className="max-w-[1400px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div>
            LedgerPulse · Phone &amp; Windows / Mac Cloud Sync + Local Vault Backup
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/api/release/windows.zip"
              download="LedgerPulse-Windows-v1.0.0.zip"
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors font-medium"
            >
              Windows Release (.zip)
            </a>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleLoadStarterDemo}
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              Load Demo Data
            </button>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleToggleDarkMode}
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              {isDarkMode ? 'Light Theme' : 'Dark Theme'}
            </button>
            <span aria-hidden="true">·</span>
            {confirmResetVault ? (
              <span className="inline-flex items-center gap-2">
                <span className="text-rose-600 dark:text-rose-400 font-medium">
                  Clear all records?
                </span>
                <button
                  type="button"
                  onClick={handleResetDemoData}
                  className="px-2 py-0.5 font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded"
                >
                  Confirm Reset
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmResetVault(false)}
                  className="hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmResetVault(true)}
                className="inline-flex items-center gap-1 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Ledger</span>
              </button>
            )}
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={handleExportCsv}
              className="hover:text-slate-900 dark:hover:text-slate-100 transition-colors"
            >
              Download CSV
            </button>
          </div>
        </div>
      </footer>

      {/* Modal for Receipt OCR, Phone Camera Capture, Demo Presets & Statement Ingestion */}
      <IngestSourceModal
        isOpen={isIngestModalOpen}
        onClose={() => setIsIngestModalOpen(false)}
        existingTransactions={transactions}
        onLoadStarterDemo={handleLoadStarterDemo}
        onCommitTransactions={handleCommitTransactions}
      />

      {/* Modal for Splitting a Purchase Bill with Friends */}
      <SplitBillModal
        transaction={activeSplitModalTx}
        onClose={() => setSplitModalTxId(null)}
        onSaveSplit={handleSaveTransactionSplit}
      />

      {/* Quick Add Floating Action Menu */}
      <QuickAddFloatingMenu
        existingTransactions={transactions}
        onQuickCommitTransaction={handleCommitTransactions}
        onOpenFullIngestModal={() => setIsIngestModalOpen(true)}
      />

      {/* Thumb-Friendly Mobile Bottom Navigation (<768px) */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        uncertainCount={uncertainCount}
        unpaidSplitsCount={unpaidSplitsCount}
      />

      {/* Offline Connectivity Notice */}
      <OfflineBanner />
    </div>
  );
}
