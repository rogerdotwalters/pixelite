/**
 * tools/objectTool.js
 * ---------------------------------------------------------------------------
 * Roger's ask: "I need to be able to convert object I cut and paste and
 * also the layers themselves into objects that can be rotated etc" — a
 * proper on-canvas transform tool (drag handles, not toolbar sliders) for
 * whatever the ACTIVE layer's current "object" selection is.
 *
 * It doesn't invent a new kind of object — it reads `ctx.getSelection()`,
 * the exact same selection Rotate Selection / Resize Selection already
 * transform via their sliders. What makes something show handles here is
 * just having a current selection, and two things now put one there
 * automatically instead of requiring a trip through the Pixel Selection
 * tool first:
 *   - A layer flagged "Acts as Object" (the Layers panel's ◆ icon) always
 *     auto-selects its own whole painted footprint the moment it becomes
 *     the active layer (App.setActiveLayer/selectActiveLayerAsObject).
 *   - As of this round, Paste (Ctrl+V) always lands on a brand-new layer
 *     flagged that same way (see App.pasteSelection) — so anything you
 *     paste is instantly grabbable here, no extra steps.
 * You can still reach this tool's handles for an ad-hoc Rect/Layer/Object
 * mode selection made with the Pixel Selection tool, too — it's a more
 * direct way to drive the same underlying transform, not a separate one.
 *
 * Roger's Round-F follow-up: clicking a handle/body still needs an
 * existing selection to hit-test against — but clicking directly on a
 * painted pixel that ISN'T currently selected (nothing selected yet, or
 * the click missed the current selection's box entirely) now falls back
 * to `ctx.pickObjectAt(x, y)` (see App.pickObjectAt), which grabs whatever
 * eligible layer is under the cursor (the active layer first, then any
 * other layer flagged "Acts as Object") and selects its footprint on the
 * spot. That selection is then immediately draggable in the SAME
 * mousedown-to-mouseup gesture — no separate select-first step.
 *
 * Three drag modes, chosen by WHERE the mouse goes down relative to the
 * selection's bounding box (hit-tested in fractional image-pixel space —
 * see ctx.eventToFractionalPixel/getZoom — so the handles stay easy to
 * grab at any zoom level, not just whichever zoom the box happens to be a
 * whole number of screen pixels at):
 *   - Inside the box, off any handle: MOVE the whole object.
 *   - One of the 4 corner handles: uniform SCALE, anchored at the
 *     OPPOSITE corner (drag the bottom-right handle, the top-left corner
 *     stays put).
 *   - One of the 4 edge-midpoint handles: SINGLE-AXIS scale (only that
 *     edge's axis), anchored at the opposite edge.
 *   - The small circular handle above the box: ROTATE around the box's
 *     own center. Deliberately reuses Rotate Selection's exact math and
 *     its accepted simplification: the box itself never grows to fit a
 *     rotated diagonal silhouette, so corners can clip past ~45°-ish
 *     angles — a known, already-documented gap, not a new one.
 *
 * Follows this codebase's "snapshot once per operation, then re-derive
 * from scratch on every move" convention (Rotate/Resize Selection, the
 * Smoothing Pencil): EACH drag — one mousedown-to-mouseup — takes its own
 * fresh snapshot of the active layer at mousedown, is ONE `history.commit()`,
 * and every `onMouseMove` recomputes the whole result from that one
 * snapshot rather than compounding rounding error. Releasing the mouse
 * BAKES the result into the layer's real pixels — per Roger's choice,
 * transforms stay destructive-on-commit, same as Rotate/Resize Selection —
 * and updates the selection to the new footprint, so the NEXT drag (move,
 * then rotate, then scale, in any order) just starts fresh from wherever
 * the last one left off, with no need to reselect anything in between.
 *
 * ROTATE specifically is the one mode that does NOT resample from that
 * per-drag snapshot — see the class-wide "snapshot once per operation"
 * note above and Roger's follow-up: "the program needs to save the
 * original state of the thing being rotated to preserve data loss... the
 * original 0 deg object will remain to be the object that is actually
 * being rotated." Baking a rotation on every mouseup (as move/scale
 * already do) would otherwise mean a SECOND rotate gesture resamples an
 * already-rotated, already-corner-clipped result — two separate 90° drags
 * ending up visibly worse than one continuous 180° drag. Instead, a rotate
 * drag reads/writes the active Layer's own `rotationOrigin` (see
 * `resolveRotationBase`/`storeRotationBase` in layer.js): the object's
 * verified-pristine pixels plus how far they've been rotated so far, kept
 * on the LAYER (not this tool, which is thrown away/recreated across tool
 * switches) so it survives switching to Rotate Selection and back, or
 * releasing the mouse and grabbing the rotate handle again later.
 */

