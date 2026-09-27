/**
 * tools/highlightShadowTool.js
 * ---------------------------------------------------------------------------
 * Roger's ask: "a highlighter and shadowing brush that is based on pixel
 * size" — one brush (Roger's choice, over two separate tools) with a
 * Lighten/Darken switch, like a combined Dodge/Burn: it nudges the color of
 * whatever's ALREADY painted under the brush toward white (Lighten) or black
 * (Darken), rather than painting a flat new color the way Pencil/V Brush do.
 * Fully transparent pixels are left untouched — there's nothing to
 * highlight/shadow where nothing's been drawn yet, same reasoning as the
 * Blender tool skipping empty pixels.
 *
 * "Based on pixel size" — the toolbar's Radius slider — works exactly like
 * the Blender brush's own circular dab (see tools/blenderTool.js): a soft
 * radial falloff from full Strength at the center to 0 at the brush's edge,
 * so a bigger brush affects a bigger, still-smoothly-edged area rather than
 * a harsh-edged disc. Strength is the OTHER slider: how far toward white/
 * black one dab pushes the center pixel, at most (0-100%).
 */

class HighlightShadowTool extends window.PAE.Tool {
  constructor() {
    super('highlightshadow', 'Highlight/Shadow', 'crosshair');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit(); // snapshot BEFORE this stroke starts
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
    const radius = ctx.getHighlightShadowRadius();
    const strength = ctx.getHighlightShadowStrength(); // 0-1
    const target = ctx.getHighlightShadowMode() === 'shadow' ? 0 : 255; // Darken pushes toward black, Lighten toward white
    if (radius <= 0 || strength <= 0) return;

    const buffer = ctx.buffer;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(buffer.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(buffer.height - 1, Math.ceil(cy + radius));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const p = buffer.getPixel(x, y);
        if (!p || p[3] === 0) continue; // nothing painted here yet — leave it alone
        const falloff = 1 - dist / radius; // 1 at the center, 0 at the brush's edge — same shape as Blender's own dab
        const amount = strength * falloff;
        buffer.setPixel(x, y, [
          p[0] + (target - p[0]) * amount,
          p[1] + (target - p[1]) * amount,
          p[2] + (target - p[2]) * amount,
          p[3], // never changes alpha — this brush shades color, it doesn't erase
        ]);
      }
    }
    ctx.requestRender();
  }
}

window.PAE = window.PAE || {};
window.PAE.HighlightShadowTool = HighlightShadowTool;
