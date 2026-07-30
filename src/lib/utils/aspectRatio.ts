// Shared aspect-ratio helpers for canvas nodes that size previews to match the
// media they represent.

const ASPECT_CANDIDATES: [string, number][] = [
  ['1:1', 1], ['16:9', 16 / 9], ['9:16', 9 / 16],
  ['4:3', 4 / 3], ['3:4', 3 / 4], ['21:9', 21 / 9],
  ['3:2', 3 / 2], ['2:3', 2 / 3],
];

/** Closest "w:h" label for a pixel size, e.g. 1920×1080 → "16:9". */
export function nearestAspectRatio(w: number, h: number): string {
  const ratio = w / h;
  let best = '1:1', bestDiff = Infinity;
  for (const [label, val] of ASPECT_CANDIDATES) {
    const diff = Math.abs(ratio - val);
    if (diff < bestDiff) { bestDiff = diff; best = label; }
  }
  return best;
}

/** CSS `aspect-ratio` value for a "w:h" label, falling back to square. */
export function cssAspectRatio(label: string): string {
  const [w, h] = label.split(':').map(Number);
  return w > 0 && h > 0 ? `${w} / ${h}` : '1 / 1';
}
