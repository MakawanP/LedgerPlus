import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  Download,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  ScanLine,
  Settings2,
  Trash2,
  UploadCloud,
  WifiOff,
  X,
} from 'lucide-react';
import {
  ALL_SPENDING_CATEGORIES,
  DataSource,
  SpendingCategory,
  Transaction,
  TransactionStatus,
  TransactionType,
} from '../types/finance';
import {
  CsvColumnMapping,
  CsvSignConvention,
  ParsedCsvFileStructure,
  analyzeCsvStructure,
  buildCsvTransactionPreview,
} from '../utils/csvImporter';
import {
  formatCurrency,
  getTransactionSplitSummary,
} from '../utils/financeMetrics';
import { MerchantLogo } from './MerchantLogo';
import { useOnlineStatus } from '../hooks/usePWAInstall';
import {
  CURRENCY_OPTIONS,
  SupportedCurrencyCode,
  convertToUsd,
  fetchLiveUsdRates,
  getCachedUsdRates,
} from '../utils/currencyConverter';
import { parseSpokenTransactionDraft } from '../utils/spokenExpenseParser';
import { VoiceRecorderControl } from './VoiceRecorderControl';

export type IngestModalMode = 'csv_import' | 'ai_parse' | 'export_csv' | 'manual';

interface IngestSourceModalProps {
  isOpen: boolean;
  initialMode?: IngestModalMode;
  onClose: () => void;
  existingTransactions: Transaction[];
  onExportNotification?: (message: string) => void;
  onCommitTransactions: (
    newItems: Transaction[],
    mergedUpdates: Array<{ existingId: string; newSource: DataSource; rawDescriptor: string }>
  ) => void;
}

interface QueuedReceiptFile {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  base64Data: string;
  previewUrl: string | null;
}

const SUPPORTED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Downscales & compresses high-megapixel phone camera photos client-side
 * (max 1600px dimension, crisp JPEG) so cellular OCR uploads stay fast and reliable.
 */
async function optimizeReceiptImageFile(file: File): Promise<{
  dataUrl: string;
  base64Data: string;
  mimeType: string;
  sizeBytes: number;
}> {
  const rawDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
    reader.readAsDataURL(file);
  });

  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    return {
      dataUrl: rawDataUrl,
      base64Data: rawDataUrl.split(',')[1] || '',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
    };
  }

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Image decode fallback'));
      el.src = rawDataUrl;
    });

    const maxDim = 1600;
    const needsResize = img.width > maxDim || img.height > maxDim || file.size > 750 * 1024;
    if (!needsResize) {
      const normalizedMime = file.type === 'image/jpg' ? 'image/jpeg' : file.type || 'image/jpeg';
      return {
        dataUrl: rawDataUrl,
        base64Data: rawDataUrl.split(',')[1] || '',
        mimeType: normalizedMime,
        sizeBytes: file.size,
      };
    }

    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas context unavailable');
    }

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.86);
    const base64Data = compressedDataUrl.split(',')[1] || '';
    const approxBytes = Math.round((base64Data.length * 3) / 4);

    return {
      dataUrl: compressedDataUrl,
      base64Data,
      mimeType: 'image/jpeg',
      sizeBytes: approxBytes,
    };
  } catch {
    const fallbackMime =
      file.type === 'image/jpg'
        ? 'image/jpeg'
        : file.type || (file.name.toLowerCase().endsWith('.heic') ? 'image/heic' : 'image/jpeg');
    return {
      dataUrl: rawDataUrl,
      base64Data: rawDataUrl.split(',')[1] || '',
      mimeType: fallbackMime,
      sizeBytes: file.size,
    };
  }
}

