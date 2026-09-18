/**
 * layer.js
 * ---------------------------------------------------------------------------
 * A single layer within a frame: a name, a visibility flag, and its own
 * PixelBuffer. Frames (see spriteProject.js) hold an ARRAY of these —
 * `layers[0]` is the bottom of the stack, the last entry is the top —
 * composited together via `PixelBuffer.compositeLayers()` for anything that
 * needs to actually SHOW the frame (the main canvas, onion-skin references,
 * filmstrip thumbnails, export). Tools only ever read/write the ACTIVE
 * layer's buffer directly (see Frame.buffer in spriteProject.js); nothing
 * else needs to know layers exist.
 */

class Layer {
  /**
   * @param {string} name
   * @param {PAE.PixelBuffer} buffer
   * @param {boolean} [visible]
   */
  constructor(name, buffer, visible = true) {
    this.id = Layer._nextId++;
    this.name = name;
    this.buffer = buffer;
    this.visible = visible;
  }

  /** Deep copy, including the pixel data — used by undo/redo snapshots and frame duplication. Keeps the same `id` so UI selection doesn't jump around across an undo. */
  clone() {
    const copy = new Layer(this.name, this.buffer.clone(), this.visible);
    copy.id = this.id;
    return copy;
  }
}

Layer._nextId = 1;

window.PAE = window.PAE || {};
window.PAE.Layer = Layer;
