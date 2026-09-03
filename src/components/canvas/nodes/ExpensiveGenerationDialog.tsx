'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';

interface ExpensiveGenerationDialogProps {
  /** Estimated cost in USD, already known to be above the confirmation threshold. */
  estimatedCostUsd: number;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Blocks a pricey video generation behind an explicit confirmation so a
 * mis-set duration or resolution does not silently burn the Fal balance.
 */
export function ExpensiveGenerationDialog({
  estimatedCostUsd,
  onConfirm,
  onCancel,
}: ExpensiveGenerationDialogProps) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="nodrag nowheel nopan"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={onCancel}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(0,0,0,0.72)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="expensive-generation-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(400px, 100%)',
          padding: 20,
          borderRadius: 16,
          background: '#1f1f20',
          border: '1px solid rgba(255,255,255,0.14)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
          color: 'var(--color-white)',
          fontFamily: 'var(--font-manrope), Manrope, sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span style={{ display: 'flex', color: '#f97316' }}>
            <AlertTriangle size={16} />
          </span>
          <h2 id="expensive-generation-title" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
            Expensive generation
          </h2>
        </div>

        <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--color-white-muted)' }}>
          Confirm you want to generate this video, it will cost you{' '}
          <strong style={{ color: 'var(--color-white)', fontVariantNumeric: 'tabular-nums' }}>
            ~${estimatedCostUsd.toFixed(2)}
          </strong>
        </p>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={onCancel}
            className="nodrag transition-opacity hover:opacity-80"
            style={{
              padding: '8px 12px',
              border: '1px solid rgba(255,255,255,0.14)',
              borderRadius: 9,
              background: 'transparent',
              color: 'var(--color-white)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            autoFocus
            onClick={onConfirm}
            className="nodrag transition-opacity hover:opacity-80"
            style={{
              padding: '8px 12px',
              border: 'none',
              borderRadius: 9,
              background: 'var(--color-accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Confirm &amp; Generate
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
