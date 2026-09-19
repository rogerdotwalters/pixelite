/**
 * tools/stampBrushTool.js
 * ---------------------------------------------------------------------------
 * Paints a small reusable pixel pattern — the "stamp", drawn in its own
 * mini editor (see stampBrush.js's Stamp Editor dialog, opened from this
 * tool's toolbar panel) — repeated across the canvas on a fixed grid sized
 * to the stamp's own width/height, so plank/tile patterns always tile
 * edge-to-edge with no gaps or overlaps. Rather than a normal per-pixel
 * dab, every touched grid CELL gets the WHOLE stamp stamped into it at
 * once: click a cell, get the whole pattern; drag across several cells
 * (via the same Bresenham-line interpolation V Brush uses, so a fast drag
 * never skips one) and each cell gets stamped exactly once per stroke.
 *
 * Two independent toggles, read fresh from `ctx` on every stamp so they can
 * be flipped mid-stroke (see the toolbar's Stamp Brush options panel,
 * wired in ui.js):
 *   - Anchor ("origin" vs "first-click"): "origin" locks the grid to the
 *     canvas's own (0,0) corner — always perfectly seamless, however or
 *     wherever you click, run after run. "first-click" instead locks the
 *     grid to whichever pixel you first click after picking up this tool
 *     (captured once, in `_ensureAnchor`, and cleared in `onDeactivate` so
 *     picking the tool back up re-anchors fresh) — lets you deliberately
 *     shift the whole tile pattern's offset.
 *   - Blend ("overwrite" vs "blend"): "overwrite" is a true rubber stamp —
 *     it replaces a touched cell's pixels completely with the stamp's own
 *     (including the stamp's own transparency), ignoring the Opacity
 *     slider entirely, so a tiled result always looks clean regardless of
 *     what was underneath. "blend" instead only paints the stamp's own
 *     non-transparent pixels via the normal opacity-aware `blendPixel`,
 *     leaving whatever was already in the cell alone wherever the stamp
 *     itself is transparent — same opacity behavior as every other brush.
 */

class StampBrushTool extends window.PAE.Tool {
  constructor() {
    super('stamp', 'Stamp Brush', 'crosshair');
    this._drawing = false;
    this._lastX = null;
    this._lastY = null;
    this._anchorX = null; // only meaningful in 'first-click' mode
    this._anchorY = null;
    this._stampedThisStroke = null; // Set of "cellX,cellY" already stamped this stroke — avoids redundant re-stamping on a slow drag (harmless either way, since stamping is idempotent)
  }

  onActivate() {
    this._anchorX = null;
    this._anchorY = null;
  }

  onDeactivate() {
    this._drawing = false;
    this._anchorX = null;
    this._anchorY = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit(); // one undo step for the whole stroke
    this._drawing = true;
    this._stampedThisStroke = new Set();
    this._ensureAnchor(ctx, x, y);
    this._stampCellAt(ctx, x, y);
    this._lastX = x;
    this._lastY = y;
  }

  onMouseMove(ctx, x, y) {
    if (!this._drawing) return;
    window.PAE.Geometry.bresenhamLine(this._lastX, this._lastY, x, y, (px, py) => this._stampCellAt(ctx, px, py), {
      skipFirst: true,
    });
    this._lastX = x;
    this._lastY = y;
  }

  onMouseUp() {
    this._drawing = false;
    this._stampedThisStroke = null;
    this._lastX = null;
    this._lastY = null;
  }

  onLeave() {
    this._drawing = false;
    this._stampedThisStroke = null;
    this._lastX = null;
    this._lastY = null;
  }

  /** In 'first-click' mode, locks the grid to the exact pixel first clicked since activation — a no-op every call after the first. */
  _ensureAnchor(ctx, x, y) {
    if (ctx.getStampAnchorMode() !== 'first-click') return;
    if (this._anchorX !== null) return;
    this._anchorX = x;
    this._anchorY = y;
  }

  /** Stamps the WHOLE grid cell that pixel (x, y) falls within. */
  _stampCellAt(ctx, x, y) {
    const stamp = ctx.getStamp();
    if (!stamp || !stamp.buffer || stamp.width < 1 || stamp.height < 1) return;

    const anchorX = ctx.getStampAnchorMode() === 'first-click' && this._anchorX !== null ? this._anchorX : 0;
    const anchorY = ctx.getStampAnchorMode() === 'first-click' && this._anchorY !== null ? this._anchorY : 0;
    const cellX = Math.floor((x - anchorX) / stamp.width);
    const cellY = Math.floor((y - anchorY) / stamp.height);
    const key = `${cellX},${cellY}`;
    if (this._stampedThisStroke) {
      if (this._stampedThisStroke.has(key)) return;
      this._stampedThisStroke.add(key);
    }

    const originX = anchorX + cellX * stamp.width;
    const originY = anchorY + cellY * stamp.height;
    const overwrite = ctx.getStampBlendMode() !== 'blend';
    const opacity = ctx.getOpacity();
    const buf = ctx.buffer;

    for (let sy = 0; sy < stamp.height; sy++) {
      for (let sx = 0; sx < stamp.width; sx++) {
        const p = stamp.buffer.getPixel(sx, sy);
        if (!p) continue;
        const destX = originX + sx;
        const destY = originY + sy;
        if (overwrite) {
          // A literal, exact replace — deliberately ignores the Opacity
          // slider, same "this is an atomic stamp, not a fade" reasoning
          // as why a rubber stamp doesn't come in shades.
          buf.setPixel(destX, destY, p);
        } else if (p[3] > 0) {
          buf.blendPixel(destX, destY, [p[0], p[1], p[2]], (p[3] / 255) * opacity);
        }
      }
    }
    ctx.requestRender();
  }
}

window.PAE = window.PAE || {};
window.PAE.StampBrushTool = StampBrushTool;
