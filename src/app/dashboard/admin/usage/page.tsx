'use client';

import { useEffect, useState } from 'react';
import { BarChart2, RefreshCw, Image, Film } from 'lucide-react';

interface UsageData {
  totalGenerations: number;
  modelUsage: { model: string; count: number }[];
  userUsage: { userId: string; username: string; count: number }[];
  nodeUsage: { nodeType: string; count: number }[];
  hourlyTraffic: { nyc: number[]; mexico: number[]; bogota: number[] };
  mediaTypeSplit: { image: number; video: number };
}

const NODE_LABELS: Record<string, string> = {
  promptNode:        'Prompt',
  imageInputNode:    'Image Input',
  imageToPromptNode: 'Image to Prompt',
  imageGenNode:      'Image Generation',
  videoGenNode:      'Video Generation',
  upscaleNode:       'Upscale',
  modifyNode:        'Modify',
  selectNode:        'Select',
  removeBgNode:      'Remove Background',
  videoToGifNode:    'Video to GIF',
  outputNode:        'Output',
  galleryOutputNode: 'Output Gallery',
  groupNode:         'Group',
};

const NODE_COLORS: Record<string, string> = {
  promptNode:        '#3b9eff',
  imageInputNode:    '#a855f7',
  imageToPromptNode: '#8b5cf6',
  imageGenNode:      '#a855f7',
  videoGenNode:      '#34d399',
  upscaleNode:       '#f59e0b',
  modifyNode:        '#fb923c',
  selectNode:        '#60a5fa',
  removeBgNode:      '#f472b6',
  videoToGifNode:    '#4ade80',
  outputNode:        '#94a3b8',
  galleryOutputNode: '#cbd5e1',
  groupNode:         '#64748b',
};

// Deterministic per-model colors
const MODEL_COLOR_MAP: Record<string, string> = {
  'nano-banana-2':   '#a855f7',
  'nano-banana-pro': '#c084fc',
  'seedream-5':      '#fb7185',
  'gpt-image-2':     '#22d3ee',
  'flux-2-pro':      '#f59e0b',
  'google-omni-flash': '#f87171',
  'kling-3-pro':     '#34d399',
  'seedance-2':      '#60a5fa',
  'seedvr2':         '#fb923c',
  'topaz':           '#f472b6',
};

function modelColor(model: string): string {
  if (MODEL_COLOR_MAP[model]) return MODEL_COLOR_MAP[model];
  // Hash unknown models to one of several fallback colors
  const fallbacks = ['#818cf8', '#38bdf8', '#4ade80', '#fbbf24', '#f87171'];
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return fallbacks[h % fallbacks.length];
}

