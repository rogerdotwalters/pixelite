/**
 * tools/mirrorPenTool.js
 * ---------------------------------------------------------------------------
 * Paints exactly like the Pencil, but every stamp is ALSO mirrored across
 * the canvas's center line — horizontally (across a vertical centerline,
 * so a stroke at column x is echoed at column width-1-x) or vertically
 * (across a horizontal centerline, row y echoed at height-1-y), picked via
 * the toolbar's Horizontal/Vertical toggle (see ctx.getMirrorAxis()).
 * Great for symmetric pixel art (character faces, icons, tiles).
 *
 * Shares the Pen Size brush and opacity with the Pencil (ctx.getBrushSize/
 * ctx.getOpacity). A pixel exactly on the centerline mirrors onto itself —
 * the de-dupe below makes sure that doesn't double-composite it at partial
 * opacity.
 */

class MirrorPenTool extends window.PAE.Tool {
  constructor() {
    super('mirror', 'Mirror Pen', 'crosshair');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit();
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
    const rgb = ctx.getColor();
    const opacity = ctx.getOpacity();
    const size = ctx.getBrushSize ? ctx.getBrushSize() : 1;
    const axis = ctx.getMirrorAxis ? ctx.getMirrorAxis() : 'x';
    const width = ctx.buffer.width;
    const height = ctx.buffer.height;

    const painted = new Set();
    const stampBoth = (px, py) => {
      const mx = axis === 'y' ? px : width - 1 - px;
      const my = axis === 'y' ? height - 1 - py : py;
      [
        [px, py],
        [mx, my],
      ].forEach(([ox, oy]) => {
        window.PAE.Geometry.brushSquare(ox, oy, size, (sx, sy) => {
          const key = sx + ',' + sy;
          if (painted.has(key)) return;
          painted.add(key);
          ctx.buffer.blendPixel(sx, sy, rgb, opacity);
        });
      });
    };

    if (this._lastX === null) {
      stampBoth(x, y);
    } else {
      window.PAE.Geometry.bresenhamLine(this._lastX, this._lastY, x, y, stampBoth, { skipFirst: true });
    }
    this._lastX = x;
    this._lastY = y;
    ctx.requestRender();
  }
}

window.PAE = window.PAE || {};
window.PAE.MirrorPenTool = MirrorPenTool;
