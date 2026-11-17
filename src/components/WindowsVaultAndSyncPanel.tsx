import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BellRing,
  Check,
  Copy,
  FolderInput,
  FolderOpen,
  HardDrive,
  MonitorDown,
  RefreshCw,
  Save,
  Settings2,
  X,
} from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  DataSource,
  SavingsGoal,
  SpendingCategory,
  SubscriptionItem,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/finance';
import { usePWAInstall } from '../hooks/usePWAInstall';

export interface WindowsVaultPayload {
  version: '1.0';
  app: 'LedgerPulse Windows Local Vault';
  transactions: Transaction[];
  subscriptions: SubscriptionItem[];
  categoryBudgets: Record<SpendingCategory, number>;
  savingsGoals: SavingsGoal[];
}

interface FileSystemWritableStreamLike {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

interface FileSystemFileHandleLike {
  name: string;
  createWritable: () => Promise<FileSystemWritableStreamLike>;
  getFile: () => Promise<File>;
}

interface WindowsVaultAndSyncPanelProps {
  vaultPayload: WindowsVaultPayload;
  diskMeta: {
    vaultFilePath: string;
    inboxDirPath: string;
    fileSizeBytes: number | null;
    lastSavedAt: string | null;
    isSavingDisk: boolean;
  };
  onHydrateVault: (loaded: Partial<WindowsVaultPayload>, sourceLabel: string) => void;
  onCommitPulledTransactions: (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>,
    customToast?: string
  ) => void;
  onShowToast: (msg: string) => void;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatShortTime(iso: string | null): string {
  if (!iso) return 'Just now';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return 'Synced';
  }
}

export const WindowsVaultAndSyncPanel: React.FC<WindowsVaultAndSyncPanelProps> = ({
  vaultPayload,
  diskMeta,
  onHydrateVault,
  onCommitPulledTransactions,
  onShowToast,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();

  // Linked native Windows file handle (File System Access API)
  const [linkedFileHandle, setLinkedFileHandle] = useState<FileSystemFileHandleLike | null>(null);
  const [linkedFileLastWrite, setLinkedFileLastWrite] = useState<string | null>(null);
  const fallbackFileInputRef = useRef<HTMLInputElement | null>(null);

  // Automated Data Pull State
  const [autoPullEnabled, setAutoPullEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('ledgerpulse_win_autopull') !== 'false';
    } catch {
      return true;
    }
  });
  const [isSyncingPull, setIsSyncingPull] = useState(false);
  const [pendingAlertsCount, setPendingAlertsCount] = useState(0);
  const [pendingInboxCount, setPendingInboxCount] = useState(0);
  const [lastPullTime, setLastPullTime] = useState<string | null>(null);
  const [totalAutoPulled, setTotalAutoPulled] = useState<number>(0);

  // Expandable Automation & Windows Desktop Setup Panels
  const [showAutomationSetup, setShowAutomationSetup] = useState(false);
  const [showWindowsInstallModal, setShowWindowsInstallModal] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const isSyncingRef = useRef(false);
  const transactionsRef = useRef(vaultPayload.transactions);
  transactionsRef.current = vaultPayload.transactions;

  // Auto-save to linked native Windows PC file whenever vaultPayload changes
  useEffect(() => {
    if (!linkedFileHandle) return;
    let cancelled = false;

    const writeToLinkedWindowsFile = async () => {
      try {
        const writable = await linkedFileHandle.createWritable();
        const serialized = JSON.stringify(
          {
            ...vaultPayload,
            savedAt: new Date().toISOString(),
          },
          null,
          2
        );
        await writable.write(serialized);
        await writable.close();
        if (!cancelled) {
          setLinkedFileLastWrite(new Date().toISOString());
        }
      } catch {
        // Permission revoked or file moved
      }
    };

    writeToLinkedWindowsFile();
    return () => {
      cancelled = true;
    };
  }, [vaultPayload, linkedFileHandle]);

