import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  ALL_SPENDING_CATEGORIES,
  BillSplitDetails,
  DataSource,
  SavingsGoal,
  SpendingCategory,
  SplitParticipant,
  SubscriptionFrequency,
  SubscriptionItem,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/finance';
import { DEFAULT_CATEGORY_BUDGETS } from '../utils/financeMetrics';

// Single shared Firebase App instance for both Firestore and Google Workspace Auth
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Google Workspace OAuth scopes (Least-privilege read-only Gmail receipt access — requested only when user connects Gmail)
export const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

export function isLegacyDemoRecordId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  return /^(?:demo-|tx-demo-|sub-demo-|goal-demo-|(?:tx|sub|goal)-\d{1,4}$)/i.test(trimmed);
}

export function isFalsePositiveGmailSpamRecord(tx: {
  id?: unknown;
  source?: unknown;
  merchant?: unknown;
  rawDescription?: unknown;
}): boolean {
  if (tx?.source !== 'Gmail') return false;
  const merchant = String(tx?.merchant || '').trim();
  const desc = String(tx?.rawDescription || '').trim();
  if (/^handshake(\s+ai)?$/i.test(merchant)) return true;
  // Earlier broken Fwd: extractions that set forwarder's own name as merchant or misread Total Savings
  if (/^makawan\s+pamornsut$/i.test(merchant) && /^fwd:/i.test(desc)) return true;
  if (
    /\b(linkedin|indeed|glassdoor|ziprecruiter)\b/i.test(merchant) &&
    /\b(applicant|job|hiring|career|role)\b/i.test(desc)
  ) {
    return true;
  }
  if (
    /(?:\bsees you as a top applicant\b|\bget paid \$\d+|\bspooky season is here\b|\bjoin our challenge\b|\bget \$\d+(?:\.\d{1,2})?\s*off\b|\b\d+%\s*off your (?:cart|order|next|purchase)\b|\boff your order of \$\d+|\bhow was your order\b|\brate your (?:order|experience)\b|\byou['’]?re eligible for \d+\s*months\b|\bcongratulations!\s*you['’]?re eligible\b|\bstarting at \$\d+(?:\.\d{2})?\s*lb\b|\bwant free tickets\b)/i.test(
      desc
    )
  ) {
    return true;
  }
  return false;
}

// In-memory OAuth access token cache ONLY (never persisted to localStorage or sessionStorage)
let isSigningIn = false;
let cachedAccessToken: string | null = null;

// Verbatim Blueprint Validation Constants (synced with firebase-blueprint.json & firestore.rules)
export const BLUEPRINT_LIMITS = {
  ID_PATTERN: /^[a-zA-Z0-9_\-]+$/,
  DATE_PATTERN: /^\d{4}-\d{2}-\d{2}$/,
  MAX_ID_LENGTH: 128,
  MAX_DEVICE_LENGTH: 80,
  MAX_TIME_LENGTH: 10,
  MAX_MERCHANT_LENGTH: 160,
  MAX_RAW_DESC_LENGTH: 600,
  MAX_PAYMENT_LENGTH: 120,
  MAX_REF_ID_LENGTH: 120,
  MAX_REASON_LENGTH: 400,
  MAX_BILLING_DAY_LENGTH: 60,
  MAX_GOAL_NAME_LENGTH: 120,
  MAX_GOAL_CATEGORY_LENGTH: 60,
  MAX_MERGED_SOURCES: 10,
  MAX_SUGGESTED_CATEGORIES: 5,
  MAX_SPLIT_PARTICIPANTS: 8,
  MAX_SPLIT_FRIEND_NAME_LENGTH: 80,
  MAX_SPLIT_ITEM_NOTE_LENGTH: 120,
  MAX_SPLIT_NOTE_LENGTH: 200,
} as const;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Startup connectivity check against Firestore server
async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Web Client';
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone/.test(ua)) return 'iPhone';
  if (/ipad/.test(ua)) return 'iPad';
  if (/android/.test(ua) && /mobile/.test(ua)) return 'Android Phone';
  if (/android/.test(ua)) return 'Android Tablet';
  if (/windows/.test(ua)) return 'Windows Computer';
  if (/macintosh|mac os x/.test(ua)) return 'Mac Computer';
  return 'Desktop Browser';
}

export function initWorkspaceAndCloudAuth(
  onUserChanged: (user: User | null, hasGmailToken: boolean) => void
): () => void {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (!cachedAccessToken && !isSigningIn) {
        cachedAccessToken = null;
      }
      onUserChanged(user, Boolean(cachedAccessToken));
    } else {
      cachedAccessToken = null;
      onUserChanged(null, false);
    }
  });
}

export async function signInWithGoogleAndGmail(
  requestGmailScope = false
): Promise<{
  user: User;
  accessToken: string | null;
}> {
  if (typeof window !== 'undefined' && window.location.hostname === '127.0.0.1') {
    const targetUrl = window.location.href.replace('://127.0.0.1', '://localhost');
    window.location.replace(targetUrl);
    throw new Error('Redirecting from 127.0.0.1 to localhost for Google OAuth compatibility...');
  }

  try {
    isSigningIn = true;
    const provider = new GoogleAuthProvider();
    if (requestGmailScope) {
      SCOPES.forEach((scope) => provider.addScope(scope));
      provider.setCustomParameters({
        prompt: 'consent select_account',
        include_granted_scopes: 'true',
      });
    } else {
      provider.setCustomParameters({
        prompt: 'select_account',
      });
    }

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (requestGmailScope) {
      cachedAccessToken = credential?.accessToken ?? null;
    }
    return {
      user: result.user,
      accessToken: requestGmailScope ? cachedAccessToken : null,
    };
  } finally {
    isSigningIn = false;
  }
}

