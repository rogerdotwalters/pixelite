/**
 * tools/resizeSelectionTool.js
 * ---------------------------------------------------------------------------
 * Scales the CONTENTS of the current pixel selection (rectangle, "Layer", or
 * "Object" — see pixelSelectionTool.js) in place, growing/shrinking outward
 * from the selection's own center, always via nearest-neighbor sampling (no
 * smoothing/anti-aliasing, matching every other resample in this app). Two
 * modes, toggled by the toolbar's Smooth/Rigid segmented control:
 *   - Smooth: any percentage 25-400%. Still nearest-neighbor, but because
 *     the scale factor isn't necessarily a whole number, different source
 *     pixels can end up mapping to slightly different numbers of destination
 *     pixels (ordinary nearest-neighbor rounding) — fine for a quick resize,
 *     less fine if an exactly even, "graph paper" enlargement matters.
 *   - Rigid: locks the factor to a whole number N (1-8), so every source
 *     pixel becomes EXACTLY an N×N block of destination pixels (N=2 → "1
 *     pixel = 4", N=3 → "1 pixel = 9", ...) — the classic pixel-art-safe way
 *     to enlarge art with zero uneven seams.
 *
 * Like Rotate Selection, there's no dragging on the canvas: make a
 * selection first with the Pixel Selection tool, then switch to this tool
 * and use the slider. `onActivate` snapshots the buffer once and commits
 * history once for the whole operation (however many times the slider
 * moves); every subsequent `applyScale()` call re-derives the result from
 * scratch against that ORIGINAL snapshot, so moving the slider back and
 * forth never compounds resampling error.
 *
 * If the selection came from "Layer" or "Object" mode (it has a pixel mask,
 * not just a bounding box), the mask is resampled right alongside the
 * pixels via the exact same nearest-neighbor lookup, so a non-rectangular
 * shape stays exactly its shape at any size instead of ballooning into its
 * old bounding box. The result is clipped to the canvas's own bounds — like
 * Rotate Selection, this doesn't grow the layer/canvas to fit a scaled-up
 * selection that no longer fits (see the "Known gaps" note this shares with
 * Rotate Selection in the architecture notes).
 */

class ResizeSelectionTool extends window.PAE.Tool {
  constructor() {
    super('scale', 'Resize Selection', 'default');
    this._snapshot = null;
    this._sel = null;
  }

  onActivate(ctx) {
    const sel = ctx.getSelection ? ctx.getSelection() : null;
    this._sel = sel || null;
    this._snapshot = sel ? ctx.buffer.clone() : null;
    if (sel) ctx.history.commit(); // one undo step for the whole resize, however many times the slider moves
  }

  onDeactivate() {
    this._snapshot = null;
    this._sel = null;
  }

  hasSelection() {
    return !!this._sel;
  }

  /**
   * Re-applies a scale of `factor` (e.g. 2 = 200%, or an integer "Rigid"
   * block size) from scratch against the original snapshot. Called by the
   * toolbar's Scale/Block sliders on every `input` event.
   */
  applyScale(ctx, factor) {
    if (!this._snapshot || !this._sel || !(factor > 0)) return;
    const buf = ctx.buffer;
    const sel = this._sel;
    const snapshot = this._snapshot;
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    const newW = Math.max(1, Math.round(sel.w * factor));
    const newH = Math.max(1, Math.round(sel.h * factor));
    const destX0 = Math.round(cx - newW / 2);
    const destY0 = Math.round(cy - newH / 2);

    // Clear the ORIGINAL selection's footprint first — the new, re-centered
    // result may be smaller than it (shrinking) or simply not fully overlap
    // it, so without this a shrink would leave stale source-sized pixels
    // lingering around the edges.
    for (let y = sel.y; y < sel.y + sel.h; y++) {
      for (let x = sel.x; x < sel.x + sel.w; x++) buf.setPixel(x, y, [0, 0, 0, 0]);
    }

    for (let dy = 0; dy < newH; dy++) {
      for (let dx = 0; dx < newW; dx++) {
        const destX = destX0 + dx;
        const destY = destY0 + dy;
        if (!buf.inBounds(destX, destY)) continue;
        // Nearest-neighbor: which source pixel (within the original
        // selection) does this destination pixel land on?
        const srcRx = Math.min(sel.w - 1, Math.floor(dx / factor));
        const srcRy = Math.min(sel.h - 1, Math.floor(dy / factor));
        if (sel.mask && !sel.mask[srcRy * sel.w + srcRx]) continue; // outside the object/layer's exact shape
        const value = snapshot.getPixel(sel.x + srcRx, sel.y + srcRy) || [0, 0, 0, 0];
        buf.setPixel(destX, destY, value);
      }
    }
    ctx.requestRender();

    // Keep the app's CURRENT selection in step with what just got painted
    // (clipped to the canvas), so a follow-up Copy/Cut/further-resize acts
    // on the NEW footprint rather than the pre-scale one. `this._sel` itself
    // is left untouched — every future slider move still re-derives from the
    // frozen original, exactly as documented above.
    const clippedX = Math.max(0, destX0);
    const clippedY = Math.max(0, destY0);
    const clippedW = Math.min(buf.width, destX0 + newW) - clippedX;
    const clippedH = Math.min(buf.height, destY0 + newH) - clippedY;
    if (clippedW <= 0 || clippedH <= 0) return;
    let newMask = null;
    if (sel.mask) {
      newMask = new Uint8Array(clippedW * clippedH);
      for (let y = 0; y < clippedH; y++) {
        for (let x = 0; x < clippedW; x++) {
          const dx = clippedX + x - destX0;
          const dy = clippedY + y - destY0;
          const srcRx = Math.min(sel.w - 1, Math.floor(dx / factor));
          const srcRy = Math.min(sel.h - 1, Math.floor(dy / factor));
          newMask[y * clippedW + x] = sel.mask[srcRy * sel.w + srcRx];
        }
      }
    }
    ctx.setSelection({ x: clippedX, y: clippedY, w: clippedW, h: clippedH, mask: newMask });
  }
}

window.PAE = window.PAE || {};
window.PAE.ResizeSelectionTool = ResizeSelectionTool;
