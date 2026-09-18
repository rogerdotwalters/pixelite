/**
 * tools/lineTool.js
 * ---------------------------------------------------------------------------
 * Click-drag draws a straight, 1px-consistent line from the drag's start
 * point to wherever the pointer currently is, using the same integer
 * Bresenham walk as the pencil's drag-gap-filling (see geometry.js) — no
 * anti-aliasing, so the line stays crisp at any zoom.
 *
 * Live preview while dragging: onMouseDown snapshots the buffer, and every
 * subsequent onMouseMove restores that snapshot before re-drawing the line
 * to the new end point, so the preview always reflects only the CURRENT
 * drag position (no "ghost" lines left behind from earlier in the drag).
 * The pixels are only truly committed to history once, at onMouseDown.
 *
 * Hold Shift to snap the line to the nearest 45° angle (0/45/90/.../315),
 * which is what most pixel art actually wants for straight/diagonal edges.
 */

class LineTool extends window.PAE.Tool {
  constructor() {
    super('line', 'Line', 'crosshair');
    this._dragging = false;
    this._startX = null;
    this._startY = null;
    this._snapshot = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit(); // snapshot BEFORE this line is drawn
    this._dragging = true;
    this._startX = x;
    this._startY = y;
    this._snapshot = ctx.buffer.clone();
    this._drawPreview(ctx, x, y, null);
  }

  onMouseMove(ctx, x, y, evt) {
    if (!this._dragging) return;
    this._drawPreview(ctx, x, y, evt);
  }

  onMouseUp(ctx, x, y, evt) {
    if (!this._dragging) return;
    this._drawPreview(ctx, x, y, evt);
    this._dragging = false;
    this._snapshot = null;
  }

  _drawPreview(ctx, x, y, evt) {
    ctx.buffer.copyFrom(this._snapshot); // undo whatever the last preview step drew
    let endX = x;
    let endY = y;
    if (evt && evt.shiftKey) {
      const snapped = LineTool._snapAngle(this._startX, this._startY, x, y);
      endX = snapped.x;
      endY = snapped.y;
    }

    const rgb = ctx.getColor();
    const opacity = ctx.getOpacity();
    // A single line never revisits the same pixel twice (Bresenham never
    // doubles back), but de-duping here anyway is cheap insurance against
    // ever double-compositing a pixel at partial opacity.
    const painted = new Set();
    const paint = (px, py) => {
      const key = px + ',' + py;
      if (painted.has(key)) return;
      painted.add(key);
      ctx.buffer.blendPixel(px, py, rgb, opacity);
    };
    window.PAE.Geometry.bresenhamLine(this._startX, this._startY, endX, endY, paint);
    ctx.requestRender();
  }

  /** Rounds the drag vector to the nearest 45° direction, keeping roughly the same length. */
  static _snapAngle(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx === 0 && dy === 0) return { x: x1, y: y1 };
    const length = Math.max(Math.abs(dx), Math.abs(dy));
    const angle = Math.atan2(dy, dx);
    const step = Math.PI / 4;
    const snapped = Math.round(angle / step) * step;
    return {
      x: Math.round(x0 + Math.cos(snapped) * length),
      y: Math.round(y0 + Math.sin(snapped) * length),
    };
  }
}

window.PAE = window.PAE || {};
window.PAE.LineTool = LineTool;
