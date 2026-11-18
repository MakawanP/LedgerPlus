# LedgerPulse Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants & Relationship Mapping

1. **Master Source of Truth**: `/ledgers/{userId}` is the root workspace owned strictly by `userId == request.auth.uid` with a verified Google email (`request.auth.token.email_verified == true`). Zero PII (`email`, `phone`, `address`) is stored in Firestore documents.
2. **Master Gate Invariant**: No subcollection document (`transactions/{txId}`, `subscriptions/{subId}`, `savingsGoals/{goalId}`) can be read (`get`), created, updated, or deleted unless `/ledgers/{userId}` exists and `get(/databases/$(database)/documents/ledgers/$(userId)).data.ownerId == request.auth.uid`.
3. **Secure List Query Invariant**: Every `allow list` rule evaluates `userId == request.auth.uid && resource.data.ownerId == request.auth.uid` with zero `get()` or `exists()` calls inside `allow list` to prevent O(n) read amplification while rejecting unoped client queries.
4. **Temporal & Identity Immutability**: `ownerId` and `createdAt` are immutable across all updates; `createdAt == request.time` on `create` and `updatedAt == request.time` on `create` and `update`.
5. **Terminal State Locking**: Once `existing().archived == true` on any entity, all subsequent updates are rejected.
6. **Total Array & Volumetric Guarding**: All IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), every string enforces explicit `.size()` bounds matching `firebase-blueprint.json`, and bounded lists (`mergedSourceNames <= 10`, `suggestedCategories <= 5`, `splitParticipants <= 8`) validate element type/structure on index `0` when non-empty.
7. **Split Bill Accounting Invariant**: On every `LedgerTransaction`, `0 <= splitOwedTotal <= amount` and `0 <= splitSettledTotal <= splitOwedTotal`, guaranteeing friend shares can never exceed the actual paid transaction amount.

## 2. The "Dirty Dozen" Adversarial Payloads (Must Return `PERMISSION_DENIED`)

1. **Cross-Tenant Workspace Read/Write**: Authenticated user `uid_attacker` attempts `get` or `set` on `/ledgers/uid_victim` -> Denied (`userId != request.auth.uid`).
2. **Unverified Email Write Spoof**: User with `request.auth.token.email_verified == false` attempts `create` on `/ledgers/uid_unverified` -> Denied (`isVerifiedUser()` fails).
3. **Orphan Subcollection Creation**: User attempts `create` on `/ledgers/uid_1/transactions/tx_1` before `/ledgers/uid_1` exists -> Denied by Master Gate `hasActiveParentLedger(userId)`.
4. **Shadow / Ghost Field Injection**: User sends valid `LedgerTransaction` payload plus `"isAdmin": true` -> Denied by `data.keys().hasOnly(...)`.
5. **Owner Identity Spoofing in Payload**: User `uid_1` writes `/ledgers/uid_1/transactions/tx_1` with `ownerId: "uid_2"` -> Denied (`data.ownerId == request.auth.uid`).
6. **Client-Forged Timestamp**: User sends past/future `createdAt` or `updatedAt` instead of `serverTimestamp()` -> Denied (`incoming().updatedAt == request.time`).
7. **Immutable Field Mutation**: User updates `createdAt` or `ownerId` on an existing transaction -> Denied (`incoming().ownerId == existing().ownerId && incoming().createdAt == existing().createdAt` + `affectedKeys().hasOnly(...)`).
8. **Terminal Lock Bypass**: User attempts to update a transaction or subscription whose `existing().archived == true` -> Denied (`existing().archived == false`).
9. **ID Poisoning / 2KB Path Variable**: Attacker uses a 1,500-char or slash/symbol-injected `{txId}` -> Denied (`isValidId(txId)`).
10. **Value / Volumetric String Poisoning**: Attacker updates `merchant` (`affectedKeys().hasOnly(['merchant', 'updatedAt'])`) with a 500KB string or boolean -> Denied by `isValidTransaction(incoming())` wrapping the `allow update` block (`merchant.size() <= 160`).
11. **Array Exhaustion Attack**: Attacker passes 500 items in `mergedSourceNames` or non-string first element `[12345]` -> Denied (`mergedSourceNames.size() <= 10` and `mergedSourceNames[0] is string`).
12. **Unfiltered Collection Scraping**: Attacker runs `list` query without `where('ownerId', '==', request.auth.uid)` or against another user's subcollection -> Denied (`userId == request.auth.uid && resource.data.ownerId == request.auth.uid`).
