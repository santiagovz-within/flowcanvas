'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import glassStyles from './ImageGenerationGlass.module.css';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = reject;
    el.src = src;
  });
}

// Compress + resize for Figma: max 4096px on longest side; PNG stays PNG
// (preserves transparency); everything else → JPEG at 0.85 quality.
// Dimensions are verified from the output blob so they match exactly what
// the Figma plugin reads via figma.createImage().
async function compressForFigma(rawBlob: Blob): Promise<{
  blob: Blob; width: number; height: number; contentType: string;
}> {
  const MAX_DIM = 4096;
  const inputUrl = URL.createObjectURL(rawBlob);
  let outputUrl: string | null = null;
  try {
    const img = await loadImage(inputUrl);

    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w <= 0 || h <= 0) throw new Error('Could not read image dimensions');

    if (w > MAX_DIM || h > MAX_DIM) {
      const ratio = Math.min(MAX_DIM / w, MAX_DIM / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);

    const isPng = rawBlob.type === 'image/png';
    const outputType = isPng ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        b => (b ? resolve(b) : reject(new Error('Canvas compression failed'))),
        outputType,
        isPng ? undefined : 0.85,
      ),
    );

    // Reload the output blob to get the authoritative pixel dimensions —
    // this is exactly what the Figma plugin reads from the downloaded file.
    outputUrl = URL.createObjectURL(blob);
    const out = await loadImage(outputUrl);
    return { blob, width: out.naturalWidth, height: out.naturalHeight, contentType: outputType };
  } finally {
    URL.revokeObjectURL(inputUrl);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }
}

type FigmaStatus = 'idle' | 'sending' | 'sent' | 'no_token' | 'error';

function FigmaIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 38 57" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ flexShrink: 0 }}>
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.9"/>
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 0 1-19 0z" fill="currentColor" opacity="0.6"/>
      <path d="M19 0v19H9.5a9.5 9.5 0 0 1 0-19H19z" fill="currentColor" opacity="0.7"/>
      <path d="M0 19a9.5 9.5 0 0 1 9.5-9.5H19V28.5H9.5A9.5 9.5 0 0 1 0 19z" fill="currentColor" opacity="0.8"/>
      <path d="M19 0h9.5a9.5 9.5 0 0 1 0 19H19V0z" fill="currentColor"/>
    </svg>
  );
}

interface SendToFigmaButtonProps {
  imageUrl: string | undefined;
  style?: React.CSSProperties;
  buttonStyle?: React.CSSProperties;
  appearance?: 'default' | 'imageGenerationGlass';
}

