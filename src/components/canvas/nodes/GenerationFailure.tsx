'use client';

import { AlertCircle, Check } from 'lucide-react';

/**
 * Fills a generation thumbnail with the reason FAL rejected it — the same
 * sentence the FAL dashboard shows, e.g. "Output audio has sensitive content".
 */
export function GenerationFailureOverlay({
  message,
  requestId,
}: {
  message?: string;
  requestId?: string;
}) {
  return (
    <div
      className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 py-3 text-center nodrag nowheel"
      style={{ background: 'rgba(248,113,113,0.12)', overflowY: 'auto' }}
    >
      <div className="flex items-center gap-1.5" style={{ color: 'var(--color-error)' }}>
        <AlertCircle size={11} className="shrink-0" />
        <span className="text-xs font-semibold">Generation failed</span>
      </div>
      <p
        className="text-xs leading-snug"
        style={{ color: 'var(--color-white-muted)', fontSize: 10, wordBreak: 'break-word' }}
      >
        {message ?? 'FAL did not report a reason for this failure.'}
      </p>
      {requestId && (
        <p
          className="select-text"
          style={{ color: 'var(--color-white-subtle)', fontSize: 9, wordBreak: 'break-all' }}
          title="Search this request ID in the FAL dashboard to see the full log"
        >
          FAL request {requestId}
        </p>
      )}
    </div>
  );
}

/**
 * Regenerating with the same inputs just reproduces the same rejection, so the
 * Generate button stays disabled until the user confirms they changed something.
 */
export function RegenerateGate({ onChangesApplied }: { onChangesApplied: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1">
      <span style={{ color: 'var(--color-white-muted)', fontSize: 10 }}>
        Make changes before regenerating
      </span>
      <button
        onClick={onChangesApplied}
        className="flex items-center gap-1 px-2 py-1 rounded-lg nodrag transition-opacity hover:opacity-80 active:opacity-60"
        style={{ background: 'var(--color-bg-hover)', color: 'var(--color-white-muted)', fontSize: 10 }}
      >
        <Check size={10} />
        Changes applied
      </button>
    </div>
  );
}