  const handleLinkOrSaveWindowsFile = useCallback(async () => {
    const serialized = JSON.stringify(
      {
        ...vaultPayload,
        savedAt: new Date().toISOString(),
      },
      null,
      2
    );

    const win = window as unknown as {
      showSaveFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike>;
    };

    if (typeof win.showSaveFilePicker === 'function') {
      try {
        const handle = await win.showSaveFilePicker({
          suggestedName: 'LedgerPulse-Windows-Vault.json',
          types: [
            {
              description: 'LedgerPulse Local Vault (.json)',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(serialized);
        await writable.close();
        setLinkedFileHandle(handle);
        setLinkedFileLastWrite(new Date().toISOString());
        onShowToast(
          `Linked Windows file "${handle.name}" — every ledger update now auto-saves directly to your PC.`
        );
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        // Fall through to direct download if blocked by iframe policy
      }
    }

    // Fallback direct local file save
    const blob = new Blob([serialized], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'LedgerPulse-Windows-Vault.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onShowToast('Saved LedgerPulse-Windows-Vault.json to your local Downloads folder.');
  }, [vaultPayload, onShowToast]);

  const parseAndLoadVaultText = useCallback(
    (rawText: string, fileName: string) => {
      try {
        const parsed = JSON.parse(rawText);
        if (!parsed || !Array.isArray(parsed.transactions)) {
          onShowToast('Invalid vault file: missing transactions array.');
          return;
        }
        onHydrateVault(
          {
            transactions: parsed.transactions,
            subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : undefined,
            categoryBudgets:
              parsed.categoryBudgets && typeof parsed.categoryBudgets === 'object'
                ? parsed.categoryBudgets
                : undefined,
            savingsGoals: Array.isArray(parsed.savingsGoals) ? parsed.savingsGoals : undefined,
          },
          fileName
        );
      } catch {
        onShowToast(`Could not parse "${fileName}". Ensure it is a valid JSON vault.`);
      }
    },
    [onHydrateVault, onShowToast]
  );

  const handleOpenWindowsVaultFile = useCallback(async () => {
    const win = window as unknown as {
      showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike[]>;
    };

    if (typeof win.showOpenFilePicker === 'function') {
      try {
        const [handle] = await win.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'LedgerPulse Local Vault (.json)',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        if (handle) {
          const file = await handle.getFile();
          const text = await file.text();
          setLinkedFileHandle(handle);
          setLinkedFileLastWrite(new Date().toISOString());
          parseAndLoadVaultText(text, handle.name);
          return;
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    fallbackFileInputRef.current?.click();
  }, [parseAndLoadVaultText]);

  // Run Automated Pull against Apple Pay webhook queue + local data/inbox/ watched folder
  const executeAutomatedPull = useCallback(
    async (silentIfEmpty = false) => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      setIsSyncingPull(true);

      try {
        const response = await fetch('/api/auto-pull/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            existingTransactions: transactionsRef.current,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data?.error || 'Automated pull failed.');
        }

        setPendingAlertsCount(0);
        setPendingInboxCount(0);
        setLastPullTime(new Date().toISOString());

        const extracted = Array.isArray(data.extractedTransactions)
          ? data.extractedTransactions
          : [];

        if (extracted.length === 0) {
          if (!silentIfEmpty) {
            onShowToast('Auto-Pull checked local inbox & Apple Pay queue: 0 new items waiting.');
          }
          return;
        }

        const newItems: Transaction[] = [];
        const mergedUpdates: Array<{
          existingId: string;
          newSource: DataSource;
          rawDescriptor: string;
        }> = [];
        let autoPostedClear = 0;
        let flaggedUncertain = 0;

        extracted.forEach((raw: any, idx: number) => {
          const validSource: DataSource =
            raw.source === 'Apple Pay' ||
            raw.source === 'Gmail' ||
            raw.source === 'Bank Statement' ||
            raw.source === 'Cash / Manual'
              ? raw.source
              : 'Uploaded Statement';

          if (raw.matchedExistingId && String(raw.matchedExistingId).trim() !== '') {
            mergedUpdates.push({
              existingId: String(raw.matchedExistingId),
              newSource: validSource,
              rawDescriptor:
                raw.rawDescription || `${raw.merchant} · $${Number(raw.amount || 0).toFixed(2)}`,
            });
            return;
          }

          const validCat: SpendingCategory = ALL_SPENDING_CATEGORIES.includes(raw.category)
            ? raw.category
            : 'Other / Uncategorized';

          const validStatus: TransactionStatus =
            raw.status === 'pending' || raw.status === 'refunded' ? raw.status : 'posted';

          const validType: TransactionType =
            raw.transactionType === 'refund' ||
            raw.transactionType === 'income' ||
            raw.transactionType === 'transfer'
              ? raw.transactionType
              : 'purchase';

          const isUncertain = Boolean(raw.uncertainCategory);
          if (isUncertain) {
            flaggedUncertain += 1;
          } else {
            autoPostedClear += 1;
          }

          const dateStr =
            typeof raw.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.date)
              ? raw.date
              : '2026-11-17';

          newItems.push({
            id: `tx-autopull-${Date.now()}-${idx}`,
            date: dateStr,
            time: new Date().toTimeString().slice(0, 5),
            merchant: raw.merchant || 'Unknown Merchant',
            rawDescription: raw.rawDescription || raw.merchant || 'Automated Notification Pull',
            amount: Math.abs(Number(raw.amount) || 0),
            paymentMethod: raw.paymentMethod || 'Apple Pay',
            category: validCat,
            status: validStatus,
            transactionType: validType,
            source: validSource,
            isDeduplicated: false,
            mergedSources: [
              {
                source: validSource,
                referenceId: `AUTO-${Date.now().toString().slice(-5)}`,
                capturedAt: `${dateStr} ${new Date().toTimeString().slice(0, 5)}`,
                rawDescriptor: raw.rawDescription || raw.merchant || 'Automated Pull',
                statusAtCapture: validStatus,
              },
            ],
            uncertainCategory: isUncertain,
            uncertaintyReason: isUncertain
              ? raw.uncertaintyPrompt ||
                'Ambiguous merchant descriptor from automated pull — confirm category.'
              : undefined,
            suggestedCategories: Array.isArray(raw.suggestedCategories)
              ? raw.suggestedCategories.filter((c: any) => ALL_SPENDING_CATEGORIES.includes(c))
              : undefined,
            monthKey: dateStr.startsWith('2026-10') ? '2026-10' : '2026-11',
          });
        });

        setTotalAutoPulled((prev) => prev + newItems.length + mergedUpdates.length);

        const summarySegments: string[] = [];
        if (autoPostedClear > 0) summarySegments.push(`${autoPostedClear} clear match(es) auto-posted`);
        if (flaggedUncertain > 0)
          summarySegments.push(`${flaggedUncertain} uncertain item(s) flagged for review`);
        if (mergedUpdates.length > 0)
          summarySegments.push(`${mergedUpdates.length} duplicate(s) merged`);

        onCommitPulledTransactions(
          newItems,
          mergedUpdates,
          `Auto-Pull Complete: ${summarySegments.join(' · ')}`
        );
      } catch (err: any) {
        if (!silentIfEmpty) {
          onShowToast(err?.message || 'Automated pull encountered an error.');
        }
      } finally {
        isSyncingRef.current = false;
        setIsSyncingPull(false);
      }
    },
    [onCommitPulledTransactions, onShowToast]
  );

  // Poll /api/auto-pull/status on interval when autoPullEnabled is true, and auto-ingest when items arrive
  useEffect(() => {
    try {
      localStorage.setItem('ledgerpulse_win_autopull', autoPullEnabled ? 'true' : 'false');
    } catch {}

    const checkStatusAndPull = async () => {
      try {
        const res = await fetch('/api/auto-pull/status');
        if (!res.ok) return;
        const status = await res.json();
        const alerts = Number(status.pendingApplePayAlerts || 0);
        const files = Number(status.pendingInboxFiles || 0);
        setPendingAlertsCount(alerts);
        setPendingInboxCount(files);

        if (autoPullEnabled && (alerts > 0 || files > 0)) {
          await executeAutomatedPull(true);
        }
      } catch {
        // Offline or server busy
      }
    };

    checkStatusAndPull();
    const timer = window.setInterval(checkStatusAndPull, 18000);
    return () => window.clearInterval(timer);
  }, [autoPullEnabled, executeAutomatedPull]);

  // Windows Desktop Keyboard Shortcuts: Ctrl+S (Save/Link Vault), Ctrl+O (Open Vault), Ctrl+Shift+S (Pull Now)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        executeAutomatedPull(false);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleLinkOrSaveWindowsFile();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleOpenWindowsVaultFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [executeAutomatedPull, handleLinkOrSaveWindowsFile, handleOpenWindowsVaultFile]);

  const handleSimulateApplePayAlert = async () => {
    try {
      const res = await fetch('/api/apple-pay/simulate', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to simulate Apple Pay notification.');
      await executeAutomatedPull(false);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to trigger simulated Apple Pay alert.');
    }
  };

  const handleDropSampleReceipt = async () => {
    try {
      const res = await fetch('/api/local-inbox/drop-sample', { method: 'POST' });
      if (!res.ok) throw new Error('Failed to write sample .eml receipt.');
      await executeAutomatedPull(false);
    } catch (err: any) {
      onShowToast(err?.message || 'Failed to test local inbox receipt pull.');
    }
  };

  const webhookEndpoint =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/apple-pay/webhook`
      : 'http://localhost:3000/api/apple-pay/webhook';

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookEndpoint);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {}
  };

  const handleInstallWindowsClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) {
        onShowToast('Installed LedgerPulse as a Windows Desktop Application.');
        return;
      }
    }
    setShowWindowsInstallModal(true);
  };

  return (
    <>
      <input
        ref={fallbackFileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const text = await file.text();
          parseAndLoadVaultText(text, file.name);
          e.target.value = '';
        }}
        className="hidden"
      />

      <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
        {/* Two-Column Windows Local Vault + Automated Notification Pull Strip */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
          {/* Left: Local Windows PC Disk Vault Status & Controls */}
          <div className="lg:col-span-7 p-3.5 bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <HardDrive className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="min-w-0 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  <span>Windows Local Disk Vault</span>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="font-mono text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                    {diskMeta.isSavingDisk
                      ? 'Writing to disk...'
                      : linkedFileHandle
                      ? `Linked: ${linkedFileHandle.name}`
                      : 'Auto-Saved Locally'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate font-mono tabular-nums">
                  <span>{diskMeta.vaultFilePath || 'data/local-ledger-vault.json'}</span>
                  <span aria-hidden="true"> · </span>
                  <span>{formatBytes(diskMeta.fileSizeBytes)}</span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    Saved {formatShortTime(linkedFileLastWrite || diskMeta.lastSavedAt)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleLinkOrSaveWindowsFile}
                title="Link or save a local .json vault file on your Windows PC (Ctrl+S)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>{linkedFileHandle ? 'Save PC Vault' : 'Link Local PC File'}</span>
              </button>

              <button
                type="button"
                onClick={handleOpenWindowsVaultFile}
                title="Load an existing local .json vault file from your PC (Ctrl+O)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Open Vault</span>
              </button>

              {!isInstalled && (
                <button
                  type="button"
                  onClick={handleInstallWindowsClick}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors whitespace-nowrap shrink-0"
                >
                  <MonitorDown className="w-3.5 h-3.5" />
                  <span>Install Windows App</span>
                </button>
              )}
            </div>
          </div>

          {/* Right: Automated Apple Pay Notification & Local Watched Folder Pull */}
          <div className="lg:col-span-5 p-3.5 bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <BellRing className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0 mt-0.5" />
              <div className="min-w-0 text-xs">
                <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                  <span>Automated Data Pull</span>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="font-mono text-[11px] font-medium text-slate-600 dark:text-slate-300">
                    {autoPullEnabled ? 'Watching Feeds' : 'Paused'}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate font-mono tabular-nums">
                  <span>Apple Pay Webhook + Local Inbox</span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {pendingAlertsCount + pendingInboxCount > 0
                      ? `${pendingAlertsCount + pendingInboxCount} queued`
                      : lastPullTime
                      ? `Checked ${formatShortTime(lastPullTime)}`
                      : `${totalAutoPulled} pulled`}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => executeAutomatedPull(false)}
                disabled={isSyncingPull}
                title="Pull pending Apple Pay notifications & local data/inbox/ files now (Ctrl+Shift+S)"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 rounded-md hover:bg-slate-800 dark:hover:bg-white disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingPull ? 'animate-spin' : ''}`} />
                <span>{isSyncingPull ? 'Pulling...' : 'Pull Now'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowAutomationSetup((prev) => !prev)}
                aria-expanded={showAutomationSetup}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Configure Feeds</span>
              </button>
            </div>
          </div>
        </div>

        {/* Expandable Automated Feeds Drawer (100% Local — No Google Cloud OAuth Required) */}
        {showAutomationSetup && (
          <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                  Local Automated Ingestion Feeds (Apple Pay Notifications & Watched PC Folder)
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Clear matches auto-post directly to your local Windows vault; ambiguous merchant codes are flagged in the review queue.
                </p>
              </div>

              <div className="flex items-center gap-3">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none text-slate-700 dark:text-slate-300 font-medium">
                  <input
                    type="checkbox"
                    checked={autoPullEnabled}
                    onChange={(e) => setAutoPullEnabled(e.target.checked)}
                    className="rounded border-slate-300 dark:border-slate-700"
                  />
                  <span>Auto-pull every 18s</span>
                </label>

                <button
                  type="button"
                  onClick={() => setShowAutomationSetup(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
                  aria-label="Close feed configuration"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Feed 1: Apple Pay & Card Notification Webhook */}
              <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    01. Apple Pay & Card Alert Webhook
                  </span>
                  <button
                    type="button"
                    onClick={handleSimulateApplePayAlert}
                    disabled={isSyncingPull}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    <BellRing className="w-3 h-3" />
                    <span>Test Live Apple Pay Alert</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Point any notification forwarder or Shortcuts automation (`POST JSON`) to your local endpoint. Incoming taps are parsed, deduplicated, and written to your PC vault automatically.
                </p>

                <div className="flex items-center gap-1.5">
                  <code className="flex-1 px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate">
                    POST {webhookEndpoint}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    {copiedWebhook ? (
                      <>
                        <Check className="w-3 h-3 text-emerald-600" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3 h-3" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Feed 2: Local Windows Watched Folder (No Cloud OAuth Needed) */}
              <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    02. Local Windows Drop-Folder Auto-Pull
                  </span>
                  <button
                    type="button"
                    onClick={handleDropSampleReceipt}
                    disabled={isSyncingPull}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    <FolderInput className="w-3 h-3" />
                    <span>Test Drop .eml Receipt</span>
                  </button>
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Drop exported email receipts (`.eml`), bank `.csv` statements, or PDFs into your local watched folder on Windows—no cloud login required. Processed files move to `processed/`.
                </p>

                <div className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono text-[11px] text-slate-700 dark:text-slate-300 truncate">
                  {diskMeta.inboxDirPath || 'data/inbox/'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Windows Desktop App Installation Guide Modal */}
      {showWindowsInstallModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Run LedgerPulse as a Windows Desktop App"
          onClick={() => setShowWindowsInstallModal(false)}
          className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Run LedgerPulse Locally as a Windows App
                </h3>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  100% local PC disk storage (`data\local-ledger-vault.json`) · Start Menu & Taskbar window
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowWindowsInstallModal(false)}
                aria-label="Close Windows app dialog"
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2.5 text-slate-700 dark:text-slate-300">
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Option A: One-Click Local Windows Launcher (`start-windows-app.bat`)
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Download or clone this project to your Windows PC and double-click{' '}
                  <code className="font-mono px-1 py-0.5 bg-slate-200/70 dark:bg-slate-900 rounded">
                    start-windows-app.bat
                  </code>
                  . It starts the local vault server (`data\local-ledger-vault.json`) and opens LedgerPulse in a dedicated native Windows app window.
                </p>
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Option B: Pin to Windows 11 Start Menu & Taskbar (Edge / Chrome)
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  In Microsoft Edge or Chrome on Windows, click the <strong>App Available</strong> icon in the right side of the address bar (or <strong>Menu ⋯ → Apps → Install LedgerPulse</strong>) to pin it directly to your Windows Taskbar, then click <strong>Link Local PC File (`Ctrl+S`)</strong> to save continuously to your `Documents` folder.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowWindowsInstallModal(false);
                  handleLinkOrSaveWindowsFile();
                }}
                className="px-3.5 py-2 text-xs font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
              >
                Save Vault File to PC (`Ctrl+S`)
              </button>
              <button
                type="button"
                onClick={() => setShowWindowsInstallModal(false)}
                className="px-4 py-2 text-xs font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white rounded-lg transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
