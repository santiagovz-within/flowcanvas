import { ApiError, ValidationError, type ValidationErrorInfo } from '@fal-ai/client';

/**
 * FAL never puts the useful text in `Error.message` — for a failed run it sends
 * `{ detail: … }` in the response body and the client turns the HTTP status text
 * ("Unprocessable Entity") into the message. These helpers pull out the same
 * sentence the FAL dashboard shows, e.g.
 * "Output audio has sensitive content" or
 * "The images or videos provided may contain likenesses of real people…".
 */

// A request that FAL retries or that never reached the model is not a verdict on
// the generation itself, so the poller should keep waiting instead of failing.
const TRANSIENT_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

function fieldLabel(loc: Array<string | number>): string | null {
  const field = [...loc].reverse().find(
    (part) => typeof part === 'string' && part !== 'body' && part !== 'query',
  );
  return typeof field === 'string' ? field : null;
}

function formatFieldError(error: ValidationErrorInfo): string | null {
  const message = error.msg?.trim();
  if (!message) return null;
  const label = fieldLabel(error.loc ?? []);
  return label ? `${label}: ${message}` : message;
}

function detailEntryText(entry: unknown): string | null {
  if (typeof entry === 'string') return entry.trim() || null;
  if (!entry || typeof entry !== 'object') return null;
  const candidate = entry as { msg?: unknown; message?: unknown; loc?: unknown };
  const message = typeof candidate.msg === 'string'
    ? candidate.msg
    : typeof candidate.message === 'string'
      ? candidate.message
      : null;
  if (!message?.trim()) return null;
  return formatFieldError({
    msg: message,
    loc: Array.isArray(candidate.loc) ? candidate.loc as Array<string | number> : [],
    type: '',
  });
}

/** The human-readable sentence FAL sent with a failed request, if there is one. */
export function falDetailText(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const { detail, message, error } = body as {
    detail?: unknown;
    message?: unknown;
    error?: unknown;
  };

  if (Array.isArray(detail)) {
    const parts = detail.map(detailEntryText).filter((part): part is string => !!part);
    if (parts.length > 0) return parts.join(' · ');
  }
  const single = detailEntryText(detail);
  if (single) return single;

  for (const candidate of [message, error]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

/** Turns any thrown value into the message we show in the UI and store on the generation. */
export function describeFalError(err: unknown): string {
  if (err instanceof ValidationError) {
    const fields = err.fieldErrors.map(formatFieldError).filter((part): part is string => !!part);
    return fields.length > 0
      ? `Error validating input — ${fields.join(' · ')}`
      : 'Error validating input.';
  }
  if (err instanceof ApiError) {
    const detail = falDetailText(err.body);
    if (detail) return detail;
    return err.message
      ? `FAL error ${err.status}: ${err.message}`
      : `FAL error ${err.status}.`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * True when FAL has decided this request is done and it failed. Polling again
 * can only repeat the same answer, so the node should fail immediately with
 * `describeFalError(err)` instead of retrying for another half minute.
 */
export function isTerminalFalError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  if (TRANSIENT_STATUSES.has(err.status)) return false;
  if (err.status >= 400 && err.status < 500) return true;
  // A 5xx that still carries FAL's error payload describes a run that blew up,
  // not a gateway hiccup on the way to it.
  return err.status >= 500 && falDetailText(err.body) !== null;
}
