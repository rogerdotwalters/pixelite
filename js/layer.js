/**
 * layer.js
 * ---------------------------------------------------------------------------
 * A single layer within a frame: a name, a visibility flag, its own
 * PixelBuffer, and an "acts as object" flag. Frames (see spriteProject.js)
 * hold an ARRAY of these — `layers[0]` is the bottom of the stack, the last
 * entry is the top — composited together via `PixelBuffer.compositeLayers()`
 * for anything that needs to actually SHOW the frame (the main canvas,
 * onion-skin references, filmstrip thumbnails, export). Tools only ever
 * read/write the ACTIVE layer's buffer directly (see Frame.buffer in
 * spriteProject.js); nothing else needs to know layers exist.
 *
 * `actAsObject`: set from the Layers panel's per-row icon (see
 * layersPanel.js). When true, this layer behaves like a single selectable
 * "object" rather than a plain paintable surface — becoming the active
 * layer (by clicking its row OR its icon; see App.setActiveLayer) auto-
 * selects its whole painted footprint, exactly like the Pixel Selection
 * tool's "Layer" mode, so the Layer Array feature (see App.promptLayerArray)
 * always has something to repeat and a pivot to repeat it around. There's
 * no separate stored pivot point — it's always re-derived fresh from the
 * layer's current content (PixelBuffer.boundingBoxOfContent) whenever it's
 * needed, so moving/repainting the layer's content just works without this
 * flag ever going stale.
 *
 * `rotationOrigin`: Roger's ask — "the program needs to save the original
 * state of the thing being rotated to preserve data loss. So even at 180
 * deg, the original 0 deg object will remain to be the object that is
 * actually being rotated... two different objects will need to be stored
 * on the one object." Both Rotate Selection and the Object tool's rotate
 * handle bake their result into real pixels on every commit (a deliberate
 * earlier choice — transforms stay destructive, not live/re-adjustable),
 * which means naively re-rotating the ALREADY-rotated, already-resampled
 * pixels a second time compounds nearest-neighbor resampling loss and the
 * "box doesn't grow to fit the diagonal" corner-clipping every time — two
 * separate 90° drags landing you somewhere visibly worse than one 180°
 * drag would have. `rotationOrigin`, when set, is exactly the "two
 * objects on the one object" Roger described: `{buffer, angle}`, the
 * layer's own pixels from the LAST time they were known to be trustworthy
 * (never just re-derived from an already-rotated bake) plus how far
 * (cumulative degrees) they've been rotated from that pristine state to
 * reach the CURRENT on-screen result. A fresh rotate gesture always
 * resamples from `buffer` at a NEW total angle, never from whatever's
 * currently baked onto the layer — see `resolveRotationBase`/
 * `storeRotationBase` below, and `PixelBuffer.rotateLocal` in
 * pixelBuffer.js for the shared rotate-around-own-center math both rotate
 * tools and this verification step all use identically.
 */

class Layer {
  /**
   * @param {string} name
   * @param {PAE.PixelBuffer} buffer
   * @param {boolean} [visible]
   * @param {boolean} [actAsObject]
   * @param {{buffer: PAE.PixelBuffer, angle: number}|null} [rotationOrigin]
   */
  constructor(name, buffer, visible = true, actAsObject = false, rotationOrigin = null) {
    this.id = Layer._nextId++;
    this.name = name;
    this.buffer = buffer;
    this.visible = visible;
    this.actAsObject = actAsObject;
    this.rotationOrigin = rotationOrigin;
  }

  /** Deep copy, including the pixel data — used by undo/redo snapshots and frame duplication. Keeps the same `id` so UI selection doesn't jump around across an undo. */
  clone() {
    const copy = new Layer(this.name, this.buffer.clone(), this.visible, this.actAsObject, Layer._cloneRotationOrigin(this.rotationOrigin));
    copy.id = this.id;
    return copy;
  }

