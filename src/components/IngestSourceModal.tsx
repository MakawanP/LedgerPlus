import React, { useRef, useState } from 'react';
import {
  Check,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  Plus,
  ScanLine,
  Trash2,
  UploadCloud,
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
import { SAMPLE_INGEST_PRESETS } from '../data/sampleFinanceData';
import { formatCurrency } from '../utils/financeMetrics';
import { MerchantLogo } from './MerchantLogo';

interface IngestSourceModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingTransactions: Transaction[];
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
 * Generates a realistic synthetic thermal receipt PNG in-browser so users can
 * test real end-to-end multimodal OCR extraction with a single click.
 */
function createSampleReceiptDataUrl(): { dataUrl: string; base64Data: string } {
  const canvas = document.createElement('canvas');
  canvas.width = 460;
  canvas.height = 580;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { dataUrl: '', base64Data: '' };
  }

  // Paper background
  ctx.fillStyle = '#fdfdfc';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Subtle receipt border
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);

  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px monospace';
  ctx.fillText('TARTINE MANUFACTORY', canvas.width / 2, 62);

  ctx.font = '13px monospace';
  ctx.fillStyle = '#334155';
  ctx.fillText('595 ALABAMA ST, SAN FRANCISCO, CA', canvas.width / 2, 86);
  ctx.fillText('TEL: (415) 487-2600', canvas.width / 2, 106);

  ctx.textAlign = 'left';
  ctx.fillStyle = '#0f172a';
  ctx.fillText('DATE: 2026-11-17   TIME: 11:18 AM', 36, 146);
  ctx.fillText('RECEIPT #: TM-90482', 36, 168);
  ctx.fillText('----------------------------------------', 36, 194);

  const items: Array<[string, string]> = [
    ['1x Country Sourdough Loaf', '$12.50'],
    ['1x Morning Bun', '$6.25'],
    ['2x Cortado Espresso', '$11.00'],
  ];

  let y = 224;
  items.forEach(([label, price]) => {
    ctx.textAlign = 'left';
    ctx.fillText(label, 36, y);
    ctx.textAlign = 'right';
    ctx.fillText(price, canvas.width - 36, y);
    y += 28;
  });

  ctx.textAlign = 'left';
  ctx.fillText('----------------------------------------', 36, y + 6);

  y += 34;
  ctx.textAlign = 'left';
  ctx.fillText('SUBTOTAL', 36, y);
  ctx.textAlign = 'right';
  ctx.fillText('$29.75', canvas.width - 36, y);

  y += 24;
  ctx.textAlign = 'left';
  ctx.fillText('CA SALES TAX (8.625%)', 36, y);
  ctx.textAlign = 'right';
  ctx.fillText('$2.57', canvas.width - 36, y);

  y += 24;
  ctx.textAlign = 'left';
  ctx.fillText('TIP', 36, y);
  ctx.textAlign = 'right';
  ctx.fillText('$4.50', canvas.width - 36, y);

  y += 36;
  ctx.font = 'bold 18px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('TOTAL CHARGED', 36, y);
  ctx.textAlign = 'right';
  ctx.fillText('$36.82', canvas.width - 36, y);

  y += 38;
  ctx.font = '13px monospace';
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'left';
  ctx.fillText('PAYMENT: APPLE PAY · VISA ••4821', 36, y);
  ctx.fillText('STATUS: APPROVED / POSTED', 36, y + 22);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.fillText('THANK YOU FOR VISITING TARTINE', canvas.width / 2, 535);

  const dataUrl = canvas.toDataURL('image/png');
  const base64Data = dataUrl.split(',')[1] || '';
  return { dataUrl, base64Data };
}

