/**
 * geometry.js
 * ---------------------------------------------------------------------------
 * Shared pixel-rasterization algorithms used by the Line and Shape tools
 * (and reusable by anything else that needs to walk a set of integer pixel
 * coordinates). Every algorithm here works in whole pixels only — no
 * floating point coverage, no anti-aliasing — so lines, rectangles, and
 * ellipses stay perfectly crisp at any zoom level, matching this whole
 * app's "nearest neighbor, never blurry" rendering philosophy (see
 * canvasView.js's header comment).
 *
 * Every function calls `visit(x, y)` once per pixel that belongs to the
 * shape. Callers decide what "visit" means (paint, preview, sample, ...).
 * None of these touch a PixelBuffer directly, so they're trivial to unit
 * test on their own.
 */

const Geometry = {
  /**
   * Classic integer Bresenham line from (x0,y0) to (x1,y1) inclusive.
   * @param {{skipFirst?: boolean}} [opts]  skipFirst omits the starting
   *   point — used when the caller already handled it (e.g. the pencil-
   *   style "walk the gap since the last mousemove" pattern, where (x0,y0)
   *   was already painted on the previous step).
   */
  bresenhamLine(x0, y0, x1, y1, visit, opts = {}) {
    const skipFirst = !!opts.skipFirst;
    let dx = Math.abs(x1 - x0);
    let dy = Math.abs(y1 - y0);
    let sx = x1 >= x0 ? 1 : -1;
    let sy = y1 >= y0 ? 1 : -1;
    let x = x0;
    let y = y0;
    let err = dx - dy;
    let first = true;
    while (true) {
      if (!(skipFirst && first)) visit(x, y);
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
  },

  /** Every pixel on the border of the axis-aligned rectangle spanning the two corners (either order). */
  rectOutline(x0, y0, x1, y1, visit) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    for (let x = left; x <= right; x++) {
      visit(x, top);
      visit(x, bottom);
    }
    for (let y = top; y <= bottom; y++) {
      visit(left, y);
      visit(right, y);
    }
  },

  /** Every pixel inside (and on the border of) the axis-aligned rectangle. */
  rectFill(x0, y0, x1, y1, visit) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) visit(x, y);
    }
  },

  /**
   * Outline of the ellipse bounded by the box spanning the two corners.
   * Uses a "double scan" instead of the classic decision-variable midpoint
   * ellipse algorithm: one pass walks every row and plots that row's exact
   * left/right edge, a second pass walks every column and plots that
   * column's exact top/bottom edge. Rows alone leave 1px gaps near the top
   * and bottom of the curve (where it's nearly flat, so consecutive rows
   * jump by more than 1px in x); the column pass fills exactly those gaps.
   * Every plotted coordinate is still a whole pixel (Math.round), so the
   * result is just as crisp as the midpoint algorithm, with less risk of
   * an off-by-one in the decision variable.
   */
  ellipseOutline(x0, y0, x1, y1, visit) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = Math.max((right - left) / 2, 0.5);
    const ry = Math.max((bottom - top) / 2, 0.5);

    for (let y = Math.floor(top); y <= Math.ceil(bottom); y++) {
      const dy = (y - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const dx = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      visit(Math.round(cx - dx), y);
      visit(Math.round(cx + dx), y);
    }
    for (let x = Math.floor(left); x <= Math.ceil(right); x++) {
      const dx = (x - cx) / rx;
      if (Math.abs(dx) > 1) continue;
      const dy = ry * Math.sqrt(Math.max(0, 1 - dx * dx));
      visit(x, Math.round(cy - dy));
      visit(x, Math.round(cy + dy));
    }
  },

  /**
   * Every pixel in an SxS square brush centered on (cx, cy) — the shared
   * "Pen Size" stamp used by the Pencil, Eraser, and Mirror Pen tools.
   * Size 1 visits exactly (cx, cy), unchanged from before brush sizes
   * existed. For an even size, the extra row/column goes to the
   * bottom-right (an arbitrary but consistent convention — there's no
   * pixel-centered way to make an even-sized square symmetric).
   */
  brushSquare(cx, cy, size, visit) {
    const s = Math.max(1, Math.round(size));
    const before = Math.floor((s - 1) / 2);
    const after = Math.ceil((s - 1) / 2);
    for (let y = cy - before; y <= cy + after; y++) {
      for (let x = cx - before; x <= cx + after; x++) visit(x, y);
    }
  },

  /** Filled ellipse bounded by the box spanning the two corners: a per-row horizontal span. */
  ellipseFill(x0, y0, x1, y1, visit) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const cx = (left + right) / 2;
    const cy = (top + bottom) / 2;
    const rx = Math.max((right - left) / 2, 0.5);
    const ry = Math.max((bottom - top) / 2, 0.5);

    for (let y = Math.floor(top); y <= Math.ceil(bottom); y++) {
      const dy = (y - cy) / ry;
      if (Math.abs(dy) > 1) continue;
      const dx = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
      const xLeft = Math.round(cx - dx);
      const xRight = Math.round(cx + dx);
      for (let x = xLeft; x <= xRight; x++) visit(x, y);
    }
  },
};

window.PAE = window.PAE || {};
window.PAE.Geometry = Geometry;