export const IngestSourceModal: React.FC<IngestSourceModalProps> = ({
  isOpen,
  initialMode = 'csv_import',
  onClose,
  existingTransactions,
  onExportNotification,
  onCommitTransactions,
}) => {
  const isOnline = useOnlineStatus();
  const [mode, setMode] = useState<IngestModalMode>(initialMode);

  // Export CSV State
  const [exportScope, setExportScope] = useState<'2026-11' | '2026-10' | 'all'>('2026-11');
  const [exportTypeFilter, setExportTypeFilter] = useState<
    'all' | 'purchase' | 'purchase_refund' | 'income'
  >('all');
  const [copiedExportCsv, setCopiedExportCsv] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setMode(initialMode);
    }
  }, [isOpen, initialMode]);

  // CSV Import State (100% client-side, instant, works online & offline)
  const [csvFileName, setCsvFileName] = useState<string>('');
  const [csvRawText, setCsvRawText] = useState<string>('');
  const [csvStructure, setCsvStructure] = useState<ParsedCsvFileStructure | null>(null);
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping>({
    dateCol: 0,
    merchantCol: 1,
    rawDescCol: -1,
    amountCol: 2,
    debitCol: -1,
    creditCol: -1,
    categoryCol: -1,
    paymentMethodCol: -1,
    typeCol: -1,
    statusCol: -1,
  });
  const [csvSignConvention, setCsvSignConvention] = useState<CsvSignConvention>('auto');
  const [csvDefaultPayment, setCsvDefaultPayment] = useState<string>('Bank CSV Statement');
  const [csvDefaultSource, setCsvDefaultSource] = useState<DataSource>('Bank Statement');
  const [showColumnMapper, setShowColumnMapper] = useState<boolean>(false);
  const [excludedRowIndices, setExcludedRowIndices] = useState<Set<number>>(new Set());
  const [categoryOverrides, setCategoryOverrides] = useState<Record<number, SpendingCategory>>({});
  const [csvError, setCsvError] = useState<string | null>(null);
  const [isCsvDragging, setIsCsvDragging] = useState<boolean>(false);
  const [showPasteCsvBox, setShowPasteCsvBox] = useState<boolean>(false);

  // Vision OCR / Raw Text Parse State
  const [sourceType, setSourceType] = useState<DataSource>('Uploaded Statement');
  const [rawText, setRawText] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<QueuedReceiptFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [parsedPreview, setParsedPreview] = useState<{
    ocrTranscribedText?: string;
    extractedTransactions: any[];
    summaryNote: string;
  } | null>(null);

  // FX Currency State (for THB -> USD & international CSVs / manual entries)
  const [fxRates, setFxRates] = useState<Record<string, number>>(() => getCachedUsdRates());
  const [csvCurrencyMode, setCsvCurrencyMode] = useState<'AUTO' | SupportedCurrencyCode>('AUTO');

  useEffect(() => {
    if (isOpen) {
      void fetchLiveUsdRates().then((r) => setFxRates({ ...r }));
    }
  }, [isOpen]);

  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Manual Entry State
  const [manualDate, setManualDate] = useState('2026-11-17');
  const [manualMerchant, setManualMerchant] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualCurrency, setManualCurrency] = useState<SupportedCurrencyCode>('USD');
  const [manualPayment, setManualPayment] = useState('Credit Card');
  const [manualCategory, setManualCategory] = useState<SpendingCategory>('Food & Restaurants');
  const [manualStatus, setManualStatus] = useState<TransactionStatus>('posted');
  const [manualType, setManualType] = useState<TransactionType>('purchase');
  const [manualSource, setManualSource] = useState<DataSource>('Cash / Manual');

  const loadCsvContent = (text: string, labelName: string) => {
    setCsvError(null);
    const trimmed = text.trim();
    if (!trimmed) {
      setCsvError('The selected CSV file is empty.');
      return;
    }

    const structure = analyzeCsvStructure(trimmed);
    if (structure.dataRows.length === 0) {
      setCsvError('No data rows detected in the CSV. Check that the file contains transaction rows.');
      return;
    }

    setCsvFileName(labelName);
    setCsvRawText(trimmed);
    setCsvStructure(structure);
    setCsvMapping(structure.suggestedMapping);
    setExcludedRowIndices(new Set());
    setCategoryOverrides({});
    setMode('csv_import');
  };

  const handleCsvFileSelected = async (file: File) => {
    try {
      setCsvError(null);
      const lowerName = file.name.toLowerCase();
      if (
        file.type === 'application/pdf' ||
        lowerName.endsWith('.pdf') ||
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|heic|heif)$/i.test(lowerName)
      ) {
        await processFiles([file]);
        return;
      }
      if (file.size > 15 * 1024 * 1024) {
        setCsvError(`File "${file.name}" exceeds the 15 MB CSV limit.`);
        return;
      }
      const text = await file.text();
      loadCsvContent(text, file.name);
    } catch {
      setCsvError(`Could not read "${file.name}". Please ensure it is a valid text/CSV file.`);
    }
  };

  const exportableTransactions = useMemo(() => {
    return existingTransactions.filter((t) => {
      if (exportScope !== 'all' && t.monthKey !== exportScope) return false;
      if (exportTypeFilter === 'purchase' && t.transactionType !== 'purchase') return false;
      if (
        exportTypeFilter === 'purchase_refund' &&
        t.transactionType !== 'purchase' &&
        t.transactionType !== 'refund'
      ) {
        return false;
      }
      if (exportTypeFilter === 'income' && t.transactionType !== 'income') return false;
      return true;
    });
  }, [existingTransactions, exportScope, exportTypeFilter]);

  const buildExportCsvString = () => {
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
    const rows = exportableTransactions.map((t) => {
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
        `"${t.paymentMethod.replace(/"/g, '""')}"`,
        t.source,
        t.mergedSources?.length || 1,
      ];
    });
    return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
  };

  const handleDownloadExportCsv = () => {
    const csvContent = buildExportCsvString();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const suffix =
      exportScope === '2026-11'
        ? 'nov_2026'
        : exportScope === '2026-10'
        ? 'oct_2026'
        : 'all_records';
    link.setAttribute('href', url);
    link.setAttribute('download', `ledgerpulse_${suffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    onExportNotification?.(
      `Exported ${exportableTransactions.length} ${
        exportableTransactions.length === 1 ? 'record' : 'records'
      } to ledgerpulse_${suffix}.csv.`
    );
    onClose();
  };

  const handleCopyExportCsv = async () => {
    try {
      await navigator.clipboard.writeText(buildExportCsvString());
      setCopiedExportCsv(true);
      setTimeout(() => setCopiedExportCsv(false), 2200);
      onExportNotification?.(
        `Copied ${exportableTransactions.length} CSV ${
          exportableTransactions.length === 1 ? 'row' : 'rows'
        } to clipboard.`
      );
    } catch {}
  };

  const csvPreviewRows = useMemo(() => {
    if (!csvStructure) return [];
    const baseRows = buildCsvTransactionPreview({
      structure: csvStructure,
      mapping: csvMapping,
      signConvention: csvSignConvention,
      defaultPaymentMethod: csvDefaultPayment,
      defaultSource: csvDefaultSource,
      existingTransactions,
      forcedCurrencyCode: csvCurrencyMode,
      fxRates,
    });
    return baseRows.map((r) => ({
      ...r,
      included: !excludedRowIndices.has(r.rowIndex),
      category: categoryOverrides[r.rowIndex] || r.category,
      uncertainCategory: categoryOverrides[r.rowIndex] ? false : r.uncertainCategory,
    }));
  }, [
    csvStructure,
    csvMapping,
    csvSignConvention,
    csvDefaultPayment,
    csvDefaultSource,
    existingTransactions,
    excludedRowIndices,
    categoryOverrides,
    csvCurrencyMode,
    fxRates,
  ]);

  const includedCsvRows = useMemo(
    () => csvPreviewRows.filter((r) => r.included),
    [csvPreviewRows]
  );

  const handleCommitCsvImport = () => {
    if (includedCsvRows.length === 0) return;

    const newItems: Transaction[] = [];
    const mergedUpdates: Array<{
      existingId: string;
      newSource: DataSource;
      rawDescriptor: string;
    }> = [];

    const nowTime = new Date().toTimeString().slice(0, 5) || '12:00';

    includedCsvRows.forEach((row, idx) => {
      if (row.matchedExistingId) {
        mergedUpdates.push({
          existingId: row.matchedExistingId,
          newSource: row.source,
          rawDescriptor: row.rawDescription || `${row.merchant} · ${formatCurrency(row.amount)}`,
        });
        return;
      }

      const monthKey: '2026-11' | '2026-10' = row.date.startsWith('2026-10')
        ? '2026-10'
        : '2026-11';

      newItems.push({
        id: `tx-csv-${Date.now()}-${idx}`,
        date: row.date,
        time: nowTime,
        merchant: row.merchant,
        rawDescription: row.rawDescription || row.merchant,
        amount: row.amount,
        paymentMethod: row.paymentMethod,
        category: row.category,
        status: row.status,
        transactionType: row.transactionType,
        source: row.source,
        isDeduplicated: false,
        mergedSources: [
          {
            source: row.source,
            referenceId: `CSV-${Date.now().toString().slice(-5)}-${row.rowIndex}`,
            capturedAt: `${row.date} ${nowTime}`,
            rawDescriptor: row.rawDescription || row.merchant,
            statusAtCapture: row.status,
          },
        ],
        uncertainCategory: row.uncertainCategory,
        uncertaintyReason: row.uncertainCategory
          ? `CSV row "${row.merchant}" (${formatCurrency(row.amount)}) needs a confirmed spending category.`
          : undefined,
        monthKey,
      });
    });

    onCommitTransactions(newItems, mergedUpdates);
    setCsvStructure(null);
    setCsvRawText('');
    setCsvFileName('');
    onClose();
  };

  const processFiles = async (fileList: FileList | File[]) => {
    setParseError(null);
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    // Route .csv / .tsv files directly to the CSV Importer tab
    const csvCandidate = filesArray.find((f) => /\.(csv|tsv)$/i.test(f.name) || f.type === 'text/csv');
    if (csvCandidate) {
      await handleCsvFileSelected(csvCandidate);
      return;
    }

    const newQueued: QueuedReceiptFile[] = [];

    for (const file of filesArray) {
      const normalizedType =
        file.type === 'image/jpg' ? 'image/jpeg' : file.type || 'application/octet-stream';
      const isPdf =
        normalizedType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImage =
        normalizedType.startsWith('image/') ||
        /\.(png|jpe?g|webp|heic|heif)$/i.test(file.name);

      if (!isImage && !isPdf && !SUPPORTED_MIME_TYPES.includes(normalizedType)) {
        setParseError(
          `Unsupported file "${file.name}". Drop a CSV file, receipt photo (JPG, PNG, HEIC, WEBP), or PDF statement.`
        );
        continue;
      }

      if (file.size > 20 * 1024 * 1024) {
        setParseError(`File "${file.name}" exceeds the 20 MB per-receipt limit.`);
        continue;
      }

      const optimized = await optimizeReceiptImageFile(file);

      newQueued.push({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name || `receipt_${Date.now()}.jpg`,
        mimeType: isPdf ? 'application/pdf' : optimized.mimeType,
        sizeBytes: optimized.sizeBytes,
        base64Data: optimized.base64Data,
        previewUrl: isPdf ? null : optimized.dataUrl,
      });
    }

    if (newQueued.length > 0) {
      setMode('ai_parse');
      setQueuedFiles((prev) => [...prev, ...newQueued]);
      setParsedPreview(null);
    }
  };

  if (!isOpen) return null;

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await processFiles(e.dataTransfer.files);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLDivElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      await processFiles(files);
    }
  };

  const handleRemoveQueuedFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleRunParse = async () => {
    if (!rawText.trim() && queuedFiles.length === 0) return;
    if (!isOnline) {
      setParseError(
        'You are currently offline. Receipt Vision OCR requires connectivity — use Import CSV or Manual Entry offline.'
      );
      return;
    }

    setIsParsing(true);
    setParseError(null);
    setParsedPreview(null);

    try {
      const response = await fetch('/api/finance/parse-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText,
          sourceType,
          attachments: queuedFiles.map((f) => ({
            fileName: f.fileName,
            mimeType: f.mimeType,
            base64Data: f.base64Data,
          })),
          existingTransactions: existingTransactions.filter((t) => t.monthKey === '2026-11'),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to parse receipt or statement.');
      }
      setParsedPreview(data);
    } catch (err: any) {
      setParseError(err.message || 'Error running OCR / parsing financial record.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleConfirmAiImport = () => {
    if (!parsedPreview) return;
    const newItems: Transaction[] = [];
    const mergedUpdates: Array<{
      existingId: string;
      newSource: DataSource;
      rawDescriptor: string;
    }> = [];

    const allowedSources: DataSource[] = [
      'Gmail',
      'Bank Statement',
      'Apple Pay',
      'Uploaded Statement',
      'Cash / Manual',
    ];

    parsedPreview.extractedTransactions.forEach((item, idx) => {
      const resolvedSource: DataSource = allowedSources.includes(item.source as DataSource)
        ? (item.source as DataSource)
        : sourceType;

      if (item.matchedExistingId && item.matchedExistingId.trim() !== '') {
        mergedUpdates.push({
          existingId: item.matchedExistingId,
          newSource: resolvedSource,
          rawDescriptor: item.rawDescription || `${item.merchant} (${formatCurrency(item.amount)})`,
        });
      } else {
        const cleanCategory = ALL_SPENDING_CATEGORIES.includes(item.category)
          ? (item.category as SpendingCategory)
          : 'Other / Uncategorized';

        const txDate = item.date || '2026-11-17';
        const monthKey: '2026-11' | '2026-10' = txDate.startsWith('2026-10')
          ? '2026-10'
          : '2026-11';

        newItems.push({
          id: `tx-ingested-${Date.now()}-${idx}`,
          date: txDate,
          time: '11:30',
          merchant: item.merchant,
          rawDescription:
            item.rawDescription ||
            (queuedFiles.length > 0 ? `OCR RECEIPT · ${item.merchant}` : item.merchant),
          amount: Math.abs(Number(item.amount) || 0),
          paymentMethod: item.paymentMethod || 'Card / Statement',
          category: cleanCategory,
          status: (item.status as TransactionStatus) || 'posted',
          transactionType: (item.transactionType as TransactionType) || 'purchase',
          source: resolvedSource,
          isDeduplicated: false,
          mergedSources: [
            {
              source: resolvedSource,
              referenceId: `${queuedFiles.length > 0 ? 'OCR' : 'ING'}-${Date.now()
                .toString()
                .slice(-5)}`,
              capturedAt: '2026-11-17 11:30',
              rawDescriptor: item.rawDescription || item.merchant,
              statusAtCapture: (item.status as TransactionStatus) || 'posted',
            },
          ],
          uncertainCategory: Boolean(item.uncertainCategory),
          uncertaintyReason: item.uncertaintyPrompt || undefined,
          suggestedCategories: item.suggestedCategories?.filter((c: any) =>
            ALL_SPENDING_CATEGORIES.includes(c)
          ) as SpendingCategory[],
          monthKey,
        });
      }
    });

    onCommitTransactions(newItems, mergedUpdates);
    setParsedPreview(null);
    setQueuedFiles([]);
    onClose();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const rawNumeric = parseFloat(manualAmount);
    if (!manualMerchant.trim() || isNaN(rawNumeric) || rawNumeric < 0) return;

    const { usdAmount: numericAmount, rateUsed } = convertToUsd(
      rawNumeric,
      manualCurrency,
      undefined,
      fxRates
    );

    const duplicateMatch = existingTransactions.find(
      (t) =>
        t.date === manualDate &&
        Math.abs(t.amount - numericAmount) < 0.01 &&
        t.merchant.toLowerCase() === manualMerchant.trim().toLowerCase()
    );

    if (duplicateMatch) {
      onCommitTransactions(
        [],
        [
          {
            existingId: duplicateMatch.id,
            newSource: manualSource,
            rawDescriptor: `${manualMerchant.trim()} · ${formatCurrency(numericAmount)}`,
          },
        ]
      );
    } else {
      const monthKey: '2026-11' | '2026-10' = manualDate.startsWith('2026-10')
        ? '2026-10'
        : '2026-11';

      const fxDetail =
        manualCurrency !== 'USD'
          ? ` · ${rawNumeric.toLocaleString('en-US', {
              maximumFractionDigits: 2,
            })} ${manualCurrency} (@ ${rateUsed})`
          : '';

      const newTx: Transaction = {
        id: `tx-manual-${Date.now()}`,
        date: manualDate,
        time: '11:30',
        merchant: manualMerchant.trim(),
        rawDescription: `MANUAL ENTRY · ${manualMerchant.trim().toUpperCase()}${fxDetail}`,
        amount: numericAmount,
        paymentMethod: manualPayment,
        category: manualCategory,
        status: manualStatus,
        transactionType: manualType,
        source: manualSource,
        isDeduplicated: false,
        mergedSources: [
          {
            source: manualSource,
            referenceId: `MAN-${Date.now().toString().slice(-5)}`,
            capturedAt: '2026-11-17 11:30',
            rawDescriptor: `${manualMerchant.trim()}${fxDetail}`,
            statusAtCapture: manualStatus,
          },
        ],
        uncertainCategory: manualCategory === 'Other / Uncategorized',
        uncertaintyReason:
          manualCategory === 'Other / Uncategorized'
            ? 'Manually logged as Other / Uncategorized — please confirm specific category.'
            : undefined,
        monthKey,
      };
      onCommitTransactions([newTx], []);
    }

    onClose();
  };

  const allCsvRowsSelected =
    csvPreviewRows.length > 0 && csvPreviewRows.every((r) => r.included);

  return (
    <div
      onPaste={handlePaste}
      onClick={onClose}
      className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
              Import, Export &amp; Scan Receipts / PDFs
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unified hub for CSV statements, receipt &amp; PDF OCR, filtered CSV exports, and manual entries
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg overflow-x-auto">
            <button
              type="button"
              onClick={() => setMode('csv_import')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'csv_import'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Import CSV</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('ai_parse')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'ai_parse'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <ScanLine className="w-3.5 h-3.5" />
              <span>Scan Receipt / PDF</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('export_csv')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'export_csv'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export CSV</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                mode === 'manual'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs font-semibold'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Manual Entry {!isOnline ? '(Offline)' : ''}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Modal Body */}
        <div className="overflow-y-auto flex-1">
          {mode === 'csv_import' ? (
            <div className="p-6 space-y-4 text-xs">
              <input
                ref={csvFileInputRef}
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values,application/vnd.ms-excel,application/pdf,image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    void handleCsvFileSelected(file);
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />

              {/* CSV Dropzone */}
              {!csvStructure ? (
                <div className="space-y-4">
                  <div
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsCsvDragging(true);
                    }}
                    onDragEnter={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsCsvDragging(true);
                    }}
                    onDragLeave={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsCsvDragging(false);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsCsvDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) void handleCsvFileSelected(file);
                    }}
                    className={`border-2 border-dashed rounded-xl p-7 text-center transition-colors ${
                      isCsvDragging
                        ? 'border-emerald-600 dark:border-emerald-400 bg-emerald-50/40 dark:bg-emerald-950/20'
                        : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex flex-col items-center justify-center gap-2.5 max-w-md mx-auto">
                      <FileSpreadsheet className="w-6 h-6 text-emerald-700 dark:text-emerald-400" />
                      <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                        Upload a Bank, Credit Card, or LedgerPulse CSV File
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                        Automatically detects Date, Merchant, Amount, Debit/Credit, and Category columns from Chase, Amex, Capital One, Citi, Apple Card, Bank of America, or custom CSV exports. Works 100% locally &amp; offline.
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2 pt-1.5">
                        <button
                          type="button"
                          onClick={() => csvFileInputRef.current?.click()}
                          className="min-h-[38px] inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg transition-colors whitespace-nowrap"
                        >
                          <FileSpreadsheet className="w-3.5 h-3.5" />
                          <span>Choose CSV File</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowPasteCsvBox((prev) => !prev)}
                          className="min-h-[38px] inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                        >
                          <FileText className="w-3.5 h-3.5" />
                          <span>{showPasteCsvBox ? 'Hide Paste Box' : 'Paste CSV Text'}</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {showPasteCsvBox && (
                    <div className="space-y-2.5">
                      <label
                        htmlFor="paste-csv-textarea"
                        className="block font-medium text-slate-700 dark:text-slate-300"
                      >
                        Paste CSV rows (including header row if available):
                      </label>
                      <textarea
                        id="paste-csv-textarea"
                        rows={5}
                        value={csvRawText}
                        onChange={(e) => setCsvRawText(e.target.value)}
                        placeholder={'Date,Description,Category,Amount\n2026-11-15,Whole Foods Market,Groceries,-64.20'}
                        className="w-full p-3 font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                      />
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={!csvRawText.trim()}
                          onClick={() => loadCsvContent(csvRawText, 'Pasted CSV Rows')}
                          className="px-4 py-2 font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-950 rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
                        >
                          Parse CSV Preview
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Loaded CSV Header Strip */}
                  <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <FileSpreadsheet className="w-4 h-4 text-emerald-700 dark:text-emerald-400 shrink-0" />
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {csvFileName}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          {csvStructure.dataRows.length} raw rows · {csvPreviewRows.length} valid transactions ·{' '}
                          {includedCsvRows.length} selected for import
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setShowColumnMapper((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                      >
                        <Settings2 className="w-3.5 h-3.5" />
                        <span>{showColumnMapper ? 'Hide Column Mapping' : 'Column Mapping'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => csvFileInputRef.current?.click()}
                        className="px-3 py-1.5 font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                      >
                        Change File
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setCsvStructure(null);
                          setCsvRawText('');
                          setCsvFileName('');
                        }}
                        className="px-2.5 py-1.5 text-slate-500 hover:text-rose-600 dark:hover:text-rose-400"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  {/* Quick Settings Bar: Sign Convention + Currency Conversion + Default Account + Source */}
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Amount Sign Convention
                      </label>
                      <select
                        value={csvSignConvention}
                        onChange={(e) => setCsvSignConvention(e.target.value as CsvSignConvention)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      >
                        <option value="auto">Auto-detect (Recommended)</option>
                        <option value="negative_is_expense">Negative (-$10) = Purchase</option>
                        <option value="positive_is_expense">Positive ($10) = Purchase</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        CSV Currency → USD
                      </label>
                      <select
                        value={csvCurrencyMode}
                        onChange={(e) =>
                          setCsvCurrencyMode(e.target.value as 'AUTO' | SupportedCurrencyCode)
                        }
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      >
                        <option value="AUTO">Auto-detect (THB/USD/EUR...)</option>
                        {CURRENCY_OPTIONS.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code === 'USD'
                              ? 'USD ($)'
                              : `${c.code} (${c.symbol}) → USD (@ ${(fxRates[c.code] || 1).toFixed(2)})`}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Default Card / Account Label
                      </label>
                      <input
                        type="text"
                        value={csvDefaultPayment}
                        onChange={(e) => setCsvDefaultPayment(e.target.value)}
                        placeholder="e.g., Wise, Credit Card, Checking"
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Source Channel
                      </label>
                      <select
                        value={csvDefaultSource}
                        onChange={(e) => setCsvDefaultSource(e.target.value as DataSource)}
                        className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
                      >
                        <option value="Bank Statement">Bank Statement</option>
                        <option value="Uploaded Statement">Uploaded Statement</option>
                        <option value="Apple Pay">Apple Pay</option>
                        <option value="Cash / Manual">Cash / Manual</option>
                      </select>
                    </div>
                  </div>

                  {/* Optional Column Mapping Override Drawer */}
                  {showColumnMapper && (
                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-xl grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Date Column
                        </label>
                        <select
                          value={csvMapping.dateCol}
                          onChange={(e) =>
                            setCsvMapping((m) => ({ ...m, dateCol: Number(e.target.value) }))
                          }
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                        >
                          {csvStructure.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Merchant / Description
                        </label>
                        <select
                          value={csvMapping.merchantCol}
                          onChange={(e) =>
                            setCsvMapping((m) => ({ ...m, merchantCol: Number(e.target.value) }))
                          }
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                        >
                          {csvStructure.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Single Amount Column
                        </label>
                        <select
                          value={csvMapping.amountCol}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setCsvMapping((m) => ({
                              ...m,
                              amountCol: val,
                              debitCol: val >= 0 ? -1 : m.debitCol,
                              creditCol: val >= 0 ? -1 : m.creditCol,
                            }));
                          }}
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                        >
                          <option value={-1}>Use Separate Debit / Credit Columns</option>
                          {csvStructure.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>

                      {csvMapping.amountCol === -1 && (
                        <>
                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                              Debit / Outflow Column
                            </label>
                            <select
                              value={csvMapping.debitCol}
                              onChange={(e) =>
                                setCsvMapping((m) => ({ ...m, debitCol: Number(e.target.value) }))
                              }
                              className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                            >
                              <option value={-1}>None</option>
                              {csvStructure.headers.map((h, i) => (
                                <option key={i} value={i}>
                                  {h}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                              Credit / Refund Column
                            </label>
                            <select
                              value={csvMapping.creditCol}
                              onChange={(e) =>
                                setCsvMapping((m) => ({ ...m, creditCol: Number(e.target.value) }))
                              }
                              className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                            >
                              <option value={-1}>None</option>
                              {csvStructure.headers.map((h, i) => (
                                <option key={i} value={i}>
                                  {h}
                                </option>
                              ))}
                            </select>
                          </div>
                        </>
                      )}

                      <div>
                        <label className="block text-[11px] font-medium text-slate-600 dark:text-slate-400 mb-1">
                          Category Column (Optional)
                        </label>
                        <select
                          value={csvMapping.categoryCol}
                          onChange={(e) =>
                            setCsvMapping((m) => ({ ...m, categoryCol: Number(e.target.value) }))
                          }
                          className="w-full px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg"
                        >
                          <option value={-1}>Auto-classify from Merchant</option>
                          {csvStructure.headers.map((h, i) => (
                            <option key={i} value={i}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* CSV Preview Table */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <div className="max-h-72 overflow-y-auto">
                      <table className="w-full text-left border-collapse">
                        <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="py-2 pl-3.5 pr-2 w-8">
                              <input
                                type="checkbox"
                                aria-label="Select all CSV rows"
                                checked={allCsvRowsSelected}
                                onChange={() => {
                                  if (allCsvRowsSelected) {
                                    setExcludedRowIndices(
                                      new Set(csvPreviewRows.map((r) => r.rowIndex))
                                    );
                                  } else {
                                    setExcludedRowIndices(new Set());
                                  }
                                }}
                                className="rounded border-slate-300 dark:border-slate-600"
                              />
                            </th>
                            <th className="py-2 px-2.5">Date</th>
                            <th className="py-2 px-2.5">Merchant</th>
                            <th className="py-2 px-2.5">Category</th>
                            <th className="py-2 px-2.5">Type</th>
                            <th className="py-2 px-3.5 text-right">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900">
                          {csvPreviewRows.length === 0 ? (
                            <tr>
                              <td
                                colSpan={6}
                                className="py-6 text-center text-slate-500 dark:text-slate-400"
                              >
                                No numeric amounts found with the current column mapping. Click &ldquo;Column Mapping&rdquo; above to select your Amount column.
                              </td>
                            </tr>
                          ) : (
                            csvPreviewRows.map((row) => (
                              <tr
                                key={row.rowIndex}
                                className={row.included ? '' : 'opacity-45'}
                              >
                                <td className="py-2 pl-3.5 pr-2">
                                  <input
                                    type="checkbox"
                                    checked={row.included}
                                    onChange={() => {
                                      setExcludedRowIndices((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(row.rowIndex)) next.delete(row.rowIndex);
                                        else next.add(row.rowIndex);
                                        return next;
                                      });
                                    }}
                                    className="rounded border-slate-300 dark:border-slate-600"
                                  />
                                </td>
                                <td className="py-2 px-2.5 font-mono tabular-nums text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                  {row.date}
                                </td>
                                <td className="py-2 px-2.5">
                                  <div className="font-medium text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
                                    {row.merchant}
                                  </div>
                                  {row.matchedExistingId && (
                                    <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
                                      Merges duplicate #{row.matchedExistingId} ($0 added)
                                    </div>
                                  )}
                                </td>
                                <td className="py-2 px-2.5">
                                  {row.transactionType === 'income' ||
                                  row.transactionType === 'transfer' ? (
                                    <span className="text-slate-400 dark:text-slate-500">—</span>
                                  ) : (
                                    <select
                                      aria-label={`Category for ${row.merchant}`}
                                      value={row.category}
                                      onChange={(e) =>
                                        setCategoryOverrides((prev) => ({
                                          ...prev,
                                          [row.rowIndex]: e.target.value as SpendingCategory,
                                        }))
                                      }
                                      className="bg-transparent border-b border-transparent hover:border-slate-300 dark:hover:border-slate-600 py-0.5 text-slate-700 dark:text-slate-300 focus:outline-none"
                                    >
                                      {ALL_SPENDING_CATEGORIES.map((cat) => (
                                        <option
                                          key={cat}
                                          value={cat}
                                          className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                                        >
                                          {cat}
                                        </option>
                                      ))}
                                    </select>
                                  )}
                                </td>
                                <td className="py-2 px-2.5 capitalize text-slate-600 dark:text-slate-400 whitespace-nowrap">
                                  {row.transactionType}
                                </td>
                                <td className="py-2 px-3.5 text-right font-mono tabular-nums font-semibold whitespace-nowrap">
                                  {row.transactionType === 'refund' ? (
                                    <span className="text-emerald-700 dark:text-emerald-400">
                                      -{formatCurrency(row.amount)}
                                    </span>
                                  ) : row.transactionType === 'income' ? (
                                    <span className="text-emerald-700 dark:text-emerald-400">
                                      +{formatCurrency(row.amount)}
                                    </span>
                                  ) : row.transactionType === 'transfer' ? (
                                    <span className="text-slate-400 line-through">
                                      {formatCurrency(row.amount)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-900 dark:text-slate-100">
                                      {formatCurrency(row.amount)}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Commit CSV Action Bar */}
                  <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-1">
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      Duplicate purchases are automatically reconciled so nothing is counted twice.
                    </span>
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <button
                        type="button"
                        onClick={onClose}
                        className="px-3.5 py-2 font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={includedCsvRows.length === 0}
                        onClick={handleCommitCsvImport}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        <Check className="w-4 h-4" />
                        <span>
                          Import {includedCsvRows.length} CSV{' '}
                          {includedCsvRows.length === 1 ? 'Transaction' : 'Transactions'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {csvError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-800 dark:text-rose-200">
                  {csvError}
                </div>
              )}
            </div>
          ) : mode === 'ai_parse' ? (
            <div className="p-6 space-y-4">
              {/* Hidden File & Phone Camera Inputs */}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf,.csv,text/csv"
                multiple
                onChange={(e) => {
                  if (e.target.files) {
                    processFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  if (e.target.files) {
                    processFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />

              {/* Source Channel Selector */}
              <div className="flex flex-wrap items-center gap-1.5">
                <label className="text-xs font-medium text-slate-700 dark:text-slate-300 mr-1">
                  Channel:
                </label>
                {(
                  [
                    'Uploaded Statement',
                    'Apple Pay',
                    'Bank Statement',
                    'Gmail',
                    'Cash / Manual',
                  ] as DataSource[]
                ).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setSourceType(src)}
                    className={`px-2.5 py-1 text-xs rounded-lg border transition-colors whitespace-nowrap ${
                      sourceType === src
                        ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {src}
                  </button>
                ))}
              </div>

              {/* File Picker, Phone Camera + Drag-and-Drop Zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(true);
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOver(false);
                }}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${
                  isDraggingOver
                    ? 'border-slate-900 dark:border-slate-200 bg-slate-100/80 dark:bg-slate-800'
                    : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40'
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-2">
                  <UploadCloud className="w-5 h-5 text-slate-600 dark:text-slate-300" />
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Snap a Receipt on Your Phone or Drag &amp; Drop Images / PDF Statements
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Supports PNG, JPG, WEBP, HEIC receipts, multi-page PDF statements, and Ctrl+V clipboard paste
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                    >
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Browse Files</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5" />
                      <span>Use Phone Camera</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Attached Receipt / PDF Queue Preview */}
              {queuedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Ready for Vision OCR ({queuedFiles.length}{' '}
                      {queuedFiles.length === 1 ? 'capture' : 'captures'})
                    </span>
                    <button
                      type="button"
                      onClick={() => setQueuedFiles([])}
                      className="text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 underline underline-offset-2 py-1"
                    >
                      Clear all
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {queuedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl flex items-center justify-between gap-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {file.previewUrl ? (
                            <img
                              src={file.previewUrl}
                              alt={`Receipt preview for ${file.fileName}`}
                              referrerPolicy="no-referrer"
                              className="w-11 h-11 object-cover rounded-lg border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                            />
                          ) : (
                            <div className="w-11 h-11 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center shrink-0">
                              {file.mimeType === 'application/pdf' ? (
                                <FileSpreadsheet className="w-4 h-4 text-rose-600 dark:text-rose-400" />
                              ) : (
                                <ImageIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                              )}
                            </div>
                          )}

                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              {file.fileName}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400">
                              {file.mimeType === 'application/pdf' ? 'PDF Document' : 'Optimized Image'} ·{' '}
                              {formatFileSize(file.sizeBytes)}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          aria-label={`Remove ${file.fileName}`}
                          onClick={() => handleRemoveQueuedFile(file.id)}
                          className="min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-lg shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Voice Dictation or Raw Text / Email Input */}
              <VoiceRecorderControl
                variant="card"
                buttonLabel="Dictate Expenses"
                placeholderHint='Dictate one or multiple purchases (e.g., "Coffee at Blue Bottle $6.75 and Uber home $18.40") to transcribe and extract automatically.'
                disabled={!isOnline}
                onTranscribed={(spokenText) => {
                  setSourceType('Cash / Manual');
                  setRawText((prev) =>
                    prev.trim() ? `${prev.trim()}\n${spokenText}` : spokenText
                  );
                }}
              />

              <div>
                <label
                  htmlFor="raw-financial-text"
                  className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Transcribed voice note, email receipt text, or card alert text:
                </label>
                <textarea
                  id="raw-financial-text"
                  rows={2}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  className="w-full p-3 text-base sm:text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400"
                  placeholder="Speak above or paste email receipt text / statement lines..."
                />
              </div>

              {!isOnline && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 rounded-xl flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
                  <div className="flex items-center gap-2">
                    <WifiOff className="w-4 h-4 shrink-0" />
                    <span>Offline Mode active — use Import CSV or Manual Entry without network.</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMode('csv_import')}
                    className="px-3 py-1.5 font-semibold bg-amber-600 text-white rounded-lg shrink-0"
                  >
                    Import CSV
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  Extracts exact totals via Vision OCR and checks existing ledger entries for duplicates.
                </span>
                <button
                  type="button"
                  onClick={handleRunParse}
                  disabled={isParsing || (!rawText.trim() && queuedFiles.length === 0)}
                  className="min-h-[46px] sm:min-h-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-emerald-700 hover:bg-emerald-800 text-white rounded-xl disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
                >
                  {isParsing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>
                        {queuedFiles.length > 0
                          ? 'Scanning Receipt OCR...'
                          : 'Extracting & Deduplicating...'}
                      </span>
                    </>
                  ) : (
                    <>
                      {queuedFiles.length > 0 ? (
                        <ScanLine className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                      <span>
                        {queuedFiles.length > 0
                          ? `Extract ${queuedFiles.length} ${
                              queuedFiles.length === 1 ? 'Receipt' : 'Receipts'
                            } via OCR`
                          : 'Analyze & Extract Transactions'}
                      </span>
                    </>
                  )}
                </button>
              </div>

              {parseError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-xl text-xs text-rose-800 dark:text-rose-200">
                  {parseError}
                </div>
              )}

              {parsedPreview && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden space-y-3 bg-slate-50/50 dark:bg-slate-800/40 p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                      OCR &amp; Deduplication Preview
                    </div>
                    <span className="text-xs text-slate-600 dark:text-slate-400">
                      {parsedPreview.summaryNote}
                    </span>
                  </div>

                  {parsedPreview.ocrTranscribedText && parsedPreview.ocrTranscribedText.trim() !== '' && (
                    <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg space-y-1">
                      <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                        <ScanLine className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400" />
                        <span>OCR Transcribed Receipt Details</span>
                      </div>
                      <pre className="text-[11px] font-mono text-slate-600 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">
                        {parsedPreview.ocrTranscribedText}
                      </pre>
                    </div>
                  )}

                  <div className="divide-y divide-slate-200 dark:divide-slate-800 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-xs">
                    {parsedPreview.extractedTransactions.length === 0 ? (
                      <div className="p-4 text-center text-slate-500 dark:text-slate-400">
                        No financial transactions were detected in the uploaded capture or text.
                      </div>
                    ) : (
                      parsedPreview.extractedTransactions.map((item, i) => {
                        const isDuplicate = Boolean(item.matchedExistingId);
                        return (
                          <div
                            key={i}
                            className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                          >
                            <div className="flex items-start gap-2.5">
                              <MerchantLogo
                                merchant={item.merchant || 'Unknown'}
                                rawDescription={item.rawDescription}
                                transactionType={item.transactionType}
                                paymentMethod={item.paymentMethod}
                                size="sm"
                              />
                              <div className="space-y-0.5">
                                <div className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2 flex-wrap">
                                  <span>{item.merchant}</span>
                                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                                  <span className="font-mono">{formatCurrency(item.amount)}</span>
                                  <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
                                  <span className="font-mono text-slate-500 dark:text-slate-400">
                                    {item.date}
                                  </span>
                                </div>
                                <div className="text-slate-500 dark:text-slate-400">
                                  Category:{' '}
                                  <strong className="text-slate-800 dark:text-slate-200">
                                    {item.category}
                                  </strong>{' '}
                                  · Payment:{' '}
                                  <span className="text-slate-700 dark:text-slate-300">
                                    {item.paymentMethod}
                                  </span>{' '}
                                  · Status: <span className="capitalize">{item.status}</span>
                                </div>
                                {item.uncertainCategory && (
                                  <div className="text-amber-700 dark:text-amber-400 font-medium">
                                    Flagged as uncertain: {item.uncertaintyPrompt}
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0">
                              {isDuplicate ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
                                  <Layers className="w-3.5 h-3.5" />
                                  Matched #{item.matchedExistingId} (Merges source, $0 added)
                                </span>
                              ) : item.transactionType === 'transfer' ? (
                                <span className="text-slate-500 dark:text-slate-400">
                                  Internal Transfer (Excluded from spend)
                                </span>
                              ) : (
                                <span className="text-slate-900 dark:text-slate-100 font-medium">
                                  New Ledger Record
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setParsedPreview(null)}
                      className="min-h-[44px] sm:min-h-0 px-3 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                    >
                      Reset Preview
                    </button>
                    {parsedPreview.extractedTransactions.length > 0 && (
                      <button
                        type="button"
                        onClick={handleConfirmAiImport}
                        className="min-h-[46px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold bg-emerald-700 text-white rounded-xl hover:bg-emerald-800 transition-colors"
                      >
                        <Check className="w-4 h-4" />
                        <span>Commit Reconciled Records to Ledger</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : mode === 'manual' ? (
            <form onSubmit={handleManualSubmit} className="p-5 sm:p-6 space-y-4 text-xs">
              {isOnline && (
                <VoiceRecorderControl
                  variant="card"
                  buttonLabel="Auto-Fill by Voice"
                  placeholderHint='Speak to auto-fill fields: "Sent 3,500 THB on Wise for electricity" or "Lunch at Chipotle $13.25 with Apple Pay"'
                  onTranscribed={(spokenText) => {
                    const draft = parseSpokenTransactionDraft(spokenText, fxRates);
                    setManualDate(draft.date);
                    if (draft.merchant) setManualMerchant(draft.merchant);
                    if (draft.amountInOriginalCurrency !== null) {
                      setManualAmount(String(draft.amountInOriginalCurrency));
                    }
                    setManualCurrency(draft.currencyCode);
                    setManualCategory(draft.category);
                    setManualPayment(draft.paymentMethod);
                    setManualType(draft.transactionType);
                    setManualSource(
                      draft.paymentMethod === 'Apple Pay' ? 'Apple Pay' : 'Cash / Manual'
                    );
                  }}
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={manualDate}
                    onChange={(e) => setManualDate(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Merchant / Store
                  </label>
                  <input
                    type="text"
                    value={manualMerchant}
                    onChange={(e) => setManualMerchant(e.target.value)}
                    placeholder="Merchant name"
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    required
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Amount &amp; Currency
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={manualAmount}
                      onChange={(e) => setManualAmount(e.target.value)}
                      placeholder="0.00"
                      className="flex-1 min-w-0 min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                      required
                    />
                    <select
                      aria-label="Entry currency"
                      value={manualCurrency}
                      onChange={(e) =>
                        setManualCurrency(e.target.value as SupportedCurrencyCode)
                      }
                      className="min-h-[44px] sm:min-h-0 px-2.5 py-2 text-base sm:text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                    >
                      {CURRENCY_OPTIONS.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code} ({c.symbol})
                        </option>
                      ))}
                    </select>
                  </div>
                  {manualCurrency !== 'USD' && Number(manualAmount) > 0 && (
                    <div className="text-[11px] font-mono tabular-nums text-emerald-700 dark:text-emerald-400 mt-1">
                      ≈{' '}
                      {formatCurrency(
                        convertToUsd(Number(manualAmount), manualCurrency, undefined, fxRates)
                          .usdAmount
                      )}{' '}
                      USD (1 USD = {(fxRates[manualCurrency] || 1).toFixed(2)} {manualCurrency})
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Spending Category
                  </label>
                  <select
                    value={manualCategory}
                    onChange={(e) => setManualCategory(e.target.value as SpendingCategory)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    {ALL_SPENDING_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Payment Method
                  </label>
                  <input
                    type="text"
                    value={manualPayment}
                    onChange={(e) => setManualPayment(e.target.value)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Source of Information
                  </label>
                  <select
                    value={manualSource}
                    onChange={(e) => setManualSource(e.target.value as DataSource)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    <option value="Apple Pay">Apple Pay</option>
                    <option value="Gmail">Gmail</option>
                    <option value="Bank Statement">Bank Statement</option>
                    <option value="Uploaded Statement">Uploaded Statement</option>
                    <option value="Cash / Manual">Cash / Manual</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Transaction Status
                  </label>
                  <select
                    value={manualStatus}
                    onChange={(e) => setManualStatus(e.target.value as TransactionStatus)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    <option value="posted">Posted</option>
                    <option value="pending">Pending</option>
                    <option value="refunded">Refunded</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Record Classification
                  </label>
                  <select
                    value={manualType}
                    onChange={(e) => setManualType(e.target.value as TransactionType)}
                    className="w-full min-h-[44px] sm:min-h-0 px-3 py-2 text-base sm:text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    <option value="purchase">Purchase (Counts as Spending)</option>
                    <option value="refund">Refund (Offsets Spending)</option>
                    <option value="income">Income / Deposit</option>
                    <option value="transfer">Account Transfer (Excluded from Spend)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] sm:min-h-0 px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="min-h-[46px] sm:min-h-0 inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-xs font-semibold bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-xl hover:bg-slate-800 dark:hover:bg-white"
                >
                  <Plus className="w-4 h-4" />
                  <span>Record Transaction</span>
                </button>
              </div>
            </form>
          ) : mode === 'export_csv' ? (
            <div className="p-6 space-y-5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Date Scope
                  </label>
                  <select
                    value={exportScope}
                    onChange={(e) =>
                      setExportScope(e.target.value as '2026-11' | '2026-10' | 'all')
                    }
                    className="w-full min-h-[42px] sm:min-h-0 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    <option value="2026-11">This Month (November 2026)</option>
                    <option value="2026-10">Last Month (October 2026)</option>
                    <option value="all">All Recorded Transactions</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                    Record Filter
                  </label>
                  <select
                    value={exportTypeFilter}
                    onChange={(e) =>
                      setExportTypeFilter(
                        e.target.value as 'all' | 'purchase' | 'purchase_refund' | 'income'
                      )
                    }
                    className="w-full min-h-[42px] sm:min-h-0 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  >
                    <option value="all">All Record Types (Purchases, Refunds, Income, Transfers)</option>
                    <option value="purchase">Purchases Only</option>
                    <option value="purchase_refund">Purchases &amp; Refunds Only</option>
                    <option value="income">Income &amp; Deposits Only</option>
                  </select>
                </div>
              </div>

              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 rounded-xl space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    Reconciled CSV Export Summary
                  </span>
                  <span className="font-mono tabular-nums text-emerald-700 dark:text-emerald-400 font-semibold">
                    {exportableTransactions.length}{' '}
                    {exportableTransactions.length === 1 ? 'row' : 'rows'} matched
                  </span>
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-relaxed">
                  Includes deduplicated provenance counts, exact card outflow (<code className="font-mono">AmountPaid</code>), your net personal spend (<code className="font-mono">PersonalShare</code>), and open friend split receivables (<code className="font-mono">SplitOwedToYou</code>)—and can be re-imported directly via the <strong>Import CSV</strong> tab.
                </p>

                {exportableTransactions.length > 0 && (
                  <div className="pt-2 border-t border-slate-200 dark:border-slate-700/80 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums text-[11px] text-slate-600 dark:text-slate-300">
                    <span>
                      Total Outflow:{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {formatCurrency(
                          exportableTransactions
                            .filter((t) => t.transactionType === 'purchase')
                            .reduce((s, t) => s + t.amount, 0)
                        )}
                      </strong>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Your Personal Share:{' '}
                      <strong className="text-slate-900 dark:text-slate-100">
                        {formatCurrency(
                          exportableTransactions
                            .filter((t) => t.transactionType === 'purchase')
                            .reduce((s, t) => s + getTransactionSplitSummary(t).personalShare, 0)
                        )}
                      </strong>
                    </span>
                  </div>
                )}
              </div>

              <div className="flex flex-col-reverse sm:flex-row items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Cancel
                </button>

                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    type="button"
                    onClick={handleCopyExportCsv}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap"
                  >
                    {copiedExportCsv ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span>Copied CSV</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        <span>Copy CSV</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={handleDownloadExportCsv}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      Download CSV ({exportableTransactions.length})
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