export const IngestSourceModal: React.FC<IngestSourceModalProps> = ({
  isOpen,
  onClose,
  existingTransactions,
  onCommitTransactions,
}) => {
  const [mode, setMode] = useState<'ai_parse' | 'manual'>('ai_parse');
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Manual Entry State
  const [manualDate, setManualDate] = useState('2026-11-17');
  const [manualMerchant, setManualMerchant] = useState('');
  const [manualAmount, setManualAmount] = useState('');
  const [manualPayment, setManualPayment] = useState('Apple Pay · Chase Sapphire ••4821');
  const [manualCategory, setManualCategory] = useState<SpendingCategory>('Food & Restaurants');
  const [manualStatus, setManualStatus] = useState<TransactionStatus>('posted');
  const [manualType, setManualType] = useState<TransactionType>('purchase');
  const [manualSource, setManualSource] = useState<DataSource>('Apple Pay');

  if (!isOpen) return null;

  const processFiles = async (fileList: FileList | File[]) => {
    setParseError(null);
    const filesArray = Array.from(fileList);
    if (filesArray.length === 0) return;

    const newQueued: QueuedReceiptFile[] = [];

    for (const file of filesArray) {
      const normalizedType =
        file.type === 'image/jpg' ? 'image/jpeg' : file.type || 'application/octet-stream';
      const isPdf =
        normalizedType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
      const isImage = normalizedType.startsWith('image/');

      if (!isImage && !isPdf && !SUPPORTED_MIME_TYPES.includes(normalizedType)) {
        setParseError(
          `Unsupported file "${file.name}". Drop receipt images (PNG, JPG, WEBP, HEIC) or PDFs.`
        );
        continue;
      }

      if (file.size > 18 * 1024 * 1024) {
        setParseError(`File "${file.name}" exceeds the 18 MB per-receipt limit.`);
        continue;
      }

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error(`Failed to read ${file.name}`));
        reader.readAsDataURL(file);
      });

      const base64Data = dataUrl.split(',')[1] || '';
      const effectiveMime = isPdf ? 'application/pdf' : normalizedType;

      newQueued.push({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        fileName: file.name,
        mimeType: effectiveMime,
        sizeBytes: file.size,
        base64Data,
        previewUrl: isImage ? dataUrl : null,
      });
    }

    if (newQueued.length > 0) {
      setQueuedFiles((prev) => [...prev, ...newQueued]);
      setParsedPreview(null);
    }
  };

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

  const handleAttachSampleReceipt = () => {
    const { dataUrl, base64Data } = createSampleReceiptDataUrl();
    if (!base64Data) return;
    const approxBytes = Math.round((base64Data.length * 3) / 4);
    setSourceType('Uploaded Statement');
    setQueuedFiles((prev) => [
      ...prev,
      {
        id: `sample-receipt-${Date.now()}`,
        fileName: 'tartine_manufactory_receipt_nov17.png',
        mimeType: 'image/png',
        sizeBytes: approxBytes,
        base64Data,
        previewUrl: dataUrl,
      },
    ]);
    setParsedPreview(null);
    setParseError(null);
  };

  const handleRemoveQueuedFile = (id: string) => {
    setQueuedFiles((prev) => prev.filter((f) => f.id !== id));
  };

  const handleRunParse = async () => {
    if (!rawText.trim() && queuedFiles.length === 0) return;
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
          paymentMethod: item.paymentMethod || 'Chase Sapphire ••4821',
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
    const numericAmount = parseFloat(manualAmount);
    if (!manualMerchant.trim() || isNaN(numericAmount) || numericAmount <= 0) return;

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

      const newTx: Transaction = {
        id: `tx-manual-${Date.now()}`,
        date: manualDate,
        time: '11:30',
        merchant: manualMerchant.trim(),
        rawDescription: `MANUAL ENTRY · ${manualMerchant.trim().toUpperCase()}`,
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
            rawDescriptor: manualMerchant.trim(),
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

  return (
    <div
      onPaste={handlePaste}
      className="fixed inset-0 z-50 bg-slate-900/60 dark:bg-slate-950/75 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl max-w-3xl w-full overflow-hidden shadow-xl my-8">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
              Collect & Reconcile Transactions (Receipt OCR · PDF · Gmail · CSV)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Drop receipt photos or PDFs for Vision OCR extraction, or paste raw text · Deduplicates automatically
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Switcher */}
        <div className="px-6 py-3 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => setMode('ai_parse')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'ai_parse'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Receipt OCR & AI Statement Parser
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                mode === 'manual'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
              }`}
            >
              Manual Transaction Entry
            </button>
          </div>

          {mode === 'ai_parse' && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={handleAttachSampleReceipt}
                className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300 underline underline-offset-4"
              >
                <ScanLine className="w-3.5 h-3.5" />
                <span>Load Sample Receipt Image (OCR Test)</span>
              </button>
              <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
              {SAMPLE_INGEST_PRESETS.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setSourceType(preset.sourceType);
                    setRawText(preset.rawText);
                    setParsedPreview(null);
                  }}
                  className="text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 underline underline-offset-4"
                >
                  Text {idx + 1} ({preset.sourceType})
                </button>
              ))}
            </div>
          )}
        </div>

        {mode === 'ai_parse' ? (
          <div className="p-6 space-y-4">
            {/* Source Channel Selector */}
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-medium text-slate-700 dark:text-slate-300 mr-1">
                Source Channel:
              </label>
              {(
                [
                  'Uploaded Statement',
                  'Gmail',
                  'Apple Pay',
                  'Bank Statement',
                  'Cash / Manual',
                ] as DataSource[]
              ).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => setSourceType(src)}
                  className={`px-2.5 py-1 text-xs rounded-md border transition-colors ${
                    sourceType === src
                      ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
                      : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                  }`}
                >
                  {src}
                </button>
              ))}
            </div>

            {/* Drag-and-Drop Receipt Image & PDF OCR Zone */}
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/heic,image/heif,application/pdf"
                multiple
                onChange={(e) => {
                  if (e.target.files) {
                    processFiles(e.target.files);
                    e.target.value = '';
                  }
                }}
                className="hidden"
              />

              <div
                role="button"
                tabIndex={0}
                aria-label="Drop receipt images or PDF statements here, or click to browse"
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
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                  isDraggingOver
                    ? 'border-slate-900 dark:border-slate-200 bg-slate-100/80 dark:bg-slate-800'
                    : 'border-slate-300 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/70 hover:border-slate-400 dark:hover:border-slate-600'
                }`}
              >
                <div className="flex flex-col items-center justify-center gap-1.5">
                  <UploadCloud
                    className={`w-6 h-6 ${
                      isDraggingOver
                        ? 'text-slate-900 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  />
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    Drag & drop receipt images or PDF statements here, or{' '}
                    <span className="underline underline-offset-4">browse files</span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Supports PNG, JPG, WEBP, HEIC photos & multi-page PDF receipts/invoices (up to 18 MB · Clipboard paste supported)
                  </p>
                </div>
              </div>

              {/* Attached Receipt / PDF Queue Preview */}
              {queuedFiles.length > 0 && (
                <div className="mt-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Queued for Multimodal OCR ({queuedFiles.length}{' '}
                      {queuedFiles.length === 1 ? 'document' : 'documents'})
                    </span>
                    <button
                      type="button"
                      onClick={() => setQueuedFiles([])}
                      className="text-slate-500 dark:text-slate-400 hover:text-rose-700 dark:hover:text-rose-400 underline underline-offset-2"
                    >
                      Clear all files
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {queuedFiles.map((file) => (
                      <div
                        key={file.id}
                        className="p-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-lg flex items-center justify-between gap-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          {file.previewUrl ? (
                            <img
                              src={file.previewUrl}
                              alt={`Receipt preview for ${file.fileName}`}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 object-cover rounded border border-slate-200 dark:border-slate-700 bg-white shrink-0"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center shrink-0">
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
                              {file.mimeType === 'application/pdf' ? 'PDF Document' : 'Receipt Image'} ·{' '}
                              {formatFileSize(file.sizeBytes)}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          aria-label={`Remove ${file.fileName}`}
                          onClick={() => handleRemoveQueuedFile(file.id)}
                          className="p-1.5 text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 rounded-md shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Optional Raw Text / Email / CSV Input */}
            <div>
              <label
                htmlFor="raw-financial-text"
                className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Or paste Gmail receipt text, Apple Pay notification, or Bank CSV lines (optional when files are attached):
              </label>
              <textarea
                id="raw-financial-text"
                rows={3}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                className="w-full p-3 text-xs font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:bg-white dark:focus:bg-slate-900 focus:border-slate-900 dark:focus:border-slate-400"
                placeholder="Optional: Paste email receipt text, context notes, or CSV statement rows..."
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Uses Gemini Vision OCR to read exact totals and cross-check existing ledger entries for duplicates.
              </span>
              <button
                type="button"
                onClick={handleRunParse}
                disabled={isParsing || (!rawText.trim() && queuedFiles.length === 0)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
              >
                {isParsing ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>
                      {queuedFiles.length > 0
                        ? 'Running Receipt OCR & Deduplicating...'
                        : 'Extracting & Checking Duplicates...'}
                    </span>
                  </>
                ) : (
                  <>
                    {queuedFiles.length > 0 ? (
                      <ScanLine className="w-3.5 h-3.5" />
                    ) : (
                      <FileText className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {queuedFiles.length > 0
                        ? `Run OCR on ${queuedFiles.length} ${
                            queuedFiles.length === 1 ? 'File' : 'Files'
                          } & Extract`
                        : 'Analyze & Extract Transactions'}
                    </span>
                  </>
                )}
              </button>
            </div>

            {parseError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 rounded-lg text-xs text-rose-800 dark:text-rose-200">
                {parseError}
              </div>
            )}

            {parsedPreview && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden space-y-3 bg-slate-50/50 dark:bg-slate-800/40 p-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                    OCR & Deduplication Preview
                  </div>
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {parsedPreview.summaryNote}
                  </span>
                </div>

                {/* Verbatim OCR Transcription Snippet */}
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
                      No financial transactions were detected in the uploaded file or text.
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
                                Matched existing #{item.matchedExistingId} (Merges source, $0 added)
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

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setParsedPreview(null)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                  >
                    Reset Preview
                  </button>
                  {parsedPreview.extractedTransactions.length > 0 && (
                    <button
                      type="button"
                      onClick={handleConfirmAiImport}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-emerald-700 text-white rounded-lg hover:bg-emerald-800 transition-colors"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>Commit Reconciled Records to Ledger</span>
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleManualSubmit} className="p-6 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Date
                </label>
                <input
                  type="date"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
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
                  placeholder="e.g., Philz Coffee"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  required
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Exact Amount ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={manualAmount}
                  onChange={(e) => setManualAmount(e.target.value)}
                  placeholder="14.50"
                  className="w-full px-3 py-2 font-mono bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                  required
                />
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
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
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
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Source of Information
                </label>
                <select
                  value={manualSource}
                  onChange={(e) => setManualSource(e.target.value as DataSource)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
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
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
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
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
                >
                  <option value="purchase">Purchase (Counts as Spending)</option>
                  <option value="refund">Refund (Offsets Spending)</option>
                  <option value="income">Income / Deposit</option>
                  <option value="transfer">Account Transfer (Excluded from Spend)</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-white"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Record Transaction</span>
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
