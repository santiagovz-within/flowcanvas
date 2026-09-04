// Inline media tagging for prompts: "@image1", "@image2", …
//
// A tag is a piece of prompt text ("@image2") plus a PromptTag record that pins
// it to the reference port and connection it was picked from. The text alone is
// never trusted: "@image2" only renders as a chip while a matching PromptTag
// exists, and a PromptTag only survives while its connection does.

import type { Edge } from '@xyflow/react';
import type { PromptTag } from '@/types';

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
