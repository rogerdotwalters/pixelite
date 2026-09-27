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

  /**
   * The `sides` vertices of a regular polygon (equilateral triangle, regular
   * hexagon/octagon, ...) sized and positioned so its OWN bounding box
   * exactly matches the box spanning the two given corners (either order) —
   * shared by the Triangle/Hexagon/Octagon tools, the same way
   * `ellipseOutline`/`ellipseFill` are shared by Ellipse/Circle.
   *
   * Placing vertices directly on a circumcircle centered in the box (the
   * naive approach) does NOT give this guarantee: an equilateral triangle's
   * circumradius, for instance, puts its base a quarter of the way short of
   * the box's bottom edge, since a triangle's center-to-vertex distance is
   * twice its center-to-edge distance. Building the polygon at a fixed unit
   * radius first and then rescaling it so ITS OWN bounding box fits the
   * target box exactly sidesteps that entirely — every one of these shapes
   * now touches all 4 sides of whatever box you drag, the same way
   * Rectangle and Ellipse already do.
   *
   * `rotationDeg` is measured the same way `Math.cos`/`Math.sin` measure it
   * (0 = straight out along +x from the center, increasing clockwise on
   * screen since +y is down) — each tool passes whatever offset gives it
   * its conventional look (apex-up for Triangle, flat-sided for Octagon,
   * etc. — see tools/shapeTool.js's POLYGON_ROTATION_DEG).
   *
   * `uniform` (default false, matching the original behavior above) is
   * what Shift-constrain actually needs, and what a plain "touches all 4
   * sides of the box" rescale does NOT give you: independently stretching
   * x and y to fill the box only produces a truly REGULAR polygon (every
   * side the same length) when the box's own aspect ratio happens to match
   * the raw shape's natural one — true for Circle/Ellipse (a circle's own
   * bounding box is always square, at any rotation) and for Octagon here
   * (8-fold symmetry gives it a square bounding box too), but NOT for
   * Triangle or Hexagon, whose natural bounding-box ratios are √3:1.5 and
   * √3:2 respectively. Forcing THOSE into a square box by stretching x and
   * y independently — which the original version of this function always
   * did — produces a squashed, non-equilateral shape whose bounding box
   * merely LOOKS square, not an actual regular triangle/hexagon. `uniform:
   * true` fixes that: it picks ONE scale (the largest that still fits
   * inside the box) and applies it to both axes, then centers the result
   * — so the polygon keeps every side equal, at the cost of not
   * necessarily touching all 4 sides of a box whose aspect ratio doesn't
   * match its own. Callers pass `uniform: true` only when Shift is held
   * (see tools/shapeTool.js) — an ordinary non-Shift drag still stretches
   * to fill the box exactly, same as Rectangle/Ellipse without Shift.
   */
  regularPolygonVertices(x0, y0, x1, y1, sides, rotationDeg, uniform) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    const rotation = (rotationDeg * Math.PI) / 180;

    const raw = [];
    for (let i = 0; i < sides; i++) {
      const angle = rotation + (i * 2 * Math.PI) / sides;
      raw.push({ x: Math.cos(angle), y: Math.sin(angle) });
    }
    const rawLeft = Math.min(...raw.map((p) => p.x));
    const rawRight = Math.max(...raw.map((p) => p.x));
    const rawTop = Math.min(...raw.map((p) => p.y));
    const rawBottom = Math.max(...raw.map((p) => p.y));
    const rawW = Math.max(rawRight - rawLeft, 1e-6);
    const rawH = Math.max(rawBottom - rawTop, 1e-6);
    const boxW = Math.max(right - left, 1);
    const boxH = Math.max(bottom - top, 1);

    let scaleX = boxW / rawW;
    let scaleY = boxH / rawH;
    let offsetX = left - rawLeft * scaleX;
    let offsetY = top - rawTop * scaleY;

    if (uniform) {
      // One shared scale (never independent per axis) — the actual fix:
      // pick the smaller of the two so the whole shape still fits inside
      // the box, then center it on whichever axis has slack left over.
      const scale = Math.min(scaleX, scaleY);
      scaleX = scale;
      scaleY = scale;
      const rawCenterX = (rawLeft + rawRight) / 2;
      const rawCenterY = (rawTop + rawBottom) / 2;
      offsetX = left + boxW / 2 - rawCenterX * scale;
      offsetY = top + boxH / 2 - rawCenterY * scale;
    }

    return raw.map((p) => ({
      x: offsetX + p.x * scaleX,
      y: offsetY + p.y * scaleY,
    }));
  },

  /** Every pixel on the outline connecting `points` in order, wrapping back to the first — shared by every polygon shape (Triangle/Hexagon/Octagon), same "walk each edge with Bresenham" idea `rectOutline` uses for its 4 sides. */
  polygonOutline(points, visit) {
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      Geometry.bresenhamLine(Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y), visit);
    }
  },

  /**
   * Every pixel inside the closed polygon `points`, via a classic
   * scanline/even-odd fill: for each pixel row, sample edge crossings at
   * y+0.5 (never exactly on a vertex, so a vertex that lands precisely on a
   * scanline can't create a degenerate double-count) and fill the spans
   * between each pair of crossings, left to right — the polygon's version
   * of `ellipseFill`'s per-row horizontal span. Also walks the outline
   * itself (`polygonOutline`), so a sharp, near-zero-width apex row (the
   * tip of a Triangle, say) that the scanline pass alone might skate past
   * without a crossing still gets its edge pixels painted.
   */
  polygonFill(points, visit) {
    const ys = points.map((p) => p.y);
    const top = Math.floor(Math.min(...ys));
    const bottom = Math.ceil(Math.max(...ys));
    for (let y = top; y <= bottom; y++) {
      const scanY = y + 0.5;
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if ((a.y <= scanY && b.y > scanY) || (b.y <= scanY && a.y > scanY)) {
          const t = (scanY - a.y) / (b.y - a.y);
          xs.push(a.x + t * (b.x - a.x));
        }
      }
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xLeft = Math.round(xs[i]);
        const xRight = Math.round(xs[i + 1]);
        for (let x = xLeft; x <= xRight; x++) visit(x, y);
      }
    }
    Geometry.polygonOutline(points, visit);
  },
};

window.PAE = window.PAE || {};
window.PAE.Geometry = Geometry;
