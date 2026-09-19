/**
 * tools/rotateSelectionTool.js
 * ---------------------------------------------------------------------------
 * Rotates the CONTENTS of the current pixel selection (see the Pixel
 * Selection tool) in place, by an arbitrary angle set with the toolbar's
 * Angle slider/number box (see ui.js's rotate-options panel) — not just 90°
 * turns. Every destination pixel inside the selection's bounding box is
 * filled by sampling a PRE-ROTATION source at the inverse-rotated source
 * coordinate, rounded to the nearest whole pixel (nearest-neighbor, never
 * smoothed/anti-aliased, matching this app's "always crisp" pixel-art
 * rendering). A source coordinate that lands outside the ORIGINAL
 * selection's rectangle is treated as empty (fully transparent) rather than
 * showing whatever else happened to be there — so rotating a shape doesn't
 * smear in unrelated pixels from outside the selection. The box itself
 * doesn't grow to fit a rotated diagonal silhouette, so corners can clip
 * past 45°-ish angles; that's an accepted simplification for a first pass.
 * This tool also deliberately ignores a Layer/Object-mode selection's exact
 * `.mask` shape — it always transforms the whole bounding box — a
 * documented, separate known gap from the data-loss fix below.
 *
 * There's no dragging here — you make a selection with the Pixel Selection
 * tool FIRST, then switch to this tool to rotate it.
 *
 * Roger: "the program needs to save the original state of the thing being
 * rotated to preserve data loss. So even at 180 deg, the original 0 deg
 * object will remain to be the object that is actually being rotated."
 * `onActivate` used to simply re-snapshot whatever pixels were CURRENTLY on
 * the layer every time the tool was (re)activated — meaning switching away
 * and back after rotating to, say, 90° would treat that already-rotated,
 * already-resampled-and-corner-clipped result as the new "0°," silently
 * compounding loss on every subsequent rotate. It now instead asks the
 * active LAYER for `resolveRotationBase(sel)` (see layer.js), which hands
 * back the object's actual pristine (never-rotated) pixels plus however far
 * they've already been rotated — verified, not just assumed, so a
 * selection someone painted on since the last rotate still starts fresh
 * from what's really there rather than silently discarding that paint.
 * Every `applyAngle(ctx, degrees)` call then re-derives the WHOLE result
 * from that one pristine buffer at `origin.angle + degrees`, and re-stores
 * the result back onto the layer — so scrubbing the slider back and forth
 * (or leaving and coming back to rotate further) never compounds rounding
 * error OR resampling/clipping loss, all the way back to angle zero.
 */

class RotateSelectionTool extends window.PAE.Tool {
  constructor() {
    super('rotate', 'Rotate Selection', 'default');
    this._sel = null;
    this._layer = null; // the Layer this rotation's rotationOrigin lives on
    this._rotationBase = null; // {buffer, angle} to resample FROM — see Layer.resolveRotationBase
  }

  onActivate(ctx) {
    const sel = ctx.getSelection ? ctx.getSelection() : null;
    const layer = sel && ctx.getActiveLayer ? ctx.getActiveLayer() : null;
    this._sel = sel || null;
    this._layer = layer;
    this._rotationBase = sel && layer ? layer.resolveRotationBase(sel) : null;
    if (sel) ctx.history.commit(); // one undo step for the whole rotation, however many times the slider moves
  }

  onDeactivate() {
    this._sel = null;
    this._layer = null;
    this._rotationBase = null;
  }

  hasSelection() {
    return !!this._sel;
  }

  /** Re-applies rotation from scratch (against the pristine rotation-origin buffer, never the current possibly-already-rotated pixels) at a TOTAL angle of `origin.angle + degrees`. Called by the Angle slider/number box's handlers. */
  applyAngle(ctx, degrees) {
    if (!this._rotationBase || !this._sel) return;
    const buf = ctx.buffer;
    const sel = this._sel;
    const totalAngle = this._rotationBase.angle + degrees;
    const rotated = window.PAE.PixelBuffer.rotateLocal(this._rotationBase.buffer, totalAngle);
    for (let ry = 0; ry < sel.h; ry++) {
      for (let rx = 0; rx < sel.w; rx++) {
        buf.setPixel(sel.x + rx, sel.y + ry, rotated.getPixel(rx, ry) || [0, 0, 0, 0]);
      }
    }
    if (this._layer) this._layer.storeRotationBase(this._rotationBase.buffer, totalAngle);
    ctx.requestRender();
  }
}

window.PAE = window.PAE || {};
window.PAE.RotateSelectionTool = RotateSelectionTool;
