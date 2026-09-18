/**
 * tools/rotateSelectionTool.js
 * ---------------------------------------------------------------------------
 * Rotates the CONTENTS of the current pixel selection (see the Pixel
 * Selection tool) in place, by an arbitrary angle set with the toolbar's
 * Angle slider (see ui.js's rotate-options panel) — not just 90° turns.
 * Every destination pixel inside the selection's bounding box is filled by
 * sampling the PRE-ROTATION snapshot at the inverse-rotated source
 * coordinate, rounded to the nearest whole pixel (nearest-neighbor, never
 * smoothed/anti-aliased, matching this app's "always crisp" pixel-art
 * rendering). A source coordinate that lands outside the ORIGINAL
 * selection's rectangle is treated as empty (fully transparent) rather than
 * showing whatever else happened to be there — so rotating a shape doesn't
 * smear in unrelated pixels from outside the selection. The box itself
 * doesn't grow to fit a rotated diagonal silhouette, so corners can clip
 * past 45°-ish angles; that's an accepted simplification for a first pass.
 *
 * There's no dragging here — you make a selection with the Pixel Selection
 * tool FIRST, then switch to this tool to rotate it. Selecting happens via
 * onActivate: it snapshots the active layer's buffer once (also the single
 * `history.commit()` for the whole rotation, how many times the slider
 * moves), so every subsequent `applyAngle()` call re-derives the rotation
 * fresh from that ORIGINAL snapshot rather than compounding rounding error
 * from rotating an already-rotated result.
 */

class RotateSelectionTool extends window.PAE.Tool {
  constructor() {
    super('rotate', 'Rotate Selection', 'default');
    this._snapshot = null;
    this._sel = null;
  }

  onActivate(ctx) {
    const sel = ctx.getSelection ? ctx.getSelection() : null;
    this._sel = sel || null;
    this._snapshot = sel ? ctx.buffer.clone() : null;
    if (sel) ctx.history.commit(); // one undo step for the whole rotation, however many times the slider moves
  }

  onDeactivate() {
    this._snapshot = null;
    this._sel = null;
  }

  hasSelection() {
    return !!this._sel;
  }

  /** Re-applies rotation from scratch (against the original snapshot) at `degrees`. Called by the Angle slider's `input` handler. */
  applyAngle(ctx, degrees) {
    if (!this._snapshot || !this._sel) return;
    const buf = ctx.buffer;
    const sel = this._sel;
    const snapshot = this._snapshot;
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    // Rotating the DESTINATION by `degrees` means looking up the SOURCE at
    // the inverse (negative) rotation — standard inverse-mapping resample.
    const rad = (-degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    for (let y = sel.y; y < sel.y + sel.h; y++) {
      for (let x = sel.x; x < sel.x + sel.w; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const srcX = Math.floor(cx + dx * cos - dy * sin);
        const srcY = Math.floor(cy + dx * sin + dy * cos);
        let value = [0, 0, 0, 0];
        if (srcX >= sel.x && srcX < sel.x + sel.w && srcY >= sel.y && srcY < sel.y + sel.h) {
          value = snapshot.getPixel(srcX, srcY) || [0, 0, 0, 0];
        }
        buf.setPixel(x, y, value);
      }
    }
    ctx.requestRender();
  }
}

window.PAE = window.PAE || {};
window.PAE.RotateSelectionTool = RotateSelectionTool;
