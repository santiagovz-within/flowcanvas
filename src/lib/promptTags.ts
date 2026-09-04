// Inline media tagging for prompts: "@image1", "@image2", …
//
// A tag is a piece of prompt text ("@image2") plus a PromptTag record that pins
// it to the reference port and connection it was picked from. The text alone is
// never trusted: "@image2" only renders as a chip while a matching PromptTag
// exists, and a PromptTag only survives while its connection does.

import type { Edge } from '@xyflow/react';
import type { PromptReferenceStyle, PromptTag } from '@/types';

export type { PromptReferenceStyle };

/**
 * Matches "@image12" as a standalone token: not "@image12abc" and not
 * "email@image12". Group 1 is the 1-based number.
 */
export const IMAGE_TAG_PATTERN = /(?<![\w])@image(\d+)(?![\w])/g;

export function imageTagLabel(portIndex: number): string {
  return `image${portIndex + 1}`;
}

/** Reference-port handle id → 0-based index, or null for non-reference handles. */
export function referenceHandleIndex(handle: string | null | undefined): number | null {
  if (!handle) return null;
  if (handle === 'reference_image') return 0;
  if (handle.startsWith('ref_')) {
    const idx = Number(handle.slice(4));
    return Number.isInteger(idx) ? idx : null;
  }
  return null;
}

/** A connected input the user can tag from the picker. */
export interface TaggableInput {
  label: string;
  portIndex: number;
  edgeId: string;
  sourceNodeId: string;
  /** Current media URL on that port; may be empty if the source has no image yet. */
  url: string;
}

/** Connected reference inputs of `nodeId`, ordered by port index. */
export function getTaggableInputs(
  nodeId: string,
  edges: Edge[],
  inputImageUrls: string[] | undefined,
): TaggableInput[] {
  const inputs: TaggableInput[] = [];
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const portIndex = referenceHandleIndex(edge.targetHandle);
    if (portIndex === null) continue;
    inputs.push({
      label: imageTagLabel(portIndex),
      portIndex,
      edgeId: edge.id,
      sourceNodeId: edge.source,
      url: inputImageUrls?.[portIndex] ?? '',
    });
  }
  return inputs.sort((a, b) => a.portIndex - b.portIndex);
}

export type PromptSegment =
  | { kind: 'text'; text: string }
  | { kind: 'tag'; text: string; tag: PromptTag };

/** Split prompt text into plain runs and live chips (text that has a PromptTag). */
export function segmentPrompt(text: string, tags: PromptTag[]): PromptSegment[] {
  if (!text) return [];
  const byLabel = new Map(tags.map((t) => [t.label, t]));
  const segments: PromptSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(IMAGE_TAG_PATTERN)) {
    const tag = byLabel.get(`image${match[1]}`);
    if (!tag) continue;
    const start = match.index ?? 0;
    if (start > last) segments.push({ kind: 'text', text: text.slice(last, start) });
    segments.push({ kind: 'tag', text: match[0], tag });
    last = start + match[0].length;
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) });
  return segments;
}

/** Labels ("image2") that appear as "@image2" in the text. */
export function labelsInText(text: string): Set<string> {
  const labels = new Set<string>();
  for (const match of text.matchAll(IMAGE_TAG_PATTERN)) labels.add(`image${match[1]}`);
  return labels;
}

/**
 * Keep `tags` consistent with `text` and the currently connected inputs:
 *  - drop tags whose "@label" the user deleted from the text
 *  - auto-create tags for "@imageN" typed by hand when port N is connected
 * Returns the same array instance when nothing changed.
 */
export function syncTagsWithText(
  text: string,
  tags: PromptTag[],
  taggable: TaggableInput[],
): PromptTag[] {
  const present = labelsInText(text);
  const kept = tags.filter((t) => present.has(t.label));
  const have = new Set(kept.map((t) => t.label));
  const added: PromptTag[] = [];
  for (const label of present) {
    if (have.has(label)) continue;
    const input = taggable.find((i) => i.label === label);
    if (input) {
      added.push({ label, portIndex: input.portIndex, edgeId: input.edgeId, sourceNodeId: input.sourceNodeId });
    }
  }
  if (kept.length === tags.length && added.length === 0) return tags;
  return [...kept, ...added];
}

/** Turn "@image2" back into plain "image2" everywhere in the text. */
export function untagLabel(text: string, label: string): string {
  const num = label.replace(/^image/, '');
  return text.replace(new RegExp(`(?<![\\w])@image${num}(?![\\w])`, 'g'), `image${num}`);
}

/**
 * The "@query" the caret is currently inside, if any. Used to open the picker
 * while typing. `query` is the text after the "@" up to the caret.
 */
export function activeMentionQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|\s)@([\w]*)$/.exec(before);
  if (!match) return null;
  const start = caret - match[2].length - 1; // index of "@"
  return { start, query: match[2] };
}

