'use client';

import { Download, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Generation } from '@/types';
import { resolveMediaUrl } from '@/lib/utils/mediaUtils';

interface GenerationCardProps {
  generation: Generation;
  onClick?: () => void;
}

function getAspectRatio(gen: Generation): string {
  if (gen.width && gen.height) return `${gen.width} / ${gen.height}`;
  const ar = gen.parameters?.aspectRatio as string | undefined;
  if (ar) {
    const parts = ar.split(':');
    if (parts.length === 2 && !isNaN(Number(parts[0])) && !isNaN(Number(parts[1]))) {
      return `${parts[0]} / ${parts[1]}`;
    }
  }
  return '1 / 1';
}

export function GenerationCard({ generation, onClick }: GenerationCardProps) {
  const [hover, setHover] = useState(false);
  const [resolvedUrl, setResolvedUrl] = useState(generation.media_url);
  const isVideo = generation.media_type === 'video';
  const isGenerating = generation.status === 'pending' || generation.status === 'processing';
  const aspectRatio = getAspectRatio(generation);

  useEffect(() => {
    if (!isGenerating) {
      resolveMediaUrl(generation.media_url).then(setResolvedUrl);
    }
  }, [generation.media_url, isGenerating]);

  async function handleDownload(e: React.MouseEvent) {
    e.stopPropagation();
    const ext = isVideo ? 'mp4' : 'png';
    const filename = `canvasflow-${generation.id.slice(0, 8)}.${ext}`;
    try {
      const res = await fetch(resolvedUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(resolvedUrl, '_blank');
    }
  }

  if (isGenerating) {
    return (
      <div
        className="relative rounded-xl overflow-hidden animate-pulse"
        style={{
          aspectRatio,
          background: 'var(--color-bg-surface)',
          border: 'var(--border-default)',
        }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <div
            className="w-5 h-5 rounded-full border-2 animate-spin"
            style={{ borderColor: 'var(--color-accent)', borderTopColor: 'transparent' }}
          />
          <p className="text-xs font-medium" style={{ color: 'var(--color-white-muted)' }}>Generating</p>
        </div>
      </div>
    );
  }

  if (generation.status === 'failed') {
    return (
      <div
        className="relative rounded-xl overflow-hidden flex flex-col items-center justify-center gap-1 px-3 py-3 text-center"
        style={{
          aspectRatio,
          background: 'var(--color-bg-surface)',
          border: '1px solid var(--color-error)',
          overflowY: 'auto',
        }}
      >
        <p className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>Failed</p>
        {generation.error_message && (
          <p
            className="leading-snug"
            style={{ color: 'var(--color-white-muted)', fontSize: 10, wordBreak: 'break-word' }}
          >
            {generation.error_message}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      className="relative rounded-xl overflow-hidden cursor-pointer group"
      style={{
        aspectRatio,
        background: 'var(--color-bg-surface)',
        border: 'var(--border-default)',
      }}
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {isVideo ? (
        <video
          src={resolvedUrl}
          className="w-full h-full object-cover"
          preload="metadata"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedUrl}
          alt={generation.prompt ?? ''}
          className="w-full h-full object-cover"
        />
      )}

      {isVideo && !hover && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.5)' }}
          >
            <Play size={16} style={{ color: '#fff' }} />
          </div>
        </div>
      )}

      {hover && (
        <div
          className="absolute inset-0 flex items-end justify-end p-2"
          style={{ background: 'rgba(0,0,0,0.35)' }}
        >
          <button
            className="p-1.5 rounded-lg transition-colors hover:bg-white/20"
            style={{ background: 'rgba(0,0,0,0.45)' }}
            onClick={handleDownload}
            title="Download"
          >
            <Download size={13} style={{ color: '#fff' }} />
          </button>
        </div>
      )}
    </div>
  );
}
