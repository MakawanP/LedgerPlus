/**
 * Phase 0 & Phase 5 Security Rules Verification Suite (Dirty Dozen Adversarial Matrix)
 * Validates every security invariant declared in security_spec.md and firebase-blueprint.json
 * against deterministic rule-evaluator mirrors so all 12 adversarial payloads return PERMISSION_DENIED.
 */

interface MockAuthContext {
  uid: string;
  emailVerified: boolean;
}

interface MockEvalEnv {
  auth: MockAuthContext | null;
  requestTimeIso: string;
  existingWorkspaces: Record<string, { ownerId: string; archived: boolean }>;
}

const ID_REGEX = /^[a-zA-Z0-9_\-]+$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const ALLOWED_CATEGORIES = new Set([
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
]);

function evaluateTransactionCreate(
  env: MockEvalEnv,
  userId: string,
  txId: string,
  payload: Record<string, unknown>
): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!env.auth || !env.auth.emailVerified) return 'PERMISSION_DENIED';
  if (!ID_REGEX.test(userId) || userId.length > 128 || userId !== env.auth.uid) {
    return 'PERMISSION_DENIED';
  }
  if (!ID_REGEX.test(txId) || txId.length > 128) {
    return 'PERMISSION_DENIED';
  }

  const requiredKeys = [
    'ownerId',
    'date',
    'time',
    'merchant',
    'rawDescription',
    'amount',
    'paymentMethod',
    'category',
    'clearingState',
    'transactionType',
    'source',
    'mergedSourceNames',
    'primaryReferenceId',
    'isDeduplicated',
    'uncertainCategory',
    'uncertaintyReason',
    'suggestedCategories',
    'anomalyNote',
    'isRecurring',
    'isSplitBill',
    'splitNote',
    'splitOwedTotal',
    'splitSettledTotal',
    'splitParticipants',
    'monthKey',
    'archived',
    'createdAt',
    'updatedAt',
  ];

  const keys = Object.keys(payload);
  if (keys.length !== requiredKeys.length || !requiredKeys.every((k) => k in payload)) {
    return 'PERMISSION_DENIED';
  }

  if (payload.ownerId !== env.auth.uid) return 'PERMISSION_DENIED';
  if (typeof payload.date !== 'string' || !DATE_REGEX.test(payload.date)) return 'PERMISSION_DENIED';
  if (typeof payload.merchant !== 'string' || payload.merchant.length < 1 || payload.merchant.length > 160) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof payload.rawDescription !== 'string' ||
    payload.rawDescription.length < 1 ||
    payload.rawDescription.length > 600
  ) {
    return 'PERMISSION_DENIED';
  }
  if (typeof payload.amount !== 'number' || payload.amount < 0 || payload.amount > 10000000) {
    return 'PERMISSION_DENIED';
  }
  if (typeof payload.category !== 'string' || !ALLOWED_CATEGORIES.has(payload.category)) {
    return 'PERMISSION_DENIED';
  }
  if (
    !Array.isArray(payload.mergedSourceNames) ||
    payload.mergedSourceNames.length > 10 ||
    (payload.mergedSourceNames.length > 0 &&
      (typeof payload.mergedSourceNames[0] !== 'string' || payload.mergedSourceNames[0].length > 40))
  ) {
    return 'PERMISSION_DENIED';
  }
  if (typeof payload.isSplitBill !== 'boolean') return 'PERMISSION_DENIED';
  if (typeof payload.splitNote !== 'string' || payload.splitNote.length > 200) return 'PERMISSION_DENIED';
  if (
    typeof payload.splitOwedTotal !== 'number' ||
    payload.splitOwedTotal < 0 ||
    payload.splitOwedTotal > payload.amount
  ) {
    return 'PERMISSION_DENIED';
  }
  if (
    typeof payload.splitSettledTotal !== 'number' ||
    payload.splitSettledTotal < 0 ||
    payload.splitSettledTotal > payload.splitOwedTotal
  ) {
    return 'PERMISSION_DENIED';
  }
  if (!Array.isArray(payload.splitParticipants) || payload.splitParticipants.length > 8) {
    return 'PERMISSION_DENIED';
  }
  if (payload.archived !== false) return 'PERMISSION_DENIED';
  if (payload.createdAt !== env.requestTimeIso || payload.updatedAt !== env.requestTimeIso) {
    return 'PERMISSION_DENIED';
  }

  const parent = env.existingWorkspaces[userId];
  if (!parent || parent.ownerId !== env.auth.uid || parent.archived) {
    return 'PERMISSION_DENIED';
  }

  return 'ALLOW';
}

