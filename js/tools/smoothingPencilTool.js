/**
 * tools/smoothingPencilTool.js
 * ---------------------------------------------------------------------------
 * A Pencil variant that runs the raw stroke through LineSmoothing
 * (lineSmoothing.js) before committing it, instead of painting exactly
 * where the mouse went. Three settings, all live-toggleable in the
 * toolbar (see ctx.getSmoothingMode/getSmoothingEvenStep/
 * getSmoothingMirrorHalves/getSmoothingTiming):
 *
 *   Mode:     'doubling'  — just LineSmoothing.limitDoubling
 *             'symmetric' — Even Step Pattern and/or Mirror Halves, per
 *                           their own two checkboxes
 *             'both'      — all of the above together
 *   Timing:   'live'   — the smoothed result updates on every mouse move
 *             'finish' — the raw stroke paints normally while dragging
 *                        (so you're not drawing blind); one smoothing pass
 *                        replaces it with the smoothed version at mouse-up
 *
 * A fifth algorithm, Arc Curve Correction (local curvature averaging —
 * LineSmoothing.arcCurveCorrect), always runs FIRST inside
 * LineSmoothing.smoothStroke regardless of Mode — it has no setting/
 * checkbox of its own here, since it's baked into every mode rather than
 * gated behind a switch.
 *
 * Implementation follows this codebase's established "snapshot once, then
 * re-derive from scratch" pattern (Rotate/Resize Selection's preview, the
 * Layer Array preview): a pristine copy of the buffer is taken at
 * mouse-down, and every recompute restores every pixel this stroke has
 * touched back to that pristine value before repainting the freshly
 * computed point set. That's what makes it safe to re-run the smoothing
 * algorithms — which are NOT idempotent to re-apply on top of their own
 * already-blended output — as many times as the mouse moves, always
 * starting from the same clean base rather than compounding blends.
 */

class SmoothingPencilTool extends window.PAE.Tool {
  constructor() {
    super('smoothpencil', 'Smoothing Pencil', 'crosshair');
    this._drawing = false;
    this._rawPoints = [];
    this._paintedCells = new Set(); // "x,y" keys this stroke has painted, as of the last recompute
    this._preStrokeSnapshot = null; // Uint8ClampedArray clone of ctx.buffer.data from just before this stroke
  }

  onActivate() {
    this._drawing = false;
    this._rawPoints = [];
    this._paintedCells = new Set();
    this._preStrokeSnapshot = null;
  }

  onMouseDown(ctx, x, y) {
    ctx.history.commit(); // snapshot BEFORE this stroke starts, for undo — same convention as every other brush
    this._drawing = true;
    this._rawPoints = [{ x, y }];
    this._paintedCells = new Set();
    this._preStrokeSnapshot = ctx.buffer.data.slice();
    this._recompute(ctx, this._isFinishTiming(ctx));
  }

  onMouseMove(ctx, x, y) {
    if (!this._drawing) return;
    const last = this._rawPoints[this._rawPoints.length - 1];
    if (last.x === x && last.y === y) return;
    window.PAE.Geometry.bresenhamLine(last.x, last.y, x, y, (px, py) => this._rawPoints.push({ x: px, y: py }), { skipFirst: true });
    this._recompute(ctx, this._isFinishTiming(ctx));
  }

  onMouseUp(ctx) {
    if (!this._drawing) return;
    // Finishing-pass mode has been painting the raw stroke this whole time
    // (see _recompute's `useRaw` branch) — this is the one moment the real
    // smoothing algorithms actually run, over the complete stroke at once.
    if (this._isFinishTiming(ctx)) this._recompute(ctx, false);
    this._drawing = false;
    this._rawPoints = [];
    this._paintedCells = new Set();
    this._preStrokeSnapshot = null;
  }

  onLeave(ctx) {
    // Lifting the pointer off the canvas ends the stroke the same way mouseup does.
    this.onMouseUp(ctx);
  }

  _isFinishTiming(ctx) {
    return (ctx.getSmoothingTiming ? ctx.getSmoothingTiming() : 'live') === 'finish';
  }

  /**
   * Restores every pixel this stroke has painted so far back to its
   * pre-stroke value, then paints fresh: the raw stroke (`useRaw`, for
   * Finishing Pass's live feedback while dragging) or the fully smoothed
   * stroke (for Live timing on every move, and Finishing Pass's one pass
   * at mouse-up).
   */
  _recompute(ctx, useRaw) {
    const snapshot = this._preStrokeSnapshot;
    for (const key of this._paintedCells) {
      const comma = key.indexOf(',');
      const sx = Number(key.slice(0, comma));
      const sy = Number(key.slice(comma + 1));
      const i = ctx.buffer.indexOf(sx, sy);
      ctx.buffer.data[i] = snapshot[i];
      ctx.buffer.data[i + 1] = snapshot[i + 1];
      ctx.buffer.data[i + 2] = snapshot[i + 2];
      ctx.buffer.data[i + 3] = snapshot[i + 3];
    }
    this._paintedCells = new Set();

    const points = useRaw ? this._rawPoints : window.PAE.LineSmoothing.smoothStroke(this._rawPoints, this._settings(ctx));

    const rgb = ctx.getColor();
    const opacity = ctx.getOpacity();
    const size = ctx.getBrushSize ? ctx.getBrushSize() : 1;
    for (const p of points) {
      window.PAE.Geometry.brushSquare(p.x, p.y, size, (sx, sy) => {
        const key = sx + ',' + sy;
        if (this._paintedCells.has(key)) return; // avoid double-blending the same pixel twice within one pass
        this._paintedCells.add(key);
        ctx.buffer.blendPixel(sx, sy, rgb, opacity);
      });
    }
    ctx.requestRender();
  }

  _settings(ctx) {
    return {
      mode: ctx.getSmoothingMode ? ctx.getSmoothingMode() : 'both',
      evenStep: ctx.getSmoothingEvenStep ? ctx.getSmoothingEvenStep() : true,
      mirrorHalves: ctx.getSmoothingMirrorHalves ? ctx.getSmoothingMirrorHalves() : false,
    };
  }
}

window.PAE = window.PAE || {};
window.PAE.SmoothingPencilTool = SmoothingPencilTool;
