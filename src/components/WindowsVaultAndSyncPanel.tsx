import React, { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  BellRing,
  Check,
  Cloud,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  Loader2,
  LogOut,
  Mail,
  MonitorSmartphone,
  RefreshCw,
  Save,
  Settings2,
  Smartphone,
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
import { formatCurrency } from '../utils/financeMetrics';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { scanGmailReceiptsWithPermission } from '../services/firebaseAndGmail';

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
  cloudUser: User | null;
  hasGmailToken: boolean;
  isSigningIn: boolean;
  authDiagnosticError?: string | null;
  onClearAuthDiagnostic?: () => void;
  cloudSyncMeta: {
    lastSyncedDevice: string;
    updatedAtIso: string | null;
    isCloudReady: boolean;
  };
  onSignInGoogle: (forceGmailConsent?: boolean) => Promise<boolean>;
  onSignOutGoogle: () => Promise<void>;
  onOpenCsvImport: () => void;
  onHydrateVault: (loaded: Partial<WindowsVaultPayload>, sourceLabel: string) => void;
  onCommitPulledTransactions: (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>,
    customToast?: string
  ) => void;
  onShowToast: (msg: string) => void;
}

const CLOUD_AUTHORIZED_APP_URL =
  'https://ais-pre-htcfj44ymcyxj7dcndkfx2-860080216343.us-east1.run.app';

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatShortTime(iso: string | null): string {
  if (!iso) return 'Just now';
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return 'Synced';
  }
}