const OBJECT_HANDLE_HIT_PX = 7; // screen pixels; divided by zoom for hit-testing in image space
const OBJECT_ROTATE_HANDLE_OFFSET_PX = 18; // screen pixels above the box's top edge

class ObjectTool extends window.PAE.Tool {
  constructor() {
    super('object', 'Object', 'default');
    this._mode = null; // null | 'move' | 'rotate' | 'scale'
    this._anchorSide = null; // for 'scale': 'tl'|'tr'|'bl'|'br'|'t'|'b'|'l'|'r'
    this._snapshot = null; // PixelBuffer clone of the active layer at drag-start
    this._sel = null; // the selection being transformed, AS OF drag-start
    this._startPt = null; // fractional image-pixel {x,y} at mousedown
    this._startAngle = 0; // for 'rotate': initial pointer angle around the pivot
    this._live = null; // transient in-progress result, read by the overlay (objectOverlay.js)
    this._commitSel = null; // the selection to commit at mouseup, once a drag has painted something
    this._layer = null; // the active Layer, for a rotate drag's rotationOrigin (see layer.js)
    this._rotationBase = null; // {buffer, angle} to resample FROM during a rotate drag — see Layer.resolveRotationBase
    this._commitRotation = null; // {layer, base, angle} to persist onto the layer at mouseup, once a rotate drag has painted something
  }

  onActivate() {
    this._resetDrag();
  }

  onDeactivate() {
    this._resetDrag();
  }

  _resetDrag() {
    this._mode = null;
    this._anchorSide = null;
    this._snapshot = null;
    this._sel = null;
    this._startPt = null;
    this._live = null;
    this._commitSel = null;
    this._layer = null;
    this._rotationBase = null;
    this._commitRotation = null;
  }

  onMouseDown(ctx, x, y, evt) {
    if (!evt) return;
    const pt = ctx.eventToFractionalPixel(evt);
    let sel = ctx.getSelection ? ctx.getSelection() : null;
    let hit = sel ? ObjectTool._hitTest(ctx, sel, pt) : null;
    if (!hit) {
      // No handle/body to grab on whatever's currently selected (or
      // there's no selection at all) — see if (x, y) itself is a painted
      // pixel worth picking up directly (see the class header comment and
      // App.pickObjectAt).
      if (!ctx.pickObjectAt) return;
      const picked = ctx.pickObjectAt(x, y);
      if (!picked) return;
      sel = picked;
      hit = { mode: 'move' }; // clicking straight on the object's own pixels always starts a move, never a resize/rotate
    }
    ctx.history.commit(); // one undo step for this whole drag, however many times the mouse moves
    this._mode = hit.mode;
    this._anchorSide = hit.side || null;
    this._snapshot = ctx.buffer.clone();
    this._sel = sel;
    this._startPt = pt;
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    this._startAngle = Math.atan2(pt.y - cy, pt.x - cx);
    // Rotate only: resolve the pristine source to resample from (see the
    // class header comment + Layer.resolveRotationBase) instead of relying
    // on `this._snapshot` above, which move/scale still use as-is.
    this._layer = this._mode === 'rotate' && ctx.getActiveLayer ? ctx.getActiveLayer() : null;
    this._rotationBase = this._layer ? this._layer.resolveRotationBase(sel, { maskAware: true }) : null;
    this._recompute(ctx, pt);
  }

  onMouseMove(ctx, x, y, evt) {
    if (!this._mode || !evt) return;
    this._recompute(ctx, ctx.eventToFractionalPixel(evt));
  }

  onMouseUp(ctx) {
    if (!this._mode) return;
    if (this._commitSel !== undefined) ctx.setSelection(this._commitSel);
    // Persist the rotation origin onto the layer LAST, right before the
    // drag's own state is torn down — so it survives switching tools or
    // grabbing the rotate handle again later (see the class header comment
    // and Layer.storeRotationBase).
    if (this._commitRotation) this._commitRotation.layer.storeRotationBase(this._commitRotation.base, this._commitRotation.angle);
    this._resetDrag();
  }

  onLeave(ctx) {
    // Lifting the pointer off the canvas ends the drag the same safe way
    // mouseup does — whatever was last painted stays exactly as it is.
    this.onMouseUp(ctx);
  }

  // ---- hit-testing ----------------------------------------------------

