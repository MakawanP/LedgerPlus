import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class FirestoreErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected synchronization error.',
    };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    let friendlyTitle = 'Cloud Sync Encountered an Issue';
    let detailMessage = this.state.errorMessage;
    let isQuotaError = false;

    try {
      const parsed = JSON.parse(this.state.errorMessage);
      if (parsed && typeof parsed.error === 'string') {
        detailMessage = `${parsed.error} (Operation: ${parsed.operationType} on ${
          parsed.path || 'unknown path'
        })`;
        if (parsed.error.includes('Quota exceeded')) {
          isQuotaError = true;
          friendlyTitle = 'Daily Cloud Sync Quota Reached';
        }
      }
    } catch {
      if (this.state.errorMessage.includes('Quota exceeded')) {
        isQuotaError = true;
        friendlyTitle = 'Daily Cloud Sync Quota Reached';
      }
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 p-6">
        <div className="max-w-lg w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 space-y-4 text-xs">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                {friendlyTitle}
              </h2>
              <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                {isQuotaError
                  ? 'Your Firebase free-tier daily quota has been reached and will reset tomorrow. Your local device cache remains intact.'
                  : detailMessage}
              </p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 font-semibold text-white dark:text-slate-950 bg-slate-900 dark:bg-slate-100 rounded-lg hover:bg-slate-800 dark:hover:bg-white transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reload Application</span>
            </button>
          </div>
        </div>
      </div>
    );
  }
}