export const GoogleSignInButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  label?: string;
}> = ({ onClick, disabled, label = 'Sign in with Google' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="gsi-material-button shrink-0"
  >
    <div className="gsi-material-button-content-wrapper">
      <div className="gsi-material-button-icon">
        <svg
          version="1.1"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 48 48"
          className="block w-full h-full"
        >
          <path
            fill="#EA4335"
            d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
          />
          <path
            fill="#4285F4"
            d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
          />
          <path
            fill="#FBBC05"
            d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
          />
          <path
            fill="#34A853"
            d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
          />
          <path fill="none" d="M0 0h48v48H0z" />
        </svg>
      </div>
      <span className="gsi-material-button-contents">{label}</span>
    </div>
  </button>
);

export const WindowsVaultAndSyncPanel: React.FC<WindowsVaultAndSyncPanelProps> = ({
  vaultPayload,
  diskMeta,
  cloudUser,
  hasGmailToken,
  isSigningIn,
  authDiagnosticError = null,
  onClearAuthDiagnostic,
  cloudSyncMeta,
  onSignInGoogle,
  onSignOutGoogle,
  onOpenCsvImport,
  onHydrateVault,
  onCommitPulledTransactions,
  onShowToast,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  // Linked native file handle (File System Access API)
  const [linkedFileHandle, setLinkedFileHandle] = useState<FileSystemFileHandleLike | null>(null);
  const [linkedFileLastWrite, setLinkedFileLastWrite] = useState<string | null>(null);
  const fallbackFileInputRef = useRef<HTMLInputElement | null>(null);

  // Gmail In-App Receipt Scanner State
  const [gmailDaysWindow, setGmailDaysWindow] = useState<7 | 30 | 90>(30);
  const [isScanningGmail, setIsScanningGmail] = useState(false);
  const [gmailConsentNotice, setGmailConsentNotice] = useState<string | null>(null);
  const [gmailPreviewResult, setGmailPreviewResult] = useState<{
    messagesScanned: number;
    extractedTransactions: any[];
    summaryNote: string;
  } | null>(null);

  // Automated Data Pull State (Apple Pay Webhook + Local Watched Folder)
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

  // Expandable Connections Drawer & Multi-Device Install Modal
  const [showConnectionsDrawer, setShowConnectionsDrawer] = useState(false);
  const [showDeviceSyncModal, setShowDeviceSyncModal] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedAppUrl, setCopiedAppUrl] = useState(false);

  const isSyncingRef = useRef(false);
  const transactionsRef = useRef(vaultPayload.transactions);
  transactionsRef.current = vaultPayload.transactions;

  // Auto-save to linked local file whenever vaultPayload changes
  useEffect(() => {
    if (!linkedFileHandle) return;
    let cancelled = false;

    const writeToLinkedFile = async () => {
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

    writeToLinkedFile();
    return () => {
      cancelled = true;
    };
  }, [vaultPayload, linkedFileHandle]);

  const handleLinkOrSaveLocalFile = useCallback(async () => {
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
          suggestedName: 'LedgerPulse-Vault-Backup.json',
          types: [
            {
              description: 'LedgerPulse Vault (.json)',
              accept: { 'application/json': ['.json'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(serialized);
        await writable.close();
        setLinkedFileHandle(handle);
        setLinkedFileLastWrite(new Date().toISOString());
        onShowToast(`Linked local backup "${handle.name}" — changes auto-save continuously.`);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    const blob = new Blob([serialized], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'LedgerPulse-Vault-Backup.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onShowToast('Downloaded LedgerPulse-Vault-Backup.json.');
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

  const handleOpenLocalVaultFile = useCallback(async () => {
    const win = window as unknown as {
      showOpenFilePicker?: (opts: unknown) => Promise<FileSystemFileHandleLike[]>;
    };

    if (typeof win.showOpenFilePicker === 'function') {
      try {
        const [handle] = await win.showOpenFilePicker({
          multiple: false,
          types: [
            {
              description: 'LedgerPulse Vault (.json)',
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

  const convertExtractedItemsToLedger = useCallback(
    (extracted: any[], defaultChannel: DataSource) => {
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
          raw.source === 'Cash / Manual' ||
          raw.source === 'Uploaded Statement'
            ? raw.source
            : defaultChannel;

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
          id: `tx-sync-${Date.now()}-${idx}`,
          date: dateStr,
          time: new Date().toTimeString().slice(0, 5),
          merchant: raw.merchant || 'Unknown Merchant',
          rawDescription: raw.rawDescription || raw.merchant || `${validSource} Import`,
          amount: Math.abs(Number(raw.amount) || 0),
          paymentMethod:
            raw.paymentMethod || (validSource === 'Gmail' ? 'Gmail Digital Receipt' : 'Apple Pay'),
          category: validCat,
          status: validStatus,
          transactionType: validType,
          source: validSource,
          isDeduplicated: false,
          mergedSources: [
            {
              source: validSource,
              referenceId: `SYNC-${Date.now().toString().slice(-5)}`,
              capturedAt: `${dateStr} ${new Date().toTimeString().slice(0, 5)}`,
              rawDescriptor: raw.rawDescription || raw.merchant || validSource,
              statusAtCapture: validStatus,
            },
          ],
          uncertainCategory: isUncertain,
          uncertaintyReason: isUncertain
            ? raw.uncertaintyPrompt ||
              'Ambiguous merchant descriptor — please confirm category.'
            : undefined,
          suggestedCategories: Array.isArray(raw.suggestedCategories)
            ? raw.suggestedCategories.filter((c: any) => ALL_SPENDING_CATEGORIES.includes(c))
            : undefined,
          monthKey: dateStr.startsWith('2026-10') ? '2026-10' : '2026-11',
        });
      });

      return { newItems, mergedUpdates, autoPostedClear, flaggedUncertain };
    },
    []
  );

  // Scan Real Gmail Receipts with User Permission
  const handleScanGmailClick = async () => {
    setIsScanningGmail(true);
    setGmailConsentNotice(null);
    setGmailPreviewResult(null);
    try {
      if (!cloudUser || !hasGmailToken) {
        const connected = await onSignInGoogle(true);
        if (!connected) {
          setIsScanningGmail(false);
          return;
        }
      }

      const result = await scanGmailReceiptsWithPermission({
        daysWindow: gmailDaysWindow,
        maxMessages: 10,
        existingTransactions: transactionsRef.current,
      });

      if (result.needsGmailAuth) {
        const reconnected = await onSignInGoogle(true);
        if (!reconnected) {
          setGmailConsentNotice(result.summaryNote);
          return;
        }
        const retryResult = await scanGmailReceiptsWithPermission({
          daysWindow: gmailDaysWindow,
          maxMessages: 10,
          existingTransactions: transactionsRef.current,
        });
        if (retryResult.needsGmailAuth) {
          setGmailConsentNotice(retryResult.summaryNote);
          onShowToast(retryResult.summaryNote);
          return;
        }
        setGmailPreviewResult(retryResult);
        if (retryResult.extractedTransactions.length === 0) {
          onShowToast(retryResult.summaryNote);
        }
        return;
      }

      setGmailPreviewResult(result);
      if (result.extractedTransactions.length === 0) {
        onShowToast(result.summaryNote);
      }
    } catch (err: any) {
      const msg = String(err?.message || 'Unable to scan Gmail receipts right now.');
      setGmailConsentNotice(msg);
      onShowToast(msg);
    } finally {
      setIsScanningGmail(false);
    }
  };

  const handleCommitGmailPreview = () => {
    if (!gmailPreviewResult) return;
    const { newItems, mergedUpdates } = convertExtractedItemsToLedger(
      gmailPreviewResult.extractedTransactions,
      'Gmail'
    );
    const parts: string[] = [];
    if (newItems.length > 0) parts.push(`${newItems.length} Gmail receipt(s) imported`);
    if (mergedUpdates.length > 0) parts.push(`${mergedUpdates.length} duplicate(s) merged`);
    onCommitPulledTransactions(
      newItems,
      mergedUpdates,
      parts.join(' · ') || 'Synced Gmail receipts.'
    );
    setGmailPreviewResult(null);
  };

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
            onShowToast('Checked Apple Pay webhook & local inbox: 0 new items waiting.');
          }
          return;
        }

        const { newItems, mergedUpdates, autoPostedClear, flaggedUncertain } =
          convertExtractedItemsToLedger(extracted, 'Uploaded Statement');

        setTotalAutoPulled((prev) => prev + newItems.length + mergedUpdates.length);

        const summarySegments: string[] = [];
        if (autoPostedClear > 0) summarySegments.push(`${autoPostedClear} clear match(es) added`);
        if (flaggedUncertain > 0)
          summarySegments.push(`${flaggedUncertain} uncertain item(s) queued for review`);
        if (mergedUpdates.length > 0)
          summarySegments.push(`${mergedUpdates.length} duplicate(s) merged`);

        onCommitPulledTransactions(
          newItems,
          mergedUpdates,
          `Feed Pull Complete: ${summarySegments.join(' · ')}`
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
    [convertExtractedItemsToLedger, onCommitPulledTransactions, onShowToast]
  );

  // Poll /api/auto-pull/status on interval when autoPullEnabled is true
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

  // Desktop Keyboard Shortcuts: Ctrl+S (Save Vault), Ctrl+O (Open Vault), Ctrl+Shift+S (Pull Now)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        executeAutomatedPull(false);
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleLinkOrSaveLocalFile();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        handleOpenLocalVaultFile();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [executeAutomatedPull, handleLinkOrSaveLocalFile, handleOpenLocalVaultFile]);

  const appOrigin =
    typeof window !== 'undefined' ? window.location.origin : CLOUD_AUTHORIZED_APP_URL;
  const isLocalhostOrigin =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const mobileShareUrl = isLocalhostOrigin ? CLOUD_AUTHORIZED_APP_URL : appOrigin;
  const webhookEndpoint = `${mobileShareUrl}/api/apple-pay/webhook`;

  const handleCopyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookEndpoint);
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } catch {}
  };

  const handleCopyAppUrl = async () => {
    try {
      await navigator.clipboard.writeText(mobileShareUrl);
      setCopiedAppUrl(true);
      setTimeout(() => setCopiedAppUrl(false), 2000);
    } catch {}
  };

  const handleInstallDeviceClick = async () => {
    if (isInstallable) {
      const accepted = await install();
      if (accepted) {
        onShowToast('Installed LedgerPulse to your device home screen / taskbar.');
        return;
      }
    }
    setShowDeviceSyncModal(true);
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
        {/* Two-Column Strip: (1) Phone & Computer Cloud Sync + Gmail | (2) CSV Import & Feed Controls */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-stretch">
          {/* Left (7 cols): Cloud Sync Across Phone & Computer + In-App Gmail Connection */}
          <div className="lg:col-span-7 p-3.5 bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Cloud className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="min-w-0 text-xs">
                {cloudUser ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1.5 font-semibold text-slate-900 dark:text-slate-100">
                      <span>Phone & Computer Sync Active</span>
                      <span aria-hidden="true" className="text-slate-400">
                        ·
                      </span>
                      <span className="font-mono text-[11px] font-medium text-emerald-700 dark:text-emerald-400 truncate max-w-[200px]">
                        {cloudUser.email || 'Signed in'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate font-mono tabular-nums">
                      <span>
                        {cloudSyncMeta.isCloudReady
                          ? `Live via ${cloudSyncMeta.lastSyncedDevice}`
                          : 'Connecting cloud ledger...'}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>
                        {cloudSyncMeta.updatedAtIso
                          ? `Synced ${formatShortTime(cloudSyncMeta.updatedAtIso)}`
                          : 'Real-time'}
                      </span>
                      <span aria-hidden="true"> · </span>
                      <span>{hasGmailToken ? 'Gmail Ready' : 'Gmail Standby'}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="font-semibold text-slate-900 dark:text-slate-100">
                      Phone & Computer Sync + Gmail Receipts
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Sign in with Google on your phone and computer to sync live and scan Gmail receipts with permission.
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!cloudUser ? (
                <GoogleSignInButton
                  onClick={() => void onSignInGoogle()}
                  disabled={isSigningIn}
                  label={isSigningIn ? 'Signing in...' : 'Sign in with Google'}
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleScanGmailClick}
                    disabled={isScanningGmail || isSigningIn}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
                  >
                    {isScanningGmail ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Scanning Gmail...</span>
                      </>
                    ) : (
                      <>
                        <Mail className="w-3.5 h-3.5" />
                        <span>{hasGmailToken ? 'Scan Gmail Receipts' : 'Connect & Scan Gmail'}</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void onSignOutGoogle()}
                    title="Sign out of cloud sync on this device"
                    className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Right (5 cols): CSV Import + Multi-Device Install + Connections Hub */}
          <div className="lg:col-span-5 p-3.5 bg-slate-50/80 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <Database className="w-4 h-4 text-slate-700 dark:text-slate-300 shrink-0 mt-0.5" />
              <div className="min-w-0 text-xs">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Import, Export &amp; Connected Feeds
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate font-mono tabular-nums">
                  <span>{vaultPayload.transactions.length} records</span>
                  <span aria-hidden="true"> · </span>
                  <span>
                    {pendingAlertsCount + pendingInboxCount > 0
                      ? `${pendingAlertsCount + pendingInboxCount} queued`
                      : lastPullTime
                      ? `Feeds checked ${formatShortTime(lastPullTime)}`
                      : `${totalAutoPulled} pulled`}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={onOpenCsvImport}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>Import / Export / Scan</span>
              </button>

              <button
                type="button"
                onClick={() => setShowConnectionsDrawer((prev) => !prev)}
                aria-expanded={showConnectionsDrawer}
                className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Connections</span>
              </button>

              <a
                href="/api/release/windows.zip"
                download="LedgerPulse-Windows-v1.0.2.zip"
                title="Download standalone Windows 10/11 desktop package (.zip)"
                className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                <span>Windows .zip</span>
              </a>

              {!isInstalled && (
                <button
                  type="button"
                  onClick={handleInstallDeviceClick}
                  title="Install or open on Phone & Computer"
                  className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-md hover:bg-emerald-100 dark:hover:bg-emerald-900/60 transition-colors whitespace-nowrap shrink-0"
                >
                  <MonitorSmartphone className="w-3.5 h-3.5" />
                  <span>{isIOS ? 'Add to iPhone' : 'Phone & PC App'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Windows Localhost OAuth / Gmail Permission Troubleshooting Helper */}
        {(authDiagnosticError || gmailConsentNotice) && (
          <div className="p-4 bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 rounded-lg space-y-2.5 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  {authDiagnosticError === 'unauthorized-domain'
                    ? 'Google OAuth Domain Notice on Localhost (Windows)'
                    : authDiagnosticError === 'popup-blocked'
                    ? 'Google Sign-In Popup Blocked'
                    : 'Gmail Connection Notice'}
                </div>

                {authDiagnosticError === 'unauthorized-domain' ? (
                  <div className="text-slate-700 dark:text-slate-300 space-y-1.5 leading-relaxed">
                    <p>
                      Google OAuth for Gmail (<code className="font-mono">gmail.readonly</code>) only allows domains explicitly registered in your Firebase &amp; Google Cloud project. Choose either option below:
                    </p>
                    <p>
                      <strong>Option 1 (Instant — Zero Console Setup):</strong> Open the pre-authorized Cloud App URL below (or run the updated <code className="font-mono">LedgerPulse.vbs</code> launcher), where Gmail &amp; multi-device sync are already authorized.
                    </p>
                    <p>
                      <strong>Option 2 (Authorize Localhost):</strong> In Firebase Console (<code className="font-mono">gen-lang-client-0623877657</code> → Authentication → Settings → Authorized domains), add <code className="font-mono">localhost</code>, and in Google Cloud Console → Credentials → OAuth 2.0 Client IDs, add <code className="font-mono">http://localhost:3000</code> under Authorized JavaScript origins.
                    </p>
                  </div>
                ) : (
                  <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                    {gmailConsentNotice ||
                      (authDiagnosticError === 'popup-blocked'
                        ? 'Allow popups for this window in Microsoft Edge or Chrome, then click "Connect & Scan Gmail" again.'
                        : authDiagnosticError)}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setGmailConsentNotice(null);
                  onClearAuthDiagnostic?.();
                }}
                aria-label="Dismiss notice"
                className="p-1 text-slate-500 hover:text-slate-900 dark:hover:text-slate-100 rounded shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <a
                href={CLOUD_AUTHORIZED_APP_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Cloud-Authorized App (Gmail Ready)</span>
              </a>

              <button
                type="button"
                onClick={() => void onSignInGoogle(true)}
                disabled={isSigningIn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-800 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors whitespace-nowrap"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Retry Gmail Consent Popup</span>
              </button>
            </div>
          </div>
        )}

        {/* Inline Gmail Scan Review Panel (when receipts are extracted from Gmail) */}
        {gmailPreviewResult && gmailPreviewResult.extractedTransactions.length > 0 && (
          <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/70 rounded-lg space-y-3 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  Gmail Receipt Scan Preview ({gmailPreviewResult.messagesScanned} emails checked)
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                  {gmailPreviewResult.summaryNote}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGmailPreviewResult(null)}
                  className="px-2.5 py-1.5 font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleCommitGmailPreview}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>
                    Import {gmailPreviewResult.extractedTransactions.length} Gmail{' '}
                    {gmailPreviewResult.extractedTransactions.length === 1 ? 'Record' : 'Records'}
                  </span>
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
              {gmailPreviewResult.extractedTransactions.map((item, idx) => (
                <div
                  key={idx}
                  className="px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {item.merchant}
                    </span>
                    <span aria-hidden="true" className="mx-1.5 text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <span className="font-mono text-slate-600 dark:text-slate-400">
                      {item.date}
                    </span>
                    <span aria-hidden="true" className="mx-1.5 text-slate-300 dark:text-slate-700">
                      ·
                    </span>
                    <span className="text-slate-500 dark:text-slate-400">{item.category}</span>
                  </div>
                  <div className="flex items-center gap-2 font-mono">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      {formatCurrency(Number(item.amount) || 0)}
                    </span>
                    {item.matchedExistingId && (
                      <span className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        (Merges duplicate)
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Expandable In-App Connections & Local Backup Hub */}
        {showConnectionsDrawer && (
          <div className="p-4 bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-3.5 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                  In-App Data Connections & Multi-Device Backup
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Connect Gmail receipts with permission, forward Apple Pay wallet notifications, or back up a local JSON file (`Ctrl+S`).
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
                  <span>Auto-pull webhook every 18s</span>
                </label>

                <button
                  type="button"
                  onClick={() => setShowConnectionsDrawer(false)}
                  className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded"
                  aria-label="Close connections panel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* Connection 1: Gmail Read-Only Receipt & Bill Scanner */}
              <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      01. Gmail Receipt Connection
                    </span>
                    <span className="text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                      {hasGmailToken ? 'Connected' : 'Read-Only'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Scans purchase confirmations, invoices, and subscription bills from Gmail with your permission. Never modifies or sends mail.
                  </p>
                </div>

                <div className="flex items-center justify-between gap-2 pt-1">
                  <select
                    aria-label="Gmail scan window"
                    value={gmailDaysWindow}
                    onChange={(e) => setGmailDaysWindow(Number(e.target.value) as 7 | 30 | 90)}
                    className="px-2 py-1.5 text-[11px] font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-slate-800 dark:text-slate-200"
                  >
                    <option value={7}>Last 7 days</option>
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                  </select>

                  <button
                    type="button"
                    onClick={handleScanGmailClick}
                    disabled={isScanningGmail || isSigningIn}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded disabled:opacity-60 transition-colors whitespace-nowrap"
                  >
                    <Mail className="w-3 h-3" />
                    <span>{hasGmailToken ? 'Scan Now' : 'Connect Gmail'}</span>
                  </button>
                </div>
              </div>

              {/* Connection 2: Apple Pay / iOS Shortcuts Webhook */}
              <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      02. Apple Pay &amp; Shortcuts Webhook
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-mono text-emerald-700 dark:text-emerald-400">
                      <BellRing className="w-3 h-3" />
                      <span>POST JSON</span>
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Forward iPhone Wallet automation taps (`POST JSON`) so mobile card spends appear automatically on both phone and computer.
                  </p>
                </div>

                <div className="flex items-center gap-1.5 pt-1">
                  <code className="flex-1 px-2 py-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded font-mono text-[10px] text-slate-700 dark:text-slate-300 truncate">
                    {webhookEndpoint}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyWebhook}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-700 whitespace-nowrap shrink-0"
                  >
                    {copiedWebhook ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedWebhook ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Connection 3: Local Vault File Backup & Watched Inbox */}
              <div className="p-3.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5 flex flex-col justify-between">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                      <span>03. Local Backup & Inbox</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">
                      {formatBytes(diskMeta.fileSizeBytes)}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                    Save or restore offline `.json` snapshots (`Ctrl+S` / `Ctrl+O`), or drop `.eml` receipts into `{diskMeta.inboxDirPath}`.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={handleLinkOrSaveLocalFile}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-800 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <Save className="w-3 h-3" />
                    <span>{linkedFileHandle ? 'Save Linked' : 'Backup JSON'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleOpenLocalVaultFile}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <FolderOpen className="w-3 h-3" />
                    <span>Open JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => executeAutomatedPull(false)}
                    disabled={isSyncingPull}
                    aria-label="Check local feeds now"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded hover:bg-slate-200 dark:hover:bg-slate-700"
                  >
                    <RefreshCw className={`w-3 h-3 ${isSyncingPull ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Multi-Device (Phone + Computer) Sync & Install Modal */}
      {showDeviceSyncModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Sync & Install LedgerPulse on Phone and Computer"
          onClick={() => setShowDeviceSyncModal(false)}
          className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl p-6 space-y-4 text-xs"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Sync & Install Across Phone and Computer
                </h3>
                <p className="text-slate-500 dark:text-slate-400 mt-0.5">
                  Sign in with the same Google account on both devices for instant real-time ledger synchronization.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeviceSyncModal(false)}
                aria-label="Close device sync modal"
                className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 text-slate-700 dark:text-slate-300">
              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2">
                <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  <Smartphone className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                  <span>01. Install &amp; Sync on iPhone (or Android)</span>
                </div>
                <ol className="list-decimal list-inside text-slate-600 dark:text-slate-400 space-y-1 leading-relaxed">
                  <li>Open the Cloud App URL below in <strong>Safari</strong> on your iPhone.</li>
                  <li>Tap the <strong>Share</strong> icon (square with arrow) → <strong>Add to Home Screen</strong> to install it like a native iOS app.</li>
                  <li>Tap <strong>Sign in with Google</strong> using the <strong>same Google account</strong> as your Windows PC—all transactions, split bills, budgets, and goals sync live over Wi-Fi &amp; 5G.</li>
                </ol>
                <div className="flex items-center gap-1.5 pt-1">
                  <code className="flex-1 px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded font-mono text-[11px] truncate">
                    {mobileShareUrl}
                  </code>
                  <button
                    type="button"
                    onClick={handleCopyAppUrl}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 rounded hover:opacity-90 whitespace-nowrap"
                  >
                    {copiedAppUrl ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedAppUrl ? 'Copied Link' : 'Copy iPhone Link'}</span>
                  </button>
                </div>
              </div>

              <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-lg space-y-2.5">
                <div className="font-semibold text-slate-900 dark:text-slate-100">
                  02. Install on Windows 10 / 11 or Mac Computer
                </div>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Download the packaged Windows release ZIP below, extract it, and run <code className="font-mono">Install-Windows-App.bat</code> (or <code className="font-mono">LedgerPulse.vbs</code>) for a silent, zero-console Windows desktop app with Desktop &amp; Start Menu shortcuts—or click <strong>Install LedgerPulse</strong> in Edge/Chrome&apos;s address bar.
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <a
                    href="/api/release/windows.zip"
                    download="LedgerPulse-Windows-v1.0.2.zip"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md transition-colors whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download Windows Release (.zip)</span>
                  </a>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              {linkedFileLastWrite && (
                <span className="text-[11px] text-slate-400 mr-auto font-mono">
                  Local backup saved {formatShortTime(linkedFileLastWrite)}
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowDeviceSyncModal(false)}
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