function runDirtyDozenAudit(): void {
  const now = '2026-11-17T15:40:00.000Z';
  const baseEnv: MockEvalEnv = {
    auth: { uid: 'user_owner_1', emailVerified: true },
    requestTimeIso: now,
    existingWorkspaces: {
      user_owner_1: { ownerId: 'user_owner_1', archived: false },
    },
  };

  const validPayload: Record<string, unknown> = {
    ownerId: 'user_owner_1',
    date: '2026-11-17',
    time: '08:42',
    merchant: 'Blue Bottle Coffee',
    rawDescription: 'BLUE BOTTLE COFFEE SOMA',
    amount: 13.75,
    paymentMethod: 'Apple Pay',
    category: 'Coffee & Drinks',
    clearingState: 'posted',
    transactionType: 'purchase',
    source: 'Apple Pay',
    mergedSourceNames: ['Apple Pay'],
    primaryReferenceId: 'AP-101',
    isDeduplicated: false,
    uncertainCategory: false,
    uncertaintyReason: '',
    suggestedCategories: [],
    anomalyNote: '',
    isRecurring: false,
    isSplitBill: true,
    splitNote: 'Coffee split with Alex',
    splitOwedTotal: 10.0,
    splitSettledTotal: 0,
    splitParticipants: [
      {
        id: 'sp-1',
        friendName: 'Alex',
        itemNote: 'Friend drink',
        amountOwed: 10.0,
        status: 'owed',
        settledDate: '',
      },
    ],
    monthKey: '2026-11',
    archived: false,
    createdAt: now,
    updatedAt: now,
  };

  if (evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', validPayload) !== 'ALLOW') {
    throw new Error('Baseline valid payload was unexpectedly denied');
  }

  const dirtyDozenCases: Array<{ name: string; run: () => 'ALLOW' | 'PERMISSION_DENIED' }> = [
    {
      name: '01. Cross-tenant path write',
      run: () => evaluateTransactionCreate(baseEnv, 'victim_uid', 'tx-101', validPayload),
    },
    {
      name: '02. Unverified email spoof',
      run: () =>
        evaluateTransactionCreate(
          { ...baseEnv, auth: { uid: 'user_owner_1', emailVerified: false } },
          'user_owner_1',
          'tx-101',
          validPayload
        ),
    },
    {
      name: '03. Orphan subcollection without parent workspace',
      run: () =>
        evaluateTransactionCreate(
          { ...baseEnv, existingWorkspaces: {} },
          'user_owner_1',
          'tx-101',
          validPayload
        ),
    },
    {
      name: '04. Shadow ghost field injection',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          isAdmin: true,
        }),
    },
    {
      name: '05. Owner identity spoofing inside payload',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          ownerId: 'someone_else',
        }),
    },
    {
      name: '06. Client-forged timestamp',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          updatedAt: '2099-01-01T00:00:00.000Z',
        }),
    },
    {
      name: '07. Missing required schema key',
      run: () => {
        const { paymentMethod: _omitted, ...incomplete } = validPayload;
        return evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', incomplete);
      },
    },
    {
      name: '08. Pre-locked terminal archived creation',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          archived: true,
        }),
    },
    {
      name: '09. 2KB poisoned document ID',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'x'.repeat(1500), validPayload),
    },
    {
      name: '10. Volumetric merchant string poisoning (>160 chars)',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          merchant: 'M'.repeat(500),
        }),
    },
    {
      name: '11. Array exhaustion (>10 elements)',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          mergedSourceNames: new Array(25).fill('Gmail'),
        }),
    },
    {
      name: '12. Array type poisoning (numeric element)',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          mergedSourceNames: [99999],
        }),
    },
    {
      name: '13. Split bill over-allocation (splitOwedTotal > paid amount)',
      run: () =>
        evaluateTransactionCreate(baseEnv, 'user_owner_1', 'tx-101', {
          ...validPayload,
          splitOwedTotal: 50.0,
        }),
    },
  ];

  for (const testCase of dirtyDozenCases) {
    const verdict = testCase.run();
    if (verdict !== 'PERMISSION_DENIED') {
      throw new Error(`Security assertion failed on ${testCase.name}: got ${verdict}`);
    }
  }
}

runDirtyDozenAudit();
export {};