  static _cloneRotationOrigin(origin) {
    if (!origin) return null;
    return { buffer: origin.buffer.clone(), angle: origin.angle };
  }

  /**
   * Returns `{buffer, angle}` to resample FROM for a brand-new rotate
   * gesture over bounding box `sel` (`{x, y, w, h, mask?}`) on this layer —
   * called once at the START of a rotate (RotateSelectionTool.onActivate,
   * ObjectTool.onMouseDown's rotate branch), never mid-drag.
   *
   * Reuses the stored `rotationOrigin` if, and only if, re-rotating it by
   * its own recorded `angle` produces PIXEL-IDENTICAL content to what's
   * actually sitting in `sel` on the layer right now (verified with
   * `PixelBuffer.equalPixels`, not merely assumed). That single check is
   * deliberately what stands in for tracking every possible way a layer's
   * pixels can change (a brush stroke, a move, a scale, undo/redo, another
   * rotate started from the slider instead of the drag handle, ...): if
   * NOTHING has touched this box since the origin was stored, regenerating
   * it must reproduce exactly what's there, byte for byte — nearest-
   * neighbor resampling is deterministic. If anything else painted here
   * (or the box changed size — e.g. after a Scale, which is destructive on
   * its own and isn't what this feature is protecting), the check fails
   * and the CURRENT pixels become the new, honest "0°" reference instead —
   * this can never itself discard anything, since it only ever remembers
   * what's already actually there.
   *
   * A moved-but-not-resized object (translation only, no resampling) keeps
   * verifying successfully with no special-casing needed: the check
   * compares LOCAL, position-independent content — the object's own
   * shape/colors relative to its own box — so where that box currently
   * sits on the canvas never enters into it.
   *
   * @param {{x:number,y:number,w:number,h:number,mask?:Uint8Array}} sel
   * @param {{maskAware?: boolean}} [opts] `maskAware: true` (the Object
   *   tool only — see ObjectTool._paintRotate) pre-zeros whatever `sel`'s
   *   mask excludes when capturing a FRESH base, matching what that
   *   caller's own mask-gated writes already leave there, so later
   *   verification keeps succeeding for a non-rectangular selection
   *   instead of re-capturing every single gesture. Rotate Selection
   *   deliberately leaves this off (its default): it always rotates the
   *   WHOLE bounding box regardless of any mask (a separate, pre-existing,
   *   documented gap — see rotateSelectionTool.js), so pre-zeroing here
   *   would destroy box content that tool actually intends to carry along.
   */
  resolveRotationBase(sel, { maskAware = false } = {}) {
    const PixelBuffer = window.PAE.PixelBuffer;
    const current = PixelBuffer.extractRegion(this.buffer, sel.x, sel.y, sel.w, sel.h);
    const origin = this.rotationOrigin;
    if (origin && origin.buffer.width === sel.w && origin.buffer.height === sel.h) {
      const expected = PixelBuffer.rotateLocal(origin.buffer, origin.angle);
      if (PixelBuffer.equalPixels(current, expected)) {
        return { buffer: origin.buffer, angle: origin.angle };
      }
    }
    if (maskAware && sel.mask) {
      for (let ry = 0; ry < sel.h; ry++) {
        for (let rx = 0; rx < sel.w; rx++) {
          if (!sel.mask[ry * sel.w + rx]) current.setPixel(rx, ry, [0, 0, 0, 0]);
        }
      }
    }
    return { buffer: current, angle: 0 };
  }

  /** Persists the result of a rotate gesture as this layer's new `rotationOrigin` — `base` is whatever buffer `resolveRotationBase` handed back (the pristine source, untouched), `angle` is the new cumulative total. Normalizes to [0, 360) so the stored value doesn't grow without bound across many rotations. */
  storeRotationBase(base, angle) {
    this.rotationOrigin = { buffer: base, angle: ((angle % 360) + 360) % 360 };
  }
}

Layer._nextId = 1;

window.PAE = window.PAE || {};
window.PAE.Layer = Layer;
