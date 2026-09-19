/**
 * tools/pixelSelectionTool.js
 * ---------------------------------------------------------------------------
 * Three ways to build a selection, switched via the toolbar's Select
 * mode segmented control (see ui.js's initToolOptions):
 *   - "Rect" (the original, default behavior): click-drag a rectangular
 *     marquee. Dragging outside the canvas or collapsing to a single click
 *     still produces a valid 1x1 selection rather than nothing, so a plain
 *     click reliably selects "the pixel under the cursor."
 *   - "Layer": a single click selects the tight bounding box of every
 *     non-transparent pixel on the ACTIVE layer, masked to that layer's
 *     exact alpha footprint (PixelBuffer.boundingBoxOfContent/alphaMask) —
 *     grabs exactly what's drawn, not the whole (possibly mostly-empty)
 *     canvas.
 *   - "Object": click a painted pixel to flood-fill (4-connected) the
 *     connected shape touching it — a simple "magic wand" — selecting its
 *     tight bounding box PLUS an exact pixel mask (PixelBuffer.floodSelect),
 *     so a non-rectangular shape's selection doesn't also grab unrelated
 *     pixels that just happen to share its bounding box.
 * Either of the last two produces a selection with a `.mask` (see
 * selection.js's header comment); "Rect" never does. The selection itself
 * never touches the pixel buffer or undo history — it's read by:
 *   - Ctrl+C / Ctrl+X / Ctrl+V (App.copySelection/cutSelection/pasteSelection)
 *     — an ordinary clipboard, within the SAME layer.
 *   - "Copy to New Layer" / "Cut to New Layer" (App.copySelectionToNewLayer,
 *     wired from this tool's toolbar options panel) — puts the selected
 *     pixels on a brand-new layer instead, using the layers system.
 *   - The Rotate Selection and Resize Selection tools read it to know what
 *     to transform (Resize Selection also respects the mask; Rotate does
 *     not yet — see its own header comment).
 */

class PixelSelectionTool extends window.PAE.Tool {
  constructor() {
    super('select', 'Pixel Selection', 'crosshair');
    this._dragging = false;
    this._startX = null;
    this._startY = null;
    this.mode = 'rect'; // 'rect' | 'layer' | 'object' — set by the toolbar's Select mode buttons
  }

  setMode(mode) {
    this.mode = mode;
  }

  onMouseDown(ctx, x, y) {
    if (this.mode === 'layer') {
      this._selectLayer(ctx);
      return;
    }
    if (this.mode === 'object') {
      this._selectObject(ctx, x, y);
      return;
    }
    this._dragging = true;
    this._startX = x;
    this._startY = y;
    ctx.setSelection(PixelSelectionTool._normalize(x, y, x, y));
  }

  onMouseMove(ctx, x, y) {
    if (this.mode !== 'rect' || !this._dragging) return;
    ctx.setSelection(PixelSelectionTool._normalize(this._startX, this._startY, x, y));
  }

  onMouseUp(ctx, x, y) {
    if (this.mode !== 'rect' || !this._dragging) return;
    ctx.setSelection(PixelSelectionTool._normalize(this._startX, this._startY, x, y));
    this._dragging = false;
  }

  onLeave() {
    this._dragging = false;
  }

  /** "Layer" mode — see the class header comment above. */
  _selectLayer(ctx) {
    const buf = ctx.buffer;
    const region = window.PAE.PixelBuffer.boundingBoxOfContent(buf);
    if (!region) {
      alert('This layer is empty — nothing to select.');
      return;
    }
    const mask = window.PAE.PixelBuffer.alphaMask(buf, region);
    ctx.setSelection({ x: region.x, y: region.y, w: region.w, h: region.h, mask });
  }

  /** "Object" mode — see the class header comment above. */
  _selectObject(ctx, x, y) {
    const buf = ctx.buffer;
    const result = window.PAE.PixelBuffer.floodSelect(buf, x, y);
    if (!result) {
      alert('No painted pixel there to select — click on part of a shape.');
      return;
    }
    const { region, mask } = result;
    ctx.setSelection({ x: region.x, y: region.y, w: region.w, h: region.h, mask });
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
