/**
 * tools/pixelSelectionTool.js
 * ---------------------------------------------------------------------------
 * Click-drag a rectangular marquee to select pixels — drawn on screen as a
 * "marching ants" overlay (see selectionOverlay.js). The selection itself
 * never touches the pixel buffer or undo history (see selection.js); it's
 * just a rectangle other actions read:
 *   - Ctrl+C / Ctrl+X / Ctrl+V (App.copySelection/cutSelection/pasteSelection)
 *     — an ordinary clipboard, within the SAME layer.
 *   - "Copy to New Layer" / "Cut to New Layer" (App.copySelectionToNewLayer,
 *     wired from this tool's toolbar options panel) — puts the selected
 *     pixels on a brand-new layer instead, using the layers system.
 *   - The Rotate Selection tool reads it to know what to rotate.
 * Dragging outside the canvas or collapsing to a single click still
 * produces a valid 1x1 selection rather than nothing, so a plain click
 * reliably selects "the pixel under the cursor."
 */

class PixelSelectionTool extends window.PAE.Tool {
  constructor() {
    super('select', 'Pixel Selection', 'crosshair');
    this._dragging = false;
    this._startX = null;
    this._startY = null;
  }

  onMouseDown(ctx, x, y) {
    this._dragging = true;
    this._startX = x;
    this._startY = y;
    ctx.setSelection(PixelSelectionTool._normalize(x, y, x, y));
  }

  onMouseMove(ctx, x, y) {
    if (!this._dragging) return;
    ctx.setSelection(PixelSelectionTool._normalize(this._startX, this._startY, x, y));
  }

  onMouseUp(ctx, x, y) {
    if (!this._dragging) return;
    ctx.setSelection(PixelSelectionTool._normalize(this._startX, this._startY, x, y));
    this._dragging = false;
  }

  onLeave() {
    this._dragging = false;
  }

  static _normalize(x0, y0, x1, y1) {
    const left = Math.min(x0, x1);
    const right = Math.max(x0, x1);
    const top = Math.min(y0, y1);
    const bottom = Math.max(y0, y1);
    return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
  }
}

window.PAE = window.PAE || {};
window.PAE.PixelSelectionTool = PixelSelectionTool;