function BarRow({ label, value, max, gradient, color }: { label: string; value: number; max: number; gradient?: boolean; color?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span
        className="text-xs truncate"
        style={{ color: 'var(--color-white-muted)', minWidth: 160, maxWidth: 160 }}
        title={label}
      >
        {label}
      </span>
      <div className="flex-1 flex items-center gap-2">
        <div
          className="rounded-full overflow-hidden"
          style={{ flex: 1, height: 6, background: 'var(--color-bg-surface)', position: 'relative' }}
        >
          {gradient ? (
            // Full-width gradient clipped to fill percentage so hue is stable
            <div
              className="absolute inset-y-0 left-0 w-full rounded-full transition-all duration-500"
              style={{
                background: 'linear-gradient(to right, #fde68a, #c4b5fd)',
                clipPath: `inset(0 ${100 - pct}% 0 0)`,
              }}
            />
          ) : (
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${pct}%`, background: color }}
            />
          )}
        </div>
        <span className="text-xs tabular-nums w-8 text-right" style={{ color: 'var(--color-white)' }}>
          {value}
        </span>
      </div>
    </div>
  );
}

function HourChart({ traffic }: { traffic: number[] }) {
  const max    = Math.max(...traffic, 1);
  const HEIGHT = 80; // px — matches h-20
  const HOURS  = Array.from({ length: 24 }, (_, i) => {
    const ampm = i < 12 ? 'am' : 'pm';
    const h    = i === 0 ? 12 : i > 12 ? i - 12 : i;
    return `${h}${ampm}`;
  });

  return (
    <div className="flex items-end gap-0.5" style={{ height: HEIGHT }}>
      {traffic.map((count, i) => (
        <div
          key={i}
          className="flex-1 rounded-sm"
          title={`${HOURS[i]}: ${count}`}
          style={{
            height: Math.max(Math.round((count / max) * HEIGHT), 2),
            background: count > 0 ? 'var(--color-accent)' : 'var(--color-bg-surface)',
            opacity:    count > 0 ? 0.7 + (count / max) * 0.3 : 1,
          }}
        />
      ))}
    </div>
  );
}

const TZ_TABS = [
  { key: 'nyc',    label: 'New York' },
  { key: 'mexico', label: 'Mexico City' },
  { key: 'bogota', label: 'Bogotá' },
] as const;

type TzKey = typeof TZ_TABS[number]['key'];

export default function AdminUsagePage() {
  const [data, setData]       = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [tzTab, setTzTab]     = useState<TzKey>('nyc');

  useEffect(() => {
    async function load() {
      const res = await fetch('/api/admin/usage');
      if (res.ok) {
        setData(await res.json());
      } else {
        setError('Failed to load usage data');
      }
      setLoading(false);
    }
    load();
  }, []);

  const cardStyle: React.CSSProperties = {
    background: 'var(--color-bg-elevated)',
    border: 'var(--border-default)',
    borderRadius: 12,
    padding: 20,
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center gap-2" style={{ color: 'var(--color-white-muted)' }}>
        <RefreshCw size={18} className="animate-spin" />
        <span className="text-sm">Loading usage data…</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm" style={{ color: 'var(--color-error)' }}>{error || 'No data'}</p>
      </div>
    );
  }

  const maxModelCount = Math.max(...data.modelUsage.map((m) => m.count), 1);
  const maxUserCount  = Math.max(...data.userUsage.map((u) => u.count), 1);
  const maxNodeCount  = Math.max(...(data.nodeUsage ?? []).map((n) => n.count), 1);

  return (
    <div className="h-full overflow-auto p-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <BarChart2 size={24} style={{ color: 'var(--color-accent)' }} />
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--color-white)' }}>All Usage</h1>
          <p className="text-sm" style={{ color: 'var(--color-white-muted)' }}>
            Platform-wide generation activity across all users
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div style={cardStyle}>
          <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-white-muted)' }}>
            Total Generations
          </p>
          <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-white)' }}>
            {data.totalGenerations.toLocaleString()}
          </p>
        </div>
        <div style={cardStyle}>
          <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-white-muted)' }}>
            Images Generated
          </p>
          <div className="flex items-center gap-2">
            <Image size={18} style={{ color: 'var(--color-accent)' }} />
            <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-white)' }}>
              {data.mediaTypeSplit.image.toLocaleString()}
            </p>
          </div>
        </div>
        <div style={cardStyle}>
          <p className="text-xs font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--color-white-muted)' }}>
            Videos Generated
          </p>
          <div className="flex items-center gap-2">
            <Film size={18} style={{ color: 'var(--color-success)' }} />
            <p className="text-3xl font-semibold tabular-nums" style={{ color: 'var(--color-white)' }}>
              {data.mediaTypeSplit.video.toLocaleString()}
            </p>
          </div>
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* Model usage */}
        <div style={cardStyle}>
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white)' }}>Model Usage</p>
          {data.modelUsage.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No data yet</p>
          ) : (
            <div>
              {data.modelUsage.slice(0, 12).map((m) => (
                <BarRow
                  key={m.model}
                  label={m.model}
                  value={m.count}
                  max={maxModelCount}
                  color={modelColor(m.model)}
                />
              ))}
            </div>
          )}
        </div>

        {/* User activity */}
        <div style={cardStyle}>
          <p className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white)' }}>User Activity</p>
          {data.userUsage.length === 0 ? (
            <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No data yet</p>
          ) : (
            <div>
              {data.userUsage.slice(0, 12).map((u) => (
                <BarRow
                  key={u.userId}
                  label={u.username}
                  value={u.count}
                  max={maxUserCount}
                  gradient
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {/* Node usage */}
      <div style={{ ...cardStyle, marginBottom: 16 }}>
        <p className="text-sm font-semibold mb-4" style={{ color: 'var(--color-white)' }}>Node Usage</p>
        {(data.nodeUsage ?? []).length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-white-muted)' }}>No data yet</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-8">
            {(data.nodeUsage ?? []).map((n) => (
              <BarRow
                key={n.nodeType}
                label={NODE_LABELS[n.nodeType] ?? n.nodeType}
                value={n.count}
                max={maxNodeCount}
                color={NODE_COLORS[n.nodeType] ?? '#818cf8'}
              />
            ))}
          </div>
        )}
      </div>

      {/* Hourly traffic */}
      <div style={cardStyle}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold" style={{ color: 'var(--color-white)' }}>API Traffic by Hour of Day</p>
          <div className="flex gap-1 p-0.5 rounded-lg" style={{ background: 'var(--color-bg-surface)' }}>
            {TZ_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTzTab(key)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: tzTab === key ? 'var(--color-bg-elevated)' : 'transparent',
                  color:      tzTab === key ? 'var(--color-white)' : 'var(--color-white-muted)',
                  border:     'none',
                  cursor:     'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <HourChart traffic={data.hourlyTraffic[tzTab]} />
        <div className="flex justify-between mt-2" style={{ color: 'var(--color-white-muted)', fontSize: 10 }}>
          <span>12am</span>
          <span>6am</span>
          <span>12pm</span>
          <span>6pm</span>
          <span>11pm</span>
        </div>
      </div>
    </div>
  );
}