  static _hitTest(ctx, sel, pt) {
    const zoom = ctx.getZoom ? ctx.getZoom() : 12;
    const tol = OBJECT_HANDLE_HIT_PX / zoom;
    const cx = sel.x + sel.w / 2;
    const rotHandle = { x: cx, y: sel.y - OBJECT_ROTATE_HANDLE_OFFSET_PX / zoom };
    if (ObjectTool._near(pt, rotHandle, tol)) return { mode: 'rotate' };

    const corners = {
      tl: { x: sel.x, y: sel.y },
      tr: { x: sel.x + sel.w, y: sel.y },
      bl: { x: sel.x, y: sel.y + sel.h },
      br: { x: sel.x + sel.w, y: sel.y + sel.h },
    };
    for (const side in corners) {
      if (ObjectTool._near(pt, corners[side], tol)) return { mode: 'scale', side };
    }
    const edges = {
      t: { x: cx, y: sel.y },
      b: { x: cx, y: sel.y + sel.h },
      l: { x: sel.x, y: sel.y + sel.h / 2 },
      r: { x: sel.x + sel.w, y: sel.y + sel.h / 2 },
    };
    for (const side in edges) {
      if (ObjectTool._near(pt, edges[side], tol)) return { mode: 'scale', side };
    }
    if (pt.x >= sel.x && pt.x <= sel.x + sel.w && pt.y >= sel.y && pt.y <= sel.y + sel.h) {
      return { mode: 'move' };
    }
    return null;
  }

  static _near(pt, target, tol) {
    return Math.abs(pt.x - target.x) <= tol && Math.abs(pt.y - target.y) <= tol;
  }

  // ---- recompute: restore the drag-start snapshot, then repaint fresh ----

  _recompute(ctx, pt) {
    const buf = ctx.buffer;
    const sel = this._sel;
    buf.copyFrom(this._snapshot);
    // Clear the ORIGINAL footprint first — every mode below paints a
    // (possibly moved/resized) rectangle, and the old one must not linger
    // underneath it once that rectangle is no longer the same one.
    for (let y = sel.y; y < sel.y + sel.h; y++) {
      for (let x = sel.x; x < sel.x + sel.w; x++) buf.setPixel(x, y, [0, 0, 0, 0]);
    }

    if (this._mode === 'move') this._paintMove(buf, sel, pt);
    else if (this._mode === 'scale') this._paintScale(buf, sel, pt);
    else if (this._mode === 'rotate') this._paintRotate(buf, sel, pt);

    ctx.requestRender();
  }

  _paintMove(buf, sel, pt) {
    const snapshot = this._snapshot;
    const dx = Math.round(pt.x - this._startPt.x);
    const dy = Math.round(pt.y - this._startPt.y);
    const destX0 = sel.x + dx;
    const destY0 = sel.y + dy;
    for (let ry = 0; ry < sel.h; ry++) {
      for (let rx = 0; rx < sel.w; rx++) {
        if (sel.mask && !sel.mask[ry * sel.w + rx]) continue;
        const value = snapshot.getPixel(sel.x + rx, sel.y + ry) || [0, 0, 0, 0];
        buf.setPixel(destX0 + rx, destY0 + ry, value);
      }
    }
    this._live = { x: destX0, y: destY0, w: sel.w, h: sel.h, angleDeg: 0 };
    this._commitSel = ObjectTool._clipSel(buf, destX0, destY0, sel.w, sel.h, sel.mask);
  }