export function getInMemoryGmailToken(): string | null {
  return cachedAccessToken;
}

export async function signOutFromCloud(): Promise<void> {
  await auth.signOut();
  cachedAccessToken = null;
}

// Defensive Sanitization Helpers Matching firebase-blueprint.json & firestore.rules
export function sanitizeDocId(rawId: string, fallbackPrefix = 'item'): string {
  const cleaned = String(rawId || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .slice(0, BLUEPRINT_LIMITS.MAX_ID_LENGTH);
  if (cleaned.length >= 1 && BLUEPRINT_LIMITS.ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now()}`;
}

function clampString(val: unknown, maxLen: number, fallback = ''): string {
  const str = typeof val === 'string' ? val.trim() : '';
  const resolved = str.length > 0 ? str : fallback;
  return resolved.slice(0, maxLen);
}

function sanitizeDateString(val: unknown, fallback = '2026-11-17'): string {
  if (typeof val === 'string' && BLUEPRINT_LIMITS.DATE_PATTERN.test(val.trim())) {
    return val.trim();
  }
  return fallback;
}

const ALLOWED_DATA_SOURCES: DataSource[] = [
  'Gmail',
  'Bank Statement',
  'Apple Pay',
  'Uploaded Statement',
  'Cash / Manual',
];

export function sanitizeCategoryBudgets(
  raw: Partial<Record<SpendingCategory, number>> | undefined
): Record<SpendingCategory, number> {
  const clean = {} as Record<SpendingCategory, number>;
  for (const cat of ALL_SPENDING_CATEGORIES) {
    const num = Number(raw?.[cat]);
    const fallback = DEFAULT_CATEGORY_BUDGETS[cat] ?? 150;
    clean[cat] = Number.isFinite(num)
      ? Math.min(1000000, Math.max(0, Math.round(num * 100) / 100))
      : fallback;
  }
  return clean;
}

function serializeTransactionPayload(uid: string, tx: Transaction) {
  const date = sanitizeDateString(tx.date, '2026-11-17');
  const category: SpendingCategory = ALL_SPENDING_CATEGORIES.includes(tx.category)
    ? tx.category
    : 'Other / Uncategorized';
  const clearingState: TransactionStatus =
    tx.status === 'pending' || tx.status === 'refunded' ? tx.status : 'posted';
  const transactionType: TransactionType =
    tx.transactionType === 'refund' ||
    tx.transactionType === 'income' ||
    tx.transactionType === 'transfer'
      ? tx.transactionType
      : 'purchase';
  const source: DataSource = ALLOWED_DATA_SOURCES.includes(tx.source)
    ? tx.source
    : 'Uploaded Statement';

  const rawMergedNames = Array.isArray(tx.mergedSources)
    ? tx.mergedSources
        .map((m) => (ALLOWED_DATA_SOURCES.includes(m.source) ? m.source : source))
        .slice(0, BLUEPRINT_LIMITS.MAX_MERGED_SOURCES)
    : [source];
  const mergedSourceNames = rawMergedNames.length > 0 ? rawMergedNames : [source];

  const primaryRef = clampString(
    tx.mergedSources?.[0]?.referenceId,
    BLUEPRINT_LIMITS.MAX_REF_ID_LENGTH,
    `REF-${sanitizeDocId(tx.id)}`
  );

  const suggestedCategories = Array.isArray(tx.suggestedCategories)
    ? tx.suggestedCategories
        .filter((c) => ALL_SPENDING_CATEGORIES.includes(c))
        .slice(0, BLUEPRINT_LIMITS.MAX_SUGGESTED_CATEGORIES)
    : [];

  const cleanAmount = Math.min(
    10000000,
    Math.max(0, Math.round((Math.abs(Number(tx.amount)) || 0) * 100) / 100)
  );

  // Sanitize optional Split Bill participants against Blueprint & Accounting Invariants
  const rawParticipants = Array.isArray(tx.splitBill?.participants)
    ? tx.splitBill!.participants.slice(0, BLUEPRINT_LIMITS.MAX_SPLIT_PARTICIPANTS)
    : [];

  let runningOwedCents = 0;
  let runningSettledCents = 0;
  const maxCents = Math.round(cleanAmount * 100);
  const splitParticipants: Array<{
    id: string;
    friendName: string;
    itemNote: string;
    amountOwed: number;
    status: 'owed' | 'settled';
    settledDate: string;
  }> = [];

  for (let i = 0; i < rawParticipants.length; i++) {
    const p = rawParticipants[i];
    const remainingCents = maxCents - runningOwedCents;
    if (remainingCents <= 0) break;
    const requestedCents = Math.round((Math.abs(Number(p.amountOwed)) || 0) * 100);
    const clampedCents = Math.min(remainingCents, requestedCents);
    if (clampedCents <= 0) continue;

    const status: 'owed' | 'settled' = p.status === 'settled' ? 'settled' : 'owed';
    runningOwedCents += clampedCents;
    if (status === 'settled') {
      runningSettledCents += clampedCents;
    }

    splitParticipants.push({
      id: sanitizeDocId(p.id || `sp-${i + 1}`, 'sp'),
      friendName: clampString(
        p.friendName,
        BLUEPRINT_LIMITS.MAX_SPLIT_FRIEND_NAME_LENGTH,
        'Friend'
      ),
      itemNote: p.itemNote
        ? p.itemNote.trim().slice(0, BLUEPRINT_LIMITS.MAX_SPLIT_ITEM_NOTE_LENGTH)
        : '',
      amountOwed: clampedCents / 100,
      status,
      settledDate:
        status === 'settled' && p.settledDate && BLUEPRINT_LIMITS.DATE_PATTERN.test(p.settledDate)
          ? p.settledDate
          : '',
    });
  }

  const splitOwedTotal = runningOwedCents / 100;
  const splitSettledTotal = Math.min(splitOwedTotal, runningSettledCents / 100);
  const isSplitBill = splitParticipants.length > 0 && splitOwedTotal > 0;
  const splitNote =
    isSplitBill && tx.splitBill?.note
      ? tx.splitBill.note.trim().slice(0, BLUEPRINT_LIMITS.MAX_SPLIT_NOTE_LENGTH)
      : '';

  return {
    ownerId: uid,
    date,
    time: clampString(tx.time || '12:00', BLUEPRINT_LIMITS.MAX_TIME_LENGTH, '12:00'),
    merchant: clampString(tx.merchant, BLUEPRINT_LIMITS.MAX_MERCHANT_LENGTH, 'Merchant'),
    rawDescription: clampString(
      tx.rawDescription || tx.merchant,
      BLUEPRINT_LIMITS.MAX_RAW_DESC_LENGTH,
      'Transaction Record'
    ),
    amount: cleanAmount,
    paymentMethod: clampString(
      tx.paymentMethod,
      BLUEPRINT_LIMITS.MAX_PAYMENT_LENGTH,
      'Card / Account'
    ),
    category,
    clearingState,
    transactionType,
    source,
    mergedSourceNames,
    primaryReferenceId: primaryRef,
    isDeduplicated: Boolean(tx.isDeduplicated || mergedSourceNames.length > 1),
    uncertainCategory: Boolean(tx.uncertainCategory),
    uncertaintyReason: tx.uncertaintyReason
      ? tx.uncertaintyReason.slice(0, BLUEPRINT_LIMITS.MAX_REASON_LENGTH)
      : '',
    suggestedCategories,
    anomalyNote: tx.anomalyNote
      ? tx.anomalyNote.slice(0, BLUEPRINT_LIMITS.MAX_REASON_LENGTH)
      : '',
    isRecurring: Boolean(tx.isRecurring),
    isSplitBill,
    splitNote,
    splitOwedTotal,
    splitSettledTotal,
    splitParticipants,
    monthKey: date.startsWith('2026-10') ? '2026-10' : '2026-11',
    archived: false,
  };
}

function deserializeTransactionDoc(id: string, data: Record<string, any>): Transaction {
  const source: DataSource = ALLOWED_DATA_SOURCES.includes(data.source)
    ? data.source
    : 'Uploaded Statement';
  const status: TransactionStatus =
    data.clearingState === 'pending' || data.clearingState === 'refunded'
      ? data.clearingState
      : 'posted';
  const sourceNames: DataSource[] = Array.isArray(data.mergedSourceNames)
    ? data.mergedSourceNames.filter((s: any) => ALLOWED_DATA_SOURCES.includes(s))
    : [source];
  const resolvedNames = sourceNames.length > 0 ? sourceNames : [source];

  let splitBill: BillSplitDetails | undefined;
  if (
    data.isSplitBill &&
    Array.isArray(data.splitParticipants) &&
    data.splitParticipants.length > 0
  ) {
    const parsedParticipants: SplitParticipant[] = data.splitParticipants
      .filter((p: any) => p && typeof p === 'object' && Number(p.amountOwed) > 0)
      .map((p: any, idx: number) => ({
        id: String(p.id || `sp-${idx + 1}`),
        friendName: String(p.friendName || 'Friend'),
        itemNote:
          typeof p.itemNote === 'string' && p.itemNote.length > 0 ? p.itemNote : undefined,
        amountOwed: Number(p.amountOwed) || 0,
        status: p.status === 'settled' ? 'settled' : 'owed',
        settledDate:
          typeof p.settledDate === 'string' && p.settledDate.length > 0
            ? p.settledDate
            : undefined,
      }));
    if (parsedParticipants.length > 0) {
      splitBill = {
        participants: parsedParticipants,
        note:
          typeof data.splitNote === 'string' && data.splitNote.length > 0
            ? data.splitNote
            : undefined,
      };
    }
  }

  return {
    id,
    date: sanitizeDateString(data.date, '2026-11-17'),
    time: typeof data.time === 'string' && data.time ? data.time : undefined,
    merchant: String(data.merchant || 'Merchant'),
    rawDescription: String(data.rawDescription || data.merchant || ''),
    amount: Number(data.amount) || 0,
    paymentMethod: String(data.paymentMethod || 'Card / Account'),
    category: ALL_SPENDING_CATEGORIES.includes(data.category)
      ? data.category
      : 'Other / Uncategorized',
    status,
    transactionType:
      data.transactionType === 'refund' ||
      data.transactionType === 'income' ||
      data.transactionType === 'transfer'
        ? data.transactionType
        : 'purchase',
    source,
    isDeduplicated: Boolean(data.isDeduplicated || resolvedNames.length > 1),
    mergedSources: resolvedNames.map((srcName, idx) => ({
      source: srcName,
      referenceId:
        idx === 0
          ? String(data.primaryReferenceId || `SYNC-${id.slice(-5)}`)
          : `MERGE-${idx + 1}`,
      capturedAt: `${sanitizeDateString(data.date)} ${data.time || '12:00'}`,
      rawDescriptor: String(data.rawDescription || data.merchant || ''),
      statusAtCapture: status,
    })),
    uncertainCategory: Boolean(data.uncertainCategory),
    uncertaintyReason:
      typeof data.uncertaintyReason === 'string' && data.uncertaintyReason.length > 0
        ? data.uncertaintyReason
        : undefined,
    suggestedCategories: Array.isArray(data.suggestedCategories)
      ? data.suggestedCategories.filter((c: any) => ALL_SPENDING_CATEGORIES.includes(c))
      : undefined,
    anomalyNote:
      typeof data.anomalyNote === 'string' && data.anomalyNote.length > 0
        ? data.anomalyNote
        : undefined,
    isRecurring: Boolean(data.isRecurring),
    splitBill,
    monthKey: data.monthKey === '2026-10' ? '2026-10' : '2026-11',
  };
}

function serializeSubscriptionPayload(uid: string, sub: SubscriptionItem) {
  const allowedFreq: SubscriptionFrequency[] = [
    'Monthly subscription',
    'Annual subscription',
    'Membership',
    'Recurring bill',
  ];
  const allowedStates: SubscriptionItem['status'][] = [
    'Active',
    'Unused / Review',
    'Price Increased',
    'Canceled',
  ];

  return {
    ownerId: uid,
    merchant: clampString(sub.merchant, BLUEPRINT_LIMITS.MAX_MERCHANT_LENGTH, 'Subscription'),
    category: ALL_SPENDING_CATEGORIES.includes(sub.category) ? sub.category : 'Subscriptions',
    amount: Math.min(1000000, Math.max(0, Math.round((Number(sub.amount) || 0) * 100) / 100)),
    previousAmount: Math.min(
      1000000,
      Math.max(0, Math.round((Number(sub.previousAmount) || 0) * 100) / 100)
    ),
    inactiveMonths: Math.min(120, Math.max(0, Math.trunc(Number(sub.inactiveMonths) || 0))),
    alertDismissed: Boolean(sub.alertDismissed),
    frequency: allowedFreq.includes(sub.frequency) ? sub.frequency : 'Monthly subscription',
    billingDayOrDate: clampString(
      sub.billingDayOrDate,
      BLUEPRINT_LIMITS.MAX_BILLING_DAY_LENGTH,
      'Monthly'
    ),
    paymentMethod: clampString(
      sub.paymentMethod,
      BLUEPRINT_LIMITS.MAX_PAYMENT_LENGTH,
      'Card / Account'
    ),
    source: ALLOWED_DATA_SOURCES.includes(sub.source) ? sub.source : 'Gmail',
    estimatedAnnualCost: Math.min(
      12000000,
      Math.max(0, Math.round((Number(sub.estimatedAnnualCost) || 0) * 100) / 100)
    ),
    planState: allowedStates.includes(sub.status) ? sub.status : 'Active',
    usageNote: sub.usageNote ? sub.usageNote.slice(0, BLUEPRINT_LIMITS.MAX_REASON_LENGTH) : '',
    lastChargedDate: sanitizeDateString(sub.lastChargedDate, '2026-11-01'),
    archived: false,
  };
}

function deserializeSubscriptionDoc(id: string, data: Record<string, any>): SubscriptionItem {
  return {
    id,
    merchant: String(data.merchant || 'Subscription'),
    category: ALL_SPENDING_CATEGORIES.includes(data.category) ? data.category : 'Subscriptions',
    amount: Number(data.amount) || 0,
    previousAmount: Number(data.previousAmount) > 0 ? Number(data.previousAmount) : undefined,
    inactiveMonths: Number(data.inactiveMonths) > 0 ? Number(data.inactiveMonths) : undefined,
    alertDismissed: Boolean(data.alertDismissed),
    frequency: data.frequency || 'Monthly subscription',
    billingDayOrDate: String(data.billingDayOrDate || 'Monthly'),
    paymentMethod: String(data.paymentMethod || 'Card'),
    source: ALLOWED_DATA_SOURCES.includes(data.source) ? data.source : 'Gmail',
    estimatedAnnualCost: Number(data.estimatedAnnualCost) || 0,
    status:
      data.planState === 'Unused / Review' ||
      data.planState === 'Price Increased' ||
      data.planState === 'Canceled'
        ? data.planState
        : 'Active',
    usageNote:
      typeof data.usageNote === 'string' && data.usageNote.length > 0
        ? data.usageNote
        : undefined,
    lastChargedDate: sanitizeDateString(data.lastChargedDate, '2026-11-01'),
  };
}

function serializeSavingsGoalPayload(uid: string, goal: SavingsGoal) {
  const priority: SavingsGoal['priority'] =
    goal.priority === 'High' || goal.priority === 'Medium' || goal.priority === 'Flexible'
      ? goal.priority
      : 'Medium';

  return {
    ownerId: uid,
    name: clampString(goal.name, BLUEPRINT_LIMITS.MAX_GOAL_NAME_LENGTH, 'Savings Goal'),
    categoryLabel: clampString(
      goal.categoryLabel,
      BLUEPRINT_LIMITS.MAX_GOAL_CATEGORY_LENGTH,
      'General'
    ),
    targetAmount: Math.min(
      100000000,
      Math.max(0, Math.round((Number(goal.targetAmount) || 0) * 100) / 100)
    ),
    currentSaved: Math.min(
      100000000,
      Math.max(0, Math.round((Number(goal.currentSaved) || 0) * 100) / 100)
    ),
    monthlyContribution: Math.min(
      10000000,
      Math.max(0, Math.round((Number(goal.monthlyContribution) || 0) * 100) / 100)
    ),
    targetDate: sanitizeDateString(goal.targetDate, '2027-06-01'),
    linkedAccount: clampString(
      goal.linkedAccount,
      BLUEPRINT_LIMITS.MAX_PAYMENT_LENGTH,
      'High-Yield Savings'
    ),
    priority,
    archived: false,
  };
}

function deserializeSavingsGoalDoc(id: string, data: Record<string, any>): SavingsGoal {
  return {
    id,
    name: String(data.name || 'Savings Goal'),
    categoryLabel: String(data.categoryLabel || 'General'),
    targetAmount: Number(data.targetAmount) || 0,
    currentSaved: Number(data.currentSaved) || 0,
    monthlyContribution: Number(data.monthlyContribution) || 0,
    targetDate: sanitizeDateString(data.targetDate, '2027-06-01'),
    linkedAccount: String(data.linkedAccount || 'Savings Account'),
    priority:
      data.priority === 'High' || data.priority === 'Medium' || data.priority === 'Flexible'
        ? data.priority
        : 'Medium',
  };
}

// Ensure parent /ledgers/{uid} workspace exists BEFORE subcollection listeners or writes
export async function ensureCloudLedgerWorkspace(
  uid: string,
  initialBudgets: Record<SpendingCategory, number>
): Promise<{ isNewWorkspace: boolean }> {
  const workspacePath = `ledgers/${uid}`;
  const workspaceRef = doc(db, 'ledgers', uid);
  try {
    const snap = await getDoc(workspaceRef);
    if (!snap.exists()) {
      await setDoc(workspaceRef, {
        ownerId: uid,
        categoryBudgets: sanitizeCategoryBudgets(initialBudgets),
        lastSyncedDevice: clampString(detectDeviceLabel(), BLUEPRINT_LIMITS.MAX_DEVICE_LENGTH, 'Web'),
        archived: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return { isNewWorkspace: true };
    }
    return { isNewWorkspace: false };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, workspacePath);
  }
}

export interface CloudLedgerSnapshotCallbacks {
  onWorkspaceMetadata: (meta: {
    categoryBudgets: Record<SpendingCategory, number>;
    lastSyncedDevice: string;
    updatedAtIso: string | null;
  }) => void;
  onTransactions: (items: Transaction[], ids: Set<string>) => void;
  onSubscriptions: (items: SubscriptionItem[], ids: Set<string>) => void;
  onSavingsGoals: (items: SavingsGoal[], ids: Set<string>) => void;
}

export function subscribeToCloudLedger(
  uid: string,
  callbacks: CloudLedgerSnapshotCallbacks
): () => void {
  const workspacePath = `ledgers/${uid}`;
  const txPath = `ledgers/${uid}/transactions`;
  const subPath = `ledgers/${uid}/subscriptions`;
  const goalPath = `ledgers/${uid}/savingsGoals`;

  const unsubWorkspace = onSnapshot(
    doc(db, 'ledgers', uid),
    (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      const updatedTs = data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : null;
      callbacks.onWorkspaceMetadata({
        categoryBudgets: sanitizeCategoryBudgets(data.categoryBudgets),
        lastSyncedDevice: String(data.lastSyncedDevice || 'Connected Device'),
        updatedAtIso: updatedTs,
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, workspacePath);
    }
  );

  const unsubTx = onSnapshot(
    query(collection(db, 'ledgers', uid, 'transactions'), where('ownerId', '==', uid)),
    (snap) => {
      const items: Transaction[] = [];
      const ids = new Set<string>();
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        if (isLegacyDemoRecordId(docSnap.id) || isFalsePositiveGmailSpamRecord(data)) {
          void deleteDoc(docSnap.ref).catch(() => {});
          return;
        }
        if (data.archived) return;
        ids.add(docSnap.id);
        items.push(deserializeTransactionDoc(docSnap.id, data));
      });
      items.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return (b.time || '').localeCompare(a.time || '');
      });
      callbacks.onTransactions(items, ids);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, txPath);
    }
  );

  const unsubSub = onSnapshot(
    query(collection(db, 'ledgers', uid, 'subscriptions'), where('ownerId', '==', uid)),
    (snap) => {
      const items: SubscriptionItem[] = [];
      const ids = new Set<string>();
      snap.forEach((docSnap) => {
        if (isLegacyDemoRecordId(docSnap.id)) {
          void deleteDoc(docSnap.ref).catch(() => {});
          return;
        }
        const data = docSnap.data();
        if (data.archived) return;
        ids.add(docSnap.id);
        items.push(deserializeSubscriptionDoc(docSnap.id, data));
      });
      items.sort((a, b) => b.amount - a.amount);
      callbacks.onSubscriptions(items, ids);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, subPath);
    }
  );

  const unsubGoals = onSnapshot(
    query(collection(db, 'ledgers', uid, 'savingsGoals'), where('ownerId', '==', uid)),
    (snap) => {
      const items: SavingsGoal[] = [];
      const ids = new Set<string>();
      snap.forEach((docSnap) => {
        if (isLegacyDemoRecordId(docSnap.id)) {
          void deleteDoc(docSnap.ref).catch(() => {});
          return;
        }
        const data = docSnap.data();
        if (data.archived) return;
        ids.add(docSnap.id);
        items.push(deserializeSavingsGoalDoc(docSnap.id, data));
      });
      callbacks.onSavingsGoals(items, ids);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, goalPath);
    }
  );

  return () => {
    unsubWorkspace();
    unsubTx();
    unsubSub();
    unsubGoals();
  };
}

async function touchWorkspaceDeviceStamp(uid: string): Promise<void> {
  const workspacePath = `ledgers/${uid}`;
  try {
    await updateDoc(doc(db, 'ledgers', uid), {
      lastSyncedDevice: clampString(detectDeviceLabel(), BLUEPRINT_LIMITS.MAX_DEVICE_LENGTH, 'Web'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, workspacePath);
  }
}

export async function syncUpsertTransactionsToCloud(
  uid: string,
  transactions: Transaction[],
  existingCloudIds: Set<string>
): Promise<void> {
  for (const tx of transactions) {
    const cleanId = sanitizeDocId(tx.id, 'tx');
    const path = `ledgers/${uid}/transactions/${cleanId}`;
    const payload = serializeTransactionPayload(uid, { ...tx, id: cleanId });
    try {
      if (existingCloudIds.has(cleanId)) {
        const { ownerId: _o, archived: _a, ...mutableFields } = payload;
        await updateDoc(doc(db, 'ledgers', uid, 'transactions', cleanId), {
          ...mutableFields,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'ledgers', uid, 'transactions', cleanId), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(
        error,
        existingCloudIds.has(cleanId) ? OperationType.UPDATE : OperationType.CREATE,
        path
      );
    }
  }
  if (transactions.length > 0) {
    await touchWorkspaceDeviceStamp(uid);
  }
}

export async function syncDeleteTransactionsFromCloud(
  uid: string,
  ids: string[]
): Promise<void> {
  for (const rawId of ids) {
    const cleanId = sanitizeDocId(rawId, 'tx');
    const path = `ledgers/${uid}/transactions/${cleanId}`;
    try {
      await deleteDoc(doc(db, 'ledgers', uid, 'transactions', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
  if (ids.length > 0) {
    await touchWorkspaceDeviceStamp(uid);
  }
}

export async function syncUpsertSubscriptionsToCloud(
  uid: string,
  subscriptions: SubscriptionItem[],
  existingCloudIds: Set<string>
): Promise<void> {
  for (const sub of subscriptions) {
    const cleanId = sanitizeDocId(sub.id, 'sub');
    const path = `ledgers/${uid}/subscriptions/${cleanId}`;
    const payload = serializeSubscriptionPayload(uid, { ...sub, id: cleanId });
    try {
      if (existingCloudIds.has(cleanId)) {
        const { ownerId: _o, archived: _a, ...mutableFields } = payload;
        await updateDoc(doc(db, 'ledgers', uid, 'subscriptions', cleanId), {
          ...mutableFields,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'ledgers', uid, 'subscriptions', cleanId), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(
        error,
        existingCloudIds.has(cleanId) ? OperationType.UPDATE : OperationType.CREATE,
        path
      );
    }
  }
  if (subscriptions.length > 0) {
    await touchWorkspaceDeviceStamp(uid);
  }
}

export async function syncDeleteSubscriptionsFromCloud(
  uid: string,
  ids: string[]
): Promise<void> {
  for (const rawId of ids) {
    const cleanId = sanitizeDocId(rawId, 'sub');
    const path = `ledgers/${uid}/subscriptions/${cleanId}`;
    try {
      await deleteDoc(doc(db, 'ledgers', uid, 'subscriptions', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}

export async function syncUpsertSavingsGoalsToCloud(
  uid: string,
  goals: SavingsGoal[],
  existingCloudIds: Set<string>
): Promise<void> {
  for (const goal of goals) {
    const cleanId = sanitizeDocId(goal.id, 'goal');
    const path = `ledgers/${uid}/savingsGoals/${cleanId}`;
    const payload = serializeSavingsGoalPayload(uid, { ...goal, id: cleanId });
    try {
      if (existingCloudIds.has(cleanId)) {
        const { ownerId: _o, archived: _a, ...mutableFields } = payload;
        await updateDoc(doc(db, 'ledgers', uid, 'savingsGoals', cleanId), {
          ...mutableFields,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(doc(db, 'ledgers', uid, 'savingsGoals', cleanId), {
          ...payload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (error) {
      handleFirestoreError(
        error,
        existingCloudIds.has(cleanId) ? OperationType.UPDATE : OperationType.CREATE,
        path
      );
    }
  }
  if (goals.length > 0) {
    await touchWorkspaceDeviceStamp(uid);
  }
}

export async function syncDeleteSavingsGoalsFromCloud(
  uid: string,
  ids: string[]
): Promise<void> {
  for (const rawId of ids) {
    const cleanId = sanitizeDocId(rawId, 'goal');
    const path = `ledgers/${uid}/savingsGoals/${cleanId}`;
    try {
      await deleteDoc(doc(db, 'ledgers', uid, 'savingsGoals', cleanId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  }
}

export async function syncUpdateCategoryBudgetsInCloud(
  uid: string,
  budgets: Record<SpendingCategory, number>
): Promise<void> {
  const path = `ledgers/${uid}`;
  try {
    await updateDoc(doc(db, 'ledgers', uid), {
      categoryBudgets: sanitizeCategoryBudgets(budgets),
      lastSyncedDevice: clampString(detectDeviceLabel(), BLUEPRINT_LIMITS.MAX_DEVICE_LENGTH, 'Web'),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ============================================================================
// Client-Side Read-Only Gmail API Receipt Scanner (gmail.googleapis.com)
// ============================================================================

function decodeBase64Url(input: string): string {
  try {
    const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4;
    const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return '';
  }
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(tr|p|div|li|h[1-6]|br|table|section)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&apos;|&rsquo;|&#8217;|&lsquo;|&#8216;/gi, "'")
    .replace(/&quot;|&ldquo;|&#8220;|&rdquo;|&#8221;/gi, '"')
    .replace(/&mdash;|&#8212;|&ndash;|&#8211;/gi, ' - ')
    .replace(/&reg;|&#174;/gi, '')
    .replace(/&#36;/g, '$')
    .replace(/&#3647;/g, '฿')
    .replace(/&pound;|&#163;/gi, '£')
    .replace(/&euro;|&#8364;/gi, '€')
    .replace(/https?:\/\/\S{35,}/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function cleanPlainEmailText(text: string): string {
  return text
    .replace(/https?:\/\/\S{35,}/gi, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

function collectMimeBodies(payload: any, plainParts: string[], htmlParts: string[]): void {
  if (!payload) return;
  const mime = String(payload.mimeType || '').toLowerCase();
  if (mime === 'text/plain' && payload.body?.data) {
    const decoded = cleanPlainEmailText(decodeBase64Url(payload.body.data));
    if (decoded) plainParts.push(decoded);
  } else if (mime === 'text/html' && payload.body?.data) {
    const decoded = stripHtmlTags(decodeBase64Url(payload.body.data));
    if (decoded) htmlParts.push(decoded);
  }
  if (Array.isArray(payload.parts)) {
    for (const part of payload.parts) {
      collectMimeBodies(part, plainParts, htmlParts);
    }
  }
}

function hasReceiptCurrencySignal(text: string): boolean {
  return /(?:[$£€฿]\s*\d+(?:[.,]\d{1,2})?|\b\d+(?:[.,]\d{1,2})?\s*(?:THB|USD|GBP|EUR|CAD|AUD|SGD|JPY|baht|บาท)\b|\b(?:THB|USD|GBP|EUR|CAD|AUD|SGD|JPY)\s*\d+(?:[.,]\d{1,2})?|\b(?:mobile\s+order\s+receipt|check-in#|subtotal|order\s+total|total\s+charged|amount\s+paid|grand\s+total|you\s+sent)\b|ยอดรวม|รวมทั้งสิ้น)/i.test(
    text
  );
}

function extractReceiptFocusedExcerpt(text: string, maxChars = 9000): string {
  if (text.length <= maxChars) return text;

  // Locate where receipt line items, Order#, Subtotal, and Total live so corporate legal footers never push out the middle receipt table
  const anchorRegex =
    /\b(mobile\s+order\s+receipt|check-in#|order#\s*[a-z0-9-]+|subtotal|order\s+total|grand\s+total|total\s+savings|total\s+charged|amount\s+paid|you\s+sent|(?<!sub)total)\b|ยอดรวม|รวมทั้งสิ้น/gi;
  const matches = Array.from(text.matchAll(anchorRegex));

  if (matches.length > 0) {
    const firstIdx = matches[0].index ?? 0;
    const lastIdx = matches[matches.length - 1].index ?? firstIdx;
    const windowStart = Math.max(0, firstIdx - 900);
    const windowEnd = Math.min(text.length, Math.max(windowStart + 4800, lastIdx + 1200));
    const headEnd = Math.min(2600, windowStart);
    if (headEnd > 200) {
      return `${text.slice(0, headEnd)}\n${text.slice(windowStart, windowEnd)}`.slice(0, maxChars);
    }
    return text.slice(windowStart, windowStart + maxChars);
  }

  const headChars = Math.floor(maxChars * 0.65);
  const tailChars = maxChars - headChars - 25;
  return `${text.slice(0, headChars)}\n...[footer omitted]...\n${text.slice(-tailChars)}`;
}

function extractReadableMessageBody(payload: any): string {
  if (!payload) return '';
  const plainParts: string[] = [];
  const htmlParts: string[] = [];
  collectMimeBodies(payload, plainParts, htmlParts);

  const plainJoined = plainParts.join('\n').trim();
  const htmlJoined = htmlParts.join('\n').trim();

  // Retail & fast-food emails (McDonald's, Wonder, Wise, GrabFood, Uber Eats, DoorDash) often place
  // a short stub in text/plain while the itemized receipt & Total ($0.00 or paid) live in text/html.
  if (
    htmlJoined &&
    (!plainJoined ||
      (!hasReceiptCurrencySignal(plainJoined) && hasReceiptCurrencySignal(htmlJoined)) ||
      htmlJoined.length > plainJoined.length * 1.5)
  ) {
    return extractReceiptFocusedExcerpt(htmlJoined);
  }
  if (plainJoined) {
    return extractReceiptFocusedExcerpt(plainJoined);
  }
  return extractReceiptFocusedExcerpt(htmlJoined);
}

export interface GmailScanResult {
  needsGmailAuth?: boolean;
  messagesScanned: number;
  extractedTransactions: any[];
  summaryNote: string;
}

export async function scanGmailReceiptsWithPermission(options: {
  daysWindow: 7 | 30 | 90 | 365;
  maxMessages?: number;
  merchantFilter?: string;
  existingTransactions: Transaction[];
}): Promise<GmailScanResult> {
  const token = cachedAccessToken;
  if (!token) {
    return {
      needsGmailAuth: true,
      messagesScanned: 0,
      extractedTransactions: [],
      summaryNote: 'Sign in with Google to grant read-only Gmail receipt access.',
    };
  }

  const maxResults = options.maxMessages ?? 40;
  const customMerchant = (options.merchantFilter || '').trim();
  const antiSpamExclusions =
    '-from:handshake -from:joinhandshake.com -from:linkedin.com -from:indeed.com -from:glassdoor.com -from:ziprecruiter.com -subject:("top applicant" OR "how was your" OR "off your order" OR "off your cart" OR "% off" OR "eligible for" OR "join our challenge" OR "get paid $" OR "starting at $" OR "want free tickets")';
  const gmailQuery = customMerchant
    ? `newer_than:${options.daysWindow}d (${customMerchant}) ${antiSpamExclusions}`
    : `newer_than:${options.daysWindow}d ("mobile order receipt" OR "thanks for placing a mobile order" OR "here's your receipt" OR "order is confirmed" OR "order confirmation" OR "order summary" OR "order total" OR "check-in#" OR "thank you for placing your mobile order" OR "thank you for your order" OR "thanks for ordering" OR "payment received" OR "amount paid" OR "total charged" OR "payment confirmation" OR "you sent" OR "subscription renewal" OR "billing statement" OR receipt OR invoice OR from:mcdonalds.com OR "mcdonald's" OR from:wise.com OR from:transferwise.com OR from:wonder.com OR from:grab.com OR "grabfood" OR foodpanda OR "line man" OR "uber eats" OR doordash OR grubhub OR deliveroo OR "just eat" OR "ใบเสร็จ" OR "คำสั่งซื้อ" OR "ยอดรวม") ${antiSpamExclusions}`;

  const listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(
    gmailQuery
  )}`;

  const listRes = await fetch(listUrl, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (listRes.status === 401 || listRes.status === 403) {
    const errBody = await listRes.json().catch(() => ({}));
    const apiReason = String(errBody?.error?.message || '');
    cachedAccessToken = null;
    return {
      needsGmailAuth: true,
      messagesScanned: 0,
      extractedTransactions: [],
      summaryNote:
        listRes.status === 403
          ? `Gmail read permission was not granted (${apiReason || 'check the Gmail permission box in the Google popup'}). Click "Connect & Scan Gmail" and check "View your email messages and settings".`
          : 'Gmail session expired — reconnect Gmail to scan receipts.',
    };
  }

  if (!listRes.ok) {
    const errBody = await listRes.json().catch(() => ({}));
    throw new Error(errBody?.error?.message || 'Failed to list messages from Gmail API.');
  }

  const listData = await listRes.json();
  const messageRefs: Array<{ id: string }> = Array.isArray(listData.messages)
    ? listData.messages.slice(0, maxResults)
    : [];

  if (messageRefs.length === 0) {
    return {
      messagesScanned: 0,
      extractedTransactions: [],
      summaryNote: customMerchant
        ? `Scanned Gmail (last ${options.daysWindow} days) for "${customMerchant}": no matching emails found. Check if the order went to a different email or increase the day range.`
        : `Scanned Gmail (last ${options.daysWindow} days): no matching receipt or order emails found.`,
    };
  }

  const emailBlocks: string[] = [];

  for (let i = 0; i < messageRefs.length; i++) {
    const msgId = messageRefs[i].id;
    const detailRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(
        msgId
      )}?format=full`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );
    if (!detailRes.ok) continue;
    const msg = await detailRes.json();
    const headers: Array<{ name: string; value: string }> = msg?.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

    const subject = getHeader('Subject');
    const from = getHeader('From');
    const dateHdr = getHeader('Date');
    const snippet = String(msg.snippet || '');
    const bodyText = extractReadableMessageBody(msg.payload);

    emailBlocks.push(
      [
        `=== GMAIL MESSAGE ${i + 1} (ID: ${msgId}) ===`,
        `From: ${from}`,
        `Subject: ${subject}`,
        `Date: ${dateHdr}`,
        `Snippet: ${snippet}`,
        `Body Excerpt:\n${bodyText || snippet}`,
      ].join('\n')
    );
  }

  if (emailBlocks.length === 0) {
    return {
      messagesScanned: 0,
      extractedTransactions: [],
      summaryNote: 'No readable receipt email bodies were returned from Gmail.',
    };
  }

  const parseRes = await fetch('/api/finance/parse-source', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      rawText: emailBlocks.join('\n\n'),
      sourceType: 'Gmail',
      existingTransactions: options.existingTransactions,
    }),
  });

  const parsedData = await parseRes.json();
  if (!parseRes.ok) {
    throw new Error(parsedData?.error || 'Failed to extract transactions from Gmail messages.');
  }

  return {
    messagesScanned: emailBlocks.length,
    extractedTransactions: Array.isArray(parsedData.extractedTransactions)
      ? parsedData.extractedTransactions
      : [],
    summaryNote:
      parsedData.summaryNote ||
      `Scanned ${emailBlocks.length} Gmail message(s) for receipts, food orders, and bills.`,
  };
}
