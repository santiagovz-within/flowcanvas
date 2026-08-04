import { cn } from '@/lib/utils/cn';
import type { NodeStatus } from '@/types';
import { RefreshCw, Check, AlertCircle, Copy } from 'lucide-react';
import { useState } from 'react';
import { CanvasNodeFocusContext } from '@/components/canvas/mediaFocus';

interface NodeWrapperProps {
  title: string;
  icon: React.ReactNode;
  status?: NodeStatus;
  errorMessage?: string;
  selected?: boolean;
  children: React.ReactNode;
  minWidth?: number;
  width?: number;
  accentColor?: string;
  /** 'inside' (default) keeps the title bar inside the card. 'outside' floats it above. */
  titlePosition?: 'inside' | 'outside';
  /** Rendered below the card when titlePosition === 'outside'. */
  footer?: React.ReactNode;
}

export function NodeWrapper({
  title, icon, status, errorMessage, selected, children,
  minWidth = 280, width, accentColor,
  titlePosition = 'inside', footer,
}: NodeWrapperProps) {
  const color = accentColor ?? 'var(--color-accent)';
  const glow  = accentColor ? `${accentColor}4d` : 'var(--color-accent-glow)';

  const cardStyle: React.CSSProperties = {
    borderRadius: 17,
    background: 'var(--color-bg-elevated)',
    border: selected ? `1px solid ${color}` : 'var(--border-default)',
    boxShadow: selected
      ? `0 4px 24px rgba(0,0,0,0.5), 0 0 0 1px ${glow}`
      : 'var(--shadow-node)',
  };

  if (titlePosition === 'outside') {
    return (
      <CanvasNodeFocusContext.Provider value={!!selected}>
      <div style={{ width: width ?? minWidth }}>
        {/* Title floats above the card */}
        <div className="flex items-center gap-2 mb-2 px-1">
          <span style={{ color }}>{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            {title}
          </span>
          {status && status !== 'idle' && <StatusBadge status={status} errorMessage={errorMessage} />}
        </div>

        {/* Card (no inner title bar) */}
        <div className={cn('overflow-hidden transition-all duration-150')} style={cardStyle}>
          <div style={{ padding: 18 }}>{children}</div>
        </div>

        {/* Footer sits below the card */}
        {footer && <div className="mt-2">{footer}</div>}
      </div>
      </CanvasNodeFocusContext.Provider>
    );
  }

  // Default: title bar inside the card
  return (
    <CanvasNodeFocusContext.Provider value={!!selected}>
    <div
      className={cn('overflow-hidden transition-all duration-150')}
      style={{ ...cardStyle, width: width ?? minWidth }}
    >
      {/* Title bar */}
      <div
        className="flex items-center justify-between px-3 py-2.5"
        style={{ borderBottom: 'var(--border-default)' }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color }}>{icon}</span>
          <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--color-white-muted)' }}>
            {title}
          </span>
        </div>
        {status && status !== 'idle' && (
          <StatusBadge status={status} />
        )}
      </div>

      {/* Content */}
      <div style={{ padding: 18 }}>{children}</div>
    </div>
    </CanvasNodeFocusContext.Provider>
  );
}

function StatusBadge({ status, errorMessage }: { status: NodeStatus; errorMessage?: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (status === 'processing') {
    return <RefreshCw size={14} className="animate-spin" style={{ color: 'var(--color-processing)' }} />;
  }
  if (status === 'completed') {
    return <Check size={14} style={{ color: 'var(--color-success)' }} />;
  }
  if (status === 'error') {
    return (
      <div className="relative nodrag">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center justify-center"
          title="Click to see error details"
        >
          <AlertCircle size={14} style={{ color: 'var(--color-error)' }} />
        </button>
        {open && (
          <div
            className="absolute right-0 top-6 z-50 w-72 p-3 rounded-xl"
            style={{
              background: 'var(--color-bg-surface)',
              border: '1px solid var(--color-error)',
              boxShadow: 'var(--shadow-node)',
            }}
          >
            <p className="text-xs font-semibold mb-1.5" style={{ color: 'var(--color-error)' }}>
              Generation failed
            </p>
            <p className="text-xs leading-relaxed mb-3" style={{ color: 'var(--color-white-muted)' }}>
              {errorMessage ?? 'An unexpected error occurred. Try regenerating.'}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(errorMessage ?? 'Unknown error').catch(() => {});
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs transition-colors"
                style={{ background: 'var(--color-bg-hover)', color: 'var(--color-white-muted)' }}
              >
                <Copy size={10} />
                {copied ? 'Copied!' : 'Copy for bug report'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-2.5 py-1 rounded-lg text-xs"
                style={{ color: 'var(--color-white-subtle)' }}
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }
  return null;
}
