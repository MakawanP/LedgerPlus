import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Loader2,
  Mic,
  RotateCcw,
  Square,
  Upload,
} from 'lucide-react';
import { transcribeAudioBlob } from '../utils/spokenExpenseParser';

interface VoiceRecorderControlProps {
  variant?: 'inline' | 'card';
  onTranscribed: (transcript: string) => void;
  placeholderHint?: string;
  buttonLabel?: string;
  autoStartSignal?: number;
  disabled?: boolean;
}

function pickSupportedRecorderMimeType(): string {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    return '';
  }
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/aac',
  ];
  for (const candidate of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // Ignore unsupported query
    }
  }
  return '';
}

function formatElapsedSeconds(totalSec: number): string {
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export const VoiceRecorderControl: React.FC<VoiceRecorderControlProps> = ({
  variant = 'card',
  onTranscribed,
  placeholderHint = 'Try saying: "Spent $14.50 at Starbucks with Apple Pay" or "Sent 3,500 THB on Wise for electric bill"',
  buttonLabel = 'Voice Record',
  autoStartSignal,
  disabled = false,
}) => {
  const [status, setStatus] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [lastTranscript, setLastTranscript] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioFileInputRef = useRef<HTMLInputElement | null>(null);
  const lastHandledSignalRef = useRef<number | undefined>(undefined);

  const cleanupMediaResources = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupMediaResources();
    };
  }, [cleanupMediaResources]);

  const handleTranscribeBlob = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (!blob || blob.size === 0) {
        setStatus('idle');
        setErrorMessage('No audio was captured. Please try speaking again.');
        return;
      }

      setStatus('transcribing');
      setErrorMessage(null);
      try {
        const text = await transcribeAudioBlob(blob, mimeType);
        if (!text) {
          setErrorMessage('No speech detected in recording. Try speaking closer to the microphone.');
          setStatus('idle');
          return;
        }
        setLastTranscript(text);
        onTranscribed(text);
        setStatus('idle');
      } catch (err: any) {
        setErrorMessage(err?.message || 'Unable to transcribe audio.');
        setStatus('idle');
      }
    },
    [onTranscribed]
  );

  const startRecording = useCallback(async () => {
    if (disabled || status === 'recording' || status === 'transcribing') return;
    setErrorMessage(null);

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      setErrorMessage(
        'Microphone recording is unavailable in this browser context. You can upload an audio clip instead.'
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      chunksRef.current = [];

      const preferredMime = pickSupportedRecorderMimeType();
      const recorder = preferredMime
        ? new MediaRecorder(stream, { mimeType: preferredMime })
        : new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = () => {
        cleanupMediaResources();
        setStatus('idle');
        setErrorMessage('Microphone recording interrupted. Please try again.');
      };

      recorder.onstop = () => {
        const resolvedMime =
          recorder.mimeType || preferredMime || 'audio/webm';
        const recordedBlob = new Blob(chunksRef.current, { type: resolvedMime });
        chunksRef.current = [];
        cleanupMediaResources();
        void handleTranscribeBlob(recordedBlob, resolvedMime);
      };

      recorder.start(250);
      setElapsedSeconds(0);
      setStatus('recording');

      timerRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } catch (err: any) {
      cleanupMediaResources();
      setStatus('idle');
      const name = String(err?.name || '');
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setErrorMessage(
          'Microphone access was blocked. Allow microphone permission in your browser address bar, or upload an audio clip.'
        );
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        setErrorMessage(
          'No microphone detected on this device. Connect a mic or upload an audio file.'
        );
      } else {
        setErrorMessage(err?.message || 'Could not start microphone recording.');
      }
    }
  }, [cleanupMediaResources, disabled, handleTranscribeBlob, status]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        cleanupMediaResources();
        setStatus('idle');
      }
    } else {
      cleanupMediaResources();
      setStatus('idle');
    }
  }, [cleanupMediaResources]);

  useEffect(() => {
    if (
      autoStartSignal &&
      autoStartSignal > 0 &&
      lastHandledSignalRef.current !== autoStartSignal
    ) {
      lastHandledSignalRef.current = autoStartSignal;
      void startRecording();
    }
  }, [autoStartSignal, startRecording]);

  const handleAudioFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      setErrorMessage('Audio file exceeds the 20 MB limit.');
      return;
    }
    void handleTranscribeBlob(file, file.type || 'audio/mp3');
  };

  if (variant === 'inline') {
    return (
      <div className="inline-flex flex-col gap-1">
        <input
          ref={audioFileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.aac"
          onChange={handleAudioFileUpload}
          className="hidden"
        />
        <div className="inline-flex items-center gap-1.5">
          {status === 'recording' ? (
            <button
              type="button"
              onClick={stopRecording}
              aria-label="Stop voice recording and transcribe"
              className="min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="font-mono tabular-nums">
                {formatElapsedSeconds(elapsedSeconds)} · Stop
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled || status === 'transcribing'}
              onClick={() => void startRecording()}
              aria-label="Record question with microphone"
              title="Record with microphone"
              className="min-h-[36px] inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {status === 'transcribing' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Transcribing...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>{buttonLabel}</span>
                </>
              )}
            </button>
          )}
        </div>
        {errorMessage && (
          <div className="text-[11px] text-rose-600 dark:text-rose-400 flex items-center gap-2">
            <span>{errorMessage}</span>
            <button
              type="button"
              onClick={() => audioFileInputRef.current?.click()}
              className="underline font-medium whitespace-nowrap"
            >
              Upload audio
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl space-y-2 text-xs">
      <input
        ref={audioFileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.webm,.ogg,.aac"
        onChange={handleAudioFileUpload}
        className="hidden"
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-slate-900 dark:text-slate-100">
            Voice Dictation &amp; Audio Transcription
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-snug">
            {placeholderHint}
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {status === 'recording' ? (
            <button
              type="button"
              onClick={stopRecording}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-rose-600 hover:bg-rose-700 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Square className="w-3 h-3 fill-current" />
              <span className="font-mono tabular-nums">
                Stop ({formatElapsedSeconds(elapsedSeconds)})
              </span>
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled || status === 'transcribing'}
              onClick={() => void startRecording()}
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-900 dark:bg-slate-100 hover:bg-slate-800 dark:hover:bg-white text-white dark:text-slate-950 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              {status === 'transcribing' ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Transcribing...</span>
                </>
              ) : (
                <>
                  <Mic className="w-3.5 h-3.5" />
                  <span>{lastTranscript ? 'Record Again' : buttonLabel}</span>
                </>
              )}
            </button>
          )}

          {status !== 'recording' && (
            <button
              type="button"
              disabled={disabled || status === 'transcribing'}
              onClick={() => audioFileInputRef.current?.click()}
              title="Upload voice memo or audio file (.m4a, .mp3, .wav, .webm)"
              className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Audio File</span>
            </button>
          )}
        </div>
      </div>

      {lastTranscript && status === 'idle' && (
        <div className="pt-1.5 border-t border-slate-200/80 dark:border-slate-700/70 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
            <span>Transcribed audio (editable):</span>
            <button
              type="button"
              onClick={() => onTranscribed(lastTranscript)}
              className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 hover:underline font-medium whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Re-apply to fields</span>
            </button>
          </div>
          <input
            type="text"
            value={lastTranscript}
            onChange={(e) => {
              const updated = e.target.value;
              setLastTranscript(updated);
              onTranscribed(updated);
            }}
            aria-label="Transcribed voice text"
            className="w-full px-2.5 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-none focus:border-slate-900 dark:focus:border-slate-400"
          />
        </div>
      )}

      {errorMessage && (
        <div className="pt-1 flex items-start gap-1.5 text-[11px] text-rose-700 dark:text-rose-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}
    </div>
  );
};