export function SendToFigmaButton({
  imageUrl,
  style,
  buttonStyle,
  appearance = 'imageGenerationGlass',
}: SendToFigmaButtonProps) {
  const [status, setStatus] = useState<FigmaStatus>('idle');
  const [error,  setError]  = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupToken, setSetupToken] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);
  const [setupCopied, setSetupCopied] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const isImageGenerationGlass = appearance === 'imageGenerationGlass';

  if (!imageUrl) return null;

  async function handleSend() {
    if (!imageUrl || status === 'sending') return;
    setStatus('sending');
    setError(null);

    try {
      // 1. Verify the user has generated their plugin link token.
      const tokenRes = await fetch('/api/figma/token');
      if (!tokenRes.ok) throw new Error('Could not check Figma token status');
      const { configured } = await tokenRes.json();
      if (!configured) {
        setStatus('no_token');
        setSetupOpen(true);
        return;
      }

      // 2. Fetch the image blob — the response Content-Type tells us the format.
      const imgRes = await fetch(imageUrl);
      if (!imgRes.ok) throw new Error('Could not fetch image');
      const rawBlob = await imgRes.blob();

      // 3. Compress + resize to fit Figma's limits (max 4096px, JPEG 0.85 or PNG).
      const { blob, width, height, contentType } = await compressForFigma(rawBlob);

      // 4. Stage — backend returns a signed GCS PUT URL.
      const stageRes = await fetch('/api/figma/stage', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sizeBytes: blob.size, width, height, contentType }),
      });
      if (!stageRes.ok) {
        const e = await stageRes.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? 'Stage request failed');
      }
      const { id: transferId, uploadUrl } = await stageRes.json() as { id: string; uploadUrl: string };

      // 5. Upload blob directly to GCS (bypasses Vercel body-size limit).
      const putRes = await fetch(uploadUrl, {
        method:  'PUT',
        body:    blob,
        headers: { 'Content-Type': contentType },
      });
      if (!putRes.ok) throw new Error(`Upload failed (${putRes.status})`);

      // 6. Confirm — transitions transfer to 'pending' so the plugin picks it up.
      const confirmRes = await fetch(`/api/figma/stage/${transferId}/confirm`, { method: 'POST' });
      if (!confirmRes.ok) {
        const e = await confirmRes.json().catch(() => ({}));
        throw new Error((e as { error?: string }).error ?? 'Confirm failed');
      }

      setStatus('sent');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  }

  async function handleGenerateKey() {
    if (setupLoading) return;
    setSetupLoading(true);
    setSetupError(null);
    setSetupCopied(false);
    try {
      const response = await fetch('/api/figma/token', { method: 'POST' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Could not generate the Figma key');
      }
      const body = await response.json() as { token: string };
      setSetupToken(body.token);
    } catch (err) {
      setSetupError(err instanceof Error ? err.message : 'Could not generate the Figma key');
    } finally {
      setSetupLoading(false);
    }
  }

  async function handleCopyKey() {
    if (!setupToken) return;
    try {
      await navigator.clipboard.writeText(setupToken);
      setSetupCopied(true);
    } catch {
      setSetupError('Could not copy the key. Select it manually and copy it before continuing.');
    }
  }

  function handleSetupDone() {
    if (!setupToken) return;
    setSetupOpen(false);
    setStatus('idle');
    void handleSend();
  }

  return (
    <>
      <div style={style}>
        <button
          onClick={handleSend}
          disabled={status === 'sending'}
          className={cn(
            'nodrag transition-opacity hover:opacity-80 active:opacity-60 disabled:opacity-50',
            isImageGenerationGlass
              ? [glassStyles.glassSurface, glassStyles.button, glassStyles.footerControl]
              : 'w-full flex items-center justify-center gap-1.5 py-3 text-xs font-medium',
          )}
          style={{
            borderRadius: 11,
            background: status === 'sent'
              ? 'rgba(34,197,94,0.15)'
              : isImageGenerationGlass
                ? undefined
                : 'rgba(255,255,255,0.06)',
            color: status === 'sent'
              ? 'var(--color-success)'
              : status === 'error' || status === 'no_token'
              ? '#f87171'
              : isImageGenerationGlass
                ? undefined
                : 'var(--color-white-muted)',
            border: status === 'sent'
              ? '1px solid rgba(34,197,94,0.3)'
              : status === 'error' || status === 'no_token'
              ? '1px solid rgba(239,68,68,0.3)'
              : isImageGenerationGlass
                ? 'none'
                : '1px solid transparent',
            cursor: 'pointer',
            fontWeight: isImageGenerationGlass ? 700 : undefined,
            ...buttonStyle,
          }}
        >
          {isImageGenerationGlass ? (
            <span className={cn(glassStyles.glassContent, glassStyles.buttonContent)}>
              {status === 'sending' ? (
                <>
                  <div
                    className="animate-spin"
                    style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--color-white-muted)', flexShrink: 0 }}
                  />
                  Sending…
                </>
              ) : status === 'sent' ? (
                <>
                  <Check size={12} style={{ color: 'var(--color-success)' }} />
                  Sent to Figma
                </>
              ) : (
                <>
                  <FigmaIcon size={12} />
                  Send to Figma
                </>
              )}
            </span>
          ) : status === 'sending' ? (
            <>
              <div
                className="animate-spin"
                style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,0.2)', borderTopColor: 'var(--color-white-muted)', flexShrink: 0 }}
              />
              Sending…
            </>
          ) : status === 'sent' ? (
            <>
              <Check size={12} style={{ color: 'var(--color-success)' }} />
              Sent to Figma
            </>
          ) : (
            <>
              <FigmaIcon size={12} />
              Send to Figma
            </>
          )}
        </button>

        {status === 'error' && error && (
          <p className="text-center mt-1 nodrag" style={{ fontSize: 10, color: '#f87171' }}>
            {error}
          </p>
        )}
      </div>

      {setupOpen && typeof document !== 'undefined' && createPortal(
        <div
          className="nodrag nowheel"
          onMouseDown={(event) => event.stopPropagation()}
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
            aria-labelledby="figma-setup-title"
            style={{
              width: 'min(440px, 100%)',
              padding: 20,
              borderRadius: 16,
              background: '#1f1f20',
              border: '1px solid rgba(255,255,255,0.14)',
              boxShadow: '0 24px 80px rgba(0,0,0,0.55)',
              color: 'var(--color-white)',
              fontFamily: 'var(--font-manrope), Manrope, sans-serif',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <span style={{ display: 'flex', color: 'var(--color-white-muted)' }}>
                <FigmaIcon size={16} />
              </span>
              <h2 id="figma-setup-title" style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>
                Configure WITHIN Glide for Figma
              </h2>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, fontSize: 12, lineHeight: 1.5, color: 'var(--color-white-muted)' }}>
              <p style={{ margin: 0 }}>
                1. In Figma go to <strong style={{ color: 'var(--color-white)' }}>Plugins &gt; Manage Plugins</strong> and install <strong style={{ color: 'var(--color-white)' }}>WITHIN Glide</strong>.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <p style={{ margin: 0 }}>
                  2. Generate your private connection key.
                </p>
                {!setupToken ? (
                  <button
                    type="button"
                    onClick={handleGenerateKey}
                    disabled={setupLoading}
                    className="nodrag transition-opacity disabled:opacity-50"
                    style={{
                      width: 'fit-content',
                      padding: '8px 12px',
                      border: 'none',
                      borderRadius: 9,
                      background: 'var(--color-accent)',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: setupLoading ? 'wait' : 'pointer',
                    }}
                  >
                    {setupLoading ? 'Generating…' : 'Generate key'}
                  </button>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'stretch', gap: 6 }}>
                    <code
                      style={{
                        minWidth: 0,
                        flex: 1,
                        padding: '8px 10px',
                        overflow: 'hidden',
                        borderRadius: 9,
                        background: '#111112',
                        color: '#fff',
                        fontSize: 11,
                        lineHeight: '16px',
                        textOverflow: 'ellipsis',
                        userSelect: 'all',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {setupToken}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopyKey}
                      className="nodrag"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                        padding: '8px 10px',
                        borderRadius: 9,
                        border: '1px solid rgba(255,255,255,0.12)',
                        background: setupCopied ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)',
                        color: setupCopied ? 'var(--color-success)' : 'var(--color-white)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      {setupCopied ? <Check size={12} /> : <Copy size={12} />}
                      {setupCopied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>

              <p style={{ margin: 0 }}>
                3. Copy and paste the key inside Figma in the <strong style={{ color: 'var(--color-white)' }}>WITHIN Glide</strong> plugin.
              </p>
              <p style={{ margin: 0 }}>
                Keep the plugin open in your target Figma file whenever you send an image.
              </p>

              {setupError && (
                <p role="alert" style={{ margin: 0, color: '#f87171' }}>{setupError}</p>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              {!setupToken && (
                <button
                  type="button"
                  onClick={() => {
                    setSetupOpen(false);
                    setStatus('idle');
                    setSetupError(null);
                  }}
                  className="nodrag"
                  style={{
                    padding: '8px 12px',
                    borderRadius: 9,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'transparent',
                    color: 'var(--color-white-muted)',
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleSetupDone}
                disabled={!setupToken}
                className="nodrag transition-opacity disabled:opacity-40"
                style={{
                  padding: '8px 16px',
                  border: 'none',
                  borderRadius: 9,
                  background: '#fff',
                  color: '#111',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: setupToken ? 'pointer' : 'not-allowed',
                }}
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
