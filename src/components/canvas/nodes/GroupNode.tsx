'use client';

import { type NodeProps } from '@xyflow/react';
import { NodeResizer } from '@xyflow/react';
import { useState } from 'react';
import { Layers, Edit2, Check } from 'lucide-react';
import type { GroupNodeData } from '@/types';

const GROUP_COLORS = [
  { label: 'Blue',   bg: 'rgba(59,158,255,0.06)',   border: 'rgba(59,158,255,0.35)',   header: 'rgba(59,158,255,0.12)'  },
  { label: 'Purple', bg: 'rgba(168,85,247,0.06)',   border: 'rgba(168,85,247,0.35)',   header: 'rgba(168,85,247,0.12)'  },
  { label: 'Green',  bg: 'rgba(52,211,153,0.06)',   border: 'rgba(52,211,153,0.35)',   header: 'rgba(52,211,153,0.12)'  },
  { label: 'Amber',  bg: 'rgba(245,158,11,0.06)',   border: 'rgba(245,158,11,0.35)',   header: 'rgba(245,158,11,0.12)'  },
  { label: 'Rose',   bg: 'rgba(244,63,94,0.06)',    border: 'rgba(244,63,94,0.35)',    header: 'rgba(244,63,94,0.12)'   },
];

export function GroupNode({ data, selected, id }: NodeProps & { data: GroupNodeData }) {
  const colorIdx = GROUP_COLORS.findIndex((c) => c.label === data.color) ?? 0;
  const theme = GROUP_COLORS[colorIdx >= 0 ? colorIdx : 0];
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelValue, setLabelValue] = useState(data.label ?? 'Group');

  function saveLabel() {
    setEditingLabel(false);
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { label: labelValue || 'Group' } },
    }));
  }

  function cycleColor() {
    const next = GROUP_COLORS[(colorIdx + 1) % GROUP_COLORS.length];
    document.dispatchEvent(new CustomEvent('node:update', {
      detail: { nodeId: id, data: { color: next.label } },
    }));
  }

  return (
    <>
      <NodeResizer
        isVisible={selected}
        minWidth={200}
        minHeight={120}
        lineStyle={{ border: `1px solid ${theme.border}` }}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: theme.border,
          border: 'none',
        }}
      />

      <div
        className="w-full h-full rounded-xl overflow-hidden"
        style={{
          background: theme.bg,
          border: `1.5px solid ${selected ? theme.border : theme.border.replace('0.35', '0.2')}`,
          boxShadow: selected ? `0 0 0 1px ${theme.border}` : 'none',
          transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        {/* Header bar */}
        <div
          className="flex items-center gap-2 px-3 py-2 select-none"
          style={{ background: theme.header }}
        >
          <Layers size={12} style={{ color: theme.border.replace('0.35', '0.8'), flexShrink: 0 }} />

          {editingLabel ? (
            <input
              autoFocus
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              onBlur={saveLabel}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveLabel();
                if (e.key === 'Escape') { setEditingLabel(false); setLabelValue(data.label ?? 'Group'); }
              }}
              className="flex-1 bg-transparent outline-none text-xs font-semibold nodrag"
              style={{ color: 'var(--color-white)', borderBottom: `1px solid ${theme.border}` }}
            />
          ) : (
            <span
              className="flex-1 text-xs font-semibold truncate"
              style={{ color: 'var(--color-white-muted)' }}
            >
              {data.label || 'Group'}
            </span>
          )}

          <div className="flex items-center gap-1 shrink-0">
            {/* Color picker dot */}
            <button
              onClick={cycleColor}
              className="rounded-full nodrag transition-transform hover:scale-110"
              style={{ width: 10, height: 10, background: theme.border, flexShrink: 0 }}
              title="Change color"
            />
            {/* Edit label */}
            {editingLabel ? (
              <button
                onClick={saveLabel}
                className="p-0.5 rounded nodrag"
                style={{ color: theme.border }}
              >
                <Check size={11} />
              </button>
            ) : (
              <button
                onClick={() => setEditingLabel(true)}
                className="p-0.5 rounded nodrag opacity-50 hover:opacity-100 transition-opacity"
                style={{ color: 'var(--color-white-muted)' }}
              >
                <Edit2 size={11} />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
