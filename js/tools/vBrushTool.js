/**
 * tools/vBrushTool.js
 * ---------------------------------------------------------------------------
 * V Brush — the app's powerhouse brush. Originally a simple "mosaic" brush
 * that pixelated the brushed area using colors drawn from the current color
 * Mix (see colorMixer.js) instead of one flat color, for quickly texturing a
 * flat area with organic-looking variety (rust, foliage, static, dithered
 * shading) without hand-placing every pixel. Renamed from "Variety Brush"
 * and extended with an optional node pipeline (see vbrushPipeline.js) that
 * lets Perlin noise, math, palette-pick, and color-clamp nodes reshape the
 * per-pixel color before it's painted.
 *
 * How it works, per dab (circular, like the Blender brush):
 *   1. Take the Mix section's current 3x3 grid (base + 4 edges + 4 corners
 *      — see ctx.getMixColors()) as the candidate colors.
 *   2. Reduce that down to AT MOST the color-count limit set by the
 *      toolbar's Colors slider (see ctx.getVBrushColorLimit()) by repeatedly
 *      averaging together the two closest remaining colors until the limit
 *      is met. This is the "hard limit... so we can limit file size"
 *      control: fewer distinct colors in the final image, by construction.
 *      Exact duplicate mix colors are merged for free first.
 *   3. For every pixel within the brush's circular radius, compute a stable
 *      per-pixel seed value from a hash of its (x, y) position (no
 *      Math.random — repainting the same spot never flickers).
 *   4. If the node pipeline (ctx.getVBrushPipeline()) is empty, pick a
 *      color from the reduced palette directly using that seed — the
 *      original, unmodified behavior. If the pipeline has nodes, run the
 *      seed through them instead (see VBrushPipeline.run in
 *      vbrushPipeline.js) — Perlin noise and math nodes reshape the scalar,
 *      a Palette Pick node converts it to a color, and Color Clamp nodes
 *      bound the final RGB — before falling back to a palette lookup if the
 *      pipeline never produced a color itself.
 *   5. Paint via the normal opacity-aware blendPixel either way, so the
 *      Opacity slider always still works as expected.
 */

class VBrushTool extends window.PAE.Tool {
  constructor() {
    super('vbrush', 'V Brush', 'crosshair');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit();
    this._drawing = true;
    this._lastX = null;
    this._lastY = null;
    this._dab(ctx, x, y);
    this._lastX = x;
    this._lastY = y;
  }

  onMouseMove(ctx, x, y) {
    if (!this._drawing) return;
    window.PAE.Geometry.bresenhamLine(this._lastX, this._lastY, x, y, (px, py) => this._dab(ctx, px, py), {
      skipFirst: true,
    });
    this._lastX = x;
    this._lastY = y;
  }

  onMouseUp() {
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  onLeave() {
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  _dab(ctx, cx, cy) {
    const radius = ctx.getVBrushRadius();
    const maxColors = ctx.getVBrushColorLimit();
    const opacity = ctx.getOpacity();
    const palette = VBrushTool._reducePalette(ctx.getMixColors(), maxColors);
    if (!palette.length) return;

    const pipeline = ctx.getVBrushPipeline ? ctx.getVBrushPipeline() : null;
    const nodes = pipeline && pipeline.nodes ? pipeline.nodes : [];

    const buffer = ctx.buffer;
    const r2 = radius * radius;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(buffer.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(buffer.height - 1, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        let color;
        if (nodes.length) {
          const seed = (VBrushTool._hash(x, y) % 1000) / 999; // 0..1, same stable hash as the no-pipeline path
          color = window.PAE.VBrushPipeline.run(nodes, seed, x, y, palette, { width: buffer.width, height: buffer.height });
        } else {
          color = palette[VBrushTool._hash(x, y) % palette.length];
        }
        buffer.blendPixel(x, y, color, opacity);
      }
    }
    ctx.requestRender();
  }

  /** Deterministic, well-mixed pseudo-random value for a pixel position (no Math.random — same spot always hashes the same way). */
  static _hash(x, y) {
    let h = (x * 374761393 + y * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    h ^= h >>> 16;
    return Math.abs(h);
  }

  /**
   * Merges `colors` ([r,g,b] arrays) down to at most `maxColors` entries by
   * repeatedly averaging together the two closest remaining colors —
   * simple, deterministic, and good enough for a handful of candidates
   * (the mixer grid is at most 9 colors to start with).
   */
  static _reducePalette(colors, maxColors) {
    const seen = new Set();
    let palette = colors.filter((c) => {
      const key = c.join(',');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const limit = Math.max(1, Math.round(maxColors));
    while (palette.length > limit && palette.length > 1) {
      let bestI = 0;
      let bestJ = 1;
      let bestDist = Infinity;
      for (let i = 0; i < palette.length; i++) {
        for (let j = i + 1; j < palette.length; j++) {
          const d = VBrushTool._dist(palette[i], palette[j]);
          if (d < bestDist) {
            bestDist = d;
            bestI = i;
            bestJ = j;
          }
        }
      }
      const merged = [
        Math.round((palette[bestI][0] + palette[bestJ][0]) / 2),
        Math.round((palette[bestI][1] + palette[bestJ][1]) / 2),
        Math.round((palette[bestI][2] + palette[bestJ][2]) / 2),
      ];
      // Remove the higher index first so the lower index's splice target doesn't shift.
      palette.splice(bestJ, 1);
      palette.splice(bestI, 1);
      palette.push(merged);
    }
    return palette;
  }

  static _dist(a, b) {
    const dr = a[0] - b[0];
    const dg = a[1] - b[1];
    const db = a[2] - b[2];
    return dr * dr + dg * dg + db * db;
  }
}

window.PAE = window.PAE || {};
window.PAE.VBrushTool = VBrushTool;
