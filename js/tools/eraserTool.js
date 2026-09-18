/**
 * tools/eraserTool.js
 * ---------------------------------------------------------------------------
 * Standard eraser: reduces the alpha of whatever's under the brush instead
 * of painting a color. At full (100%) opacity it clears pixels straight to
 * fully transparent; at a lower opacity it partially erases (fades toward
 * transparent), same as a real eraser tool would. Respects the shared "Pen
 * Size" brush (see Geometry.brushSquare — the same 1x1/2x2/3x3 stamp the
 * Pencil and Mirror Pen tools use) and walks a Bresenham line between
 * mousemove steps so a fast drag doesn't leave gaps.
 */

class EraserTool extends window.PAE.Tool {
  constructor() {
    super('eraser', 'Eraser', 'crosshair');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit(); // snapshot BEFORE this stroke starts
    this._drawing = true;
    this._lastX = null;
    this._lastY = null;
    this._paintStep(ctx, x, y);
  }

  onMouseMove(ctx, x, y) {
    if (!this._drawing) return;
    this._paintStep(ctx, x, y);
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

  _paintStep(ctx, x, y) {
    const opacity = ctx.getOpacity();
    const size = ctx.getBrushSize ? ctx.getBrushSize() : 1;

    const erase = (px, py) => {
      const p = ctx.buffer.getPixel(px, py);
      if (!p) return;
      ctx.buffer.setPixel(px, py, [p[0], p[1], p[2], p[3] * (1 - opacity)]);
    };

    // De-dupe within one stamp/walk so an overlapping brush at size > 1
    // never erases the same pixel twice in one step (which would fade it
    // further than the opacity slider says it should for a single pass).
    const painted = new Set();
    const stampAt = (px, py) => {
      window.PAE.Geometry.brushSquare(px, py, size, (sx, sy) => {
        const key = sx + ',' + sy;
        if (painted.has(key)) return;
        painted.add(key);
        erase(sx, sy);
      });
    };

    if (this._lastX === null) {
      stampAt(x, y);
    } else {
      window.PAE.Geometry.bresenhamLine(this._lastX, this._lastY, x, y, stampAt, { skipFirst: true });
    }
    this._lastX = x;
    this._lastY = y;
    ctx.requestRender();
  }
}

window.PAE = window.PAE || {};
window.PAE.EraserTool = EraserTool;
