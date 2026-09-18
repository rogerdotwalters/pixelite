/**
 * tools/eyedropperTool.js
 * ---------------------------------------------------------------------------
 * Samples whatever pixel is under the click and makes it the new base/
 * current color — via ctx.pickColor(hex), which (see app.js's
 * App.setBaseColor) re-centers the color mixer's 3x3 grid AND becomes the
 * color the pencil/fill tools paint with. It never mutates the buffer and
 * needs no undo history entry.
 *
 * Clicking a fully transparent pixel is a no-op — there's no meaningful
 * color to pick up off blank canvas.
 */

class EyedropperTool extends window.PAE.Tool {
  constructor() {
    super('eyedropper', 'Eyedropper', 'copy');
  }

  onMouseDown(ctx, x, y) {
    this._pick(ctx, x, y);
  }

  // Dragging keeps sampling, same convenience real paint programs offer —
  // handy for scanning across a gradient to compare candidates.
  onMouseMove(ctx, x, y) {
    if (this._dragging) this._pick(ctx, x, y);
  }

  onMouseUp() {
    this._dragging = false;
  }

  onLeave() {
    this._dragging = false;
  }

  _pick(ctx, x, y) {
    this._dragging = true;
    const rgba = ctx.buffer.getPixel(x, y);
    if (!rgba || rgba[3] === 0) return; // out of bounds, or nothing painted there
    const hex =
      '#' +
      rgba
        .slice(0, 3)
        .map((v) => v.toString(16).padStart(2, '0'))
        .join('');
    ctx.pickColor(hex);
  }
}

window.PAE = window.PAE || {};
window.PAE.EyedropperTool = EyedropperTool;