// ── Submit-time conversion ───────────────────────────────────────────────────
//
// Models differ in how (or whether) a prompt can point at a specific input
// image. Each image model declares a `promptReference` style in the model
// config; chips are rewritten to that style right before the request is sent.
//
//   native → the model has its own token syntax, e.g. "@Image{n}" (Seedance
//            reference-to-video) or "@Element{n}" (Kling elements). The token
//            is substituted verbatim.
//   plain  → the model only understands natural language; the chip becomes a
//            phrase like "the first image attached" or "image 1".
//
// `{n}` is the 1-based position of the image among the images actually sent,
// and `{ordinal}` is that position as a word ("first"). Positions are counted
// over the compacted list the API receives, not over port numbers, so a chip
// for port 3 becomes "the second image" when port 2 is empty.

export const DEFAULT_PROMPT_REFERENCE: PromptReferenceStyle = {
  kind: 'plain',
  template: 'the {ordinal} image attached',
};

const ORDINALS = [
  'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth',
  'ninth', 'tenth', 'eleventh', 'twelfth', 'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth',
];

export function ordinalWord(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

export function formatPromptReference(style: PromptReferenceStyle, position: number): string {
  return style.template
    .replaceAll('{n}', String(position))
    .replaceAll('{ordinal}', ordinalWord(position));
}

export interface CompiledPrompt {
  prompt: string;
  /** Tags whose port has no image to send; their "@" was dropped in `prompt`. */
  unresolved: PromptTag[];
}

/**
 * Rewrite live chips in `prompt` for the model. `inputImageUrls` is the node's
 * port-indexed array (holes allowed); the model receives `filter(Boolean)` of
 * it, so positions are computed over the non-empty entries in port order.
 */
export function compilePromptForModel(
  prompt: string,
  tags: PromptTag[],
  inputImageUrls: string[] | undefined,
  style: PromptReferenceStyle = DEFAULT_PROMPT_REFERENCE,
): CompiledPrompt {
  const positionByPort = new Map<number, number>();
  let position = 0;
  (inputImageUrls ?? []).forEach((url, portIndex) => {
    if (url) positionByPort.set(portIndex, ++position);
  });

  const byLabel = new Map(tags.map((t) => [t.label, t]));
  const unresolved: PromptTag[] = [];
  const compiled = prompt.replace(IMAGE_TAG_PATTERN, (token, num: string) => {
    const tag = byLabel.get(`image${num}`);
    if (!tag) return token; // not a live chip: leave the text alone
    const pos = positionByPort.get(tag.portIndex);
    if (pos === undefined) {
      unresolved.push(tag);
      return tag.label;
    }
    return formatPromptReference(style, pos);
  });

  return { prompt: compiled, unresolved };
}

// ── Keeping tags honest ──────────────────────────────────────────────────────

/**
 * Drop tags whose connection no longer exists exactly as it did when the tag
 * was picked (same edge id, same target port, same source node). Their
 * "@label" text becomes plain "label". Returns null when nothing changed.
 *
 * Because the check is by edge identity, replacing the image on a port with a
 * different connection untags too — a chip never silently re-points.
 */
export function reconcilePromptTags(
  nodeId: string,
  prompt: string,
  tags: PromptTag[],
  edges: Edge[],
): { prompt: string; tags: PromptTag[] } | null {
  if (tags.length === 0) return null;
  const edgeById = new Map(edges.map((e) => [e.id, e]));
  let nextPrompt = prompt;
  const kept: PromptTag[] = [];
  for (const tag of tags) {
    const edge = edgeById.get(tag.edgeId);
    const stillValid =
      !!edge &&
      edge.target === nodeId &&
      edge.source === tag.sourceNodeId &&
      referenceHandleIndex(edge.targetHandle) === tag.portIndex;
    if (stillValid) kept.push(tag);
    else nextPrompt = untagLabel(nextPrompt, tag.label);
  }
  if (kept.length === tags.length) return null;
  return { prompt: nextPrompt, tags: kept };
}

/**
 * Tags that would break a generation: their port is connected but has no
 * image to send yet (e.g. an upstream node hasn't generated). Tags with a
 * missing connection are expected to have been untagged already by
 * reconcilePromptTags, but are reported here too as a safety net.
 */
export function findBrokenTags(
  nodeId: string,
  tags: PromptTag[],
  edges: Edge[],
  inputImageUrls: string[] | undefined,
): PromptTag[] {
  const valid = reconcilePromptTags(nodeId, '', tags, edges)?.tags ?? tags;
  const validLabels = new Set(valid.map((t) => t.label));
  return tags.filter((t) => !validLabels.has(t.label) || !inputImageUrls?.[t.portIndex]);
}
