/**
 * tools/blenderTool.js
 * ---------------------------------------------------------------------------
 * A brush that doesn't paint the current palette color at all — it mixes
 * together whatever colors are ALREADY on the canvas, inside a circular
 * radius around the cursor, softening hard edges the way a real paint
 * "blend"/smudge tool does. Two tunable knobs, both read from ctx (see
 * app.js's toolCtx and ui.js's blender-radius / blender-strength sliders):
 *   - radius:   how far the circular brush reaches, in pixels.
 *   - strength: 0-1, how far each pixel moves toward the local average
 *               per dab (1 = snaps straight to the average; low values
 *               blend gradually so repeated strokes deepen the effect).
 *
 * The algorithm at each dab (see _blend below):
 *   1. Read every pixel currently inside the circle and compute their
 *      weighted average color — weight falls off linearly from 1 at the
 *      center to 0 at the circle's edge, so the blend has a soft edge
 *      instead of a hard-edged disc.
 *   2. Move every one of those same pixels toward that average, by an
 *      amount proportional to ITS OWN weight times `strength` — center
 *      pixels move almost all the way to the average, edge pixels barely
 *      move at all.
 * Both passes read/write the buffer directly (setPixel, not blendPixel) —
 * this is mixing existing pixel data together, not compositing a new color
 * over it, so there's no "opacity" slider here; `strength` plays that role.
 *
 * Dragging walks the same Bresenham path as the pencil (skipFirst: true,
 * since the starting point was already dabbed on the previous step) so a
 * fast drag doesn't leave un-blended gaps between dabs.
 */

class BlenderTool extends window.PAE.Tool {
  constructor() {
    super('blender', 'Blender', 'crosshair');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit(); // the whole drag is one undo step
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
    const radius = ctx.getBlenderRadius();
    const strength = ctx.getBlenderStrength();
    BlenderTool._blend(ctx.buffer, cx, cy, radius, strength);
    ctx.requestRender();
  }

  /**
   * @param {PAE.PixelBuffer} buffer
   * @param {number} cx  brush center, image pixel coords
   * @param {number} cy
   * @param {number} radius  brush radius in pixels
   * @param {number} strength  0-1
   */
  static _blend(buffer, cx, cy, radius, strength) {
    if (radius <= 0 || strength <= 0) return;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(buffer.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(buffer.height - 1, Math.ceil(cy + radius));
    if (minX > maxX || minY > maxY) return;

    // Pass 1: weighted average of every pixel currently inside the circle
    // (read-only — nothing is written yet, so this pass never sees any of
    // this same dab's own output).
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;
    let sumW = 0;
    const samples = [];
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const w = 1 - dist / radius; // 1 at the center, 0 at the edge
        const p = buffer.getPixel(x, y);
        sumR += p[0] * w;
        sumG += p[1] * w;
        sumB += p[2] * w;
        sumA += p[3] * w;
        sumW += w;
        samples.push({ x, y, w, p });
      }
    }
    if (sumW <= 0) return;
    const avg = [sumR / sumW, sumG / sumW, sumB / sumW, sumA / sumW];

    // Pass 2: move every sampled pixel toward that average, proportional
    // to its own falloff weight and the brush strength.
    for (const { x, y, w, p } of samples) {
      const t = Math.max(0, Math.min(1, w * strength));
      if (t <= 0) continue;
      buffer.setPixel(x, y, [
        p[0] + (avg[0] - p[0]) * t,
        p[1] + (avg[1] - p[1]) * t,
        p[2] + (avg[2] - p[2]) * t,
        p[3] + (avg[3] - p[3]) * t,
      ]);
    }
  }
}

window.PAE = window.PAE || {};
window.PAE.BlenderTool = BlenderTool;