  _paintScale(buf, sel, pt) {
    const snapshot = this._snapshot;
    const side = this._anchorSide;
    // Each axis's anchor is whichever edge/corner of THAT axis is NOT being
    // dragged — composing the two independently gives the right opposite
    // corner for a corner handle, and leaves the untouched axis alone
    // entirely for an edge handle (see the class header's per-mode summary).
    const anchorX = side.includes('l') ? sel.x + sel.w : side.includes('r') ? sel.x : sel.x + sel.w / 2;
    const anchorY = side.includes('t') ? sel.y + sel.h : side.includes('b') ? sel.y : sel.y + sel.h / 2;

    let newW = sel.w;
    let newH = sel.h;
    if (side.includes('l') || side.includes('r')) newW = Math.max(1, Math.round(Math.abs(pt.x - anchorX)));
    if (side.includes('t') || side.includes('b')) newH = Math.max(1, Math.round(Math.abs(pt.y - anchorY)));

    const destX0 = side.includes('l') ? Math.round(anchorX - newW) : side.includes('r') ? Math.round(anchorX) : sel.x;
    const destY0 = side.includes('t') ? Math.round(anchorY - newH) : side.includes('b') ? Math.round(anchorY) : sel.y;
    const scaleX = newW / sel.w;
    const scaleY = newH / sel.h;

    let newMask = null;
    if (sel.mask) newMask = new Uint8Array(newW * newH);
    for (let dy = 0; dy < newH; dy++) {
      for (let dx = 0; dx < newW; dx++) {
        const srcRx = Math.min(sel.w - 1, Math.floor(dx / scaleX));
        const srcRy = Math.min(sel.h - 1, Math.floor(dy / scaleY));
        const masked = sel.mask && !sel.mask[srcRy * sel.w + srcRx];
        if (newMask) newMask[dy * newW + dx] = masked ? 0 : 1;
        if (masked) continue;
        const value = snapshot.getPixel(sel.x + srcRx, sel.y + srcRy) || [0, 0, 0, 0];
        buf.setPixel(destX0 + dx, destY0 + dy, value);
      }
    }
    this._live = { x: destX0, y: destY0, w: newW, h: newH, angleDeg: 0 };
    this._commitSel = ObjectTool._clipSel(buf, destX0, destY0, newW, newH, newMask);
  }

  _paintRotate(buf, sel, pt) {
    if (!this._rotationBase) return; // shouldn't happen (no active layer?) — bail out rather than paint garbage
    const cx = sel.x + sel.w / 2;
    const cy = sel.y + sel.h / 2;
    const deltaDeg = ((Math.atan2(pt.y - cy, pt.x - cx) - this._startAngle) * 180) / Math.PI;
    const totalAngle = this._rotationBase.angle + deltaDeg;
    // Resample from the LAYER's pristine, verified-unrotated buffer at the
    // TOTAL angle-from-original — never from `this._snapshot` (this
    // drag's start state, which may itself already be a rotated,
    // corner-clipped result) — see the class header comment and
    // Layer.resolveRotationBase in layer.js.
    const rotated = window.PAE.PixelBuffer.rotateLocal(this._rotationBase.buffer, totalAngle);
    for (let ry = 0; ry < sel.h; ry++) {
      for (let rx = 0; rx < sel.w; rx++) {
        if (sel.mask && !sel.mask[ry * sel.w + rx]) continue;
        const value = rotated.getPixel(rx, ry) || [0, 0, 0, 0];
        buf.setPixel(sel.x + rx, sel.y + ry, value);
      }
    }
    this._live = { x: sel.x, y: sel.y, w: sel.w, h: sel.h, angleDeg: totalAngle };
    this._commitSel = sel; // rotate never changes the bounding box or mask
    this._commitRotation = { layer: this._layer, base: this._rotationBase.buffer, angle: totalAngle };
  }

  /** Clips a candidate {x,y,w,h,mask} to the buffer's own bounds, resampling the mask along with it — same convention ResizeSelectionTool.applyScale already uses so a moved/scaled object dragged partway off-canvas doesn't leave a stale, larger selection behind. Returns null if nothing is left on-canvas. */
  static _clipSel(buf, x, y, w, h, mask) {
    const clippedX = Math.max(0, x);
    const clippedY = Math.max(0, y);
    const clippedW = Math.min(buf.width, x + w) - clippedX;
    const clippedH = Math.min(buf.height, y + h) - clippedY;
    if (clippedW <= 0 || clippedH <= 0) return null;
    let clippedMask = null;
    if (mask) {
      clippedMask = new Uint8Array(clippedW * clippedH);
      for (let cy = 0; cy < clippedH; cy++) {
        for (let cx = 0; cx < clippedW; cx++) {
          const mx = clippedX + cx - x;
          const my = clippedY + cy - y;
          clippedMask[cy * clippedW + cx] = mask[my * w + mx];
        }
      }
    }
    return { x: clippedX, y: clippedY, w: clippedW, h: clippedH, mask: clippedMask };
  }

  /**
   * Read back by objectOverlay.js: the live in-progress drag's box if
   * one's underway, otherwise whatever the active layer's current
   * selection is. Returns null if there's nothing to show handles for.
   */
  getOverlayBox(ctx) {
    if (this._mode && this._live) return this._live;
    const sel = ctx.getSelection ? ctx.getSelection() : null;
    if (!sel) return null;
    return { x: sel.x, y: sel.y, w: sel.w, h: sel.h, angleDeg: 0 };
  }
}

window.PAE = window.PAE || {};
window.PAE.ObjectTool = ObjectTool;
