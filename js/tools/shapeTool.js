/**
 * tools/shapeTool.js
 * ---------------------------------------------------------------------------
 * Draws a rectangle or an ellipse (outline or filled — see the toolbar's
 * "Fill" checkbox, read via ctx.getShapeFill()) by click-dragging from one
 * corner of its bounding box to the opposite corner. One class handles
 * both shapes — `shapeKind` ('rect' or 'ellipse') picks which pair of
 * Geometry helpers to use; everything else (drag tracking, live preview,
 * history) is identical.
 *
 * Live preview works the same way as the Line tool: onMouseDown snapshots
 * the buffer, and every onMouseMove restores it before re-drawing the shape
 * to the current pointer position, so dragging around always shows exactly
 * one shape — the one that would be committed if you released right now.
 *
 * Hold Shift to constrain the bounding box to a square, which turns the
 * rectangle into a perfect square and the ellipse into a perfect circle.
 */

class ShapeTool extends window.PAE.Tool {
  /**
   * @param {'rect'|'ellipse'} shapeKind
   * @param {string} name
   */
  constructor(shapeKind, name) {
    super(shapeKind, name, 'crosshair');
    this.shapeKind = shapeKind;
    this._dragging = false;
    this._startX = null;
    this._startY = null;
    this._snapshot = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit(); // snapshot BEFORE this shape is drawn
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
      const constrained = ShapeTool._constrainSquare(this._startX, this._startY, x, y);
      endX = constrained.x;
      endY = constrained.y;
    }

    const rgb = ctx.getColor();
    const opacity = ctx.getOpacity();
    const filled = ctx.getShapeFill ? ctx.getShapeFill() : false;

    // An outline's row/column double-scan (see geometry.js) and a filled
    // shape's edge pixels can otherwise visit the same pixel twice, which
    // would double-composite it at partial opacity — de-dupe so every
    // pixel in the shape is blended exactly once, regardless of opacity.
    const painted = new Set();
    const paint = (px, py) => {
      const key = px + ',' + py;
      if (painted.has(key)) return;
      painted.add(key);
      ctx.buffer.blendPixel(px, py, rgb, opacity);
    };

    const geometry = window.PAE.Geometry;
    if (this.shapeKind === 'rect') {
      (filled ? geometry.rectFill : geometry.rectOutline)(this._startX, this._startY, endX, endY, paint);
    } else {
      (filled ? geometry.ellipseFill : geometry.ellipseOutline)(this._startX, this._startY, endX, endY, paint);
    }
    ctx.requestRender();
  }

  /** Expands/contracts the (x1,y1) corner so the bounding box from (x0,y0) is a square, preserving drag direction. */
  static _constrainSquare(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    return {
      x: x0 + (dx < 0 ? -size : size),
      y: y0 + (dy < 0 ? -size : size),
    };
  }
}

window.PAE = window.PAE || {};
window.PAE.ShapeTool = ShapeTool;
