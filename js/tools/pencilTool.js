/**
 * tools/pencilTool.js
 * ---------------------------------------------------------------------------
 * The default tool. Paints the current palette color into the pixel buffer,
 * respecting the opacity slider. Uses a Bresenham line walk between the last
 * and current mouse position so fast drags don't leave gaps between pixels.
 *
 * Also respects the shared "Pen Size" brush (ctx.getBrushSize(): 1, 2, or 3
 * — see ui.js's pen-size control and Geometry.brushSquare) by stamping a
 * size x size square at every walked point instead of a single pixel. Size
 * 1 stamps exactly one pixel, so this is byte-for-byte the same behavior as
 * before brush sizes existed.
 */

class PencilTool extends window.PAE.Tool {
  constructor() {
    super('pencil', 'Pencil', 'crosshair');
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
    // Lifting the pointer off the canvas ends the current stroke, same as mouseup.
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
  }

  _paintStep(ctx, x, y) {
    const rgb = ctx.getColor();
    const opacity = ctx.getOpacity();
    const size = ctx.getBrushSize ? ctx.getBrushSize() : 1;

    // De-dupe within one step so an overlapping brush (size > 1) along a
    // walked diagonal never blends the same pixel twice at partial opacity.
    const painted = new Set();
    const stampAt = (px, py) => {
      window.PAE.Geometry.brushSquare(px, py, size, (sx, sy) => {
        const key = sx + ',' + sy;
        if (painted.has(key)) return;
        painted.add(key);
        ctx.buffer.blendPixel(sx, sy, rgb, opacity);
      });
    };

    if (this._lastX === null) {
      stampAt(x, y);
    } else {
      PencilTool._walkLine(this._lastX, this._lastY, x, y, stampAt);
    }
    this._lastX = x;
    this._lastY = y;
    ctx.requestRender();
  }

  /** Classic integer Bresenham line, calls visit(x, y) for every pixel on the segment. */
  static _walkLine(x0, y0, x1, y1, visit) {
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x1 >= x0 ? 1 : -1;
    let sy = y1 >= y0 ? 1 : -1;
    let x = x0;
    let y = y0;
    let err = dx - dy;
    // Skip the very first point (x0,y0) since it was already painted last step.
    let first = true;
    while (true) {
      if (!first) visit(x, y);
      first = false;
      if (x === x1 && y === y1) break;
      const e2 = err * 2;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }
}

window.PAE = window.PAE || {};
window.PAE.PencilTool = PencilTool;
