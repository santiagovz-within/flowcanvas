import glassStyles from './ImageGenerationGlass.module.css';

export function AspectRatioGlyph({ ratio }: { ratio: string }) {
  const [width, height] = ratio.split(':').map(Number);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return <span className={glassStyles.aspectGlyphBox} aria-hidden />;
  }

  const scale = Math.min(width, height) / Math.max(width, height);
  const glyphWidth = width >= height ? 10 : 10 * scale;
  const glyphHeight = height >= width ? 10 : 10 * scale;

  return (
    <span className={glassStyles.aspectGlyphBox} aria-hidden>
      <span
        className={glassStyles.aspectGlyph}
        style={{ width: glyphWidth, height: glyphHeight }}
      />
    </span>
  );
}
